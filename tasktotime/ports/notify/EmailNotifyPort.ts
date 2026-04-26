/**
 * EmailNotifyPort — send templated emails (Brevo / Sendgrid backed).
 *
 * Either `userId` or `email` is sufficient — adapter resolves missing one.
 */

import type { TaskId, UserId } from '../../domain/identifiers';

export interface EmailNotifyInput {
  recipient: { userId?: UserId; email?: string };
  /** Template id e.g. 'task_assigned' | 'task_due_soon'. */
  templateId: string;
  variables: Record<string, string | number | boolean>;
  taskId?: TaskId;
}

export type EmailSendResult =
  | { messageId: string }
  | { skipped: true; reason: string };

export interface EmailNotifyPort {
  send(input: EmailNotifyInput): Promise<EmailSendResult>;
}
