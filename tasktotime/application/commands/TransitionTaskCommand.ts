/**
 * TransitionTaskCommand — DTO for `POST /api/tasktotime/tasks/:id/transition`.
 */

import type { AcceptanceAct, UserRef } from '../../domain/Task';
import type { TransitionAction } from '../../domain/lifecycle';

export interface TransitionTaskCommand {
  taskId: string;
  action: TransitionAction;
  by: UserRef;
  reason?: string;
  acceptance?: AcceptanceAct;
  blockedReason?: string;
  idempotencyKey: string;
}
