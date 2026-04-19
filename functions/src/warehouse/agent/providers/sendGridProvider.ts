/**
 * SendGrid — production RFQEmailProvider.
 *
 * Uses SendGrid's v3 Mail Send API (`/v3/mail/send`). Auth via Bearer
 * token in the `SENDGRID_API_KEY` env var. Wrapped behind our generic
 * RFQEmailProvider interface so callers don't depend on SendGrid-specific
 * shapes.
 *
 * Docs: https://docs.sendgrid.com/api-reference/mail-send/mail-send
 */

import axios, { AxiosInstance } from 'axios';
import { logger } from 'firebase-functions';
import type { RFQEmailProvider, RFQEnvelope } from '../capabilities/sendVendorRFQ';

export interface SendGridOptions {
  apiKey: string;
  /** Optional — override axios for tests. */
  http?: AxiosInstance;
  timeoutMs?: number;
}

export class SendGridRFQEmailProvider implements RFQEmailProvider {
  readonly name = 'sendgrid';
  private readonly http: AxiosInstance;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(opts: SendGridOptions) {
    if (!opts.apiKey) throw new Error('SendGridRFQEmailProvider: apiKey is required');
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 10000;
    this.http = opts.http ?? axios.create();
  }

  async send(envelope: RFQEnvelope): Promise<{ messageId?: string }> {
    const payload = buildSendGridPayload(envelope);

    try {
      const resp = await this.http.post('https://api.sendgrid.com/v3/mail/send', payload, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: this.timeoutMs,
      });
      // SendGrid returns an X-Message-Id header on 202
      const messageId = resp.headers?.['x-message-id'];
      return { messageId: typeof messageId === 'string' ? messageId : undefined };
    } catch (e: any) {
      const detail = e?.response?.data ?? e?.message;
      logger.error('SendGrid: send failed', { detail, to: envelope.to });
      throw new Error(
        `SendGrid send failed (${e?.response?.status ?? 'network'}): ${JSON.stringify(detail)}`,
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Payload builder (exported for tests)
// ═══════════════════════════════════════════════════════════════════

export function buildSendGridPayload(envelope: RFQEnvelope) {
  return {
    personalizations: [
      {
        to: [{ email: envelope.to }],
        custom_args: envelope.customArgs,
      },
    ],
    from: { email: envelope.from },
    reply_to: { email: envelope.replyTo },
    subject: envelope.subject,
    content: [{ type: 'text/plain', value: envelope.body }],
  };
}
