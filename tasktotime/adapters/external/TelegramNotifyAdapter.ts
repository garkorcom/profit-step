/**
 * TelegramNotifyAdapter — `TelegramNotifyPort` implementation.
 *
 * Wraps the existing `sendMessageToWorker` flow (see
 * `functions/src/utils/workerMessaging.ts:7-58`):
 *   1. Resolve `recipientUserId` → `telegramId` via `users/{id}` then
 *      legacy `employees/{id}` fallback.
 *   2. POST to Telegram Bot API `sendMessage` with `parse_mode: HTML`.
 *
 * Adapter mapping: spec/04-storage/adapter-mapping.md §18.
 *
 * Conventions:
 *   - Skip-not-throw when recipient has no `telegramId`. Returns
 *     `{ skipped: true, reason: 'no_telegram_id' }` per port contract.
 *   - HTML-escape the user-supplied text. Markdown formatting is intentionally
 *     not propagated — the existing worker bot uses HTML mode because it
 *     escapes more reliably than MarkdownV2.
 *   - Inline keyboard buttons are NOT supported in MVP — they are logged at
 *     `warn` and silently dropped. PR-B will implement.
 *   - Token is passed in via the constructor (resolved by composition root
 *     using `defineSecret('WORKER_BOT_TOKEN').value()`). The adapter NEVER
 *     reads `process.env` itself.
 *   - `fetchImpl` is injectable for tests.
 */

import type { Firestore } from 'firebase-admin/firestore';

import type {
  TelegramNotifyPort,
  TelegramMessageInput,
  TelegramSendResult,
} from '../../ports/notify/TelegramNotifyPort';
import { AdapterError } from '../errors';
import { type AdapterLogger, noopLogger } from '../firestore/_shared';

type FetchImpl = typeof fetch;

interface TelegramApiOk {
  ok: true;
  result: { message_id: number };
}

interface TelegramApiErr {
  ok: false;
  description?: string;
  error_code?: number;
}

export class TelegramNotifyAdapter implements TelegramNotifyPort {
  constructor(
    private readonly db: Firestore,
    private readonly botToken: string,
    private readonly logger: AdapterLogger = noopLogger,
    private readonly fetchImpl: FetchImpl = fetch,
  ) {}

  async send(input: TelegramMessageInput): Promise<TelegramSendResult> {
    const telegramId = await this.resolveTelegramId(input.recipientUserId);
    if (telegramId == null) {
      this.logger.warn?.('TelegramNotifyAdapter.send skipped — no telegramId', {
        userId: input.recipientUserId,
        taskId: input.taskId,
      });
      return { skipped: true, reason: 'no_telegram_id' };
    }

    if (input.buttons && input.buttons.length > 0) {
      this.logger.warn?.(
        'TelegramNotifyAdapter.send: inline keyboard not yet supported (PR-B); buttons dropped',
        { count: input.buttons.length, taskId: input.taskId },
      );
    }

    const body = {
      chat_id: telegramId,
      text: escapeHTML(input.text),
      parse_mode: 'HTML',
      disable_notification: input.silent ?? false,
    };

    let res: Response;
    try {
      res = await this.fetchImpl(
        `https://api.telegram.org/bot${this.botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
    } catch (err) {
      this.logger.error?.('TelegramNotifyAdapter.send network error', {
        userId: input.recipientUserId,
        err,
      });
      throw new AdapterError(
        'EXTERNAL_FAILURE',
        `Telegram network error: ${(err as Error)?.message ?? String(err)}`,
        { op: 'TelegramNotify.send', userId: input.recipientUserId },
        err,
      );
    }

    let json: TelegramApiOk | TelegramApiErr;
    try {
      json = (await res.json()) as TelegramApiOk | TelegramApiErr;
    } catch (err) {
      throw new AdapterError(
        'EXTERNAL_FAILURE',
        `Telegram returned non-JSON response (status ${res.status})`,
        { op: 'TelegramNotify.send', status: res.status },
        err,
      );
    }

    if (!res.ok || !json.ok) {
      const description =
        ('description' in json && json.description) || `HTTP ${res.status}`;
      this.logger.error?.('TelegramNotifyAdapter.send API error', {
        userId: input.recipientUserId,
        status: res.status,
        description,
      });
      throw new AdapterError(
        'EXTERNAL_FAILURE',
        `Telegram API error: ${description}`,
        {
          op: 'TelegramNotify.send',
          userId: input.recipientUserId,
          status: res.status,
        },
      );
    }

    return { messageId: String(json.result.message_id) };
  }

  /**
   * Match the legacy lookup order: `users/{id}` first, then `employees/{id}`
   * (see `functions/src/utils/workerMessaging.ts:13-22`). Either may carry a
   * numeric `telegramId`. Returns `null` if neither has one.
   */
  private async resolveTelegramId(userId: string): Promise<number | string | null> {
    try {
      const userSnap = await this.db.collection('users').doc(userId).get();
      const userTg = userSnap.exists ? userSnap.data()?.telegramId : undefined;
      if (userTg != null && userTg !== '') return userTg as number | string;

      const empSnap = await this.db.collection('employees').doc(userId).get();
      const empTg = empSnap.exists ? empSnap.data()?.telegramId : undefined;
      if (empTg != null && empTg !== '') return empTg as number | string;

      return null;
    } catch (err) {
      this.logger.error?.('TelegramNotifyAdapter.resolveTelegramId failed', {
        userId,
        err,
      });
      throw new AdapterError(
        'STORAGE_FAILURE',
        `Failed to resolve telegramId for ${userId}`,
        { op: 'TelegramNotify.resolveTelegramId', userId },
        err,
      );
    }
  }
}

/**
 * Escape HTML-special characters so user-provided text cannot break Telegram's
 * `parse_mode: HTML`. Mirrors `functions/src/utils/workerMessaging.ts:64-72`.
 */
export function escapeHTML(text: string): string {
  if (!text) return text;
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
