/**
 * removeDependencyHandler — wire DTO -> DependencyService.removeDependency.
 *
 * Cycle / cascade considerations: removing an edge cannot CREATE a cycle, so
 * there is no `assertCanAddDependency` check on this path. The reverse
 * `blocksTaskIds[]` index on the predecessor is rebuilt by the
 * `cascadeBlocksTaskIds` trigger that fires on the source task's
 * `dependsOn[]` change — the application handler stays out of that cascade
 * to keep responsibilities single-purpose.
 *
 * Idempotency mirrors the pattern in `patchTaskHandler` / `deleteTaskHandler`
 * — replays return the current task without re-issuing the underlying CAS.
 */

import type { Task } from '../../domain/Task';
import { DependencyService } from '../../domain/services/DependencyService';
import { asTaskId } from '../../domain/identifiers';
import type { TaskRepository } from '../../ports/repositories/TaskRepository';
import type { IdempotencyPort } from '../../ports/ai/IdempotencyPort';
import { TaskNotFound } from '../../domain/errors';
import type { RemoveDependencyCommand } from '../commands/RemoveDependencyCommand';

export interface RemoveDependencyHandlerDeps {
  dependencyService: DependencyService;
  taskRepo: TaskRepository;
  idempotency: IdempotencyPort;
}

export interface RemoveDependencyOutcome {
  task: Task;
  /** True if the idempotency key was already reserved (no mutation). */
  skipped: boolean;
}

export class RemoveDependencyHandler {
  constructor(private readonly deps: RemoveDependencyHandlerDeps) {}

  async execute(
    command: RemoveDependencyCommand,
  ): Promise<RemoveDependencyOutcome> {
    const fromTaskId = asTaskId(command.fromTaskId);
    const toTaskId = asTaskId(command.toTaskId);
    const idempotencyKey =
      `task.dependency.remove:${command.fromTaskId}:${command.toTaskId}` +
      `:${command.idempotencyKey}`;

    const proceed = await this.deps.idempotency.reserve(idempotencyKey);
    if (!proceed) {
      const existing = await this.deps.taskRepo.findById(fromTaskId);
      if (!existing) throw new TaskNotFound(fromTaskId);
      return { task: existing, skipped: true };
    }

    await this.deps.dependencyService.removeDependency(fromTaskId, toTaskId);

    const after = await this.deps.taskRepo.findById(fromTaskId);
    if (!after) throw new TaskNotFound(fromTaskId);
    return { task: after, skipped: false };
  }
}
