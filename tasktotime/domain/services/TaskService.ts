/**
 * TaskService — orchestrates task lifecycle commands.
 *
 * Pure business logic with all I/O via injected ports. Returns
 * `TransitionOutcome` so the caller (application layer) can fan out events
 * to notify/audit adapters.
 *
 * Design notes (blueprint §3.1):
 *   - Constructor injection of all ports — no `new FirestoreXxx()` here.
 *   - All methods return Task / TransitionOutcome / DomainError — never HTTP.
 *   - Idempotency check happens BEFORE applying the transition.
 *   - Optimistic concurrency via `taskRepo.saveIfUnchanged`.
 */

import type { Task, UserRef, EpochMs } from '../Task';
import type { TaskId } from '../identifiers';
import { asUserId, asPayrollPeriodId } from '../identifiers';
import type {
  TaskLifecycle,
  TransitionAction,
} from '../lifecycle';
import { canTransition } from '../lifecycle';
import { applyTransition } from '../transitions';
import type { TransitionPayload } from '../transitions';
import { validateTaskDraft } from '../validation';
import { TransitionNotAllowed, TaskNotFound, MaxHierarchyDepth } from '../errors';
import type { DomainEvent } from '../events';
import { computeBonusPenalty } from '../policies/BonusPenaltyPolicy';

import type { TaskRepository } from '../../ports/repositories/TaskRepository';
import type { TransitionLogPort } from '../../ports/repositories/TransitionLogPort';
import type { WorkSessionPort } from '../../ports/work/WorkSessionPort';
import type { PayrollPort } from '../../ports/work/PayrollPort';
import type { IdempotencyPort } from '../../ports/ai/IdempotencyPort';
import type { ClockPort } from '../../ports/infra/ClockPort';
import type { TelegramNotifyPort } from '../../ports/notify/TelegramNotifyPort';
import type { BigQueryAuditPort } from '../../ports/infra/BigQueryAuditPort';
import type { IdGeneratorPort } from '../../ports/infra/IdGeneratorPort';

// ─── Inputs / outputs ──────────────────────────────────────────────────

/**
 * Subset of Task fields supplied by caller when creating a task.
 * Identity, timestamps, history, and lifecycle are filled by the service.
 */
export type TaskDraft = Omit<
  Task,
  'id' | 'taskNumber' | 'createdAt' | 'updatedAt' | 'history' | 'lifecycle'
>;

export interface CreateTaskInput {
  companyId: string;
  draft: TaskDraft;
  initialLifecycle: 'draft' | 'ready';
  by: UserRef;
  /** Idempotency key (e.g. request-id from HTTP layer or telegram update id). */
  idempotencyKey: string;
}

export interface TransitionInput {
  taskId: TaskId;
  action: TransitionAction;
  by: UserRef;
  reason?: string;
  /** Required when action === 'accept'. */
  acceptance?: Task['acceptance'];
  /** Required when action === 'block'. */
  blockedReason?: string;
  /** Idempotency key (deterministic — same retry hits same key). */
  idempotencyKey: string;
}

export interface TransitionOutcome {
  task: Task;
  events: DomainEvent[];
  /** True if idempotency key was already reserved (no-op). */
  skipped: boolean;
}

export interface ActualsAggregate {
  actualDurationMinutes: number;
  totalEarnings: number;
  actualStartAt: number | null;
}

// ─── Service ────────────────────────────────────────────────────────────

export interface TaskServiceDeps {
  taskRepo: TaskRepository;
  transitionLog: TransitionLogPort;
  workSessions: WorkSessionPort;
  payroll: PayrollPort;
  idempotency: IdempotencyPort;
  clock: ClockPort;
  idGenerator: IdGeneratorPort;
  /** Optional — caller may skip notifications. */
  telegram?: TelegramNotifyPort;
  /** Optional — fire-and-forget audit. */
  audit?: BigQueryAuditPort;
}

export class TaskService {
  constructor(private readonly deps: TaskServiceDeps) {}

  // ─── lifecycle commands ──────────────────────────────────────

  async createTask(input: CreateTaskInput): Promise<Task> {
    const idempotencyKey = `task.create:${input.idempotencyKey}`;
    const proceed = await this.deps.idempotency.reserve(idempotencyKey);
    if (!proceed) {
      // Already processed — caller should use existing record. We return null-ish.
      // For the simple Phase 1 contract: return whatever findById sees by the
      // generated id (not available — caller must inspect the response).
      // To keep semantics clean, we throw, matching createTask's "create or fail"
      // contract. The application handler can pre-check before calling.
      throw new Error(
        `Task creation already processed for idempotency key: ${input.idempotencyKey}`,
      );
    }

    // Hierarchy depth guard: max 2 levels — a root task can have subtasks,
    // but a subtask cannot have its own subtasks (no grand-subtasks).
    // QA 2026-04-27 P2-2 found we created chains down to L7 unbounded.
    if (input.draft.parentTaskId) {
      const parent = await this.deps.taskRepo.findById(input.draft.parentTaskId);
      if (parent?.isSubtask) {
        throw new MaxHierarchyDepth(input.draft.parentTaskId);
      }
    }

    const now = this.deps.clock.now() as EpochMs;
    const id = this.deps.idGenerator.newTaskId();
    const year = new Date(now).getUTCFullYear();
    const taskNumber = await this.deps.idGenerator.nextTaskNumber(
      input.draft.companyId,
      year,
    );

    if (input.initialLifecycle === 'ready') {
      // Validate ready preconditions on the draft (cast to Task with placeholder
      // fields since ID/taskNumber are about to be filled).
      validateTaskDraft(
        { ...input.draft, id, taskNumber, lifecycle: 'draft', createdAt: now, updatedAt: now, history: [] } as Task,
        'ready',
      );
    }

    const task: Task = {
      ...input.draft,
      id,
      taskNumber,
      lifecycle: input.initialLifecycle,
      createdAt: now,
      updatedAt: now,
      history: [
        {
          type: 'create',
          at: now,
          by: input.by,
          to: input.initialLifecycle,
          action: 'create',
        },
      ],
    };

    await this.deps.taskRepo.save(task);
    await this.deps.transitionLog.append({
      id: `${id}_null_${input.initialLifecycle}_${now}`,
      companyId: task.companyId,
      taskId: id,
      from: null,
      to: input.initialLifecycle,
      action: 'create',
      by: input.by,
      at: now,
    });

    if (this.deps.audit) {
      // Fire-and-forget — adapter swallows errors
      void this.deps.audit.log({
        eventType: 'task.created',
        companyId: task.companyId,
        actorId: input.by.id,
        taskId: id,
        occurredAt: now,
        payload: { taskNumber, initialLifecycle: input.initialLifecycle },
      });
    }

    return task;
  }

  async transition(input: TransitionInput): Promise<TransitionOutcome> {
    const idempotencyKey = `task.transition:${input.taskId}:${input.action}:${input.idempotencyKey}`;
    const proceed = await this.deps.idempotency.reserve(idempotencyKey);
    if (!proceed) {
      const existing = await this.deps.taskRepo.findById(input.taskId);
      if (!existing) throw new TaskNotFound(input.taskId);
      return { task: existing, events: [], skipped: true };
    }

    const task = await this.deps.taskRepo.findById(input.taskId);
    if (!task) throw new TaskNotFound(input.taskId);

    if (!canTransition(task.lifecycle, input.action)) {
      throw new TransitionNotAllowed(task.lifecycle, input.action, task.id);
    }

    const now = this.deps.clock.now() as EpochMs;
    const payload: TransitionPayload = {
      reason: input.reason,
      acceptance: input.acceptance,
      blockedReason: input.blockedReason,
    };

    // Pre-action enrichment for `complete`: aggregate work_sessions actuals
    let workingTask = task;
    if (input.action === 'complete') {
      const actuals = await this.aggregateActuals(task.id);
      workingTask = {
        ...task,
        actualDurationMinutes: actuals.actualDurationMinutes,
        totalEarnings: actuals.totalEarnings,
        actualStartAt: actuals.actualStartAt ?? task.actualStartAt,
      };
    }

    // Pre-action enrichment for `accept`: compute bonus/penalty on completedAt
    if (input.action === 'accept') {
      const bp = computeBonusPenalty(workingTask);
      if (bp.bonus) workingTask = { ...workingTask, bonusOnTime: bp.bonus };
      if (bp.penalty)
        workingTask = { ...workingTask, penaltyOverdue: bp.penalty };
    }

    // Apply transition (pure)
    const result = applyTransition(workingTask, input.action, payload, input.by, now);

    // Persist task with optimistic concurrency
    await this.deps.taskRepo.saveIfUnchanged(result.task, task.updatedAt);

    // Append transition log
    await this.deps.transitionLog.append({
      id: `${task.id}_${result.from}_${result.to}_${now}`,
      companyId: task.companyId,
      taskId: task.id,
      from: result.from,
      to: result.to,
      action: input.action,
      reason: input.reason,
      by: input.by,
      at: now,
    });

    // Side-effect: payroll on accept
    if (input.action === 'accept') {
      await this.maybeApplyPayroll(result.task, input.by);
    }

    // Audit
    if (this.deps.audit) {
      void this.deps.audit.log({
        eventType: 'task.transitioned',
        companyId: task.companyId,
        actorId: input.by.id,
        taskId: task.id,
        occurredAt: now,
        payload: { from: result.from, to: result.to, action: input.action },
      });
    }

    return { task: result.task, events: result.events, skipped: false };
  }

  async cancel(
    taskId: TaskId,
    by: UserRef,
    reason?: string,
    idempotencyKey?: string,
  ): Promise<TransitionOutcome> {
    return this.transition({
      taskId,
      action: 'cancel',
      by,
      reason,
      idempotencyKey: idempotencyKey ?? `cancel:${taskId}:${this.deps.clock.now()}`,
    });
  }

  // ─── pure validations ────────────────────────────────────────

  validateDraftReadyForTransition(task: Task, action: TransitionAction): void {
    if (!canTransition(task.lifecycle, action)) {
      throw new TransitionNotAllowed(task.lifecycle, action, task.id);
    }
    validateTaskDraft(task, action);
  }

  canTransition(from: TaskLifecycle, action: TransitionAction): boolean {
    return canTransition(from, action);
  }

  // ─── computed enrichment ─────────────────────────────────────

  async aggregateActuals(taskId: TaskId): Promise<ActualsAggregate> {
    const agg = await this.deps.workSessions.aggregateForTask(taskId);
    return {
      actualDurationMinutes: agg.totalDurationMinutes,
      totalEarnings: agg.totalEarnings,
      actualStartAt: agg.earliestStartAt,
    };
  }

  computeBonusPenalty(task: Task): {
    bonus?: Task['bonusOnTime'];
    penalty?: Task['penaltyOverdue'];
  } {
    return computeBonusPenalty(task);
  }

  // ─── private helpers ─────────────────────────────────────────

  private async maybeApplyPayroll(task: Task, by: UserRef): Promise<void> {
    const bp = computeBonusPenalty(task);
    if (!bp.bonus && !bp.penalty) return;

    // Default payroll period — adapter MAY override via injected resolver.
    // Phase 1: deterministic week-of-year style ID derived from acceptedAt.
    const acceptedAt = task.acceptedAt ?? this.deps.clock.now();
    const period = asPayrollPeriodId(isoWeekId(acceptedAt));
    const userId = asUserId(task.assignedTo.id);

    if (bp.bonus) {
      const exists = await this.deps.payroll.hasAdjustmentForTask(
        task.id,
        'bonus_on_time',
      );
      if (!exists) {
        await this.deps.payroll.appendAdjustment({
          companyId: task.companyId,
          userId,
          taskId: task.id,
          amount: bp.bonus,
          reason: 'bonus_on_time',
          payrollPeriodId: period,
          note: `Auto bonus for on-time delivery (by ${by.name})`,
        });
      }
    }
    if (bp.penalty) {
      const exists = await this.deps.payroll.hasAdjustmentForTask(
        task.id,
        'penalty_overdue',
      );
      if (!exists) {
        await this.deps.payroll.appendAdjustment({
          companyId: task.companyId,
          userId,
          taskId: task.id,
          amount: bp.penalty,
          reason: 'penalty_overdue',
          payrollPeriodId: period,
          note: `Auto penalty for overdue delivery (by ${by.name})`,
        });
      }
    }
  }
}

// ─── helpers ────────────────────────────────────────────────────────────

/**
 * Compute deterministic ISO-week id from epoch ms: "2026-W17". Pure.
 *
 * Uses ISO-8601 week numbering (Monday-start, week 1 contains Jan 4).
 */
export function isoWeekId(epochMs: number): string {
  const d = new Date(epochMs);
  // Move to nearest Thursday (ISO week is determined by Thursday of week)
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = Date.UTC(target.getUTCFullYear(), 0, 4);
  const week =
    1 +
    Math.round(
      ((target.getTime() - firstThursday) / 86_400_000 -
        3 +
        ((new Date(firstThursday).getUTCDay() + 6) % 7)) /
        7,
    );
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
