/**
 * Cloud Function wrapper for `tasktotime/adapters/triggers/onTaskUpdate`.
 *
 * **CRITICAL — read CLAUDE.md §2.1.** This is the single highest-risk
 * trigger in the project; the watched-fields filter and idempotency
 * reservation inside the pure handler are the line of defence against the
 * $10k+ billing-bomb scenario. Verify them before changing this wrapper.
 *
 * The wrapper itself is thin: build before/after `Task` envelopes from the
 * change snap and dispatch into the pure handler.
 */

import * as functions from 'firebase-functions';

import { onTaskUpdate as handleTaskUpdate } from '../../../../../tasktotime/adapters/triggers/onTaskUpdate';
import { TASKTOTIME_TRIGGER_SECRETS } from '../../../config/secrets';
import { getTasktotimeServices } from '../../composition';
import { taskFromSnapshot } from '../../helpers/taskMapper';

export const onTasktotimeTaskUpdate = functions
  .region('us-central1')
  .runWith({ memory: '256MB', secrets: [...TASKTOTIME_TRIGGER_SECRETS] })
  .firestore.document('tasktotime_tasks/{taskId}')
  .onUpdate(async (change, context) => {
    const taskId = context.params.taskId as string;
    const eventId = context.eventId;
    try {
      const services = getTasktotimeServices();
      const before = taskFromSnapshot(change.before.data() ?? {}, taskId);
      const after = taskFromSnapshot(change.after.data() ?? {}, taskId);
      const result = await handleTaskUpdate(
        { before, after, docId: taskId, eventId },
        {
          taskRepo: services.adapters.taskRepo,
          idempotency: services.adapters.idempotency,
          bigQueryAudit: services.adapters.bigQueryAudit,
          clock: services.adapters.clock,
          pubsub: services.adapters.pubsub,
          logger: functions.logger,
        },
      );
      functions.logger.info('[tasktotime.onTaskUpdate]', { taskId, result });
    } catch (err) {
      functions.logger.error('[tasktotime.onTaskUpdate] handler threw', {
        taskId,
        eventId,
        err,
      });
    }
    return null;
  });
