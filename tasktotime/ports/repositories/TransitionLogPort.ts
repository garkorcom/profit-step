/**
 * TransitionLogPort — append-only audit log for lifecycle transitions.
 *
 * Persisted alongside `task.history[]`. The independent log feeds compliance,
 * BigQuery, and reporting; `task.history` feeds UI timelines. Both are
 * written together in the same transaction by adapters.
 *
 * See spec/03-state-machine/transitions.md §"История transitions".
 */

import type { TaskId, CompanyId } from '../../domain/identifiers';
import type { UserRef } from '../../domain/Task';
import type { TaskLifecycle } from '../../domain/lifecycle';

export interface TransitionLogEntry {
  /** id format: `${taskId}_${from}_${to}_${at}` (deterministic, idempotent). */
  id: string;
  companyId: CompanyId;
  taskId: TaskId;
  /** null = creation event. */
  from: TaskLifecycle | null;
  to: TaskLifecycle;
  /** 'create' | 'ready' | 'start' | 'block' | 'unblock' | 'complete' | 'accept' | 'cancel'. */
  action: string;
  reason?: string;
  by: UserRef;
  /** epoch ms. */
  at: number;
  meta?: Record<string, unknown>;
}

export interface TransitionLogPort {
  append(entry: TransitionLogEntry): Promise<void>;
  findForTask(taskId: TaskId, limit?: number): Promise<TransitionLogEntry[]>;
  findForCompany(
    companyId: CompanyId,
    sinceMs?: number,
    limit?: number,
  ): Promise<TransitionLogEntry[]>;
}
