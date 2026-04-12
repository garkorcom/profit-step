/**
 * Telegram Bridge — Phase 10
 *
 * Sends agent event notifications to employees via Telegram.
 * If the employee has a telegramId in their user doc, they receive
 * a formatted message about the event.
 *
 * Fire-and-forget — never blocks the caller.
 */
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import axios from 'axios';

import { AgentEvent } from './eventPublisher';

const db = admin.firestore();
const logger = functions.logger;

const WORKER_BOT_TOKEN = process.env.WORKER_BOT_TOKEN || '';

/** Emoji map for event types */
const EVENT_EMOJI: Record<string, string> = {
  task: '📋',
  session: '⏱️',
  cost: '💰',
  estimate: '📝',
  project: '🏗️',
  inventory: '📦',
  payroll: '💵',
  alert: '🚨',
};

/** Action descriptions for human-readable messages */
const ACTION_LABELS: Record<string, string> = {
  created: 'New',
  updated: 'Updated',
  assigned: 'Assigned',
  completed: 'Completed',
  blocked: 'Blocked',
  started: 'Started',
  stopped: 'Stopped',
  paused: 'Paused',
  auto_closed: 'Auto-closed',
  voided: 'Voided',
  sent: 'Sent',
  approved: 'Approved',
  rejected: 'Rejected',
  converted: 'Converted',
  transaction: 'Transaction',
  low_stock: 'Low stock',
  period_closed: 'Period closed',
  period_locked: 'Period locked',
  period_paid: 'Period paid',
  overtime_alert: 'Overtime alert',
};

/**
 * Format an agent event into a Telegram message.
 */
export function formatEventForTelegram(event: AgentEvent): string {
  const emoji = EVENT_EMOJI[event.type] || '🔔';
  const actionLabel = ACTION_LABELS[event.action] || event.action;
  const typeLabel = event.entityType.replace(/_/g, ' ');

  let message = `${emoji} <b>${actionLabel}</b> — ${typeLabel}\n`;
  message += `${event.summary}`;

  // Add relevant data fields if present
  if (event.data) {
    const extras: string[] = [];
    if (event.data.priority) extras.push(`Priority: ${event.data.priority}`);
    if (event.data.clientName) extras.push(`Client: ${event.data.clientName}`);
    if (event.data.amount) extras.push(`Amount: $${event.data.amount}`);
    if (event.data.durationMinutes) extras.push(`Duration: ${event.data.durationMinutes}min`);
    if (extras.length > 0) {
      message += `\n<i>${extras.join(' · ')}</i>`;
    }
  }

  return message;
}

/**
 * Send a Telegram message via Bot API.
 * Returns true on success, false on failure.
 */
async function sendTelegramMessage(chatId: number | string, text: string): Promise<boolean> {
  if (!WORKER_BOT_TOKEN) {
    logger.warn('⚠️ Telegram bridge: WORKER_BOT_TOKEN not set');
    return false;
  }

  try {
    await axios.post(
      `https://api.telegram.org/bot${WORKER_BOT_TOKEN}/sendMessage`,
      {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      },
      { timeout: 10_000 },
    );
    return true;
  } catch (err: any) {
    logger.warn('⚠️ Telegram bridge: failed to send', {
      chatId,
      error: err.response?.data?.description || err.message,
    });
    return false;
  }
}

/**
 * Notify an employee about an event via Telegram.
 * Looks up the employee's telegramId and sends a formatted message.
 *
 * Fire-and-forget — errors are logged, never thrown.
 */
export function notifyViaTelegram(event: AgentEvent): void {
  if (!event.employeeId) return; // Broadcast events don't go to Telegram

  _notifyAsync(event).catch((err: any) => {
    logger.error('⚠️ Telegram bridge dispatch error', {
      error: err.message,
      employeeId: event.employeeId,
    });
  });
}

async function _notifyAsync(event: AgentEvent): Promise<void> {
  if (!WORKER_BOT_TOKEN) return;

  const userDoc = await db.collection('users').doc(event.employeeId!).get();
  if (!userDoc.exists) return;

  const userData = userDoc.data();
  const telegramId = userData?.telegramId;
  if (!telegramId) return;

  // Don't send bot-sourced events back to Telegram (avoid echo loops)
  if (event.source === 'bot') return;

  const message = formatEventForTelegram(event);
  const sent = await sendTelegramMessage(telegramId, message);

  if (sent) {
    logger.info('📨 Telegram bridge: event sent', {
      employeeId: event.employeeId,
      eventType: `${event.type}.${event.action}`,
    });
  }
}
