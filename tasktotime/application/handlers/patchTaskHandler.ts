/**
 * patchTaskHandler — partial-update use case for `PATCH /tasks/:id`.
 *
 * Responsibilities (top-down):
 *   1. Reserve the idempotency key. Replay (`reserve` returns false) returns
 *      the existing task as a no-op — the wire response then mirrors the
 *      original mutation result.
 *   2. Verify the target task exists. Cross-tenant scoping is enforced one
 *      layer up (the HTTP handler compares `companyId` BEFORE invoking us)
 *      so this handler returns `null` only on truly missing tasks.
 *   3. Delegate to `TaskRepository.patch(id, patch)`. The repository
 *      re-validates `PATCH_FORBIDDEN_KEYS` at the storage boundary; a
 *      forbidden key bubbles up as `IllegalPatchError` (mapped to HTTP 422
 *      by the error middleware).
 *   4. Re-fetch and return the updated task. We deliberately DO NOT optimise
 *      this away by mutating a local copy of the in-memory task because
 *      Firestore stamps `updatedAt` server-side and the cascade triggers
 *      may have run between the patch and the read.
 *
 * Lifecycle / state-machine fields are NOT mutated here — those flow through
 * `TransitionTaskHandler`. Any attempt to patch them is rejected by the
 * forbidden-key list (the HTTP schema layer catches this earlier as a 400).
 */

import type { Task } from '../../domain/Task';
import { asTaskId } from '../../domain/identifiers';
import type { TaskRepository } from '../../ports/repositories/TaskRepository';
import type { IdempotencyPort } from '../../ports/ai/IdempotencyPort';
import { TaskNotFound } from '../../domain/errors';
import type { PatchTaskCommand } from '../commands/PatchTaskCommand';

export interface PatchTaskHandlerDeps {
  taskRepo: TaskRepository;
  idempotency: IdempotencyPort;
}

export interface PatchTaskOutcome {
  task: Task;
  /** True if the idempotency key was already reserved (no mutation). */
  skipped: boolean;
}

export class PatchTaskHandler {
  constructor(private readonly deps: PatchTaskHandlerDeps) {}

  async execute(command: PatchTaskCommand): Promise<PatchTaskOutcome> {
    const taskId = asTaskId(command.taskId);
    const idempotencyKey = `task.patch:${command.taskId}:${command.idempotencyKey}`;
    const proceed = await this.deps.idempotency.reserve(idempotencyKey);
    if (!proceed) {
      const existing = await this.deps.taskRepo.findById(taskId);
      if (!existing) throw new TaskNotFound(taskId);
      return { task: existing, skipped: true };
    }

    const before = await this.deps.taskRepo.findById(taskId);
    if (!before) throw new TaskNotFound(taskId);

    await this.deps.taskRepo.patch(taskId, command.patch);

    const after = await this.deps.taskRepo.findById(taskId);
    if (!after) throw new TaskNotFound(taskId);
    return { task: after, skipped: false };
  }
}
