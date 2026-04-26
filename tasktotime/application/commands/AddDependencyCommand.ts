/**
 * AddDependencyCommand — DTO for adding a dependency edge between two tasks.
 */

import type { UserRef } from '../../domain/Task';

export interface AddDependencyCommand {
  fromTaskId: string;
  toTaskId: string;
  type: 'finish_to_start' | 'start_to_start' | 'finish_to_finish' | 'start_to_finish';
  lagMinutes?: number;
  isHardBlock: boolean;
  reason?: string;
  by: UserRef;
}
