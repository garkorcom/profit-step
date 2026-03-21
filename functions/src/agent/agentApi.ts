/**
 * Agent API — Express Application
 *
 * 20 endpoints for OpenClaw agent integration:
 * - GET    /api/clients/search
 * - POST   /api/gtd-tasks
 * - GET    /api/gtd-tasks/list
 * - PATCH  /api/gtd-tasks/:id
 * - DELETE /api/gtd-tasks/:id          ← Phase 2
 * - POST   /api/costs
 * - GET    /api/costs/list
 * - DELETE /api/costs/:id              ← Phase 2
 * - POST   /api/time-tracking          (start now supports startTime, stop supports endTime)
 * - GET    /api/time-tracking/active-all
 * - GET    /api/time-tracking/summary  ← Phase 2
 * - POST   /api/time-tracking/admin-stop ← Phase 2
 * - GET    /api/users/search           ← Phase 2
 * - GET    /api/projects/status
 * - GET    /api/finance/context
 * - POST   /api/finance/transactions/batch
 * - POST   /api/finance/transactions/approve
 * - POST   /api/finance/transactions/undo
 */

import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import * as express from 'express';
import { z } from 'zod';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Fuse = require('fuse.js');

import {
  authMiddleware,
  rateLimitMiddleware,
  requestLogger,
  errorHandler,
} from './agentMiddleware';

import {
  getCachedClients,
  fuzzySearchClient,
  logAgentActivity,
  COST_CATEGORY_LABELS,
} from './agentHelpers';

const logger = functions.logger;
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

// ─── Express App ────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(requestLogger);
app.use(authMiddleware);
app.use(rateLimitMiddleware);

// ─── Zod Schemas ────────────────────────────────────────────────────

const CreateGTDTaskSchema = z.object({
  title: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
  clientId: z.string().optional(),
  clientName: z.string().optional(),
  assigneeId: z.string().optional(),
  assigneeName: z.string().optional(),
  priority: z.enum(['high', 'medium', 'low', 'none']).default('none'),
  status: z.enum(['inbox', 'next_action', 'waiting', 'projects', 'estimate', 'someday']).default('inbox'),
  description: z.string().optional(),
  dueDate: z.string().optional(),
  estimatedDurationMinutes: z.number().optional(),
  taskType: z.string().optional(),
});

const CreateCostSchema = z.object({
  clientId: z.string().min(1),
  clientName: z.string().min(1),
  category: z.enum(['materials', 'tools', 'reimbursement', 'fuel', 'housing', 'food', 'permit', 'other']),
  amount: z.number().positive().max(1_000_000),
  description: z.string().optional(),
  idempotencyKey: z.string().min(1).optional(),
  taskId: z.string().optional(),
});

const TimeTrackingSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('start'),
    taskId: z.string().optional(),
    taskTitle: z.string().min(1),
    clientId: z.string().optional(),
    clientName: z.string().optional(),
    startTime: z.string().optional(), // ISO string — manual override ("забыл отметиться утром в 7")
  }),
  z.object({
    action: z.literal('stop'),
    endTime: z.string().optional(), // ISO string — manual override ("забыл закрыть вчера в 5")
  }),
  z.object({ action: z.literal('status') }),
]);

const ProjectStatusQuery = z.object({
  clientId: z.string().optional(),
  clientName: z.string().min(2).optional(),
}).refine((d) => d.clientId || d.clientName, {
  message: 'Требуется clientId или clientName',
});

const FinanceBatchSchema = z.object({
  transactions: z.array(z.object({
    id: z.string().min(1),
    date: z.string(), // ISO string
    rawDescription: z.string(),
    cleanMerchant: z.string(),
    amount: z.number(),
    paymentType: z.enum(['company', 'cash']),
    categoryId: z.string(),
    projectId: z.string().nullable().optional(),
    confidence: z.enum(['high', 'low']),
  }))
});

const FinanceApproveSchema = z.object({
  transactions: z.array(z.object({
    id: z.string().min(1),
    date: z.string(), 
    rawDescription: z.string(),
    cleanMerchant: z.string(),
    amount: z.number(),
    paymentType: z.enum(['company', 'cash']),
    categoryId: z.string(),
    projectId: z.string().nullable().optional(),
    confidence: z.enum(['high', 'low']),
    taxAmount: z.number().optional().default(0),
  }))
});

const FinanceUndoSchema = z.object({
  transactionIds: z.array(z.string().min(1)),
});

// ─── NEW Zod Schemas ───────────────────────────────────────────────

const ListTasksQuerySchema = z.object({
  clientId: z.string().optional(),
  clientName: z.string().min(2).optional(),
  status: z.string().optional(), // comma-separated: "inbox,next_action"
  assigneeId: z.string().optional(),
  priority: z.enum(['high', 'medium', 'low', 'none']).optional(),
  dueBefore: z.string().optional(),
  dueAfter: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  sortBy: z.enum(['createdAt', 'dueDate', 'priority', 'updatedAt']).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

const UpdateTaskSchema = z.object({
  status: z.enum([
    'inbox', 'next_action', 'waiting', 'projects', 'estimate', 'someday', 'completed', 'archived',
  ]).optional(),
  priority: z.enum(['high', 'medium', 'low', 'none']).optional(),
  dueDate: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  assigneeName: z.string().nullable().optional(),
  description: z.string().optional(),
  title: z.string().min(1).optional(),
  estimatedDurationMinutes: z.number().positive().optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});

const ListCostsQuerySchema = z.object({
  clientId: z.string().optional(),
  clientName: z.string().min(2).optional(),
  category: z.string().optional(), // comma-separated
  from: z.string().optional(), // ISO date
  to: z.string().optional(), // ISO date
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  sortBy: z.enum(['createdAt', 'amount', 'category']).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

const ActiveSessionsQuerySchema = z.object({
  clientId: z.string().optional(),
});

// ─── Phase 2 Schemas ───────────────────────────────────────────────

const TimeSummaryQuerySchema = z.object({
  from: z.string().min(1), // ISO date, required
  to: z.string().min(1),   // ISO date, required
  employeeId: z.string().optional(), // filter to specific employee
});

const AdminStopSchema = z.object({
  sessionId: z.string().min(1),
  endTime: z.string().optional(), // ISO string — optional manual end time
});

const UserSearchQuerySchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

// ─── GET /api/clients/search ────────────────────────────────────────

app.get('/api/clients/search', async (req, res, next) => {
  try {
    const query = req.query.q as string;
    if (!query || query.length < 2) {
      res.status(400).json({ error: 'Query must be at least 2 characters' });
      return;
    }

    logger.info('🔍 clients:search', { query });
    const clients = await getCachedClients();
    const fuse = new Fuse(clients, { keys: ['name', 'address'], threshold: 0.4 });
    const results = fuse.search(query, { limit: 5 }).map((r: any) => ({
      clientId: r.item.id,
      clientName: r.item.name,
      address: r.item.address,
      score: r.score,
    }));

    logger.info('🔍 clients:search results', { query, count: results.length });
    res.json({ results, count: results.length });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/gtd-tasks ───────────────────────────────────────────

app.post('/api/gtd-tasks', async (req, res, next) => {
  try {
    const data = CreateGTDTaskSchema.parse(req.body);
    logger.info('📋 tasks:create', { title: data.title, key: data.idempotencyKey });

    // Dedup check via _idempotency collection
    if (data.idempotencyKey) {
      const keyDoc = await db.doc(`_idempotency/${data.idempotencyKey}`).get();
      if (keyDoc.exists) {
        const existing = keyDoc.data()!;
        logger.info('📋 tasks:deduplicated', { taskId: existing.entityId });
        res.status(200).json({ taskId: existing.entityId, deduplicated: true });
        return;
      }
    }

    const docRef = await db.collection('gtd_tasks').add({
      ownerId: req.agentUserId,
      ownerName: req.agentUserName,
      title: data.title,
      status: data.status,
      priority: data.priority,
      context: '@office',
      clientId: data.clientId || null,
      clientName: data.clientName || null,
      assigneeId: data.assigneeId || null,
      assigneeName: data.assigneeName || null,
      description: data.description || '',
      dueDate: data.dueDate ? Timestamp.fromDate(new Date(data.dueDate)) : null,
      taskType: data.taskType || null,
      estimatedDurationMinutes: data.estimatedDurationMinutes || null,
      source: 'openclaw',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Store idempotency key with 24h TTL
    if (data.idempotencyKey) {
      await db.doc(`_idempotency/${data.idempotencyKey}`).set({
        entityId: docRef.id,
        collection: 'gtd_tasks',
        expiresAt: Date.now() + 24 * 3600_000,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    logger.info('📋 tasks:created', { taskId: docRef.id });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'task_created',
      endpoint: '/api/gtd-tasks',
      metadata: { taskId: docRef.id, title: data.title, clientId: data.clientId },
    });

    res.status(201).json({ taskId: docRef.id });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/costs ────────────────────────────────────────────────

app.post('/api/costs', async (req, res, next) => {
  try {
    const data = CreateCostSchema.parse(req.body);
    logger.info('💰 costs:create', { clientId: data.clientId, category: data.category, amount: data.amount });

    // Dedup
    if (data.idempotencyKey) {
      const keyDoc = await db.doc(`_idempotency/${data.idempotencyKey}`).get();
      if (keyDoc.exists) {
        const existing = keyDoc.data()!;
        logger.info('💰 costs:deduplicated', { costId: existing.entityId });
        res.status(200).json({ costId: existing.entityId, deduplicated: true });
        return;
      }
    }

    const effectiveAmount = data.category === 'reimbursement'
      ? -Math.abs(data.amount) : data.amount;

    const docRef = await db.collection('costs').add({
      userId: req.agentUserId,
      userName: req.agentUserName,
      clientId: data.clientId,
      clientName: data.clientName,
      category: data.category,
      categoryLabel: COST_CATEGORY_LABELS[data.category] || data.category,
      amount: effectiveAmount,
      originalAmount: Math.abs(data.amount),
      description: data.description || null,
      receiptPhotoUrl: null,
      voiceNoteUrl: null,
      status: 'confirmed',
      source: 'openclaw',
      taskId: data.taskId || null,
      createdAt: FieldValue.serverTimestamp(),
    });

    if (data.idempotencyKey) {
      await db.doc(`_idempotency/${data.idempotencyKey}`).set({
        entityId: docRef.id,
        collection: 'costs',
        expiresAt: Date.now() + 24 * 3600_000,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    logger.info('💰 costs:created', { costId: docRef.id });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'cost_created',
      endpoint: '/api/costs',
      metadata: { costId: docRef.id, category: data.category, amount: effectiveAmount },
    });

    res.status(201).json({ costId: docRef.id });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/time-tracking ────────────────────────────────────────

app.post('/api/time-tracking', async (req, res, next) => {
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

        const result = await db.runTransaction(async (tx) => {
          // 1. Get user doc → activeSessionId pointer
          const userRef = db.collection('users').doc(userId);
          const userDoc = await tx.get(userRef);
          const activeSessionId = userDoc.data()?.activeSessionId as string | undefined;

          let closedSession: { id: string; mins: number; earn: number } | null = null;

          // 2. Close existing session if pointer is set
          if (activeSessionId) {
            const oldRef = db.collection('work_sessions').doc(activeSessionId);
            const oldDoc = await tx.get(oldRef);

            if (oldDoc.exists && ['active', 'paused'].includes(oldDoc.data()!.status)) {
              const old = oldDoc.data()!;
              const endTime = manualStartTime || Timestamp.now();
              let diff = endTime.toMillis() - old.startTime.toMillis();
              if (old.totalBreakMinutes) diff -= old.totalBreakMinutes * 60000;
              if (old.status === 'paused' && old.lastBreakStart) {
                diff -= (endTime.toMillis() - old.lastBreakStart.toMillis());
              }
              const mins = Math.max(0, Math.round(diff / 60000));
              const earn = +((mins / 60) * (old.hourlyRate || 0)).toFixed(2);

              tx.update(oldRef, {
                status: 'completed',
                endTime,
                durationMinutes: mins,
                sessionEarnings: earn,
              });

              // Aggregate on linked task
              if (old.relatedTaskId) {
                tx.update(db.collection('gtd_tasks').doc(old.relatedTaskId), {
                  totalTimeSpentMinutes: FieldValue.increment(mins),
                  totalEarnings: FieldValue.increment(earn),
                  updatedAt: FieldValue.serverTimestamp(),
                });
              }

              closedSession = { id: oldDoc.id, mins, earn };
              logger.info('⏱️ timer:start — closed previous', closedSession);
            } else {
              // Auto-heal: stale pointer
              logger.warn('⏱️ auto-heal: stale activeSessionId', { activeSessionId });
            }
          }

          // 3. hourlyRate cascade: task → user → 0
          let hourlyRate = 0;
          if (data.taskId) {
            const taskDoc = await tx.get(db.collection('gtd_tasks').doc(data.taskId));
            hourlyRate = taskDoc.data()?.hourlyRate || 0;
          }
          if (!hourlyRate) {
            hourlyRate = userDoc.data()?.hourlyRate || 0;
          }

          // 4. Create new session + update pointer
          const effectiveStartTime = manualStartTime || Timestamp.now();
          const newRef = db.collection('work_sessions').doc();
          tx.set(newRef, {
            employeeId: userId,
            employeeName: userName,
            startTime: effectiveStartTime,
            status: 'active',
            description: data.taskTitle,
            clientId: data.clientId || '',
            clientName: data.clientName || '',
            type: 'regular',
            relatedTaskId: data.taskId || null,
            relatedTaskTitle: data.taskTitle,
            hourlyRate,
            source: 'openclaw',
          });
          tx.update(userRef, { activeSessionId: newRef.id });

          return { sessionId: newRef.id, closedSession, hourlyRate };
        });

        logger.info('⏱️ timer:started', {
          sessionId: result.sessionId,
          hourlyRate: result.hourlyRate,
          closedPrevious: !!result.closedSession,
        });
        await logAgentActivity({
          userId,
          action: 'timer_started',
          endpoint: '/api/time-tracking',
          metadata: {
            sessionId: result.sessionId,
            taskTitle: data.taskTitle,
            closedSession: result.closedSession,
          },
        });

        res.status(201).json({
          sessionId: result.sessionId,
          message: 'Таймер запущен',
          closedPrevious: result.closedSession
            ? `Предыдущая сессия закрыта: ${result.closedSession.mins}мин, $${result.closedSession.earn}`
            : null,
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

        const result = await db.runTransaction(async (tx) => {
          const userRef = db.collection('users').doc(userId);
          const userDoc = await tx.get(userRef);
          const sid = userDoc.data()?.activeSessionId as string | undefined;

          if (!sid) return null;

          const sessionRef = db.collection('work_sessions').doc(sid);
          const sessionDoc = await tx.get(sessionRef);

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

          return { mins, earn, task: s.relatedTaskTitle || s.description };
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
        const userDoc = await db.collection('users').doc(userId).get();
        const sid = userDoc.data()?.activeSessionId as string | undefined;

        if (!sid) {
          res.json({ active: false, message: 'Нет активной сессии' });
          return;
        }

        const session = await db.collection('work_sessions').doc(sid).get();
        if (!session.exists) {
          res.json({ active: false, message: 'Нет активной сессии' });
          return;
        }

        const s = session.data()!;
        res.json({
          active: true,
          sessionId: sid,
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

// ─── GET /api/projects/status ───────────────────────────────────────

app.get('/api/projects/status', async (req, res, next) => {
  try {
    const q = ProjectStatusQuery.parse(req.query);
    let clientId = q.clientId;

    // Resolve clientName → clientId via fuzzy search
    if (!clientId && q.clientName) {
      const match = await fuzzySearchClient(q.clientName);
      if (!match) {
        res.status(404).json({ error: 'Клиент не найден' });
        return;
      }
      clientId = match.id;
    }

    logger.info('📊 projects:status', { clientId });

    // Parallel queries: count() for totals + limited reads for aggregation
    const [taskCount, costCount, recentTasks, recentCosts, sessions] = await Promise.all([
      db.collection('gtd_tasks').where('clientId', '==', clientId).count().get(),
      db.collection('costs').where('clientId', '==', clientId).count().get(),
      db.collection('gtd_tasks').where('clientId', '==', clientId)
        .orderBy('createdAt', 'desc').limit(50).get(),
      db.collection('costs').where('clientId', '==', clientId)
        .orderBy('createdAt', 'desc').limit(200).get(),
      db.collection('work_sessions').where('clientId', '==', clientId)
        .where('status', '==', 'completed')
        .orderBy('startTime', 'desc').limit(200).get(),
    ]);

    // Task breakdown by status
    const byStatus: Record<string, number> = {};
    recentTasks.docs.forEach((d) => {
      const status = d.data().status as string;
      byStatus[status] = (byStatus[status] || 0) + 1;
    });

    // Financial aggregation
    const totalCosts = recentCosts.docs.reduce((sum, d) => sum + (d.data().amount || 0), 0);
    const totalMins = sessions.docs.reduce((sum, d) => sum + (d.data().durationMinutes || 0), 0);
    const totalEarn = sessions.docs.reduce((sum, d) => sum + (d.data().sessionEarnings || 0), 0);

    logger.info('📊 projects:status result', {
      clientId,
      tasks: taskCount.data().count,
      costs: costCount.data().count,
      sessions: sessions.size,
    });

    res.json({
      clientId,
      tasks: { total: taskCount.data().count, recentByStatus: byStatus },
      costs: { total: +totalCosts.toFixed(2), count: costCount.data().count },
      time: { totalHours: +(totalMins / 60).toFixed(1), totalEarnings: +totalEarn.toFixed(2) },
    });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/time-tracking/active-all ──────────────────────────────

app.get('/api/time-tracking/active-all', async (req, res, next) => {
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

// ─── GET /api/gtd-tasks/list ───────────────────────────────────────

app.get('/api/gtd-tasks/list', async (req, res, next) => {
  try {
    const params = ListTasksQuerySchema.parse(req.query);
    let clientId = params.clientId;

    // Resolve clientName → clientId via fuzzy search
    if (!clientId && params.clientName) {
      const match = await fuzzySearchClient(params.clientName);
      if (!match) {
        res.status(404).json({ error: 'Клиент не найден' });
        return;
      }
      clientId = match.id;
    }

    logger.info('📋 tasks:list', { clientId, status: params.status, limit: params.limit });

    let q: admin.firestore.Query = db.collection('gtd_tasks');

    if (clientId) {
      q = q.where('clientId', '==', clientId);
    }
    if (params.assigneeId) {
      q = q.where('assigneeId', '==', params.assigneeId);
    }
    if (params.priority) {
      q = q.where('priority', '==', params.priority);
    }

    // Status filter: comma-separated → 'in' query
    if (params.status) {
      const statuses = params.status.split(',').map((s) => s.trim()).filter(Boolean);
      if (statuses.length === 1) {
        q = q.where('status', '==', statuses[0]);
      } else if (statuses.length > 1 && statuses.length <= 10) {
        q = q.where('status', 'in', statuses);
      }
    }

    // Date filters
    if (params.dueBefore) {
      q = q.where('dueDate', '<=', Timestamp.fromDate(new Date(params.dueBefore)));
    }
    if (params.dueAfter) {
      q = q.where('dueDate', '>=', Timestamp.fromDate(new Date(params.dueAfter)));
    }

    // Sort — only apply if not conflicting with inequality filters
    // Firestore requires orderBy on inequality field first
    const hasDateFilter = !!(params.dueBefore || params.dueAfter);
    if (hasDateFilter) {
      q = q.orderBy('dueDate', params.sortDir);
    } else {
      q = q.orderBy(params.sortBy, params.sortDir);
    }

    // Count total before pagination
    const countSnap = await q.count().get();
    const total = countSnap.data().count;

    // Apply pagination
    if (params.offset > 0) {
      q = q.offset(params.offset);
    }
    q = q.limit(params.limit);

    const snap = await q.get();
    const tasks = snap.docs.map((d) => {
      const t = d.data();
      return {
        id: d.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        clientId: t.clientId,
        clientName: t.clientName,
        assigneeId: t.assigneeId || null,
        assigneeName: t.assigneeName || null,
        description: t.description || '',
        dueDate: t.dueDate?.toDate?.()?.toISOString() || null,
        taskType: t.taskType || null,
        estimatedDurationMinutes: t.estimatedDurationMinutes || null,
        totalTimeSpentMinutes: t.totalTimeSpentMinutes || 0,
        totalEarnings: t.totalEarnings || 0,
        source: t.source || null,
        createdAt: t.createdAt?.toDate?.()?.toISOString() || null,
        updatedAt: t.updatedAt?.toDate?.()?.toISOString() || null,
      };
    });

    res.json({ tasks, total, hasMore: params.offset + tasks.length < total });
  } catch (e) {
    next(e);
  }
});

// ─── PATCH /api/gtd-tasks/:id ──────────────────────────────────────

app.patch('/api/gtd-tasks/:id', async (req, res, next) => {
  try {
    const taskId = req.params.id;
    const data = UpdateTaskSchema.parse(req.body);

    logger.info('📋 tasks:update', { taskId, fields: Object.keys(data) });

    const taskRef = db.collection('gtd_tasks').doc(taskId);
    const taskDoc = await taskRef.get();

    if (!taskDoc.exists) {
      res.status(404).json({ error: 'Задача не найдена' });
      return;
    }

    const updatePayload: Record<string, any> = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (data.status !== undefined) updatePayload.status = data.status;
    if (data.priority !== undefined) updatePayload.priority = data.priority;
    if (data.title !== undefined) updatePayload.title = data.title;
    if (data.description !== undefined) updatePayload.description = data.description;
    if (data.assigneeId !== undefined) updatePayload.assigneeId = data.assigneeId;
    if (data.assigneeName !== undefined) updatePayload.assigneeName = data.assigneeName;
    if (data.estimatedDurationMinutes !== undefined) {
      updatePayload.estimatedDurationMinutes = data.estimatedDurationMinutes;
    }

    // dueDate: string → Timestamp, null → null (clear)
    if (data.dueDate !== undefined) {
      updatePayload.dueDate = data.dueDate
        ? Timestamp.fromDate(new Date(data.dueDate))
        : null;
    }

    await taskRef.update(updatePayload);

    logger.info('📋 tasks:updated', { taskId });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'task_updated',
      endpoint: `/api/gtd-tasks/${taskId}`,
      metadata: { taskId, fields: Object.keys(data) },
    });

    res.json({ taskId, updated: true });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/costs/list ───────────────────────────────────────────

app.get('/api/costs/list', async (req, res, next) => {
  try {
    const params = ListCostsQuerySchema.parse(req.query);
    let clientId = params.clientId;

    // Resolve clientName → clientId via fuzzy search
    if (!clientId && params.clientName) {
      const match = await fuzzySearchClient(params.clientName);
      if (!match) {
        res.status(404).json({ error: 'Клиент не найден' });
        return;
      }
      clientId = match.id;
    }

    logger.info('💰 costs:list', { clientId, category: params.category, limit: params.limit });

    let q: admin.firestore.Query = db.collection('costs');

    if (clientId) {
      q = q.where('clientId', '==', clientId);
    }

    // Category filter: comma-separated
    if (params.category) {
      const categories = params.category.split(',').map((c) => c.trim()).filter(Boolean);
      if (categories.length === 1) {
        q = q.where('category', '==', categories[0]);
      } else if (categories.length > 1 && categories.length <= 10) {
        q = q.where('category', 'in', categories);
      }
    }

    // Date range filters
    const hasDateFilter = !!(params.from || params.to);
    if (params.from) {
      q = q.where('createdAt', '>=', Timestamp.fromDate(new Date(params.from)));
    }
    if (params.to) {
      // Add 1 day to 'to' to include the entire day
      const toDate = new Date(params.to);
      toDate.setDate(toDate.getDate() + 1);
      q = q.where('createdAt', '<', Timestamp.fromDate(toDate));
    }

    // Sort
    if (hasDateFilter) {
      q = q.orderBy('createdAt', params.sortDir);
    } else {
      q = q.orderBy(params.sortBy, params.sortDir);
    }

    // Count total before pagination
    const countSnap = await q.count().get();
    const total = countSnap.data().count;

    // Apply pagination
    if (params.offset > 0) {
      q = q.offset(params.offset);
    }
    q = q.limit(params.limit);

    const snap = await q.get();
    const costs = snap.docs.map((d) => {
      const c = d.data();
      return {
        id: d.id,
        clientId: c.clientId,
        clientName: c.clientName,
        category: c.category,
        categoryLabel: c.categoryLabel,
        amount: c.amount,
        originalAmount: c.originalAmount,
        description: c.description || null,
        taskId: c.taskId || null,
        status: c.status,
        source: c.source || null,
        createdAt: c.createdAt?.toDate?.()?.toISOString() || null,
      };
    });

    // Aggregate sum by category
    const byCategory: Record<string, number> = {};
    let totalAmount = 0;
    costs.forEach((c) => {
      totalAmount += c.amount;
      byCategory[c.category] = (byCategory[c.category] || 0) + c.amount;
    });

    res.json({
      costs,
      total,
      hasMore: params.offset + costs.length < total,
      sum: { total: +totalAmount.toFixed(2), byCategory },
    });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/finance/context ───────────────────────────────────────

app.get('/api/finance/context', async (req, res, next) => {
  try {
    logger.info('🏦 finance:context');
    // Active projects (using projects collection, mapped to clientId)
    const projectsSnap = await db.collection('projects').where('status', '==', 'active').get();
    const projects = projectsSnap.docs.map(d => ({ 
       id: d.id, 
       projectId: d.data().clientId || d.id, 
       name: d.data().name || 'Unknown', 
       clientName: d.data().clientName || '' 
    }));
    
    const categories = Object.keys(COST_CATEGORY_LABELS);

    const rulesSnap = await db.collection('finance_rules').get();
    const rules = rulesSnap.docs.map(d => ({ merchantName: d.id, ...d.data() }));

    res.json({ projects, categories, rules });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/finance/transactions/batch ───────────────────────────

app.post('/api/finance/transactions/batch', async (req, res, next) => {
  try {
    const data = FinanceBatchSchema.parse(req.body);
    logger.info(`🏦 finance:batch. Count: ${data.transactions.length}`);

    const CHUNK_SIZE = 400;
    let savedCount = 0;

    for (let i = 0; i < data.transactions.length; i += CHUNK_SIZE) {
      const chunk = data.transactions.slice(i, i + CHUNK_SIZE);
      
      const refs = chunk.map(t => db.collection('bank_transactions').doc(t.id));
      const snaps = await db.getAll(...refs);
      
      const approvedIds = new Set<string>();
      snaps.forEach(snap => {
        if (snap.exists && snap.data()?.status === 'approved') {
          approvedIds.add(snap.id);
        }
      });

      const batch = db.batch();
      for (const t of chunk) {
        if (approvedIds.has(t.id)) {
          logger.info(`🏦 finance:batch. Skipping ${t.id} - already approved`);
          continue;
        }
        const docRef = db.collection('bank_transactions').doc(t.id);
        batch.set(docRef, {
          ...t,
          status: 'draft',
          createdAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        savedCount++;
      }
      await batch.commit();
    }

    res.status(200).json({ success: true, count: savedCount, totalReceived: data.transactions.length });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/finance/transactions/approve ─────────────────────────

app.post('/api/finance/transactions/approve', async (req, res, next) => {
  try {
    const data = FinanceApproveSchema.parse(req.body);
    logger.info(`🏦 finance:approve. Count: ${data.transactions.length}`);

    // Each transaction can generate up to 3 batch ops (cost + rule + bank_tx update).
    // Firestore batch limit = 500 ops. 150 × 3 = 450 — safe margin.
    const CHUNK_SIZE = 150;
    for (let i = 0; i < data.transactions.length; i += CHUNK_SIZE) {
      const chunk = data.transactions.slice(i, i + CHUNK_SIZE);
      const batch = db.batch();

      for (const t of chunk) {
        let generatedCostId: string | null = null;
        
        // Действие А: Копирует данные и создает документы в costs 
        if (t.paymentType === 'company' && t.projectId) {
           const costRef = db.collection('costs').doc();
           generatedCostId = costRef.id;
           
           const isRefund = t.amount > 0;
           const effectiveAmount = isRefund ? -Math.abs(t.amount) : Math.abs(t.amount);
           
           batch.set(costRef, {
             userId: req.agentUserId || 'system',
             userName: req.agentUserName || 'system',
             clientId: t.projectId,
             clientName: 'Reconciled via Bank', 
             category: t.categoryId,
             categoryLabel: COST_CATEGORY_LABELS[t.categoryId as keyof typeof COST_CATEGORY_LABELS] || t.categoryId,
             amount: effectiveAmount,
             originalAmount: Math.abs(t.amount),
             taxAmount: t.taxAmount || 0,
             description: `[Bank] ${t.cleanMerchant}${t.rawDescription ? ' - ' + t.rawDescription : ''}`,
             receiptPhotoUrl: null,
             voiceNoteUrl: null,
             status: 'confirmed',
             source: 'bank_statement',
             date: Timestamp.fromDate(new Date(t.date)),
             createdAt: FieldValue.serverTimestamp(),
           });
        }

        // Действие Б: Самообучение (Upsert в finance_rules)
        const safeMerchant = t.cleanMerchant.trim().toLowerCase();
        if (safeMerchant) {
          const ruleRef = db.collection('finance_rules').doc(safeMerchant);
          batch.set(ruleRef, {
            merchantName: safeMerchant,
            defaultPaymentType: t.paymentType,
            defaultCategoryId: t.categoryId,
            defaultProjectId: t.projectId || null,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        }

        // Действие В: Обновление статуса в bank_transactions
        const draftRef = db.collection('bank_transactions').doc(t.id);
        batch.update(draftRef, {
           status: 'approved',
           paymentType: t.paymentType,
           categoryId: t.categoryId,
           projectId: t.projectId || null,
           costId: generatedCostId,
           updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }

    res.status(200).json({ success: true });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/finance/transactions/undo ─────────────────────────

app.post('/api/finance/transactions/undo', async (req, res, next) => {
  try {
    const data = FinanceUndoSchema.parse(req.body);
    logger.info(`🏦 finance:undo. Count: ${data.transactionIds.length}`);

    const batch = db.batch();
    const refs = data.transactionIds.map(id => db.collection('bank_transactions').doc(id));
    const snaps = await db.getAll(...refs);

    for (const snap of snaps) {
      if (!snap.exists) continue;
      const txData = snap.data()!;
      if (txData.status !== 'approved') continue;

      if (txData.costId) {
        batch.delete(db.collection('costs').doc(txData.costId));
      }

      batch.update(snap.ref, {
        status: 'draft',
        costId: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();
    res.status(200).json({ success: true, count: snaps.filter(s => s.exists).length });
  } catch (e) {
    next(e);
  }
});

// ─── DELETE /api/costs/:id (Phase 2) ────────────────────────────────

app.delete('/api/costs/:id', async (req, res, next) => {
  try {
    const costId = req.params.id;
    logger.info('💰 costs:void', { costId });

    const costRef = db.collection('costs').doc(costId);
    const costDoc = await costRef.get();

    if (!costDoc.exists) {
      res.status(404).json({ error: 'Расход не найден' });
      return;
    }

    const costData = costDoc.data()!;
    if (costData.status === 'voided') {
      res.status(400).json({ error: 'Расход уже удалён (voided)' });
      return;
    }

    await costRef.update({
      status: 'voided',
      voidedAt: FieldValue.serverTimestamp(),
      voidedBy: req.agentUserId,
    });

    logger.info('💰 costs:voided', { costId });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'cost_voided',
      endpoint: `/api/costs/${costId}`,
      metadata: { costId, previousAmount: costData.amount, category: costData.category },
    });

    res.json({ costId, voided: true, message: 'Расход удалён (voided)' });
  } catch (e) {
    next(e);
  }
});

// ─── DELETE /api/gtd-tasks/:id (Phase 2) ───────────────────────────

app.delete('/api/gtd-tasks/:id', async (req, res, next) => {
  try {
    const taskId = req.params.id;
    logger.info('📋 tasks:archive-delete', { taskId });

    const taskRef = db.collection('gtd_tasks').doc(taskId);
    const taskDoc = await taskRef.get();

    if (!taskDoc.exists) {
      res.status(404).json({ error: 'Задача не найдена' });
      return;
    }

    const taskData = taskDoc.data()!;
    if (taskData.status === 'archived') {
      res.status(400).json({ error: 'Задача уже удалена (archived)' });
      return;
    }

    await taskRef.update({
      status: 'archived',
      updatedAt: FieldValue.serverTimestamp(),
    });

    logger.info('📋 tasks:archived', { taskId });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'task_archived',
      endpoint: `/api/gtd-tasks/${taskId}`,
      metadata: { taskId, previousStatus: taskData.status, title: taskData.title },
    });

    res.json({ taskId, archived: true, message: 'Задача удалена (archived)' });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/time-tracking/summary (Phase 2) ──────────────────────

app.get('/api/time-tracking/summary', async (req, res, next) => {
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

app.post('/api/time-tracking/admin-stop', async (req, res, next) => {
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

      tx.update(sessionRef, {
        status: 'completed',
        endTime,
        durationMinutes: mins,
        sessionEarnings: earn,
      });

      // Clear activeSessionId pointer on the employee
      const employeeRef = db.collection('users').doc(s.employeeId);
      const employeeDoc = await tx.get(employeeRef);
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

// ─── GET /api/users/search (Phase 2) ───────────────────────────────

app.get('/api/users/search', async (req, res, next) => {
  try {
    const params = UserSearchQuerySchema.parse(req.query);
    logger.info('👤 users:search', { q: params.q });

    const snap = await db.collection('users').get();
    const users = snap.docs.map((d) => ({
      id: d.id,
      displayName: d.data().displayName || '',
      email: d.data().email || '',
      role: d.data().role || 'employee',
      hourlyRate: d.data().hourlyRate || 0,
    }));

    const fuse = new Fuse(users, {
      keys: ['displayName', 'email'],
      threshold: 0.4,
    });

    const results = fuse.search(params.q, { limit: params.limit }).map((r: any) => ({
      userId: r.item.id,
      displayName: r.item.displayName,
      email: r.item.email,
      role: r.item.role,
      hourlyRate: r.item.hourlyRate,
      score: r.score,
    }));

    res.json({ results, count: results.length });
  } catch (e) {
    next(e);
  }
});

// ─── Error Handler (must be last) ──────────────────────────────────

app.use(errorHandler);

// ─── Export as Firebase Function ────────────────────────────────────

export const agentApi = functions
  .runWith({ minInstances: 1, memory: '256MB', timeoutSeconds: 60 })
  .https.onRequest(app);
