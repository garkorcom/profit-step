/**
 * Cloud Function wrapper for `tasktotime/adapters/triggers/onTaskTransition`.
 *
 * - Source: `tasktotime_transitions/{transitionId}` onCreate. Append-only.
 * - Per-action notifications + audit row.
 */

import * as functions from 'firebase-functions';

import { onTaskTransition as handleTaskTransition } from '../../../../../tasktotime/adapters/triggers/onTaskTransition';
import type { TransitionLogEntry } from '../../../../../tasktotime/ports/repositories';
import { timestampsToEpochs } from '../../../../../tasktotime/adapters/firestore/_shared';
import { TASKTOTIME_TRIGGER_SECRETS } from '../../../config/secrets';
import { getTasktotimeServices } from '../../composition';

export const onTasktotimeTaskTransition = functions
  .region('us-central1')
  .runWith({ memory: '256MB', secrets: [...TASKTOTIME_TRIGGER_SECRETS] })
  .firestore.document('tasktotime_transitions/{transitionId}')
  .onCreate(async (snap, context) => {
    const transitionId = context.params.transitionId as string;
    const eventId = context.eventId;
    try {
      const services = getTasktotimeServices();
      const raw = snap.data() ?? {};
      const after = {
        ...timestampsToEpochs({ ...raw }),
        id: transitionId,
      } as unknown as TransitionLogEntry;
      const result = await handleTaskTransition(
        { before: null, after, docId: transitionId, eventId },
        {
          taskRepo: services.adapters.taskRepo,
          idempotency: services.adapters.idempotency,
          telegram: services.adapters.telegram,
          bigQueryAudit: services.adapters.bigQueryAudit,
          clock: services.adapters.clock,
          logger: functions.logger,
        },
      );
      functions.logger.info('[tasktotime.onTaskTransition]', { transitionId, result });
    } catch (err) {
      functions.logger.error('[tasktotime.onTaskTransition] handler threw', {
        transitionId,
        eventId,
        err,
      });
    }
    return null;
  });
