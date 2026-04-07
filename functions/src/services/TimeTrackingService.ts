/**
 * TimeTrackingService — Unified time tracking logic
 *
 * Centralizes session duration calculation, session closing, cross-platform
 * employee ID resolution, and active session lookup.
 *
 * Used by: agent/routes/timeTracking.ts, scheduled functions, callable functions.
 */

import * as admin from 'firebase-admin';

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

// ─── Types ─────────────────────────────────────────────────────────

export interface SessionDuration {
  durationMinutes: number;
  earnings: number;
}

export interface ClosedSessionResult {
  sessionId: string;
  durationMinutes: number;
  earnings: number;
  task: string;
  employeeId?: string;
  employeeName?: string;
}

// ─── Core Calculation ──────────────────────────────────────────────

/**
 * Calculate session duration in minutes and earnings, accounting for breaks.
 */
export function calculateSessionDuration(
  session: admin.firestore.DocumentData,
  endTime: admin.firestore.Timestamp,
): SessionDuration {
  let diff = endTime.toMillis() - session.startTime.toMillis();

  // Subtract total accumulated break time
  if (session.totalBreakMinutes) {
    diff -= session.totalBreakMinutes * 60000;
  }

  // If currently paused, subtract time since last break start
  if (session.status === 'paused' && session.lastBreakStart) {
    diff -= (endTime.toMillis() - session.lastBreakStart.toMillis());
  }

  const durationMinutes = Math.max(0, Math.round(diff / 60000));
  const earnings = +((durationMinutes / 60) * (session.hourlyRate || 0)).toFixed(2);

  return { durationMinutes, earnings };
}

// ─── Cross-Platform ID Resolution ──────────────────────────────────

/**
 * Resolve all possible employee IDs for a user (Firebase UID + Telegram ID variants).
 * The Telegram bot stores employeeId as a number, while the web uses Firebase UID strings.
 */
export async function resolveEmployeeIds(userId: string): Promise<(string | number)[]> {
  const userDoc = await db.collection('users').doc(userId).get();
  const telegramId = userDoc.data()?.telegramId as string | undefined;

  const ids: (string | number)[] = [userId];
  if (telegramId) {
    ids.push(Number(telegramId)); // Bot stores as number
    ids.push(telegramId);          // Fallback: string variant
  }

  return ids;
}

/**
 * Resolve employee IDs within a transaction (when user doc is already read).
 */
export function resolveEmployeeIdsFromDoc(
  userId: string,
  userData: admin.firestore.DocumentData | undefined,
): (string | number)[] {
  const telegramId = userData?.telegramId as string | undefined;
  const ids: (string | number)[] = [userId];
  if (telegramId) {
    ids.push(Number(telegramId));
    ids.push(telegramId);
  }
  return ids;
}

// ─── Session Lookup ────────────────────────────────────────────────

/**
 * Find active sessions across all employee IDs (cross-platform).
 * Use inside a Firestore transaction.
 */
export async function findActiveSessionsInTx(
  tx: admin.firestore.Transaction,
  employeeIds: (string | number)[],
  limit = 5,
): Promise<admin.firestore.DocumentSnapshot[]> {
  const results: admin.firestore.DocumentSnapshot[] = [];
  const seenIds = new Set<string>();

  for (const empId of employeeIds) {
    const snap = await tx.get(
      db.collection('work_sessions')
        .where('employeeId', '==', empId)
        .where('status', 'in', ['active', 'paused'])
        .limit(limit),
    );
    for (const doc of snap.docs) {
      if (!seenIds.has(doc.id)) {
        results.push(doc);
        seenIds.add(doc.id);
      }
    }
  }

  return results;
}

/**
 * Find a single active session (by pointer first, then cross-platform scan).
 * Use outside transactions for read-only status checks.
 */
export async function findActiveSession(
  userId: string,
): Promise<admin.firestore.DocumentSnapshot | null> {
  const userDoc = await db.collection('users').doc(userId).get();
  const activeSessionId = userDoc.data()?.activeSessionId as string | undefined;
  const employeeIds = resolveEmployeeIdsFromDoc(userId, userDoc.data());

  // 1. Try pointer
  if (activeSessionId) {
    const session = await db.collection('work_sessions').doc(activeSessionId).get();
    if (session.exists && ['active', 'paused'].includes(session.data()!.status)) {
      return session;
    }
  }

  // 2. Cross-platform fallback
  for (const empId of employeeIds) {
    const snap = await db.collection('work_sessions')
      .where('employeeId', '==', empId)
      .where('status', 'in', ['active', 'paused'])
      .limit(1)
      .get();
    if (!snap.empty) {
      return snap.docs[0];
    }
  }

  return null;
}

// ─── Session Close (in transaction) ────────────────────────────────

/**
 * Close a session within a Firestore transaction.
 * Updates session status, calculates duration/earnings, and aggregates on linked task.
 *
 * @returns ClosedSessionResult or null if session was already closed
 */
export function closeSessionInTx(
  tx: admin.firestore.Transaction,
  sessionDoc: admin.firestore.DocumentSnapshot,
  endTime: admin.firestore.Timestamp,
  options?: { autoStopReason?: string },
): ClosedSessionResult | null {
  if (!sessionDoc.exists) return null;

  const s = sessionDoc.data()!;
  if (!['active', 'paused'].includes(s.status)) return null;

  const { durationMinutes, earnings } = calculateSessionDuration(s, endTime);

  const updateData: Record<string, any> = {
    status: 'completed',
    endTime,
    durationMinutes,
    sessionEarnings: earnings,
  };

  if (options?.autoStopReason) {
    updateData.autoStopped = true;
    updateData.autoStopReason = options.autoStopReason;
    updateData.autoStoppedAt = endTime;
  }

  tx.update(sessionDoc.ref, updateData);

  // Aggregate on linked task
  if (s.relatedTaskId) {
    tx.update(db.collection('gtd_tasks').doc(s.relatedTaskId), {
      totalTimeSpentMinutes: FieldValue.increment(durationMinutes),
      totalEarnings: FieldValue.increment(earnings),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  return {
    sessionId: sessionDoc.id,
    durationMinutes,
    earnings,
    task: s.relatedTaskTitle || s.description || 'Unknown task',
    employeeId: s.employeeId,
    employeeName: s.employeeName,
  };
}

// ─── Hourly Rate Resolution ────────────────────────────────────────

/**
 * Resolve hourly rate: task → user → 0
 */
export async function resolveHourlyRateInTx(
  tx: admin.firestore.Transaction,
  taskId: string | undefined,
  userDoc: admin.firestore.DocumentSnapshot,
): Promise<{ hourlyRate: number; resolvedProjectId: string | null }> {
  let hourlyRate = 0;
  let resolvedProjectId: string | null = null;

  if (taskId) {
    const taskDoc = await tx.get(db.collection('gtd_tasks').doc(taskId));
    const taskData = taskDoc.data();
    hourlyRate = taskData?.hourlyRate || 0;
    if (taskData?.projectId) {
      resolvedProjectId = taskData.projectId;
    }
  }

  if (!hourlyRate) {
    hourlyRate = userDoc.data()?.hourlyRate || 0;
  }

  return { hourlyRate, resolvedProjectId };
}
