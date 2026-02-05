/**
 * @fileoverview Audit Logger for BigQuery Data Warehouse
 * 
 * Central utility for logging all business events to BigQuery.
 * Non-blocking: errors are logged but don't interrupt main flow.
 * 
 * @module utils/auditLogger
 */

import { BigQuery } from '@google-cloud/bigquery';

// Initialize BigQuery client (uses default credentials)
const bigquery = new BigQuery();

const DATASET_ID = 'profit_step_dwh';
const TABLE_ID = 'audit_events_log';

/**
 * Entity types that can be logged
 */
export type AuditEntityType =
    | 'work_session'
    | 'gtd_task'
    | 'note'
    | 'cost'
    | 'invoice'
    | 'payment';

/**
 * Event codes for audit trail
 */
export type AuditEventCode =
    // Work Sessions (Time Trail)
    | 'TIMER_START'
    | 'TIMER_STOP'
    | 'MANUAL_TIME_EDIT'
    | 'SESSION_VOIDED'
    // Tasks (Process Trail)
    | 'TASK_CREATED'
    | 'TASK_STATUS_CHANGE'
    | 'DEADLINE_SHIFT'
    | 'SCOPE_CHANGE'
    | 'BLOCKER_RAISED'
    // Notes/Estimates
    | 'NOTE_CREATED'
    | 'ESTIMATE_LOCKED'
    | 'PRICE_OVERRIDE'
    // Finance (Money Trail)
    | 'PAYMENT_ADDED'
    | 'MATERIAL_PURCHASED'
    | 'LABOR_ACCRUED'
    | 'ADJUSTMENT_ADDED'
    | 'INVOICE_STATUS';

/**
 * Audit event structure
 */
export interface AuditEvent {
    entityType: AuditEntityType;
    entityId: string;
    eventCode: AuditEventCode;
    actorUid?: string;
    projectId?: string;
    companyId?: string;
    before?: object;
    after?: object;
    financialImpact?: number;  // Positive = income, Negative = expense
    timeImpact?: number;       // Minutes
}

/**
 * Log an audit event to BigQuery
 * 
 * @param event - The audit event to log
 * @returns Promise that resolves when insert completes (or fails silently)
 * 
 * @example
 * await logAuditEvent({
 *     entityType: 'work_session',
 *     entityId: 'session_123',
 *     eventCode: 'TIMER_STOP',
 *     actorUid: 'user_456',
 *     financialImpact: 50.00,
 *     timeImpact: 120,
 * });
 */
export async function logAuditEvent(event: AuditEvent): Promise<void> {
    // Generate unique event ID
    const eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

    const row = {
        event_id: eventId,
        timestamp: new Date().toISOString(),
        actor_uid: event.actorUid || null,
        project_id: event.projectId || null,
        company_id: event.companyId || null,
        entity_type: event.entityType,
        entity_id: event.entityId,
        event_code: event.eventCode,
        payload_before: event.before ? JSON.stringify(event.before) : null,
        payload_after: event.after ? JSON.stringify(event.after) : null,
        financial_impact: event.financialImpact ?? 0,
        time_impact: event.timeImpact ?? 0,
    };

    try {
        await bigquery
            .dataset(DATASET_ID)
            .table(TABLE_ID)
            .insert([row]);

        console.log(`📊 Audit logged: ${event.eventCode} for ${event.entityType}/${event.entityId}`);
    } catch (error: unknown) {
        // Non-blocking: log error but don't throw
        // This ensures main business logic isn't affected by analytics failures
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`⚠️ BigQuery audit log failed (non-blocking): ${errorMessage}`);

        // If table doesn't exist yet, provide helpful message
        if (errorMessage.includes('Not found: Table')) {
            console.error(`💡 Hint: Create table with: bq mk --table ${DATASET_ID}.${TABLE_ID}`);
        }
    }
}

/**
 * Batch log multiple audit events
 * More efficient for bulk operations
 */
export async function logAuditEventsBatch(events: AuditEvent[]): Promise<void> {
    if (events.length === 0) return;

    const rows = events.map(event => ({
        event_id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
        timestamp: new Date().toISOString(),
        actor_uid: event.actorUid || null,
        project_id: event.projectId || null,
        company_id: event.companyId || null,
        entity_type: event.entityType,
        entity_id: event.entityId,
        event_code: event.eventCode,
        payload_before: event.before ? JSON.stringify(event.before) : null,
        payload_after: event.after ? JSON.stringify(event.after) : null,
        financial_impact: event.financialImpact ?? 0,
        time_impact: event.timeImpact ?? 0,
    }));

    try {
        await bigquery
            .dataset(DATASET_ID)
            .table(TABLE_ID)
            .insert(rows);

        console.log(`📊 Audit batch logged: ${events.length} events`);
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`⚠️ BigQuery batch audit log failed (non-blocking): ${errorMessage}`);
    }
}
