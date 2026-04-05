/**
 * Time Tracking Routes — POST, GET active-all, summary, admin-stop (4 endpoints)
 */
import { Router } from 'express';
import * as admin from 'firebase-admin';
import { db, FieldValue, Timestamp, logger, logAgentActivity } from '../routeContext';
import { logAudit, AuditHelpers, extractAuditContext } from '../utils/auditLogger';
import {
  TimeTrackingSchema,
  ActiveSessionsQuerySchema,
  TimeSummaryQuerySchema,
  AdminStopSchema,
} from '../schemas';

const router = Router();

// ─── POST /api/time-tracking ────────────────────────────────────────

router.post('/api/time-tracking', async (req, res, next) => {
  try {
    const data = TimeTrackingSchema.parse(req.body);
    const userId = req.agentUserId!;
    const userName = req.agentUserName!;

    switch (data.action) {
      // ─── START ──────────────────────────────────────────
      case 'start': {
        logger.info('⏱️ timer:start', { taskTitle: data.taskTitle, clientId: data.clientId, startTime: data.startTime });

        // Validate optional manual startTime
        let manualStartTime: admin.firestore.Timestamp | null = null;
        if (data.startTime) {
          const parsed = new Date(data.startTime);
          if (isNaN(parsed.getTime())) {
            res.status(400).json({ error: 'Invalid startTime format (ISO string expected)' });
            return;
          }
          const now = Date.now();
          const sevenDaysAgo = now - 7 * 24 * 3600_000;
          if (parsed.getTime() > now + 60_000) { // 1 min grace
            res.status(400).json({ error: 'startTime не может быть в будущем' });
            return;
          }
          if (parsed.getTime() < sevenDaysAgo) {
            res.status(400).json({ error: 'startTime не может быть старше 7 дней' });
            return;
          }
          manualStartTime = Timestamp.fromDate(parsed);
        }

        // ─── Cross-lookup: resolve telegramId ↔ Firebase UID ───
        // The user calling this API uses Firebase UID (userId).
        // But they may also have a telegramId in their profile,
        // meaning the Telegram Bot creates sessions with employeeId = telegramId (number).
        // We need to close active sessions from BOTH IDs before starting a new one.
        const userDocSnap = await db.collection('users').doc(userId).get();
        const telegramId = userDocSnap.data()?.telegramId as string | undefined;
        const allEmployeeIds: (string | number)[] = [userId];
        if (telegramId) {
          allEmployeeIds.push(Number(telegramId)); // Bot stores employeeId as number
          allEmployeeIds.push(telegramId);          // Fallback: string variant
        }
        logger.info('⏱️ timer:start — cross-lookup IDs', { userId, telegramId, allEmployeeIds });

        const result = await db.runTransaction(async (tx) => {
          // ═══════════════════════════════════════════════════════════
          // PHASE 1: ALL READS (before any writes — Firestore requirement)
          // ═══════════════════════════════════════════════════════════

          // 1. Get user doc → activeSessionId pointer + hourlyRate
          const userRef = db.collection('users').doc(userId);
          const userDoc = await tx.get(userRef);
          const activeSessionId = userDoc.data()?.activeSessionId as string | undefined;

          // 1b. Resolve clientName from clientId if not provided
          let resolvedClientName = data.clientName || '';
          let clientDoc: admin.firestore.DocumentSnapshot | null = null;
          if (!resolvedClientName && data.clientId) {
            clientDoc = await tx.get(db.collection('clients').doc(data.clientId));
          }

          // 2a. Read pointed-to session (if exists)
          let pointerSessionDoc: admin.firestore.DocumentSnapshot | null = null;
          if (activeSessionId) {
            pointerSessionDoc = await tx.get(
              db.collection('work_sessions').doc(activeSessionId)
            );
          }

          // 2b. Cross-platform scan: find ANY active sessions for ALL employee IDs
          const crossPlatformDocs: admin.firestore.DocumentSnapshot[] = [];
          for (const empId of allEmployeeIds) {
            const activeSnap = await tx.get(
              db.collection('work_sessions')
                .where('employeeId', '==', empId)
                .where('status', 'in', ['active', 'paused'])
                .limit(5)
            );
            crossPlatformDocs.push(...activeSnap.docs);
          }

          // 3. hourlyRate cascade + projectId resolution: task → user → 0
          let hourlyRate = 0;
          let resolvedProjectId = data.projectId || null;
          if (data.taskId) {
            const taskDoc = await tx.get(db.collection('gtd_tasks').doc(data.taskId));
            const taskData = taskDoc.data();
            hourlyRate = taskData?.hourlyRate || 0;
            // Auto-resolve projectId from task if not explicitly provided
            if (!resolvedProjectId && taskData?.projectId) {
              resolvedProjectId = taskData.projectId;
            }
          }
          if (!hourlyRate) {
            hourlyRate = userDoc.data()?.hourlyRate || 0;
          }

          // ═══════════════════════════════════════════════════════════
          // PHASE 2: ALL WRITES (after all reads are complete)
          // ═══════════════════════════════════════════════════════════

          const closedSessions: { id: string; mins: number; earn: number }[] = [];

          // Helper: compute duration & earnings for a session, then write updates
          const closeSession = (
            sessionRef: admin.firestore.DocumentReference,
            sessionDoc: admin.firestore.DocumentSnapshot,
          ) => {
            const old = sessionDoc.data()!;
            const endTime = manualStartTime || Timestamp.now();
            let diff = endTime.toMillis() - old.startTime.toMillis();
            if (old.totalBreakMinutes) diff -= old.totalBreakMinutes * 60000;
            if (old.status === 'paused' && old.lastBreakStart) {
              diff -= (endTime.toMillis() - old.lastBreakStart.toMillis());
            }
            const mins = Math.max(0, Math.round(diff / 60000));
            const earn = +((mins / 60) * (old.hourlyRate || 0)).toFixed(2);

            tx.update(sessionRef, {
              status: 'completed',
              endTime,
              durationMinutes: mins,
              sessionEarnings: earn,
            });

            if (old.relatedTaskId) {
              tx.update(db.collection('gtd_tasks').doc(old.relatedTaskId), {
                totalTimeSpentMinutes: FieldValue.increment(mins),
                totalEarnings: FieldValue.increment(earn),
                updatedAt: FieldValue.serverTimestamp(),
              });
            }

            closedSessions.push({ id: sessionDoc.id, mins, earn });
            logger.info('⏱️ timer:start — closed session', { id: sessionDoc.id, mins, earn });
          };

          // Close pointer session
          const closedIds = new Set<string>();
          if (pointerSessionDoc && pointerSessionDoc.exists &&
              ['active', 'paused'].includes(pointerSessionDoc.data()!.status)) {
            closeSession(pointerSessionDoc.ref, pointerSessionDoc);
            closedIds.add(pointerSessionDoc.id);
          } else if (activeSessionId) {
            logger.warn('⏱️ auto-heal: stale activeSessionId', { activeSessionId });
          }

          // Close cross-platform sessions (deduplicated)
          for (const doc of crossPlatformDocs) {
            if (!closedIds.has(doc.id) && !closedSessions.some(cs => cs.id === doc.id)) {
              if (['active', 'paused'].includes(doc.data()!.status)) {
                closeSession(doc.ref, doc);
                closedIds.add(doc.id);
              }
            }
          }

          // 4. Create new session + update pointer
          const effectiveStartTime = manualStartTime || Timestamp.now();
          if (!resolvedClientName && clientDoc && clientDoc.exists) {
            resolvedClientName = clientDoc.data()?.name || '';
          }
          const newRef = db.collection('work_sessions').doc();
          tx.set(newRef, {
            employeeId: userId,
            employeeName: userName,
            startTime: effectiveStartTime,
            status: 'active',
            description: data.taskTitle,
            clientId: data.clientId || '',
            clientName: resolvedClientName || '',
            projectId: resolvedProjectId,
            type: 'regular',
            relatedTaskId: data.taskId || null,
            relatedTaskTitle: data.taskTitle,
            hourlyRate,
            siteId: data.siteId || null,
            source: 'openclaw',
          });
          tx.update(userRef, { activeSessionId: newRef.id });

          return { sessionId: newRef.id, closedSessions, hourlyRate };
        });

        // Build response for closed sessions
        const primaryClosed = result.closedSessions.length > 0 ? result.closedSessions[0] : null;

        logger.info('⏱️ timer:started', {
          sessionId: result.sessionId,
          hourlyRate: result.hourlyRate,
          closedCount: result.closedSessions.length,
        });

        // Audit Log: Timer started
        const auditContext = extractAuditContext(req);
        await logAudit(AuditHelpers.create(
          'work_session',
          result.sessionId,
          {
            taskTitle: data.taskTitle,
            clientId: data.clientId,
            projectId: resolvedProjectId,
            hourlyRate: result.hourlyRate,
          },
          auditContext.performedBy,
          auditContext.source as any
        ));

        // Audit Log: Closed previous sessions
        for (const closedSession of result.closedSessions) {
          await logAudit({
            action: 'TIMER_AUTO_STOP',
            entityType: 'work_session',
            entityId: closedSession.id,
            source: auditContext.source as any,
            performedBy: auditContext.performedBy,
            metadata: {
              reason: 'Auto-stopped by new session start',
              durationMinutes: closedSession.mins,
              earnings: closedSession.earn,
            },
          });
        }

        await logAgentActivity({
          userId,
          action: 'timer_started',
          endpoint: '/api/time-tracking',
          metadata: {
            sessionId: result.sessionId,
            taskTitle: data.taskTitle,
            closedSessions: result.closedSessions,
          },
        });

        // hourlyRate = 0 warning
        const warnings: string[] = [];
        if (!result.hourlyRate) {
          warnings.push('⚠️ Ставка $0/ч. Обратитесь к руководителю.');
        }

        res.status(201).json({
          sessionId: result.sessionId,
          message: 'Таймер запущен',
          closedPrevious: primaryClosed
            ? `Предыдущая сессия закрыта: ${primaryClosed.mins}мин, $${primaryClosed.earn}`
            : null,
          closedCount: result.closedSessions.length,
          ...(warnings.length > 0 ? { warnings } : {}),
        });
        return;
      }

      // ─── STOP ───────────────────────────────────────────
      case 'stop': {
        logger.info('⏱️ timer:stop', { endTime: data.endTime });

        // Validate optional manual endTime
        let manualEndTime: admin.firestore.Timestamp | null = null;
        if (data.endTime) {
          const parsed = new Date(data.endTime);
          if (isNaN(parsed.getTime())) {
            res.status(400).json({ error: 'Invalid endTime format (ISO string expected)' });
            return;
          }
          const now = Date.now();
          if (parsed.getTime() > now + 60_000) { // 1 min grace
            res.status(400).json({ error: 'endTime не может быть в будущем' });
            return;
          }
          const sevenDaysAgo = now - 7 * 24 * 3600_000;
          if (parsed.getTime() < sevenDaysAgo) {
            res.status(400).json({ error: 'endTime не может быть старше 7 дней' });
            return;
          }
          manualEndTime = Timestamp.fromDate(parsed);
        }

        // Cross-lookup: resolve telegramId for this user (same as start)
        const stopUserDoc = await db.collection('users').doc(userId).get();
        const stopTelegramId = stopUserDoc.data()?.telegramId as string | undefined;
        const stopAllIds: (string | number)[] = [userId];
        if (stopTelegramId) {
          stopAllIds.push(Number(stopTelegramId));
          stopAllIds.push(stopTelegramId);
        }

        const result = await db.runTransaction(async (tx) => {
          const userRef = db.collection('users').doc(userId);
          const userDoc = await tx.get(userRef);
          const sid = userDoc.data()?.activeSessionId as string | undefined;

          // Try pointer first, then cross-platform scan
          let sessionRef: admin.firestore.DocumentReference | null = null;
          let sessionDoc: admin.firestore.DocumentSnapshot | null = null;

          if (sid) {
            sessionRef = db.collection('work_sessions').doc(sid);
            sessionDoc = await tx.get(sessionRef);
            if (!sessionDoc.exists || !['active', 'paused'].includes(sessionDoc.data()!.status)) {
              logger.warn('⏱️ auto-heal: clearing stale pointer', { sid });
              tx.update(userRef, { activeSessionId: null });
              sessionRef = null;
              sessionDoc = null;
            }
          }

          // Cross-platform fallback: find active session by any employee ID
          if (!sessionDoc) {
            for (const empId of stopAllIds) {
              const snap = await tx.get(
                db.collection('work_sessions')
                  .where('employeeId', '==', empId)
                  .where('status', 'in', ['active', 'paused'])
                  .limit(1)
              );
              if (!snap.empty) {
                sessionDoc = snap.docs[0];
                sessionRef = sessionDoc.ref;
                logger.info('⏱️ timer:stop — found cross-platform session', { id: sessionDoc.id, empId });
                break;
              }
            }
          }

          if (!sessionRef || !sessionDoc) return null;

          // Auto-heal: stale pointer
          if (!sessionDoc.exists || !['active', 'paused'].includes(sessionDoc.data()!.status)) {
            logger.warn('⏱️ auto-heal: clearing stale pointer', { sid });
            tx.update(userRef, { activeSessionId: null });
            return null;
          }

          const s = sessionDoc.data()!;
          const endTime = manualEndTime || Timestamp.now();

          // Validate endTime > startTime
          if (endTime.toMillis() < s.startTime.toMillis()) {
            throw new Error('END_BEFORE_START');
          }

          let diff = endTime.toMillis() - s.startTime.toMillis();
          if (s.totalBreakMinutes) diff -= s.totalBreakMinutes * 60000;
          if (s.status === 'paused' && s.lastBreakStart) {
            diff -= (endTime.toMillis() - s.lastBreakStart.toMillis());
          }
          const mins = Math.max(0, Math.round(diff / 60000));
          const earn = +((mins / 60) * (s.hourlyRate || 0)).toFixed(2);

          tx.update(sessionRef, {
            status: 'completed',
            endTime,
            durationMinutes: mins,
            sessionEarnings: earn,
            updatedBySource: 'openclaw',
          });
          tx.update(userRef, { activeSessionId: null });

          // Aggregate on linked task
          if (s.relatedTaskId) {
            tx.update(db.collection('gtd_tasks').doc(s.relatedTaskId), {
              totalTimeSpentMinutes: FieldValue.increment(mins),
              totalEarnings: FieldValue.increment(earn),
              updatedAt: FieldValue.serverTimestamp(),
            });
          }

          return { mins, earn, task: s.relatedTaskTitle || s.description, sessionId: sessionRef.id };
        }).catch((e: Error) => {
          if (e.message === 'END_BEFORE_START') {
            return 'END_BEFORE_START' as const;
          }
          throw e;
        });

        if (result === 'END_BEFORE_START') {
          res.status(400).json({ error: 'endTime не может быть раньше startTime сессии' });
          return;
        }

        if (!result) {
          res.status(404).json({ error: 'Нет активной сессии' });
          return;
        }

        logger.info('⏱️ timer:stopped', result);

        // Audit Log: Timer stopped
        const stopAuditContext = extractAuditContext(req);
        await logAudit({
          action: 'TIMER_STOP',
          entityType: 'work_session',
          entityId: result.sessionId,
          source: stopAuditContext.source as any,
          performedBy: stopAuditContext.performedBy,
          metadata: {
            durationMinutes: result.mins,
            earnings: result.earn,
            task: result.task,
          },
        });

        await logAgentActivity({
          userId,
          action: 'timer_stopped',
          endpoint: '/api/time-tracking',
          metadata: result,
        });

        res.json({
          durationMinutes: result.mins,
          earnings: result.earn,
          message: `Сессия завершена: ${result.mins}мин, $${result.earn}`,
        });
        return;
      }

      // ─── STATUS ─────────────────────────────────────────
      case 'status': {
        const statusUserDoc = await db.collection('users').doc(userId).get();
        const statusSid = statusUserDoc.data()?.activeSessionId as string | undefined;
        const statusTelegramId = statusUserDoc.data()?.telegramId as string | undefined;

        // 1. Try pointer
        let foundSession: admin.firestore.DocumentSnapshot | null = null;
        if (statusSid) {
          const s = await db.collection('work_sessions').doc(statusSid).get();
          if (s.exists && ['active', 'paused'].includes(s.data()!.status)) {
            foundSession = s;
          }
        }

        // 2. Cross-platform fallback
        if (!foundSession && statusTelegramId) {
          const searchIds: (string | number)[] = [userId, Number(statusTelegramId), statusTelegramId];
          for (const empId of searchIds) {
            const snap = await db.collection('work_sessions')
              .where('employeeId', '==', empId)
              .where('status', 'in', ['active', 'paused'])
              .limit(1)
              .get();
            if (!snap.empty) {
              foundSession = snap.docs[0];
              break;
            }
          }
        }

        if (!foundSession) {
          res.json({ active: false, message: 'Нет активной сессии' });
          return;
        }

        const s = foundSession.data()!;
        res.json({
          active: true,
          sessionId: foundSession.id,
          task: s.relatedTaskTitle || s.description,
          client: s.clientName,
          status: s.status,
          elapsedMinutes: Math.round((Date.now() - s.startTime.toMillis()) / 60000),
          hourlyRate: s.hourlyRate,
        });
        return;
      }
    }
  } catch (e) {
    next(e);
  }
});


// ─── GET /api/time-tracking/active-all ──────────────────────────────

router.get('/api/time-tracking/active-all', async (req, res, next) => {
  try {
    const query = ActiveSessionsQuerySchema.parse(req.query);
    logger.info('⏱️ timer:active-all', { clientId: query.clientId });

    let q: admin.firestore.Query = db.collection('work_sessions')
      .where('status', '==', 'active');

    if (query.clientId) {
      q = q.where('clientId', '==', query.clientId);
    }

    const snap = await q.get();

    const activeSessions = snap.docs.map((d) => {
      const s = d.data();
      return {
        sessionId: d.id,
        employeeId: s.employeeId,
        employeeName: s.employeeName,
        clientId: s.clientId,
        clientName: s.clientName,
        projectId: s.projectId || null,
        task: s.relatedTaskTitle || s.description,
        relatedTaskId: s.relatedTaskId || null,
        startTime: s.startTime?.toDate?.()?.toISOString() || null,
        elapsedMinutes: s.startTime
          ? Math.round((Date.now() - s.startTime.toMillis()) / 60000)
          : 0,
        hourlyRate: s.hourlyRate || 0,
      };
    });

    res.json({ activeSessions, count: activeSessions.length });
  } catch (e) {
    next(e);
  }
});


// ─── GET /api/time-tracking/summary (Phase 2) ──────────────────────

router.get('/api/time-tracking/summary', async (req, res, next) => {
  try {
    const params = TimeSummaryQuerySchema.parse(req.query);
    logger.info('⏱️ timer:summary', { from: params.from, to: params.to, employeeId: params.employeeId });

    const fromDate = new Date(params.from);
    const toDate = new Date(params.to);
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      res.status(400).json({ error: 'Invalid date format (ISO string expected)' });
      return;
    }
    // Extend 'to' to end of day
    toDate.setDate(toDate.getDate() + 1);

    let q: admin.firestore.Query = db.collection('work_sessions')
      .where('status', '==', 'completed')
      .where('startTime', '>=', Timestamp.fromDate(fromDate))
      .where('startTime', '<', Timestamp.fromDate(toDate));

    if (params.employeeId) {
      q = q.where('employeeId', '==', params.employeeId);
    }

    const snap = await q.get();

    // Aggregate per employee
    const byEmployee: Record<string, {
      employeeId: string;
      employeeName: string;
      totalMinutes: number;
      totalEarnings: number;
      sessionCount: number;
    }> = {};

    let grandTotalMinutes = 0;
    let grandTotalEarnings = 0;

    snap.docs.forEach((d) => {
      const s = d.data();
      const eid = s.employeeId || 'unknown';
      if (!byEmployee[eid]) {
        byEmployee[eid] = {
          employeeId: eid,
          employeeName: s.employeeName || 'Unknown',
          totalMinutes: 0,
          totalEarnings: 0,
          sessionCount: 0,
        };
      }
      const mins = s.durationMinutes || 0;
      const earn = s.sessionEarnings || 0;
      byEmployee[eid].totalMinutes += mins;
      byEmployee[eid].totalEarnings += earn;
      byEmployee[eid].sessionCount += 1;
      grandTotalMinutes += mins;
      grandTotalEarnings += earn;
    });

    const employees = Object.values(byEmployee).map((e) => ({
      ...e,
      totalHours: +(e.totalMinutes / 60).toFixed(1),
      totalEarnings: +e.totalEarnings.toFixed(2),
    }));

    // Sort by totalMinutes desc
    employees.sort((a, b) => b.totalMinutes - a.totalMinutes);

    res.json({
      from: params.from,
      to: params.to,
      totalHours: +(grandTotalMinutes / 60).toFixed(1),
      totalEarnings: +grandTotalEarnings.toFixed(2),
      totalSessions: snap.size,
      employees,
    });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/time-tracking/admin-stop (Phase 2) ──────────────────

router.post('/api/time-tracking/admin-stop', async (req, res, next) => {
  try {
    // Security: only OWNER can admin-stop
    if (req.agentUserId !== process.env.OWNER_UID) {
      res.status(403).json({ error: 'Только владелец может останавливать чужие сессии' });
      return;
    }

    const data = AdminStopSchema.parse(req.body);
    logger.info('⏱️ timer:admin-stop', { sessionId: data.sessionId, endTime: data.endTime });

    // Validate optional manual endTime
    let manualEndTime: admin.firestore.Timestamp | null = null;
    if (data.endTime) {
      const parsed = new Date(data.endTime);
      if (isNaN(parsed.getTime())) {
        res.status(400).json({ error: 'Invalid endTime format (ISO string expected)' });
        return;
      }
      if (parsed.getTime() > Date.now() + 60_000) {
        res.status(400).json({ error: 'endTime не может быть в будущем' });
        return;
      }
      manualEndTime = Timestamp.fromDate(parsed);
    }

    const result = await db.runTransaction(async (tx) => {
      const sessionRef = db.collection('work_sessions').doc(data.sessionId);
      const sessionDoc = await tx.get(sessionRef);

      if (!sessionDoc.exists) {
        throw new Error('SESSION_NOT_FOUND');
      }

      const s = sessionDoc.data()!;
      if (!['active', 'paused'].includes(s.status)) {
        throw new Error('SESSION_NOT_ACTIVE');
      }

      const endTime = manualEndTime || Timestamp.now();

      if (endTime.toMillis() < s.startTime.toMillis()) {
        throw new Error('END_BEFORE_START');
      }

      let diff = endTime.toMillis() - s.startTime.toMillis();
      if (s.totalBreakMinutes) diff -= s.totalBreakMinutes * 60000;
      if (s.status === 'paused' && s.lastBreakStart) {
        diff -= (endTime.toMillis() - s.lastBreakStart.toMillis());
      }
      const mins = Math.max(0, Math.round(diff / 60000));
      const earn = +((mins / 60) * (s.hourlyRate || 0)).toFixed(2);

      // READ employee doc BEFORE any writes (Firestore requirement)
      const employeeRef = db.collection('users').doc(s.employeeId);
      const employeeDoc = await tx.get(employeeRef);

      // === ALL WRITES below ===

      tx.update(sessionRef, {
        status: 'completed',
        endTime,
        durationMinutes: mins,
        sessionEarnings: earn,
      });

      // Clear activeSessionId pointer on the employee
      if (employeeDoc.exists && employeeDoc.data()?.activeSessionId === data.sessionId) {
        tx.update(employeeRef, { activeSessionId: null });
      }

      // Aggregate on linked task
      if (s.relatedTaskId) {
        tx.update(db.collection('gtd_tasks').doc(s.relatedTaskId), {
          totalTimeSpentMinutes: FieldValue.increment(mins),
          totalEarnings: FieldValue.increment(earn),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      return {
        mins,
        earn,
        employeeId: s.employeeId,
        employeeName: s.employeeName,
        task: s.relatedTaskTitle || s.description,
      };
    }).catch((e: Error) => {
      if (['SESSION_NOT_FOUND', 'SESSION_NOT_ACTIVE', 'END_BEFORE_START'].includes(e.message)) {
        return e.message as 'SESSION_NOT_FOUND' | 'SESSION_NOT_ACTIVE' | 'END_BEFORE_START';
      }
      throw e;
    });

    if (result === 'SESSION_NOT_FOUND') {
      res.status(404).json({ error: 'Сессия не найдена' });
      return;
    }
    if (result === 'SESSION_NOT_ACTIVE') {
      res.status(400).json({ error: 'Сессия не активна' });
      return;
    }
    if (result === 'END_BEFORE_START') {
      res.status(400).json({ error: 'endTime не может быть раньше startTime сессии' });
      return;
    }

    logger.info('⏱️ timer:admin-stopped', result);

    // Audit Log: Admin stop
    const adminStopAuditContext = extractAuditContext(req);
    await logAudit({
      action: 'ADMIN_TIMER_STOP',
      entityType: 'work_session',
      entityId: data.sessionId,
      source: adminStopAuditContext.source as any,
      performedBy: adminStopAuditContext.performedBy,
      metadata: {
        targetEmployeeId: result.employeeId,
        targetEmployeeName: result.employeeName,
        durationMinutes: result.mins,
        earnings: result.earn,
        task: result.task,
      },
    });

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'timer_admin_stopped',
      endpoint: '/api/time-tracking/admin-stop',
      metadata: { sessionId: data.sessionId, ...result },
    });

    res.json({
      sessionId: data.sessionId,
      durationMinutes: result.mins,
      earnings: result.earn,
      employeeName: result.employeeName,
      message: `Сессия ${result.employeeName} остановлена: ${result.mins}мин, $${result.earn}`,
    });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/time-tracking/admin-start ─────────────────────────────

import { AdminStartSchema } from '../schemas/timeTrackingSchemas';

router.post('/api/time-tracking/admin-start', async (req, res, next) => {
  try {
    if (req.agentUserId !== process.env.OWNER_UID) {
      res.status(403).json({ error: 'Только владелец может запускать чужие сессии' });
      return;
    }

    const data = AdminStartSchema.parse(req.body);
    logger.info('⏱️ timer:admin-start', { employeeId: data.employeeId, taskTitle: data.taskTitle });

    let manualStartTime: admin.firestore.Timestamp | null = null;
    if (data.startTime) {
      const parsed = new Date(data.startTime);
      if (isNaN(parsed.getTime())) {
        res.status(400).json({ error: 'Invalid startTime format' });
        return;
      }
      manualStartTime = Timestamp.fromDate(parsed);
    }

    // Resolve client name
    let resolvedClientName = data.clientName || '';
    if (!resolvedClientName && data.clientId) {
      const clientDoc = await db.collection('clients').doc(data.clientId).get();
      if (clientDoc.exists) resolvedClientName = clientDoc.data()?.name || '';
    }

    // Resolve projectId from task
    let resolvedProjectId = data.projectId || null;
    if (!resolvedProjectId && data.taskId) {
      const taskDoc = await db.collection('gtd_tasks').doc(data.taskId).get();
      if (taskDoc.exists) resolvedProjectId = taskDoc.data()?.projectId || null;
    }

    // Get hourly rate
    const userDoc = await db.collection('users').doc(data.employeeId).get();
    const hourlyRate = userDoc.exists ? (userDoc.data()?.hourlyRate || 0) : 0;
    const employeeName = userDoc.exists ? (userDoc.data()?.displayName || 'Unknown') : 'Unknown';

    const effectiveStartTime = manualStartTime || Timestamp.now();
    const newRef = db.collection('work_sessions').doc();
    await newRef.set({
      employeeId: data.employeeId,
      employeeName,
      startTime: effectiveStartTime,
      status: 'active',
      description: data.taskTitle,
      clientId: data.clientId || '',
      clientName: resolvedClientName,
      projectId: resolvedProjectId,
      type: 'regular',
      relatedTaskId: data.taskId || null,
      relatedTaskTitle: data.taskTitle,
      hourlyRate,
      source: 'openclaw',
    });

    // Update user pointer
    await db.collection('users').doc(data.employeeId).update({ activeSessionId: newRef.id });

    // Audit Log: Admin start
    const adminStartAuditContext = extractAuditContext(req);
    await logAudit(AuditHelpers.create(
      'work_session',
      newRef.id,
      {
        employeeId: data.employeeId,
        employeeName,
        taskTitle: data.taskTitle,
        clientId: data.clientId,
        hourlyRate,
        adminStarted: true,
      },
      adminStartAuditContext.performedBy,
      adminStartAuditContext.source as any
    ));

    res.status(201).json({
      sessionId: newRef.id,
      employeeName,
      hourlyRate,
      message: `Таймер запущен для ${employeeName}`,
    });
  } catch (e) {
    next(e);
  }
});


// ─── autoStopStaleTimers UTILITY ────────────────────────────────────

/**
 * Find and stop all active sessions that have been running for more than 12 hours (720 minutes)
 * @returns Array of stopped sessions with their details
 */
export async function autoStopStaleTimers(): Promise<{
  stoppedSessions: Array<{
    sessionId: string;
    employeeId: string;
    employeeName: string;
    durationMinutes: number;
    earnings: number;
    task: string;
  }>;
  totalStopped: number;
}> {
  const twelveHoursAgo = Timestamp.fromMillis(Date.now() - 12 * 60 * 60 * 1000); // 12 hours ago

  logger.info('⏱️ auto-stop:scan — searching for stale sessions', { cutoffTime: twelveHoursAgo.toDate().toISOString() });

  // Find all active/paused sessions that started more than 12 hours ago
  const staleSessionsQuery = await db.collection('work_sessions')
    .where('status', 'in', ['active', 'paused'])
    .where('startTime', '<', twelveHoursAgo)
    .get();

  if (staleSessionsQuery.empty) {
    logger.info('⏱️ auto-stop:scan — no stale sessions found');
    return { stoppedSessions: [], totalStopped: 0 };
  }

  logger.info('⏱️ auto-stop:scan — found stale sessions', { count: staleSessionsQuery.size });

  const stoppedSessions = [];

  // Process each stale session
  for (const sessionDoc of staleSessionsQuery.docs) {
    try {
      const sessionId = sessionDoc.id;

      const result = await db.runTransaction(async (tx) => {
        // Re-read the session to ensure it's still stale and active
        const freshSessionDoc = await tx.get(sessionDoc.ref);
        if (!freshSessionDoc.exists || !['active', 'paused'].includes(freshSessionDoc.data()!.status)) {
          return null; // Session was already closed by another process
        }

        const s = freshSessionDoc.data()!;
        const endTime = Timestamp.now();

        // Calculate duration and earnings
        let diff = endTime.toMillis() - s.startTime.toMillis();
        if (s.totalBreakMinutes) diff -= s.totalBreakMinutes * 60000;
        if (s.status === 'paused' && s.lastBreakStart) {
          diff -= (endTime.toMillis() - s.lastBreakStart.toMillis());
        }
        const mins = Math.max(0, Math.round(diff / 60000));
        const earn = +((mins / 60) * (s.hourlyRate || 0)).toFixed(2);

        // Update session to completed with auto-stop note
        tx.update(freshSessionDoc.ref, {
          status: 'completed',
          endTime,
          durationMinutes: mins,
          sessionEarnings: earn,
          autoStopped: true,
          autoStopReason: 'Auto-stopped: exceeded 12 hours',
          autoStoppedAt: endTime,
        });

        // Clear activeSessionId pointer if this session is the active one for the employee
        if (s.employeeId) {
          const userRef = db.collection('users').doc(s.employeeId);
          const userDoc = await tx.get(userRef);
          if (userDoc.exists && userDoc.data()?.activeSessionId === sessionId) {
            tx.update(userRef, { activeSessionId: null });
          }
        }

        // Aggregate on linked task
        if (s.relatedTaskId) {
          tx.update(db.collection('gtd_tasks').doc(s.relatedTaskId), {
            totalTimeSpentMinutes: FieldValue.increment(mins),
            totalEarnings: FieldValue.increment(earn),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }

        return {
          sessionId,
          employeeId: s.employeeId,
          employeeName: s.employeeName,
          durationMinutes: mins,
          earnings: earn,
          task: s.relatedTaskTitle || s.description || 'Unknown task',
        };
      });

      if (result) {
        stoppedSessions.push(result);
        logger.info('⏱️ auto-stop:stopped', result);

        // Audit Log: Auto-stop stale session
        await logAudit({
          action: 'AUTO_STOP_STALE',
          entityType: 'work_session',
          entityId: result.sessionId,
          source: 'system',
          performedBy: 'system',
          metadata: {
            reason: 'Auto-stopped: exceeded 12 hours',
            durationMinutes: result.durationMinutes,
            earnings: result.earnings,
            employeeName: result.employeeName,
          },
        });
      }
    } catch (error: any) {
      logger.error('⏱️ auto-stop:error — failed to stop session', {
        sessionId: sessionDoc.id,
        error: error.message
      });
    }
  }

  logger.info('⏱️ auto-stop:complete', { totalStopped: stoppedSessions.length });

  return { stoppedSessions, totalStopped: stoppedSessions.length };
}

// ─── POST /api/time-tracking/auto-stop-stale ──────────────────────

router.post('/api/time-tracking/auto-stop-stale', async (req, res, next) => {
  try {
    // Security: only OWNER can trigger auto-stop
    if (req.agentUserId !== process.env.OWNER_UID) {
      res.status(403).json({ error: 'Только владелец может запускать авто-остановку сессий' });
      return;
    }

    logger.info('⏱️ auto-stop:triggered', { userId: req.agentUserId });

    const result = await autoStopStaleTimers();

    // Audit Log: Manual trigger of auto-stop
    const autoStopAuditContext = extractAuditContext(req);
    await logAudit({
      action: 'MANUAL_AUTO_STOP_TRIGGER',
      entityType: 'system',
      entityId: 'auto-stop-stale-timers',
      source: autoStopAuditContext.source as any,
      performedBy: autoStopAuditContext.performedBy,
      metadata: {
        totalStopped: result.totalStopped,
        triggeredManually: true,
      },
    });

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'auto_stop_stale_timers',
      endpoint: '/api/time-tracking/auto-stop-stale',
      metadata: {
        totalStopped: result.totalStopped,
        stoppedSessions: result.stoppedSessions,
      },
    });

    res.json({
      success: true,
      totalStopped: result.totalStopped,
      message: `Auto-stopped ${result.totalStopped} stale sessions`,
      stoppedSessions: result.stoppedSessions,
    });
  } catch (e: any) {
    logger.error('⏱️ auto-stop:error', { error: e.message, stack: e.stack });
    next(e);
  }
});

export default router;

