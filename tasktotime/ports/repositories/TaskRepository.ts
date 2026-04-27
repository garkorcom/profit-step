/**
 * TaskRepository — read/write port for tasktotime_tasks.
 *
 * Pure interface, zero Firebase imports. See spec/04-storage/data-dependencies.md
 * for full I/O inventory motivating each method.
 *
 * Conventions (blueprint §Section 2):
 *   - All methods async.
 *   - `null` for not-found, NOT `undefined`.
 *   - `softDelete` is the canonical archival path; never hard-delete from domain.
 *   - `saveIfUnchanged` provides optimistic concurrency.
 */

import type { Task } from '../../domain/Task';
import type { TaskId, CompanyId, UserId } from '../../domain/identifiers';
import type { UserRef } from '../../domain/Task';
import type { TaskLifecycle } from '../../domain/lifecycle';

export interface TaskFilter {
  companyId: CompanyId;
  lifecycle?: TaskLifecycle[];
  bucket?: Array<'inbox' | 'next' | 'someday' | 'archive'>;
  assigneeId?: UserId;
  /** null = root tasks only (no parentTaskId). */
  parentTaskId?: TaskId | null;
  projectId?: string;
  clientId?: string;
  isSubtask?: boolean;
  archivedOnly?: boolean;
  /** epoch ms — tasks with dueAt before this. */
  dueBefore?: number;
  /** Free text search (delegated to adapter). */
  search?: string;
}

export interface ListOptions {
  /** default 50, max 500. */
  limit?: number;
  /** Opaque pagination cursor. */
  cursor?: string;
  /**
   * Sort key. `'titleLowercase'` is reserved for adapters that pair an
   * inequality range filter on the same field (the prefix-match search
   * path); see `TaskFilter.search`.
   */
  orderBy?:
    | 'createdAt'
    | 'updatedAt'
    | 'dueAt'
    | 'priority'
    | 'taskNumber'
    | 'titleLowercase';
  direction?: 'asc' | 'desc';
}

export interface PageResult<T> {
  items: T[];
  nextCursor: string | null;
  /** Optional — adapter may not provide (count is expensive). */
  total?: number;
}

/**
 * Subset of Task fields. Adapter responsible for write-time validation.
 * Use carefully — bypasses transition machine. Reserved for system writes
 * (computed fields, denormalization sync). Lifecycle changes MUST go via
 * the transition log path.
 */
export interface PartialTaskUpdate {
  [key: string]: unknown;
}

export interface TaskRepository {
  findById(id: TaskId): Promise<Task | null>;
  findByIds(ids: TaskId[]): Promise<Task[]>;
  findMany(filter: TaskFilter, options?: ListOptions): Promise<PageResult<Task>>;
  findSubtasks(parentId: TaskId): Promise<Task[]>;
  /** Reverse query for cycle detection / cascade. */
  findByDependsOn(taskId: TaskId): Promise<Task[]>;

  save(task: Task): Promise<void>;
  /** Batch save — atomic per adapter. */
  saveMany(tasks: Task[]): Promise<void>;
  patch(id: TaskId, partial: PartialTaskUpdate): Promise<void>;

  softDelete(id: TaskId, archivedBy: UserRef): Promise<void>;

  /**
   * Optimistic concurrency: throws StaleVersion if `task.updatedAt` does not
   * match `expectedUpdatedAt` in storage.
   */
  saveIfUnchanged(task: Task, expectedUpdatedAt: number): Promise<void>;
}
