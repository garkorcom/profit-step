/**
 * Cloud Function wrapper for `tasktotime/adapters/triggers/onWikiUpdate`.
 *
 * - Source: `tasktotime_tasks/{taskId}` onUpdate where `wiki.contentMd` or
 *   `wiki.attachments` differ.
 * - Audit row only in PR-C; `versionHistory` archive overflow + parent
 *   rollup wiki invalidation come in PR-B6 once a `WikiHistoryPort` lands.
 *
 * Note: this is a SECOND trigger on `tasktotime_tasks/{taskId}` onUpdate
 * (the other being `onTasktotimeTaskUpdate`). Cloud Functions allows
 * multiple triggers on the same document — they fire in parallel. The
 * watched-fields filter inside each handler keeps them independent.
 */

import * as functions from 'firebase-functions';

import { onWikiUpdate as handleWikiUpdate } from '../../../../../tasktotime/adapters/triggers/onWikiUpdate';
import { TASKTOTIME_TRIGGER_SECRETS } from '../../../config/secrets';
import { getTasktotimeServices } from '../../composition';
import { taskFromSnapshot } from '../../helpers/taskMapper';

export const onTasktotimeWikiUpdate = functions
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
      const result = await handleWikiUpdate(
        { before, after, docId: taskId, eventId },
        {
          taskRepo: services.adapters.taskRepo,
          idempotency: services.adapters.idempotency,
          bigQueryAudit: services.adapters.bigQueryAudit,
          clock: services.adapters.clock,
          logger: functions.logger,
        },
      );
      functions.logger.info('[tasktotime.onWikiUpdate]', { taskId, result });
    } catch (err) {
      functions.logger.error('[tasktotime.onWikiUpdate] handler threw', {
        taskId,
        eventId,
        err,
      });
    }
    return null;
  });
