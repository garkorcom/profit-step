/**
 * NoopNotifier — record calls but don't fire.
 *
 * Implements TelegramNotifyPort, EmailNotifyPort, PushNotifyPort. Tests can
 * inspect `.calls` to verify notifications were attempted.
 */

import type {
  TelegramNotifyPort,
  TelegramMessageInput,
  TelegramSendResult,
} from '../../ports/notify/TelegramNotifyPort';
import type {
  EmailNotifyPort,
  EmailNotifyInput,
  EmailSendResult,
} from '../../ports/notify/EmailNotifyPort';
import type {
  PushNotifyPort,
  PushNotifyInput,
} from '../../ports/notify/PushNotifyPort';

export class NoopTelegramNotifier implements TelegramNotifyPort {
  public calls: TelegramMessageInput[] = [];
  async send(input: TelegramMessageInput): Promise<TelegramSendResult> {
    this.calls.push(input);
    return { messageId: `msg_${this.calls.length}` };
  }
  reset(): void {
    this.calls = [];
  }
}

export class NoopEmailNotifier implements EmailNotifyPort {
  public calls: EmailNotifyInput[] = [];
  async send(input: EmailNotifyInput): Promise<EmailSendResult> {
    this.calls.push(input);
    return { messageId: `email_${this.calls.length}` };
  }
  reset(): void {
    this.calls = [];
  }
}

export class NoopPushNotifier implements PushNotifyPort {
  public calls: PushNotifyInput[] = [];
  async send(input: PushNotifyInput): Promise<{ delivered: boolean }> {
    this.calls.push(input);
    return { delivered: true };
  }
  reset(): void {
    this.calls = [];
  }
}
