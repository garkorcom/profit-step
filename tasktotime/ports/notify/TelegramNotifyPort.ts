/**
 * TelegramNotifyPort — send messages to worker bot.
 *
 * Adapter wraps the existing `sendMessageToWorker` infrastructure. Domain
 * services emit DomainEvent; application layer translates select events
 * into Telegram messages via this port.
 *
 * Defensive: implementations MAY return `{ skipped: true, reason }` instead
 * of throwing if the user has no telegramId, opt-out, or rate limit hit.
 */

import type { TaskId, UserId } from '../../domain/identifiers';

export interface TelegramMessageInput {
  recipientUserId: UserId;
  /** Markdown-safe text. */
  text: string;
  /** For trace correlation. */
  taskId?: TaskId;
  /** Inline keyboard buttons. */
  buttons?: Array<{ label: string; payload: string }>;
  silent?: boolean;
}

export type TelegramSendResult =
  | { messageId: string }
  | { skipped: true; reason: string };

export interface TelegramNotifyPort {
  send(input: TelegramMessageInput): Promise<TelegramSendResult>;
}
