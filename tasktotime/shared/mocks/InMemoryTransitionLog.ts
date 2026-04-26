/**
 * InMemoryTransitionLog — Array-backed implementation of TransitionLogPort.
 */

import type { TaskId, CompanyId } from '../../domain/identifiers';
import type {
  TransitionLogPort,
  TransitionLogEntry,
} from '../../ports/repositories/TransitionLogPort';

export class InMemoryTransitionLog implements TransitionLogPort {
  private entries: TransitionLogEntry[] = [];

  // ─── helpers for tests ─────────────────────────────────────
  all(): TransitionLogEntry[] {
    return [...this.entries];
  }
  clear(): void {
    this.entries = [];
  }
  count(): number {
    return this.entries.length;
  }

  // ─── TransitionLogPort ─────────────────────────────────────
  async append(entry: TransitionLogEntry): Promise<void> {
    // dedupe by id (idempotency)
    if (this.entries.some((e) => e.id === entry.id)) return;
    this.entries.push({ ...entry });
  }

  async findForTask(
    taskId: TaskId,
    limit: number = 100,
  ): Promise<TransitionLogEntry[]> {
    return this.entries
      .filter((e) => e.taskId === taskId)
      .slice(-limit)
      .map((e) => ({ ...e }));
  }

  async findForCompany(
    companyId: CompanyId,
    sinceMs?: number,
    limit: number = 200,
  ): Promise<TransitionLogEntry[]> {
    return this.entries
      .filter(
        (e) =>
          e.companyId === companyId &&
          (sinceMs === undefined || e.at >= sinceMs),
      )
      .slice(-limit)
      .map((e) => ({ ...e }));
  }
}
