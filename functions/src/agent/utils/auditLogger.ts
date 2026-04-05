/**
 * Audit Logger Utility
 *
 * Logs all API write operations to the 'auditLog' collection for compliance and debugging
 */

import * as admin from 'firebase-admin';

const db = admin.firestore();

export interface AuditLogEntry {
  action: string;
  entityType: string;
  entityId: string;
  changes?: {
    from?: Record<string, any>;
    to?: Record<string, any>;
  };
  source: 'jarvis' | 'web' | 'bot' | 'openclaw' | 'system';
  performedBy: string;
  performedByName?: string;
  timestamp: admin.firestore.Timestamp;
  userAgent?: string;
  ipAddress?: string;
  sessionId?: string;
  metadata?: Record<string, any>;
}

/**
 * Log an audit entry to the auditLog collection
 * @param entry - The audit log entry to record
 * @returns Promise<void>
 */
export async function logAudit(entry: Omit<AuditLogEntry, 'timestamp'>): Promise<void> {
  try {
    const auditEntry: AuditLogEntry = {
      ...entry,
      timestamp: admin.firestore.Timestamp.now(),
    };

    // Use a generated ID for the audit log entry
    await db.collection('auditLog').add(auditEntry);

    // Also log to console for development/debugging
    console.log('🔍 AUDIT:', {
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      performedBy: entry.performedBy,
      source: entry.source,
    });
  } catch (error: any) {
    // Never let audit logging failures break the main operation
    console.error('❌ Audit logging failed:', error.message);
  }
}

/**
 * Middleware-like function to wrap operations with audit logging
 * @param operation - The operation function to execute
 * @param auditData - The audit data to log
 * @returns Promise with the operation result
 */
export async function withAuditLog<T>(
  operation: () => Promise<T>,
  auditData: Omit<AuditLogEntry, 'timestamp'>
): Promise<T> {
  try {
    const result = await operation();

    // Log successful operation
    await logAudit(auditData);

    return result;
  } catch (error) {
    // Log failed operation attempt
    await logAudit({
      ...auditData,
      action: `${auditData.action}_FAILED`,
      metadata: {
        ...auditData.metadata,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    throw error;
  }
}

/**
 * Helper to generate audit data for common operations
 */
export class AuditHelpers {
  static create(entityType: string, entityId: string, data: Record<string, any>, performedBy: string, source: AuditLogEntry['source']) {
    return {
      action: 'CREATE',
      entityType,
      entityId,
      changes: { to: data },
      source,
      performedBy,
    };
  }

  static update(entityType: string, entityId: string, oldData: Record<string, any>, newData: Record<string, any>, performedBy: string, source: AuditLogEntry['source']) {
    return {
      action: 'UPDATE',
      entityType,
      entityId,
      changes: { from: oldData, to: newData },
      source,
      performedBy,
    };
  }

  static delete(entityType: string, entityId: string, data: Record<string, any>, performedBy: string, source: AuditLogEntry['source']) {
    return {
      action: 'DELETE',
      entityType,
      entityId,
      changes: { from: data },
      source,
      performedBy,
    };
  }

  static customAction(action: string, entityType: string, entityId: string, performedBy: string, source: AuditLogEntry['source'], metadata?: Record<string, any>) {
    return {
      action,
      entityType,
      entityId,
      source,
      performedBy,
      metadata,
    };
  }
}

/**
 * Express middleware to extract audit context from requests
 */
export function extractAuditContext(req: any): Pick<AuditLogEntry, 'performedBy' | 'performedByName' | 'source' | 'userAgent' | 'ipAddress'> {
  return {
    performedBy: req.agentUserId || req.user?.uid || 'anonymous',
    performedByName: req.agentUserName || req.user?.displayName || 'Unknown',
    source: req.headers['x-source'] || 'openclaw', // Default to openclaw for agent API
    userAgent: req.headers['user-agent'],
    ipAddress: req.ip || req.connection.remoteAddress,
  };
}