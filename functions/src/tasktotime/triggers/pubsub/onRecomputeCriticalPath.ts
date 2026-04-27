/**
 * Cloud Function wrapper for `tasktotime/adapters/triggers/handleRecomputeCriticalPath`.
 *
 * Subscribes to the `recomputeCriticalPath` Pub/Sub topic. The publisher
 * (`publishCriticalPathRecompute`, called from `onTaskUpdate`) emits one
 * message per project debounce window when graph-affecting fields change.
 * This subscriber loads all tasks in the project, runs the pure CPM
 * forward+backward pass, and patches `{ isCriticalPath, slackMinutes }`
 * per task only when the value differs.
 *
 * **Topic auto-creation.** Deploying this Cloud Function registers the
 * subscription with Pub/Sub, which auto-creates the topic on first deploy.
 * No `gcloud pubsub topics create` step needed.
 *
 * **Loop safety.** Both patched fields (`isCriticalPath`, `slackMinutes`)
 * are on the EXCLUDED watched-fields list in
 * `tasktotime/adapters/triggers/_shared.ts`, so the resulting
 * `onTaskUpdate` invocations short-circuit with `no_watched_field_change`
 * — no re-publish. One hop to terminate.
 *
 * **Idempotency.** Keyed by `(projectId, messageId)` for 1h TTL. Pub/Sub
 * redeliveries within that window are skipped. The recompute is also
 * mathematically idempotent (same inputs → same schedule).
 */

import * as functions from 'firebase-functions';

import {
  handleRecomputeCriticalPath,
  type RecomputeCriticalPathMessage,
} from '../../../../../tasktotime/adapters/triggers/handleRecomputeCriticalPath';
import { RECOMPUTE_CRITICAL_PATH_TOPIC } from '../../../../../tasktotime/adapters/triggers/publishCriticalPathRecompute';
import { TASKTOTIME_TRIGGER_SECRETS } from '../../../config/secrets';
import { getTasktotimeServices } from '../../composition';

export const onTasktotimeRecomputeCriticalPath = functions
  .region('us-central1')
  .runWith({ memory: '256MB', secrets: [...TASKTOTIME_TRIGGER_SECRETS] })
  .pubsub.topic(RECOMPUTE_CRITICAL_PATH_TOPIC)
  .onPublish(async (message, context) => {
    const messageId = context.eventId;
    try {
      const payload = message.json as RecomputeCriticalPathMessage | undefined;
      if (!payload || typeof payload !== 'object') {
        functions.logger.warn(
          '[tasktotime.onRecomputeCriticalPath] missing or non-JSON payload',
          { messageId },
        );
        return null;
      }
      const services = getTasktotimeServices();
      const result = await handleRecomputeCriticalPath(
        payload,
        { messageId },
        {
          taskRepo: services.adapters.taskRepo,
          idempotency: services.adapters.idempotency,
          bigQueryAudit: services.adapters.bigQueryAudit,
          clock: services.adapters.clock,
          logger: functions.logger,
        },
      );
      functions.logger.info('[tasktotime.onRecomputeCriticalPath]', {
        messageId,
        projectId: payload.projectId,
        result,
      });
    } catch (err) {
      // Swallow + log. The handler is idempotent and the publisher emits
      // a fresh message on the next graph change, so a missed run only
      // delays the recompute. Rethrowing would trigger Pub/Sub redelivery
      // which the idempotency reservation already handles for retries
      // within 1h — but a permanently bad payload would loop without
      // ack. Safer to ack and rely on the next publish.
      functions.logger.error(
        '[tasktotime.onRecomputeCriticalPath] handler threw',
        { messageId, err },
      );
    }
    return null;
  });
