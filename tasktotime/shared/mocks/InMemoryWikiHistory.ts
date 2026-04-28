/**
 * InMemoryWikiHistory — Map-backed implementation of WikiHistoryPort.
 *
 * Mirrors the production adapter's idempotent-set semantics: re-appending
 * the same `(taskId, version)` pair overwrites the previous entry rather
 * than duplicating, so handler retries (e.g. an idempotency reservation
 * race) don't pollute the archive.
 */

import type { TaskId } from '../../domain/identifiers';
import type {
  WikiHistoryPort,
  WikiHistoryEntry,
} from '../../ports/repositories/WikiHistoryPort';

/**
 * Compose the storage key — `${taskId}::v${version}`. Mirrors the
 * deterministic doc id used by the Firestore adapter
 * (`tasktotime_tasks/{taskId}/wiki_history/v${version}`).
 */
function storageKey(taskId: TaskId, version: number): string {
  return `${taskId}::v${version}`;
}

export class InMemoryWikiHistory implements WikiHistoryPort {
  /** Internal store keyed by `${taskId}::v${version}`. */
  private store = new Map<string, WikiHistoryEntry & { taskId: TaskId }>();

  // ─── helpers for tests ─────────────────────────────────────
  /** Return all entries archived for a given task, oldest version first. */
  forTask(taskId: TaskId): WikiHistoryEntry[] {
    return Array.from(this.store.values())
      .filter((entry) => entry.taskId === taskId)
      .sort((a, b) => a.version - b.version)
      .map(({ taskId: _t, ...rest }) => ({ ...rest }));
  }
  all(): Array<{ taskId: TaskId; entry: WikiHistoryEntry }> {
    return Array.from(this.store.values()).map(({ taskId, ...entry }) => ({
      taskId,
      entry,
    }));
  }
  clear(): void {
    this.store.clear();
  }
  count(): number {
    return this.store.size;
  }

  // ─── WikiHistoryPort ───────────────────────────────────────
  async append(taskId: TaskId, entry: WikiHistoryEntry): Promise<void> {
    // Idempotent: same (taskId, version) overwrites — matches Firestore
    // `set` with deterministic doc id semantics.
    this.store.set(storageKey(taskId, entry.version), { ...entry, taskId });
  }
}
