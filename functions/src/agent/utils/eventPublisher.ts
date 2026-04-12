/**
 * Agent Event Publisher
 *
 * Publishes events to agent_events collection for external agent consumption.
 * Used by API routes and Firestore triggers to notify agents about CRM changes.
 *
 * Events auto-expire after 7 days (cleanup via scheduled function).
 *
 * Phase 10: Also dispatches webhook deliveries and Telegram notifications.
 */
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

import { dispatchWebhooks } from './webhookDelivery';
import { notifyViaTelegram } from './telegramBridge';

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const logger = functions.logger;

export interface AgentEvent {
  type: 'task' | 'session' | 'cost' | 'estimate' | 'project' | 'inventory' | 'payroll' | 'alert';
  action: string;
  entityId: string;
  entityType: string;
  summary: string;
  data?: Record<string, any>;
  employeeId?: string | null;   // null = broadcast to all agents
  companyId?: string | null;
  source?: 'api' | 'bot' | 'trigger' | 'scheduled';
}

/**
 * Publish an event to the agent_events collection.
 * Fire-and-forget — never blocks the caller.
 */
export function publishEvent(event: AgentEvent): void {
  const doc = {
    ...event,
    employeeId: event.employeeId ?? null,
    companyId: event.companyId ?? null,
    source: event.source ?? 'api',
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
  };

  db.collection('agent_events').add(doc)
    .then((ref) => {
      // Phase 10: dispatch webhook + Telegram notifications after event is persisted
      dispatchWebhooks({ ...event, id: ref.id });
      notifyViaTelegram(event);
    })
    .catch((e: any) => {
      logger.error('⚠️ Failed to publish agent event', {
        error: e.message,
        eventType: event.type,
        eventAction: event.action,
      });
    });
}

/**
 * Publish a task event.
 */
export function publishTaskEvent(
  action: 'created' | 'updated' | 'assigned' | 'completed' | 'blocked',
  taskId: string,
  summary: string,
  data?: Record<string, any>,
  employeeId?: string | null,
): void {
  publishEvent({
    type: 'task',
    action,
    entityId: taskId,
    entityType: 'gtd_task',
    summary,
    data,
    employeeId,
    source: 'api',
  });
}

/**
 * Publish a time tracking session event.
 */
export function publishSessionEvent(
  action: 'started' | 'stopped' | 'paused' | 'auto_closed',
  sessionId: string,
  summary: string,
  data?: Record<string, any>,
  employeeId?: string | null,
): void {
  publishEvent({
    type: 'session',
    action,
    entityId: sessionId,
    entityType: 'work_session',
    summary,
    data,
    employeeId,
    source: 'api',
  });
}

/**
 * Publish a cost event.
 */
export function publishCostEvent(
  action: 'created' | 'voided',
  costId: string,
  summary: string,
  data?: Record<string, any>,
  employeeId?: string | null,
): void {
  publishEvent({
    type: 'cost',
    action,
    entityId: costId,
    entityType: 'cost',
    summary,
    data,
    employeeId,
    source: 'api',
  });
}

/**
 * Publish an alert event (budget warning, deadline, safety, etc.).
 */
export function publishAlertEvent(
  action: string,
  entityId: string,
  summary: string,
  data?: Record<string, any>,
  employeeId?: string | null,
): void {
  publishEvent({
    type: 'alert',
    action,
    entityId,
    entityType: 'alert',
    summary,
    data,
    employeeId,
    source: 'scheduled',
  });
}

/**
 * Publish an estimate event.
 */
export function publishEstimateEvent(
  action: 'created' | 'sent' | 'approved' | 'rejected' | 'converted',
  estimateId: string,
  summary: string,
  data?: Record<string, any>,
  employeeId?: string | null,
): void {
  publishEvent({
    type: 'estimate',
    action,
    entityId: estimateId,
    entityType: 'estimate',
    summary,
    data,
    employeeId,
    source: 'api',
  });
}

/**
 * Publish a project event.
 */
export function publishProjectEvent(
  action: 'created' | 'updated' | 'completed',
  projectId: string,
  summary: string,
  data?: Record<string, any>,
  employeeId?: string | null,
): void {
  publishEvent({
    type: 'project',
    action,
    entityId: projectId,
    entityType: 'project',
    summary,
    data,
    employeeId,
    source: 'api',
  });
}

/**
 * Publish an inventory event.
 */
export function publishInventoryEvent(
  action: 'transaction' | 'low_stock' | 'created' | 'updated',
  entityId: string,
  summary: string,
  data?: Record<string, any>,
  employeeId?: string | null,
): void {
  publishEvent({
    type: 'inventory',
    action,
    entityId,
    entityType: 'inventory',
    summary,
    data,
    employeeId,
    source: 'api',
  });
}

/**
 * Publish a payroll event.
 */
export function publishPayrollEvent(
  action: 'period_closed' | 'period_locked' | 'period_paid' | 'overtime_alert',
  entityId: string,
  summary: string,
  data?: Record<string, any>,
  employeeId?: string | null,
): void {
  publishEvent({
    type: 'payroll',
    action,
    entityId,
    entityType: 'payroll_period',
    summary,
    data,
    employeeId,
    source: 'api',
  });
}
