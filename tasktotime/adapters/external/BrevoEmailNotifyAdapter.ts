/**
 * BrevoEmailNotifyAdapter — `EmailNotifyPort` implementation backed by Brevo.
 *
 * Brevo (formerly Sendinblue) is the project's existing email provider — see
 * `functions/src/config/env.ts` (EMAIL_HOST=smtp-relay.brevo.com) and
 * `functions/src/brevoStatusChecker.ts`. This adapter uses Brevo's HTTP
 * Transactional Email API (`POST https://api.brevo.com/v3/smtp/email`)
 * because it returns a `messageId` we can correlate with the Brevo webhook
 * status checker.
 *
 * Adapter mapping: spec/04-storage/adapter-mapping.md §19.
 *
 * Conventions:
 *   - If neither `recipient.email` nor a resolvable `users/{userId}.email` is
 *     present, returns `{ skipped: true, reason: 'no_email' }` per port
 *     contract — no throw.
 *   - Brevo's `templateId` is numeric. The port's `templateId: string` is cast
 *     via `Number(...)`; `NaN` → throw `INVALID_INPUT`.
 *   - Optionally writes a `notifications/{auto-id}` tracking doc on success.
 *     Write failure is logged but never blocks the send result.
 *   - API key passed in via constructor (composition root resolves it from
 *     `defineSecret('BREVO_API_KEY').value()`); adapter never reads env.
 *   - `fetchImpl` injectable for tests.
 */

import { Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';

import type {
  EmailNotifyPort,
  EmailNotifyInput,
  EmailSendResult,
} from '../../ports/notify/EmailNotifyPort';
import { AdapterError } from '../errors';
import {
  type AdapterLogger,
  noopLogger,
  stripUndefined,
} from '../firestore/_shared';

type FetchImpl = typeof fetch;

interface BrevoOk {
  messageId: string;
}

interface BrevoErr {
  code?: string;
  message?: string;
}

export class BrevoEmailNotifyAdapter implements EmailNotifyPort {
  constructor(
    private readonly db: Firestore,
    private readonly apiKey: string,
    private readonly senderEmail: string,
    private readonly senderName: string,
    private readonly logger: AdapterLogger = noopLogger,
    private readonly fetchImpl: FetchImpl = fetch,
  ) {}

  async send(input: EmailNotifyInput): Promise<EmailSendResult> {
    const email = await this.resolveEmail(input.recipient);
    if (!email) {
      this.logger.warn?.('BrevoEmailNotifyAdapter.send skipped — no email', {
        recipient: input.recipient,
        taskId: input.taskId,
      });
      return { skipped: true, reason: 'no_email' };
    }

    const templateId = Number(input.templateId);
    if (!Number.isFinite(templateId)) {
      throw new AdapterError(
        'INVALID_INPUT',
        `Brevo templateId must be numeric, got ${JSON.stringify(input.templateId)}`,
        { op: 'EmailNotify.send', templateId: input.templateId },
      );
    }

    const body = {
      sender: { email: this.senderEmail, name: this.senderName },
      to: [{ email }],
      templateId,
      params: input.variables,
    };

    let res: Response;
    try {
      res = await this.fetchImpl('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      this.logger.error?.('BrevoEmailNotifyAdapter.send network error', {
        email,
        err,
      });
      throw new AdapterError(
        'EXTERNAL_FAILURE',
        `Brevo network error: ${(err as Error)?.message ?? String(err)}`,
        { op: 'EmailNotify.send', email },
        err,
      );
    }

    if (!res.ok) {
      let detail: BrevoErr | undefined;
      try {
        detail = (await res.json()) as BrevoErr;
      } catch {
        // body wasn't JSON — fall through with status only
      }
      this.logger.error?.('BrevoEmailNotifyAdapter.send API error', {
        email,
        status: res.status,
        detail,
      });
      throw new AdapterError(
        'EXTERNAL_FAILURE',
        `Brevo API error (${res.status}): ${detail?.message ?? 'unknown'}`,
        { op: 'EmailNotify.send', email, status: res.status, code: detail?.code },
      );
    }

    let ok: BrevoOk;
    try {
      ok = (await res.json()) as BrevoOk;
    } catch (err) {
      throw new AdapterError(
        'EXTERNAL_FAILURE',
        'Brevo returned non-JSON success response',
        { op: 'EmailNotify.send', email, status: res.status },
        err,
      );
    }

    await this.trackSend({
      taskId: input.taskId,
      email,
      templateId: input.templateId,
      messageId: ok.messageId,
    });

    return { messageId: ok.messageId };
  }

  private async resolveEmail(
    recipient: EmailNotifyInput['recipient'],
  ): Promise<string | null> {
    if (recipient.email && recipient.email.trim()) return recipient.email.trim();
    if (!recipient.userId) return null;
    try {
      const snap = await this.db.collection('users').doc(recipient.userId).get();
      if (!snap.exists) return null;
      const e = snap.data()?.email;
      return typeof e === 'string' && e.trim() ? e.trim() : null;
    } catch (err) {
      this.logger.error?.('BrevoEmailNotifyAdapter.resolveEmail failed', {
        userId: recipient.userId,
        err,
      });
      throw new AdapterError(
        'STORAGE_FAILURE',
        `Failed to resolve email for user ${recipient.userId}`,
        { op: 'EmailNotify.resolveEmail', userId: recipient.userId },
        err,
      );
    }
  }

  /**
   * Best-effort tracking write. Failure here MUST NOT bubble to the caller —
   * the email was already sent.
   */
  private async trackSend(meta: {
    taskId: string | undefined;
    email: string;
    templateId: string;
    messageId: string;
  }): Promise<void> {
    try {
      await this.db.collection('notifications').add(
        stripUndefined({
          kind: 'email',
          provider: 'brevo',
          taskId: meta.taskId,
          email: meta.email,
          templateId: meta.templateId,
          messageId: meta.messageId,
          sentAt: Timestamp.now(),
        }),
      );
    } catch (err) {
      this.logger.warn?.(
        'BrevoEmailNotifyAdapter.trackSend failed (non-blocking)',
        { messageId: meta.messageId, err },
      );
    }
  }
}
