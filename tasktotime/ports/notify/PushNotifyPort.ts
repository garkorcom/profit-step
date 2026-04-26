/**
 * PushNotifyPort — web push notifications (FCM-backed).
 *
 * Used for in-browser alerts when an assigned task is approaching dueAt.
 */

import type { TaskId, UserId } from '../../domain/identifiers';

export interface PushNotifyInput {
  userId: UserId;
  title: string;
  body: string;
  taskId?: TaskId;
  /** Deep link URL for click action. */
  url?: string;
}

export interface PushNotifyPort {
  send(input: PushNotifyInput): Promise<{ delivered: boolean }>;
}
