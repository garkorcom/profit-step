/**
 * Cloud Function wrapper for `tasktotime/adapters/triggers/onTaskCreate`.
 *
 * - Region: us-central1 (matches the rest of the agent stack).
 * - Source:  `tasktotime_tasks/{taskId}` onCreate.
 * - Secrets: `TASKTOTIME_TRIGGER_SECRETS` (worker-bot token + Brevo key).
 * - Memory:  256MB; the handler reads at most one parent doc and writes a
 *   transition row + audit row, well under the default budget.
 *
 * The wrapper is deliberately thin: build the `DocumentChange<Task>`
 * envelope and dispatch into the pure handler. All business logic lives in
 * `tasktotime/adapters/triggers/onTaskCreate.ts`.
 */

import * as functions from 'firebase-functions';

import { onTaskCreate as handleTaskCreate } from '../../../../../tasktotime/adapters/triggers/onTaskCreate';
import { TASKTOTIME_TRIGGER_SECRETS } from '../../../config/secrets';
import { getTasktotimeServices } from '../../composition';

import { taskFromSnapshot } from '../../helpers/taskMapper';

export const onTasktotimeTaskCreate = functions
  .region('us-central1')
  .runWith({ memory: '256MB', secrets: [...TASKTOTIME_TRIGGER_SECRETS] })
  .firestore.document('tasktotime_tasks/{taskId}')
  .onCreate(async (snap, context) => {
    const taskId = context.params.taskId as string;
    const eventId = context.eventId;
    try {
      const services = getTasktotimeServices();
      const after = taskFromSnapshot(snap.data() ?? {}, taskId);
      const result = await handleTaskCreate(
        { before: null, after, docId: taskId, eventId },
        {
          taskRepo: services.adapters.taskRepo,
          transitionLog: services.adapters.transitionLog,
          idempotency: services.adapters.idempotency,
          telegram: services.adapters.telegram,
          bigQueryAudit: services.adapters.bigQueryAudit,
          clock: services.adapters.clock,
          logger: functions.logger,
        },
      );
      functions.logger.info('[tasktotime.onTaskCreate]', { taskId, result });
    } catch (err) {
      // Trigger MUST NOT throw — Cloud Functions retries on throw, which
      // bypasses the idempotency window. Log and swallow.
      functions.logger.error('[tasktotime.onTaskCreate] handler threw', {
        taskId,
        eventId,
        err,
      });
    }
    return null;
  });
