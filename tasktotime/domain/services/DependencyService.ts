/**
 * DependencyService — cycle detection + auto-shift cascade + CPM trigger.
 *
 * All graph algorithms live in pure modules (`dependencies.ts`,
 * `criticalPath.ts`, `autoShift.ts`). This service is the orchestration
 * layer that fetches tasks via `TaskRepository` then runs the algorithms.
 *
 * See blueprint §3.2.
 */

import type { Task, TaskDependency, UserRef, EpochMs } from '../Task';
import type { TaskId, ProjectId, CompanyId } from '../identifiers';
import {
  buildDependencyGraph,
  canAddDependency,
  assertCanAddDependency,
} from '../dependencies';
import { cascadeShift } from '../autoShift';
import type { ShiftEntry } from '../autoShift';
import { computeSchedule, applyScheduleToTask } from '../criticalPath';
import { CycleDetected, TaskNotFound, MaxHierarchyDepth } from '../errors';

import type { TaskRepository } from '../../ports/repositories/TaskRepository';
import type { ClockPort } from '../../ports/infra/ClockPort';

// ─── Public types ──────────────────────────────────────────────────────

export interface CycleCheckResult {
  ok: boolean;
  cyclePath?: TaskId[];
}

export interface AutoShiftPlan {
  taskId: TaskId;
  oldPlannedStartAt?: EpochMs;
  newPlannedStartAt: EpochMs;
  /** human-readable e.g. "predecessor T-001 completedAt shifted". */
  reason: string;
  cascadeDepth: number;
}

export interface CriticalPathSummary {
  /** Ordered IDs on the critical path. */
  taskIds: TaskId[];
  /** Slack minutes per task (0 = on critical path). */
  slackByTaskId: Record<string, number>;
  projectDurationMinutes: number;
  earliestProjectFinish: number;
  latestProjectFinish: number;
}

// ─── Service ────────────────────────────────────────────────────────────

export interface DependencyServiceDeps {
  taskRepo: TaskRepository;
  clock: ClockPort;
}

export class DependencyService {
  constructor(private readonly deps: DependencyServiceDeps) {}

  // ─── cycle prevention ────────────────────────────────────────

  async canAddDependency(
    fromTaskId: TaskId,
    toTaskId: TaskId,
  ): Promise<CycleCheckResult> {
    if (fromTaskId === toTaskId) {
      return { ok: false, cyclePath: [fromTaskId, toTaskId] };
    }
    const tasks = await this.loadGraphTasks(fromTaskId, toTaskId);
    const graph = buildDependencyGraph(tasks);
    return canAddDependency(graph, fromTaskId, toTaskId);
  }

  async canSetParent(
    taskId: TaskId,
    newParentId: TaskId | null,
  ): Promise<CycleCheckResult> {
    if (!newParentId) return { ok: true };
    if (taskId === newParentId) {
      return { ok: false, cyclePath: [taskId, newParentId] };
    }
    // Hierarchy is max 2 levels — newParent cannot itself be a subtask.
    const parent = await this.deps.taskRepo.findById(newParentId);
    if (!parent) return { ok: false, cyclePath: [newParentId] };
    if (parent.isSubtask) {
      return { ok: false, cyclePath: [parent.id, taskId] };
    }
    return { ok: true };
  }

  async addDependency(
    fromTaskId: TaskId,
    dep: Omit<TaskDependency, 'createdAt' | 'createdBy'>,
    by: UserRef,
  ): Promise<void> {
    const fromTask = await this.deps.taskRepo.findById(fromTaskId);
    if (!fromTask) throw new TaskNotFound(fromTaskId);

    const tasks = await this.loadGraphTasks(fromTaskId, dep.taskId);
    const graph = buildDependencyGraph(tasks);
    assertCanAddDependency(graph, fromTaskId, dep.taskId);

    const now = this.deps.clock.now() as EpochMs;
    const fullDep: TaskDependency = {
      ...dep,
      createdAt: now,
      createdBy: by,
    };

    const existingDeps = fromTask.dependsOn ?? [];
    const filtered = existingDeps.filter((d) => d.taskId !== dep.taskId);
    const next: Task = {
      ...fromTask,
      dependsOn: [...filtered, fullDep],
      updatedAt: now,
      history: [
        ...(fromTask.history ?? []),
        {
          type: 'dependency_added',
          at: now,
          by,
          meta: { toTaskId: dep.taskId, depType: dep.type, lagMinutes: dep.lagMinutes },
        },
      ],
    };

    await this.deps.taskRepo.saveIfUnchanged(next, fromTask.updatedAt);
  }

  async removeDependency(fromTaskId: TaskId, toTaskId: TaskId): Promise<void> {
    const fromTask = await this.deps.taskRepo.findById(fromTaskId);
    if (!fromTask) throw new TaskNotFound(fromTaskId);
    const now = this.deps.clock.now() as EpochMs;
    const next: Task = {
      ...fromTask,
      dependsOn: (fromTask.dependsOn ?? []).filter((d) => d.taskId !== toTaskId),
      updatedAt: now,
    };
    await this.deps.taskRepo.saveIfUnchanged(next, fromTask.updatedAt);
  }

  // ─── auto-shift cascade ──────────────────────────────────────

  async computeShiftPlan(triggerTaskId: TaskId): Promise<AutoShiftPlan[]> {
    const trigger = await this.deps.taskRepo.findById(triggerTaskId);
    if (!trigger) throw new TaskNotFound(triggerTaskId);

    // Project-scope: load all tasks under same projectId. Falls back to
    // `findByDependsOn(triggerTaskId)` traversal if no projectId.
    const tasks = await this.loadProjectTasks(trigger);
    const shifts = cascadeShift(tasks, triggerTaskId);
    return shifts.map((s: ShiftEntry) => ({
      taskId: s.taskId,
      oldPlannedStartAt: s.oldPlannedStartAt,
      newPlannedStartAt: s.newPlannedStartAt,
      reason: s.reason,
      cascadeDepth: s.cascadeDepth,
    }));
  }

  async applyShiftPlan(plan: AutoShiftPlan[]): Promise<void> {
    for (const entry of plan) {
      const task = await this.deps.taskRepo.findById(entry.taskId);
      if (!task) continue;
      const now = this.deps.clock.now() as EpochMs;
      const next: Task = {
        ...task,
        plannedStartAt: entry.newPlannedStartAt,
        updatedAt: now,
      };
      await this.deps.taskRepo.saveIfUnchanged(next, task.updatedAt);
    }
  }

  // ─── critical path ───────────────────────────────────────────

  /**
   * Compute the critical path for tasks scoped to `(companyId, projectId)`.
   *
   * **Cross-tenant safety.** The Firestore `findMany` filter REQUIRES a
   * companyId; passing an empty string sentinel returns 0 results because
   * no document has `companyId == ''`. Earlier revisions used such a
   * sentinel as a Phase-1 shortcut — that silently broke the schedule for
   * every project. Callers must now thread the real companyId from their
   * authentication / trigger document context.
   */
  async computeCriticalPath(
    companyId: CompanyId,
    projectId: ProjectId,
  ): Promise<CriticalPathSummary> {
    const result = await this.deps.taskRepo.findMany(
      { companyId, projectId, archivedOnly: false },
      { limit: 500 },
    );
    const schedule = computeSchedule(result.items);
    if (!schedule) {
      throw new CycleDetected([]);
    }
    const slackByTaskId: Record<string, number> = {};
    for (const e of schedule.byTaskId.values()) {
      slackByTaskId[e.taskId] = e.slack;
    }
    return {
      taskIds: schedule.criticalPath,
      slackByTaskId,
      projectDurationMinutes: schedule.projectDurationMinutes,
      earliestProjectFinish: schedule.earliestProjectFinish,
      latestProjectFinish: schedule.latestProjectFinish,
    };
  }

  /**
   * Recompute the critical path for `(companyId, projectId)` and persist
   * `slackMinutes` + `isCriticalPath` per task. See {@link computeCriticalPath}
   * for the cross-tenant safety contract.
   */
  async recomputeAndPersist(
    companyId: CompanyId,
    projectId: ProjectId,
  ): Promise<CriticalPathSummary> {
    const summary = await this.computeCriticalPath(companyId, projectId);
    // Persist slackMinutes + isCriticalPath on each task.
    const result = await this.deps.taskRepo.findMany(
      { companyId, projectId, archivedOnly: false },
      { limit: 500 },
    );
    const schedule = computeSchedule(result.items);
    if (!schedule) throw new CycleDetected([]);

    // Determine project start (earliest plannedStartAt or first task's createdAt)
    let projectStart: EpochMs = Number.POSITIVE_INFINITY as EpochMs;
    for (const t of result.items) {
      const candidate = t.plannedStartAt ?? t.createdAt;
      if (candidate < projectStart) projectStart = candidate as EpochMs;
    }
    if (!Number.isFinite(projectStart)) {
      projectStart = this.deps.clock.now() as EpochMs;
    }

    for (const task of result.items) {
      const entry = schedule.byTaskId.get(task.id);
      if (!entry) continue;
      const updated = applyScheduleToTask(task, entry, projectStart);
      if (
        updated.slackMinutes !== task.slackMinutes ||
        updated.isCriticalPath !== task.isCriticalPath
      ) {
        await this.deps.taskRepo.patch(task.id, {
          slackMinutes: updated.slackMinutes,
          isCriticalPath: updated.isCriticalPath,
          updatedAt: this.deps.clock.now(),
        });
      }
    }

    return summary;
  }

  // ─── helpers ─────────────────────────────────────────────────

  /**
   * Load tasks needed for cycle detection — both `to`'s subgraph plus
   * `from` itself. For Phase 1 we approximate by loading both tasks plus
   * the `to` subtree via `findByDependsOn`.
   */
  private async loadGraphTasks(
    fromTaskId: TaskId,
    toTaskId: TaskId,
  ): Promise<Task[]> {
    const seen = new Set<TaskId>();
    const stack: TaskId[] = [fromTaskId, toTaskId];
    const result: Task[] = [];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const t = await this.deps.taskRepo.findById(id);
      if (!t) continue;
      result.push(t);
      for (const dep of t.dependsOn ?? []) {
        if (!seen.has(dep.taskId)) stack.push(dep.taskId);
      }
    }
    return result;
  }

  private async loadProjectTasks(trigger: Task): Promise<Task[]> {
    if (trigger.projectId) {
      const page = await this.deps.taskRepo.findMany(
        {
          companyId: trigger.companyId,
          projectId: trigger.projectId,
          archivedOnly: false,
        },
        { limit: 500 },
      );
      return page.items;
    }
    // Fallback: BFS over blocksTaskIds reverse index
    const seen = new Set<TaskId>();
    const stack: TaskId[] = [trigger.id];
    const result: Task[] = [];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const t = await this.deps.taskRepo.findById(id);
      if (!t) continue;
      result.push(t);
      const successors = await this.deps.taskRepo.findByDependsOn(id);
      for (const s of successors) {
        if (!seen.has(s.id)) {
          stack.push(s.id);
        }
      }
    }
    return result;
  }
}

// Re-export for tests / external typing reference (not used internally above)
export type { MaxHierarchyDepth };
