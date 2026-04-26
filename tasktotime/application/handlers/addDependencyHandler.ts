/**
 * addDependencyHandler — wire DTO -> DependencyService.addDependency.
 *
 * Throws CycleDetected (caller translates to HTTP 409).
 */

import { DependencyService } from '../../domain/services/DependencyService';
import { asTaskId } from '../../domain/identifiers';
import type { AddDependencyCommand } from '../commands/AddDependencyCommand';

export interface AddDependencyHandlerDeps {
  dependencyService: DependencyService;
}

export class AddDependencyHandler {
  constructor(private readonly deps: AddDependencyHandlerDeps) {}

  async execute(command: AddDependencyCommand): Promise<{ ok: true }> {
    await this.deps.dependencyService.addDependency(
      asTaskId(command.fromTaskId),
      {
        taskId: asTaskId(command.toTaskId),
        type: command.type,
        lagMinutes: command.lagMinutes,
        isHardBlock: command.isHardBlock,
        reason: command.reason,
      },
      command.by,
    );
    return { ok: true };
  }
}
