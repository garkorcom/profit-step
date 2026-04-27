/**
 * Cloud Function wrapper for `tasktotime/adapters/triggers/onWorkSessionCompleted`.
 *
 * - Source: `work_sessions/{sessionId}` onUpdate (status → 'completed').
 * - Re-aggregates `task.actualDurationMinutes` + `totalEarnings`.
 *
 * `work_sessions` is a SHARED collection — the legacy `clientJourneyTriggers`
 * stack also listens here. The handler's idempotency key keeps the two
 * triggers from clobbering each other.
 */

import * as functions from 'firebase-functions';

import {
  onWorkSessionCompleted as handleWorkSessionCompleted,
  type SessionDoc,
} from '../../../../../tasktotime/adapters/triggers/onWorkSessionCompleted';
import { timestampsToEpochs } from '../../../../../tasktotime/adapters/firestore/_shared';
import { TASKTOTIME_TRIGGER_SECRETS } from '../../../config/secrets';
import { getTasktotimeServices } from '../../composition';

function sessionFromSnapshot(
  data: Record<string, unknown>,
  id: string,
): SessionDoc {
  const converted = timestampsToEpochs({ ...data }) as Record<string, unknown>;
  return { ...converted, id } as unknown as SessionDoc;
}

export const onTasktotimeWorkSessionCompleted = functions
  .region('us-central1')
  .runWith({ memory: '256MB', secrets: [...TASKTOTIME_TRIGGER_SECRETS] })
  .firestore.document('work_sessions/{sessionId}')
  .onUpdate(async (change, context) => {
    const sessionId = context.params.sessionId as string;
    const eventId = context.eventId;
    try {
      const services = getTasktotimeServices();
      const before = sessionFromSnapshot(change.before.data() ?? {}, sessionId);
      const after = sessionFromSnapshot(change.after.data() ?? {}, sessionId);
      const result = await handleWorkSessionCompleted(
        { before, after, docId: sessionId, eventId },
        {
          taskRepo: services.adapters.taskRepo,
          workSession: services.adapters.workSession,
          idempotency: services.adapters.idempotency,
          bigQueryAudit: services.adapters.bigQueryAudit,
          clock: services.adapters.clock,
          logger: functions.logger,
        },
      );
      functions.logger.info('[tasktotime.onWorkSessionCompleted]', {
        sessionId,
        result,
      });
    } catch (err) {
      functions.logger.error(
        '[tasktotime.onWorkSessionCompleted] handler threw',
        { sessionId, eventId, err },
      );
    }
    return null;
  });
