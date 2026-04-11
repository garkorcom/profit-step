/**
 * Time Tracking Routes — POST, GET active-all, summary, admin-stop (4 endpoints)
 */
import { Router } from 'express';
import * as admin from 'firebase-admin';
import { db, Timestamp, logger, logAgentActivity } from '../routeContext';
import { logAudit, AuditHelpers, extractAuditContext } from '../utils/auditLogger';
import {
  resolveEmployeeIds,
  findActiveSessionsInTx,
  closeSessionInTx,
  findActiveSession,
} from '../../services/TimeTrackingService';
import {
  TimeTrackingSchema,
  ActiveSessionsQuerySchema,
  TimeSummaryQuerySchema,
  AdminStopSchema,
} from '../schemas';
import { requireScope } from '../agentMiddleware';
import { publishSessionEvent } from '../utils/eventPublisher';

const router = Router();

// ─── POST /api/time-tracking ────────────────────────────────────────

router.post('/api/time-tracking', requireScope('time:write', 'admin'), async (req, res, next) => {
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
        const allEmployeeIds = await resolveEmployeeIds(userId);
        logger.info('⏱️ timer:start — cross-lookup IDs', { userId, allEmployeeIds });

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
          // 2b. Cross-platform scan: find ANY active sessions for ALL employee IDs
          const crossPlatformDocs = await findActiveSessionsInTx(tx, allEmployeeIds);

          // 3. hourlyRate cascade + projectId resolution: task → user → 0
          let hourlyRate = 0;
          let resolvedProjectId = data.projectId || null;
          if (data.taskId) {
            const taskDoc = await tx.get(db.collection('gtd_tasks').doc(data.taskId));
            const taskData = taskDoc.data();
            hourlyRate = taskData?.hourlyRate || 0;
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
          const closeEndTime = manualStartTime || Timestamp.now();

          // Close pointer session
          const closedIds = new Set<string>();
          if (pointerSessionDoc && pointerSessionDoc.exists &&
              ['active', 'paused'].includes(pointerSessionDoc.data()!.status)) {
            const result = closeSessionInTx(tx, pointerSessionDoc, closeEndTime);
            if (result) {
              closedSessions.push({ id: result.sessionId, mins: result.durationMinutes, earn: result.earnings });
              closedIds.add(result.sessionId);
              logger.info('⏱️ timer:start — closed session', { id: result.sessionId, mins: result.durationMinutes, earn: result.earnings });
            }
          } else if (activeSessionId) {
            logger.warn('⏱️ auto-heal: stale activeSessionId', { activeSessionId });
          }

          // Close cross-platform sessions (deduplicated)
          for (const doc of crossPlatformDocs) {
            if (!closedIds.has(doc.id)) {
              const result = closeSessionInTx(tx, doc, closeEndTime);
              if (result) {
                closedSessions.push({ id: result.sessionId, mins: result.durationMinutes, earn: result.earnings });
                closedIds.add(result.sessionId);
                logger.info('⏱️ timer:start — closed session', { id: result.sessionId, mins: result.durationMinutes, earn: result.earnings });
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

          return { sessionId: newRef.id, closedSessions, hourlyRate, resolvedProjectId };
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
            projectId: result.resolvedProjectId,
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

        // Publish session started event
        publishSessionEvent('started', result.sessionId, `Session started for ${data.clientName || data.clientId || 'unknown'}`, {
          clientId: data.clientId, employeeId: userId, employeeName: userName,
        }, userId);

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
        const stopAllIds = await resolveEmployeeIds(userId);

        const result = await db.runTransaction(async (tx) => {
          const userRef = db.collection('users').doc(userId);
          const userDoc = await tx.get(userRef);
          const sid = userDoc.data()?.activeSessionId as string | undefined;

          // Try pointer first, then cross-platform scan
          let sessionDoc: admin.firestore.DocumentSnapshot | null = null;

          if (sid) {
            const pointerDoc = await tx.get(db.collection('work_sessions').doc(sid));
            if (pointerDoc.exists && ['active', 'paused'].includes(pointerDoc.data()!.status)) {
              sessionDoc = pointerDoc;
            } else {
              logger.warn('⏱️ auto-heal: clearing stale pointer', { sid });
              tx.update(userRef, { activeSessionId: null });
            }
          }

          // Cross-platform fallback
          if (!sessionDoc) {
            const found = await findActiveSessionsInTx(tx, stopAllIds, 1);
            if (found.length > 0) {
              sessionDoc = found[0];
              logger.info('⏱️ timer:stop — found cross-platform session', { id: sessionDoc.id });
            }
          }

          if (!sessionDoc) return null;

          const s = sessionDoc.data()!;
          const endTime = manualEndTime || Timestamp.now();

          // Validate endTime > startTime
          if (endTime.toMillis() < s.startTime.toMillis()) {
            throw new Error('END_BEFORE_START');
          }

          // Use unified closeSessionInTx (handles status update, duration, earnings, task aggregation)
          const closed = closeSessionInTx(tx, sessionDoc, endTime);
          if (!closed) return null;

          // Clear activeSessionId pointer
          tx.update(userRef, { activeSessionId: null });

          return { mins: closed.durationMinutes, earn: closed.earnings, task: closed.task, sessionId: closed.sessionId };
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

        // Publish session stopped event
        publishSessionEvent('stopped', result.sessionId, `Session stopped: ${result.mins}min, $${result.earn}`, {
          durationMinutes: result.mins, earnings: result.earn, employeeId: userId,
        }, userId);

        res.json({
          durationMinutes: result.mins,
          earnings: result.earn,
          message: `Сессия завершена: ${result.mins}мин, $${result.earn}`,
        });
        return;
      }

      // ─── RESTART ──────────────────────────────────────────
      case 'restart': {
        logger.info('⏱️ timer:restart', { taskTitle: data.taskTitle, clientId: data.clientId });

        const restartAllIds = await resolveEmployeeIds(userId);

        const result = await db.runTransaction(async (tx) => {
          // ═══ PHASE 1: ALL READS ═══
          const userRef = db.collection('users').doc(userId);
          const userDoc = await tx.get(userRef);
          const activeSessionId = userDoc.data()?.activeSessionId as string | undefined;

          let resolvedClientName = data.clientName || '';
          let clientDoc: admin.firestore.DocumentSnapshot | null = null;
          if (!resolvedClientName && data.clientId) {
            clientDoc = await tx.get(db.collection('clients').doc(data.clientId));
          }

          let pointerSessionDoc: admin.firestore.DocumentSnapshot | null = null;
          if (activeSessionId) {
            pointerSessionDoc = await tx.get(db.collection('work_sessions').doc(activeSessionId));
          }

          const crossPlatformDocs = await findActiveSessionsInTx(tx, restartAllIds);

          let hourlyRate = 0;
          let resolvedProjectId = data.projectId || null;
          if (data.taskId) {
            const taskDoc = await tx.get(db.collection('gtd_tasks').doc(data.taskId));
            const taskData = taskDoc.data();
            hourlyRate = taskData?.hourlyRate || 0;
            if (!resolvedProjectId && taskData?.projectId) {
              resolvedProjectId = taskData.projectId;
            }
          }
          if (!hourlyRate) {
            hourlyRate = userDoc.data()?.hourlyRate || 0;
          }

          // ═══ PHASE 2: ALL WRITES ═══
          const closedSessions: { id: string; mins: number; earn: number }[] = [];
          const closeEndTime = Timestamp.now();
          const closedIds = new Set<string>();

          // Close pointer session
          if (pointerSessionDoc && pointerSessionDoc.exists &&
              ['active', 'paused'].includes(pointerSessionDoc.data()!.status)) {
            const closed = closeSessionInTx(tx, pointerSessionDoc, closeEndTime);
            if (closed) {
              closedSessions.push({ id: closed.sessionId, mins: closed.durationMinutes, earn: closed.earnings });
              closedIds.add(closed.sessionId);
            }
          }

          // Close cross-platform sessions
          for (const doc of crossPlatformDocs) {
            if (!closedIds.has(doc.id)) {
              const closed = closeSessionInTx(tx, doc, closeEndTime);
              if (closed) {
                closedSessions.push({ id: closed.sessionId, mins: closed.durationMinutes, earn: closed.earnings });
                closedIds.add(closed.sessionId);
              }
            }
          }

          // Create new session
          if (!resolvedClientName && clientDoc && clientDoc.exists) {
            resolvedClientName = clientDoc.data()?.name || '';
          }
          const newRef = db.collection('work_sessions').doc();
          tx.set(newRef, {
            employeeId: userId,
            employeeName: userName,
            startTime: Timestamp.now(),
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

          return { sessionId: newRef.id, closedSessions, hourlyRate, resolvedProjectId };
        });

        const primaryClosed = result.closedSessions.length > 0 ? result.closedSessions[0] : null;

        logger.info('⏱️ timer:restarted', {
          sessionId: result.sessionId,
          closedCount: result.closedSessions.length,
        });

        const restartAuditContext = extractAuditContext(req);
        await logAudit(AuditHelpers.create(
          'work_session',
          result.sessionId,
          {
            action: 'restart',
            taskTitle: data.taskTitle,
            clientId: data.clientId,
            projectId: result.resolvedProjectId,
            hourlyRate: result.hourlyRate,
            closedCount: result.closedSessions.length,
          },
          restartAuditContext.performedBy,
          restartAuditContext.source as any
        ));

        for (const closedSession of result.closedSessions) {
          await logAudit({
            action: 'TIMER_AUTO_STOP',
            entityType: 'work_session',
            entityId: closedSession.id,
            source: restartAuditContext.source as any,
            performedBy: restartAuditContext.performedBy,
            metadata: {
              reason: 'Stopped by restart action',
              durationMinutes: closedSession.mins,
              earnings: closedSession.earn,
            },
          });
        }

        await logAgentActivity({
          userId,
          action: 'timer_restarted',
          endpoint: '/api/time-tracking',
          metadata: {
            sessionId: result.sessionId,
            taskTitle: data.taskTitle,
            closedSessions: result.closedSessions,
          },
        });

        const warnings: string[] = [];
        if (!result.hourlyRate) {
          warnings.push('⚠️ Ставка $0/ч. Обратитесь к руководителю.');
        }

        res.status(201).json({
          sessionId: result.sessionId,
          message: 'Таймер перезапущен',
          closedPrevious: primaryClosed
            ? `Предыдущая сессия закрыта: ${primaryClosed.mins}мин, $${primaryClosed.earn}`
            : null,
          closedCount: result.closedSessions.length,
          ...(warnings.length > 0 ? { warnings } : {}),
        });
        return;
      }

      // ─── STATUS ─────────────────────────────────────────
      case 'status': {
        const foundSession = await findActiveSession(userId);

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

router.get('/api/time-tracking/active-all', requireScope('time:read', 'admin'), async (req, res, next) => {
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

router.get('/api/time-tracking/summary', requireScope('time:read', 'admin'), async (req, res, next) => {
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

router.post('/api/time-tracking/admin-stop', requireScope('admin'), async (req, res, next) => {
  try {
    // Security: only admin role can admin-stop
    const isAdminUser = ['superadmin', 'company_admin', 'admin'].includes(req.agentRole || '');
    if (!isAdminUser && req.agentUserId !== process.env.OWNER_UID) {
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

      // READ employee doc BEFORE any writes (Firestore requirement)
      const employeeRef = db.collection('users').doc(s.employeeId);
      const employeeDoc = await tx.get(employeeRef);

      // Use unified closeSessionInTx
      const closed = closeSessionInTx(tx, sessionDoc, endTime);
      if (!closed) throw new Error('SESSION_NOT_ACTIVE');

      // Clear activeSessionId pointer on the employee
      if (employeeDoc.exists && employeeDoc.data()?.activeSessionId === data.sessionId) {
        tx.update(employeeRef, { activeSessionId: null });
      }

      return {
        mins: closed.durationMinutes,
        earn: closed.earnings,
        employeeId: closed.employeeId || s.employeeId,
        employeeName: closed.employeeName || s.employeeName,
        task: closed.task,
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

        const closed = closeSessionInTx(tx, freshSessionDoc, endTime, {
          autoStopReason: 'Auto-stopped: exceeded 12 hours',
        });

        if (!closed) return null;

        // Clear activeSessionId pointer if this session is the active one for the employee
        if (s.employeeId) {
          const userRef = db.collection('users').doc(s.employeeId);
          const userDoc = await tx.get(userRef);
          if (userDoc.exists && userDoc.data()?.activeSessionId === sessionId) {
            tx.update(userRef, { activeSessionId: null });
          }
        }

        return {
          sessionId,
          employeeId: closed.employeeId || '',
          employeeName: closed.employeeName || '',
          durationMinutes: closed.durationMinutes,
          earnings: closed.earnings,
          task: closed.task,
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

