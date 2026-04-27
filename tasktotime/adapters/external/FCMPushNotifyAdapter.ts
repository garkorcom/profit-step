/**
 * FCMPushNotifyAdapter — `PushNotifyPort` implementation backed by Firebase
 * Cloud Messaging.
 *
 * Reads FCM tokens from `users/{userId}` (`fcmTokens` array, with legacy
 * `fcmToken` and `pushTokens` fallbacks) and calls
 * `messaging.sendEachForMulticast`. Push is best-effort — errors are logged
 * but never thrown. Per port contract, the result is `{ delivered: boolean }`
 * where `delivered: true` means at least one device accepted the message.
 *
 * Adapter mapping: spec/04-storage/adapter-mapping.md §20.
 *
 * Conventions:
 *   - Tracking write to `notifications/{auto-id}` is best-effort and never
 *     blocks the result.
 *   - Empty token list → `{ delivered: false }` without contacting FCM.
 *   - FCM SDK is passed via constructor (composition root supplies
 *     `admin.messaging()`); adapter never imports it directly.
 */

import { Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import type { Messaging, MulticastMessage } from 'firebase-admin/messaging';

import type {
  PushNotifyPort,
  PushNotifyInput,
} from '../../ports/notify/PushNotifyPort';
import {
  type AdapterLogger,
  noopLogger,
  stripUndefined,
} from '../firestore/_shared';

export class FCMPushNotifyAdapter implements PushNotifyPort {
  constructor(
    private readonly db: Firestore,
    private readonly messaging: Messaging,
    private readonly logger: AdapterLogger = noopLogger,
  ) {}

  async send(input: PushNotifyInput): Promise<{ delivered: boolean }> {
    let tokens: string[] = [];
    try {
      tokens = await this.resolveTokens(input.userId);
    } catch (err) {
      this.logger.error?.('FCMPushNotifyAdapter.resolveTokens failed', {
        userId: input.userId,
        err,
      });
      return { delivered: false };
    }

    if (tokens.length === 0) {
      this.logger.warn?.('FCMPushNotifyAdapter.send skipped — no FCM tokens', {
        userId: input.userId,
        taskId: input.taskId,
      });
      await this.trackSend({ ...input, delivered: false, accepted: 0 });
      return { delivered: false };
    }

    const message: MulticastMessage = {
      tokens,
      notification: { title: input.title, body: input.body },
      data: stripUndefined({
        taskId: input.taskId ?? '',
        url: input.url ?? '',
      }),
      ...(input.url
        ? { webpush: { fcmOptions: { link: input.url } } }
        : {}),
    };

    try {
      const res = await this.messaging.sendEachForMulticast(message);
      const delivered = res.successCount > 0;
      await this.trackSend({
        ...input,
        delivered,
        accepted: res.successCount,
      });
      if (res.failureCount > 0) {
        this.logger.warn?.('FCMPushNotifyAdapter.send partial failure', {
          userId: input.userId,
          successCount: res.successCount,
          failureCount: res.failureCount,
        });
      }
      return { delivered };
    } catch (err) {
      this.logger.error?.('FCMPushNotifyAdapter.send FCM error (non-blocking)', {
        userId: input.userId,
        err,
      });
      return { delivered: false };
    }
  }

  private async resolveTokens(userId: string): Promise<string[]> {
    const snap = await this.db.collection('users').doc(userId).get();
    if (!snap.exists) return [];
    const data = snap.data() ?? {};
    const candidates: unknown[] = [data.fcmTokens, data.pushTokens, data.fcmToken];
    for (const c of candidates) {
      if (Array.isArray(c)) {
        const arr = c.filter((t): t is string => typeof t === 'string' && t.length > 0);
        if (arr.length > 0) return arr;
      } else if (typeof c === 'string' && c.length > 0) {
        return [c];
      }
    }
    return [];
  }

  /**
   * Best-effort tracking write to `notifications/`. Failure is logged but
   * never bubbles up.
   */
  private async trackSend(meta: {
    userId: string;
    title: string;
    taskId?: string;
    url?: string;
    delivered: boolean;
    accepted: number;
  }): Promise<void> {
    try {
      await this.db.collection('notifications').add(
        stripUndefined({
          kind: 'push',
          userId: meta.userId,
          title: meta.title,
          taskId: meta.taskId,
          url: meta.url,
          delivered: meta.delivered,
          accepted: meta.accepted,
          createdAt: Timestamp.now(),
        }),
      );
    } catch (err) {
      this.logger.warn?.(
        'FCMPushNotifyAdapter.trackSend failed (non-blocking)',
        { userId: meta.userId, err },
      );
    }
  }
}
