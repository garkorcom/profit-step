/**
 * Agent API — Express Application
 *
 * 5 endpoints for OpenClaw agent integration:
 * - GET  /api/clients/search
 * - POST /api/gtd-tasks
 * - POST /api/costs
 * - POST /api/time-tracking
 * - GET  /api/projects/status
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
  amount: z.number().positive(),
  description: z.string().optional(),
  idempotencyKey: z.string().min(1).optional(),
});

const TimeTrackingSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('start'),
    taskId: z.string().optional(),
    taskTitle: z.string().min(1),
    clientId: z.string().optional(),
    clientName: z.string().optional(),
  }),
  z.object({ action: z.literal('stop') }),
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
        logger.info('⏱️ timer:start', { taskTitle: data.taskTitle, clientId: data.clientId });

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
              const endTime = Timestamp.now();
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
          const newRef = db.collection('work_sessions').doc();
          tx.set(newRef, {
            employeeId: userId,
            employeeName: userName,
            startTime: Timestamp.now(),
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
        logger.info('⏱️ timer:stop');

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
          const endTime = Timestamp.now();
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
        });

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

    const CHUNK_SIZE = 400;
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

// ─── Error Handler (must be last) ──────────────────────────────────

app.use(errorHandler);

// ─── Export as Firebase Function ────────────────────────────────────

export const agentApi = functions
  .runWith({ minInstances: 1, memory: '256MB', timeoutSeconds: 60 })
  .https.onRequest(app);
