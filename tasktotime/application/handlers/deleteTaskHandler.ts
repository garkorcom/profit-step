/**
 * deleteTaskHandler — soft-delete use case for `DELETE /tasks/:id`.
 *
 * Soft delete writes `archivedAt` (epoch ms) and denormalises `archivedBy`
 * to the user id. The Firestore adapter additionally sets `isArchived: true`
 * and `bucket: 'archive'` so listing queries can exclude archived rows
 * without a second predicate. Hard delete is intentionally out of scope —
 * the audit trail and reporting need the row to remain queryable.
 *
 * Idempotency:
 *   - The key is namespaced as `task.delete:{taskId}:{key}`.
 *   - Replay returns the cached `archivedAt` (read off the existing row);
 *     no second mutation is performed.
 *   - A second delete with a NEW idempotency key on an already-archived
 *     task is also a no-op — soft-delete is a monotonic state change.
 */

import { asTaskId } from '../../domain/identifiers';
import type { TaskRepository } from '../../ports/repositories/TaskRepository';
import type { IdempotencyPort } from '../../ports/ai/IdempotencyPort';
import type { ClockPort } from '../../ports/infra/ClockPort';
import { TaskNotFound } from '../../domain/errors';
import type {
  DeleteTaskCommand,
  DeleteTaskOutcome,
} from '../commands/DeleteTaskCommand';

export interface DeleteTaskHandlerDeps {
  taskRepo: TaskRepository;
  idempotency: IdempotencyPort;
  clock: ClockPort;
}

export class DeleteTaskHandler {
  constructor(private readonly deps: DeleteTaskHandlerDeps) {}

  async execute(command: DeleteTaskCommand): Promise<DeleteTaskOutcome> {
    const taskId = asTaskId(command.taskId);
    const idempotencyKey = `task.delete:${command.taskId}:${command.idempotencyKey}`;
    const proceed = await this.deps.idempotency.reserve(idempotencyKey);

    if (!proceed) {
      const existing = await this.deps.taskRepo.findById(taskId);
      if (!existing) throw new TaskNotFound(taskId);
      // Replay: surface the previously-recorded archive timestamp. If the
      // first call somehow didn't end up with `archivedAt` set (e.g. an
      // adapter that defers the field write), fall back to the clock.
      const archivedAt = (existing.archivedAt ?? this.deps.clock.now()) as number;
      return { archivedAt, skipped: true };
    }

    const before = await this.deps.taskRepo.findById(taskId);
    if (!before) throw new TaskNotFound(taskId);

    if (before.archivedAt != null) {
      // Already archived — second delete with a new idempotency key. Still a
      // no-op: monotonic transition. Return the original archivedAt so the
      // wire response is stable.
      return { archivedAt: before.archivedAt as number, skipped: true };
    }

    await this.deps.taskRepo.softDelete(taskId, command.by);
    // Re-read so the wire `archivedAt` matches the value Firestore actually
    // committed (the adapter stamps `archivedAt = serverTimestamp()` in
    // production; reading back is the only way to surface the authoritative
    // wall clock to the client). Falling back to the clock keeps the API
    // contract intact when an adapter persists `archivedAt` lazily.
    const after = await this.deps.taskRepo.findById(taskId);
    const archivedAt = (after?.archivedAt ?? this.deps.clock.now()) as number;
    return { archivedAt, skipped: false };
  }
}
