/**
 * transitionTaskHandler — wire DTO -> TaskService.transition.
 *
 * Pure orchestration; converts string `taskId` to branded `TaskId`.
 */

import type { TransitionOutcome } from '../../domain/services/TaskService';
import { TaskService } from '../../domain/services/TaskService';
import { asTaskId } from '../../domain/identifiers';
import type { TransitionTaskCommand } from '../commands/TransitionTaskCommand';

export interface TransitionTaskHandlerDeps {
  taskService: TaskService;
}

export class TransitionTaskHandler {
  constructor(private readonly deps: TransitionTaskHandlerDeps) {}

  async execute(command: TransitionTaskCommand): Promise<TransitionOutcome> {
    return this.deps.taskService.transition({
      taskId: asTaskId(command.taskId),
      action: command.action,
      by: command.by,
      reason: command.reason,
      acceptance: command.acceptance,
      blockedReason: command.blockedReason,
      idempotencyKey: command.idempotencyKey,
    });
  }
}
