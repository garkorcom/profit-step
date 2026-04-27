/**
 * InMemoryTaskRepository — Map-backed implementation of TaskRepository.
 *
 * Used in unit tests + application-handler tests. Honors basic filter
 * semantics; advanced filters (full-text search, complex orderBy) return
 * unsorted full set.
 */

import type { Task, UserRef } from '../../domain/Task';
import type { TaskId, CompanyId } from '../../domain/identifiers';
import { StaleVersion } from '../../domain/errors';
import type {
  TaskRepository,
  TaskFilter,
  ListOptions,
  PageResult,
  PartialTaskUpdate,
} from '../../ports/repositories/TaskRepository';

export class InMemoryTaskRepository implements TaskRepository {
  private store = new Map<TaskId, Task>();

  // ─── helpers for tests ─────────────────────────────────────
  seed(tasks: Task[]): void {
    for (const t of tasks) this.store.set(t.id, { ...t });
  }
  clear(): void {
    this.store.clear();
  }
  size(): number {
    return this.store.size;
  }

  // ─── TaskRepository ────────────────────────────────────────
  async findById(id: TaskId): Promise<Task | null> {
    const t = this.store.get(id);
    return t ? cloneTask(t) : null;
  }

  async findByIds(ids: TaskId[]): Promise<Task[]> {
    const result: Task[] = [];
    for (const id of ids) {
      const t = this.store.get(id);
      if (t) result.push(cloneTask(t));
    }
    return result;
  }

  async findMany(filter: TaskFilter, options: ListOptions = {}): Promise<PageResult<Task>> {
    let items = [...this.store.values()].filter((t) => match(t, filter));

    if (options.orderBy) {
      const dir = options.direction === 'desc' ? -1 : 1;
      const key = options.orderBy;
      items.sort((a, b) => compareByKey(a, b, key) * dir);
    }

    const limit = options.limit ?? 50;
    items = items.slice(0, limit);
    return {
      items: items.map(cloneTask),
      nextCursor: null,
      total: this.store.size,
    };
  }

  async findSubtasks(parentId: TaskId): Promise<Task[]> {
    return [...this.store.values()]
      .filter((t) => t.parentTaskId === parentId)
      .map(cloneTask);
  }

  async findByDependsOn(
    taskId: TaskId,
    companyId?: CompanyId,
  ): Promise<Task[]> {
    // Mirror the Firestore adapter: when companyId is omitted the mock
    // returns matches across all tenants (legacy/test path); when supplied
    // it scopes to the tenant before returning. Production callers SHOULD
    // pass companyId — see TaskRepository port doc.
    return [...this.store.values()]
      .filter(
        (t) =>
          (t.dependsOn ?? []).some((d) => d.taskId === taskId) &&
          (companyId === undefined || t.companyId === companyId),
      )
      .map(cloneTask);
  }

  async save(task: Task): Promise<void> {
    this.store.set(task.id, cloneTask(task));
  }

  async saveMany(tasks: Task[]): Promise<void> {
    for (const t of tasks) this.store.set(t.id, cloneTask(t));
  }

  async patch(id: TaskId, partial: PartialTaskUpdate): Promise<void> {
    const existing = this.store.get(id);
    if (!existing) return;
    this.store.set(id, { ...existing, ...partial } as Task);
  }

  /**
   * Idempotent append that mirrors Firestore `FieldValue.arrayUnion`
   * semantics — values already present are not duplicated. The mock models
   * the race-safety property by atomic-update under the JS event loop:
   * two awaited calls cannot interleave between read and write here.
   */
  async appendToArray(id: TaskId, field: keyof Task, values: unknown[]): Promise<void> {
    if (values.length === 0) return;
    const existing = this.store.get(id);
    if (!existing) return;
    const current = (existing[field] as unknown[]) ?? [];
    const out = [...current];
    for (const v of values) {
      if (!out.includes(v)) out.push(v);
    }
    this.store.set(id, { ...existing, [field]: out } as Task);
  }

  async softDelete(id: TaskId, archivedBy: UserRef): Promise<void> {
    const existing = this.store.get(id);
    if (!existing) return;
    this.store.set(id, {
      ...existing,
      archivedAt: Date.now(),
      archivedBy: archivedBy.id as Task['archivedBy'],
    });
  }

  async saveIfUnchanged(task: Task, expectedUpdatedAt: number): Promise<void> {
    const current = this.store.get(task.id);
    if (current && current.updatedAt !== expectedUpdatedAt) {
      throw new StaleVersion(task.id, expectedUpdatedAt);
    }
    this.store.set(task.id, cloneTask(task));
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────

function cloneTask(t: Task): Task {
  // Shallow-deep clone via JSON. Sufficient for tests; arrays/objects re-created.
  return JSON.parse(JSON.stringify(t)) as Task;
}

function match(t: Task, filter: TaskFilter): boolean {
  if (filter.companyId && t.companyId !== filter.companyId) return false;
  if (filter.lifecycle && filter.lifecycle.length > 0 && !filter.lifecycle.includes(t.lifecycle))
    return false;
  if (filter.bucket && filter.bucket.length > 0 && !filter.bucket.includes(t.bucket))
    return false;
  if (filter.assigneeId && t.assignedTo.id !== filter.assigneeId) return false;
  if (filter.parentTaskId === null && t.parentTaskId) return false;
  if (filter.parentTaskId && t.parentTaskId !== filter.parentTaskId) return false;
  if (filter.projectId && t.projectId !== filter.projectId) return false;
  if (filter.clientId && t.clientId !== filter.clientId) return false;
  if (filter.isSubtask !== undefined && t.isSubtask !== filter.isSubtask) return false;
  if (filter.archivedOnly === true && !t.archivedAt) return false;
  if (filter.archivedOnly === false && t.archivedAt) return false;
  if (filter.dueBefore !== undefined && (t.dueAt ?? Number.POSITIVE_INFINITY) >= filter.dueBefore)
    return false;
  if (filter.search) {
    const s = filter.search.toLowerCase();
    const inTitle = t.title?.toLowerCase().includes(s);
    const inDesc = t.description?.toLowerCase().includes(s);
    if (!inTitle && !inDesc) return false;
  }
  return true;
}

function compareByKey(a: Task, b: Task, key: NonNullable<ListOptions['orderBy']>): number {
  if (key === 'priority') {
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    return order[a.priority] - order[b.priority];
  }
  const av = a[key as keyof Task] as unknown;
  const bv = b[key as keyof Task] as unknown;
  if (typeof av === 'number' && typeof bv === 'number') return av - bv;
  return String(av).localeCompare(String(bv));
}
