/**
 * Agent API — Express Application
 *
 * 29 endpoints for OpenClaw agent integration:
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
 * - POST   /api/estimates              ← Estimator
 * - GET    /api/estimates/list         ← Estimator
 * - PATCH  /api/estimates/:id          ← Estimator
 * - POST   /api/estimates/:id/convert-to-tasks ← Estimator
 * - POST   /api/projects              ← Estimator
 * - GET    /api/projects/list          ← Estimator
 * - POST   /api/projects/:id/files    ← File Upload (base64)
 * - GET    /api/projects/:id/files    ← List project files
 * - GET    /api/finance/context
 * - POST   /api/finance/transactions/batch
 * - POST   /api/finance/transactions/approve
 * - POST   /api/finance/transactions/undo
 * - POST   /api/blueprint/split           ← Estimator V3 Phase 2
 * - POST   /api/blackboard                ← Estimator V3 Phase 3
 * - GET    /api/blackboard/:projectId     ← Estimator V3 Phase 3
 */

import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import * as express from 'express';
import * as cors from 'cors';
import { z } from 'zod';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Fuse = require('fuse.js');

import { PDFDocument } from 'pdf-lib';

import {
  authMiddleware,
  rateLimitMiddleware,
  requestLogger,
  errorHandler,
} from './agentMiddleware';

import {
  getCachedClients,
  fuzzySearchClient,
  searchClientByAddress,
  autoCreateClientByAddress,
  logAgentActivity,
  resolveOwnerCompanyId,
  COST_CATEGORY_LABELS,
} from './agentHelpers';

const logger = functions.logger;
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

// ─── Express App ────────────────────────────────────────────────────

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '60mb' }));
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
  // Budget Tracking fields
  parentTaskId: z.string().optional(),
  isSubtask: z.boolean().optional(),
  budgetAmount: z.number().optional(),
  paidAmount: z.number().optional(),
  budgetCategory: z.string().optional(),
  progressPercentage: z.number().min(0).max(100).optional(),
  // Payment tracking
  payments: z.array(z.object({
    id: z.string(),
    amount: z.number().positive(),
    date: z.any(), // Firestore Timestamp or serialized
    note: z.string().optional(),
    method: z.enum(['check', 'wire', 'cash', 'card']).optional(),
    createdBy: z.string(),
    createdAt: z.any(), // Firestore Timestamp or serialized
  })).optional(),
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

// ─── Contacts Schemas ──────────────────────────────────────────────

const ContactPhoneSchema = z.object({
  number: z.string().min(1),
  label: z.string().default('Мобильный'),
});

const CreateContactSchema = z.object({
  name: z.string().min(1),
  phones: z.array(ContactPhoneSchema).default([]),
  roles: z.array(z.string()).default([]),
  linkedProjects: z.array(z.string()).default([]),
  notes: z.string().optional(),
  location: z.string().optional(),
  emails: z.array(z.string().email()).default([]),
  messengers: z.object({
    whatsapp: z.string().optional(),
    telegram: z.string().optional(),
  }).default({}),
  defaultCity: z.string().optional(),
});

const SearchContactsQuerySchema = z.object({
  q: z.string().min(1),
  role: z.string().optional(),
  projectId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
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
          // 1. Get user doc → activeSessionId pointer
          const userRef = db.collection('users').doc(userId);
          const userDoc = await tx.get(userRef);
          const activeSessionId = userDoc.data()?.activeSessionId as string | undefined;

          const closedSessions: { id: string; mins: number; earn: number }[] = [];

          // Helper: close an active/paused session
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

          // 2a. Close session via activeSessionId pointer (fast path)
          const closedPointerSessionId = new Set<string>();
          if (activeSessionId) {
            const oldRef = db.collection('work_sessions').doc(activeSessionId);
            const oldDoc = await tx.get(oldRef);

            if (oldDoc.exists && ['active', 'paused'].includes(oldDoc.data()!.status)) {
              closeSession(oldRef, oldDoc);
              closedPointerSessionId.add(activeSessionId);
            } else {
              logger.warn('⏱️ auto-heal: stale activeSessionId', { activeSessionId });
            }
          }

          // 2b. Cross-platform scan: find ANY active sessions for ALL employee IDs
          // This catches Telegram Bot sessions that use numeric telegramId as employeeId
          for (const empId of allEmployeeIds) {
            const activeSnap = await tx.get(
              db.collection('work_sessions')
                .where('employeeId', '==', empId)
                .where('status', 'in', ['active', 'paused'])
                .limit(5)
            );
            for (const doc of activeSnap.docs) {
              if (!closedPointerSessionId.has(doc.id) && !closedSessions.some(cs => cs.id === doc.id)) {
                closeSession(doc.ref, doc);
              }
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

          return { sessionId: newRef.id, closedSessions, hourlyRate };
        });

        // Build response for closed sessions
        const primaryClosed = result.closedSessions.length > 0 ? result.closedSessions[0] : null;

        logger.info('⏱️ timer:started', {
          sessionId: result.sessionId,
          hourlyRate: result.hourlyRate,
          closedCount: result.closedSessions.length,
        });
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
        // Budget Tracking fields
        parentTaskId: t.parentTaskId || null,
        isSubtask: t.isSubtask || false,
        budgetAmount: t.budgetAmount || null,
        paidAmount: t.paidAmount || null,
        budgetCategory: t.budgetCategory || null,
        progressPercentage: t.progressPercentage ?? null,
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

    // Budget Tracking fields
    if (data.parentTaskId !== undefined) updatePayload.parentTaskId = data.parentTaskId;
    if (data.isSubtask !== undefined) updatePayload.isSubtask = data.isSubtask;
    if (data.budgetAmount !== undefined) updatePayload.budgetAmount = data.budgetAmount;
    if (data.paidAmount !== undefined) updatePayload.paidAmount = data.paidAmount;
    if (data.budgetCategory !== undefined) updatePayload.budgetCategory = data.budgetCategory;
    if (data.progressPercentage !== undefined) updatePayload.progressPercentage = data.progressPercentage;
    if (data.payments !== undefined) updatePayload.payments = data.payments;

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

// ─── POST /api/contacts ────────────────────────────────────────────

app.post('/api/contacts', async (req, res, next) => {
  try {
    const data = CreateContactSchema.parse(req.body);
    logger.info('📇 contacts:create', { name: data.name });

    const docRef = await db.collection('contacts').add({
      name: data.name,
      phones: data.phones,
      roles: data.roles,
      linkedProjects: data.linkedProjects,
      notes: data.notes || '',
      emails: data.emails,
      messengers: data.messengers,
      defaultCity: data.defaultCity || null,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: req.agentUserId || 'system',
    });

    logger.info('📇 contacts:created', { contactId: docRef.id });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'contact_created',
      endpoint: '/api/contacts',
      metadata: { contactId: docRef.id, name: data.name },
    });

    res.status(201).json({ contactId: docRef.id, name: data.name });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/contacts/search ──────────────────────────────────────

app.get('/api/contacts/search', async (req, res, next) => {
  try {
    const params = SearchContactsQuerySchema.parse(req.query);
    logger.info('📇 contacts:search', { q: params.q, role: params.role, projectId: params.projectId });

    const snap = await db.collection('contacts').get();
    let contacts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Filter by role if specified
    if (params.role) {
      const roleLower = params.role.toLowerCase();
      contacts = contacts.filter((c: any) =>
        Array.isArray(c.roles) && c.roles.some((r: string) => r.toLowerCase().includes(roleLower))
      );
    }

    // Filter by project if specified
    if (params.projectId) {
      contacts = contacts.filter((c: any) =>
        Array.isArray(c.linkedProjects) && c.linkedProjects.includes(params.projectId)
      );
    }

    // Fuzzy search by name
    const fuseOptions = {
      keys: ['name', 'notes', 'defaultCity'],
      threshold: 0.4,
    };
    const fuse = new Fuse(contacts, fuseOptions);
    const results = fuse.search(params.q, { limit: params.limit }).map((r: any) => ({
      contactId: r.item.id,
      name: r.item.name,
      phones: r.item.phones || [],
      roles: r.item.roles || [],
      linkedProjects: r.item.linkedProjects || [],
      notes: r.item.notes || '',
      emails: r.item.emails || [],
      messengers: r.item.messengers || {},
      defaultCity: r.item.defaultCity || null,
      score: r.score,
    }));

    res.json({ results, count: results.length });
  } catch (e) {
    next(e);
  }
});

// ═══════════════════════════════════════════════════════════════════
// ESTIMATES & PROJECTS — Estimator Agent Endpoints
// ═══════════════════════════════════════════════════════════════════

const CreateEstimateSchema = z.object({
  clientId: z.string().min(1).optional(),
  clientName: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional(),
  items: z.array(z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    quantity: z.number().min(0),
    unitPrice: z.number().min(0),
    total: z.number().min(0),
    type: z.enum(['labor', 'material', 'service', 'other']),
  })).min(1),
  notes: z.string().optional(),
  terms: z.string().optional(),
  validUntil: z.string().optional(), // ISO date string
  taxRate: z.number().min(0).max(100).optional(),
});

const ListEstimatesQuerySchema = z.object({
  clientId: z.string().optional(),
  clientName: z.string().min(2).optional(),
  status: z.string().optional(), // comma-separated: "draft,sent"
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const UpdateEstimateSchema = z.object({
  status: z.enum(['draft', 'sent', 'approved', 'rejected', 'converted']).optional(),
  items: z.array(z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    quantity: z.number().min(0),
    unitPrice: z.number().min(0),
    total: z.number().min(0),
    type: z.enum(['labor', 'material', 'service', 'other']),
  })).optional(),
  notes: z.string().optional(),
  terms: z.string().optional(),
  validUntil: z.string().nullable().optional(),
  taxRate: z.number().min(0).max(100).optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});

const CreateProjectSchema = z.object({
  clientId: z.string().min(1).optional(),
  clientName: z.string().min(1).optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['work', 'estimate', 'financial', 'other']).default('work'),
  address: z.string().optional(),
  areaSqft: z.number().optional(),
  projectType: z.string().optional(),
  facilityUse: z.string().optional(),
});

const ListProjectsQuerySchema = z.object({
  clientId: z.string().optional(),
  clientName: z.string().min(2).optional(),
  status: z.string().optional(),
  type: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// ─── POST /api/estimates ────────────────────────────────────────────

app.post('/api/estimates', async (req, res, next) => {
  try {
    const data = CreateEstimateSchema.parse(req.body);
    logger.info('📐 estimates:create', { clientId: data.clientId, address: data.address, itemCount: data.items.length, key: data.idempotencyKey });

    // Dedup check via _idempotency collection
    if (data.idempotencyKey) {
      const keyDoc = await db.doc(`_idempotency/${data.idempotencyKey}`).get();
      if (keyDoc.exists) {
        const existing = keyDoc.data()!;
        logger.info('📐 estimates:deduplicated', { estimateId: existing.entityId });
        res.status(200).json({ estimateId: existing.entityId, deduplicated: true });
        return;
      }
    }

    // Resolve client: by clientId, or auto-find/create by address
    let clientId = data.clientId;
    let clientName = data.clientName;

    if (!clientId && data.address) {
      // Search by address first (deduplication)
      const found = await searchClientByAddress(data.address);
      if (found) {
        clientId = found.id;
        clientName = clientName || found.name;
        logger.info('📐 estimates:client found by address', { clientId, address: data.address });
      } else {
        // Auto-create client with address as name
        const created = await autoCreateClientByAddress(data.address, 'estimate');
        clientId = created.id;
        clientName = clientName || created.name;
        logger.info('📐 estimates:client auto-created', { clientId, address: data.address });
      }
    }

    if (!clientId) {
      res.status(400).json({ error: 'Необходим clientId или address для создания estimate' });
      return;
    }

    // Validate clientId exists in Firestore
    const clientDoc = await db.collection('clients').doc(clientId).get();
    if (!clientDoc.exists) {
      res.status(400).json({ error: `Клиент с ID "${clientId}" не найден` });
      return;
    }

    const companyId = await resolveOwnerCompanyId();

    // Generate estimate number
    const number = `EST-${Date.now().toString().slice(-6)}`;

    const subtotal = data.items.reduce((sum, item) => sum + item.total, 0);
    const taxRate = data.taxRate || 0;
    const taxAmount = +(subtotal * (taxRate / 100)).toFixed(2);
    const total = +(subtotal + taxAmount).toFixed(2);

    const docRef = await db.collection('estimates').add({
      companyId,
      clientId,
      clientName: clientName || '',
      number,
      status: 'draft',
      items: data.items,
      subtotal: +subtotal.toFixed(2),
      taxRate,
      taxAmount,
      total,
      notes: data.notes || '',
      terms: data.terms || '',
      validUntil: data.validUntil ? Timestamp.fromDate(new Date(data.validUntil)) : null,
      createdBy: req.agentUserId,
      source: 'openclaw_estimator',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Store idempotency key with 24h TTL
    if (data.idempotencyKey) {
      await db.doc(`_idempotency/${data.idempotencyKey}`).set({
        entityId: docRef.id,
        collection: 'estimates',
        expiresAt: Date.now() + 24 * 3600_000,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    logger.info('📐 estimates:created', { estimateId: docRef.id, number, total });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'estimate_created',
      endpoint: '/api/estimates',
      metadata: { estimateId: docRef.id, number, clientId, total },
    });

    res.status(201).json({ estimateId: docRef.id, number, total });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/estimates/list ────────────────────────────────────────

app.get('/api/estimates/list', async (req, res, next) => {
  try {
    const params = ListEstimatesQuerySchema.parse(req.query);
    let clientId = params.clientId;

    if (!clientId && params.clientName) {
      const match = await fuzzySearchClient(params.clientName);
      if (!match) {
        res.status(404).json({ error: 'Клиент не найден' });
        return;
      }
      clientId = match.id;
    }

    const companyId = await resolveOwnerCompanyId();
    logger.info('📐 estimates:list', { companyId, clientId, status: params.status });

    let q: admin.firestore.Query = db.collection('estimates')
      .where('companyId', '==', companyId);

    if (clientId) {
      q = q.where('clientId', '==', clientId);
    }

    if (params.status) {
      const statuses = params.status.split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length === 1) {
        q = q.where('status', '==', statuses[0]);
      } else if (statuses.length > 1 && statuses.length <= 10) {
        q = q.where('status', 'in', statuses);
      }
    }

    q = q.orderBy('createdAt', 'desc');

    const countSnap = await q.count().get();
    const total = countSnap.data().count;

    if (params.offset > 0) {
      q = q.offset(params.offset);
    }
    q = q.limit(params.limit);

    const snap = await q.get();
    const estimates = snap.docs.map(d => {
      const e = d.data();
      return {
        id: d.id,
        number: e.number,
        clientId: e.clientId,
        clientName: e.clientName,
        status: e.status,
        subtotal: e.subtotal,
        taxRate: e.taxRate,
        taxAmount: e.taxAmount,
        total: e.total,
        itemCount: e.items?.length || 0,
        notes: e.notes || '',
        validUntil: e.validUntil?.toDate?.()?.toISOString() || null,
        createdAt: e.createdAt?.toDate?.()?.toISOString() || null,
        updatedAt: e.updatedAt?.toDate?.()?.toISOString() || null,
      };
    });

    res.json({ estimates, total, hasMore: params.offset + estimates.length < total });
  } catch (e) {
    next(e);
  }
});

// ─── PATCH /api/estimates/:id ───────────────────────────────────────

app.patch('/api/estimates/:id', async (req, res, next) => {
  try {
    const estimateId = req.params.id;
    const data = UpdateEstimateSchema.parse(req.body);

    logger.info('📐 estimates:update', { estimateId, fields: Object.keys(data) });

    const estimateRef = db.collection('estimates').doc(estimateId);
    const estimateDoc = await estimateRef.get();

    if (!estimateDoc.exists) {
      res.status(404).json({ error: 'Смета не найдена' });
      return;
    }

    const updatePayload: Record<string, any> = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (data.status !== undefined) updatePayload.status = data.status;
    if (data.notes !== undefined) updatePayload.notes = data.notes;
    if (data.terms !== undefined) updatePayload.terms = data.terms;
    if (data.taxRate !== undefined) updatePayload.taxRate = data.taxRate;

    if (data.validUntil !== undefined) {
      updatePayload.validUntil = data.validUntil
        ? Timestamp.fromDate(new Date(data.validUntil))
        : null;
    }

    if (data.items !== undefined) {
      updatePayload.items = data.items;
      const subtotal = data.items.reduce((sum, item) => sum + item.total, 0);
      const taxRate = data.taxRate ?? estimateDoc.data()!.taxRate ?? 0;
      const taxAmount = +(subtotal * (taxRate / 100)).toFixed(2);
      updatePayload.subtotal = +subtotal.toFixed(2);
      updatePayload.taxAmount = taxAmount;
      updatePayload.total = +(subtotal + taxAmount).toFixed(2);
    }

    await estimateRef.update(updatePayload);

    logger.info('📐 estimates:updated', { estimateId });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'estimate_updated',
      endpoint: `/api/estimates/${estimateId}`,
      metadata: { estimateId, fields: Object.keys(data) },
    });

    res.json({ estimateId, updated: true });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/estimates/:id/convert-to-tasks ──────────────────────

app.post('/api/estimates/:id/convert-to-tasks', async (req, res, next) => {
  try {
    const estimateId = req.params.id;
    const agentUserId = req.agentUserId;
    logger.info('📐 estimates:convert-to-tasks', { estimateId });

    // Atomic transaction: read estimate + check status + create tasks + update status
    const result = await db.runTransaction(async (tx) => {
      const estimateRef = db.collection('estimates').doc(estimateId);
      const estimateDoc = await tx.get(estimateRef);

      if (!estimateDoc.exists) {
        return { error: 'not_found' } as const;
      }

      const estimate = estimateDoc.data()!;

      if (estimate.status === 'converted') {
        return { error: 'already_converted', taskId: estimate.convertedToTaskId } as const;
      }

      // Group items by type for sub-tasks
      const byType: Record<string, { items: any[]; total: number }> = {};
      for (const item of (estimate.items || [])) {
        const type = item.type || 'other';
        if (!byType[type]) byType[type] = { items: [], total: 0 };
        byType[type].items.push(item);
        byType[type].total += item.total || 0;
      }

      const createdTaskIds: string[] = [];

      // Parent task
      const parentRef = db.collection('gtd_tasks').doc();
      const itemsSummary = (estimate.items || [])
        .map((i: any) => `• ${i.description}: ${i.quantity} × $${i.unitPrice} = $${i.total}`)
        .join('\n');

      tx.set(parentRef, {
        ownerId: agentUserId,
        title: `${estimate.number}: ${estimate.clientName} — Electrical`,
        description: `Converted from estimate ${estimate.number}.\n${estimate.notes || ''}\n\nItems:\n${itemsSummary}\n\nTotal: $${estimate.total}`,
        status: 'next_action',
        priority: 'high',
        context: '@office',
        clientId: estimate.clientId,
        clientName: estimate.clientName,
        budgetAmount: estimate.total,
        taskType: 'estimate_conversion',
        source: `estimate:${estimateId}`,
        estimateId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      createdTaskIds.push(parentRef.id);

      // Sub-tasks by category
      const typeLabels: Record<string, string> = {
        material: 'Materials',
        labor: 'Labor',
        service: 'Services',
        other: 'Other',
      };

      for (const [type, group] of Object.entries(byType)) {
        const subRef = db.collection('gtd_tasks').doc();
        const label = typeLabels[type] || type;
        tx.set(subRef, {
          ownerId: agentUserId,
          title: `${estimate.number}: ${label} — $${group.total.toFixed(2)}`,
          description: group.items.map((i: any) => `• ${i.description}: $${i.total}`).join('\n'),
          status: 'next_action',
          priority: 'medium',
          context: '@office',
          clientId: estimate.clientId,
          clientName: estimate.clientName,
          parentTaskId: parentRef.id,
          isSubtask: true,
          budgetAmount: +group.total.toFixed(2),
          budgetCategory: type,
          taskType: 'estimate_conversion',
          source: `estimate:${estimateId}`,
          estimateId,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        createdTaskIds.push(subRef.id);
      }

      // Update estimate status atomically
      tx.update(estimateRef, {
        status: 'converted',
        convertedToTaskId: parentRef.id,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        error: null,
        parentTaskId: parentRef.id,
        createdTaskIds,
        estimateNumber: estimate.number,
      } as const;
    });

    // Handle transaction results
    if (result.error === 'not_found') {
      res.status(404).json({ error: 'Смета не найдена' });
      return;
    }

    if (result.error === 'already_converted') {
      res.status(409).json({ error: 'Смета уже конвертирована', taskId: result.taskId });
      return;
    }

    logger.info('📐 estimates:converted', { estimateId, taskCount: result.createdTaskIds.length });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'estimate_converted',
      endpoint: `/api/estimates/${estimateId}/convert-to-tasks`,
      metadata: { estimateId, parentTaskId: result.parentTaskId, taskCount: result.createdTaskIds.length },
    });

    res.status(201).json({
      parentTaskId: result.parentTaskId,
      taskIds: result.createdTaskIds,
      taskCount: result.createdTaskIds.length,
      message: `Создано ${result.createdTaskIds.length} задач из сметы ${result.estimateNumber}`,
    });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/projects ─────────────────────────────────────────────

app.post('/api/projects', async (req, res, next) => {
  try {
    const data = CreateProjectSchema.parse(req.body);
    logger.info('🏗️ projects:create', { clientId: data.clientId, address: data.address, name: data.name });

    // Resolve client: by clientId, or auto-find/create by address
    let clientId = data.clientId;
    let clientName = data.clientName;

    if (!clientId && data.address) {
      const found = await searchClientByAddress(data.address);
      if (found) {
        clientId = found.id;
        clientName = clientName || found.name;
        logger.info('🏗️ projects:client found by address', { clientId, address: data.address });
      } else {
        const created = await autoCreateClientByAddress(data.address, 'project');
        clientId = created.id;
        clientName = clientName || created.name;
        logger.info('🏗️ projects:client auto-created', { clientId, address: data.address });
      }
    }

    if (!clientId) {
      res.status(400).json({ error: 'Необходим clientId или address для создания проекта' });
      return;
    }

    const companyId = await resolveOwnerCompanyId();

    const docRef = db.collection('projects').doc();
    await docRef.set({
      id: docRef.id,
      companyId,
      clientId,
      clientName: clientName || '',
      name: data.name,
      description: data.description || '',
      status: 'active',
      type: data.type,
      address: data.address || null,
      areaSqft: data.areaSqft || null,
      projectType: data.projectType || null,
      facilityUse: data.facilityUse || null,
      files: [],
      totalDebit: 0,
      totalCredit: 0,
      balance: 0,
      createdBy: req.agentUserId,
      source: 'openclaw_estimator',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    logger.info('🏗️ projects:created', { projectId: docRef.id });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'project_created',
      endpoint: '/api/projects',
      metadata: { projectId: docRef.id, name: data.name, clientId },
    });

    res.status(201).json({ projectId: docRef.id, name: data.name });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/projects/list ─────────────────────────────────────────

app.get('/api/projects/list', async (req, res, next) => {
  try {
    const params = ListProjectsQuerySchema.parse(req.query);
    let clientId = params.clientId;

    if (!clientId && params.clientName) {
      const match = await fuzzySearchClient(params.clientName);
      if (!match) {
        res.status(404).json({ error: 'Клиент не найден' });
        return;
      }
      clientId = match.id;
    }

    const companyId = await resolveOwnerCompanyId();
    logger.info('🏗️ projects:list', { companyId, clientId, status: params.status });

    let q: admin.firestore.Query = db.collection('projects')
      .where('companyId', '==', companyId);

    if (clientId) {
      q = q.where('clientId', '==', clientId);
    }

    if (params.status) {
      q = q.where('status', '==', params.status);
    }

    if (params.type) {
      q = q.where('type', '==', params.type);
    }

    q = q.orderBy('updatedAt', 'desc').limit(params.limit);

    const snap = await q.get();
    const projects = snap.docs.map(d => {
      const p = d.data();
      return {
        id: d.id,
        name: p.name,
        clientId: p.clientId,
        clientName: p.clientName,
        status: p.status,
        type: p.type || 'other',
        address: p.address || null,
        totalDebit: p.totalDebit || 0,
        totalCredit: p.totalCredit || 0,
        balance: p.balance || 0,
        fileCount: p.files?.length || 0,
        createdAt: p.createdAt?.toDate?.()?.toISOString() || null,
        updatedAt: p.updatedAt?.toDate?.()?.toISOString() || null,
      };
    });

    res.json({ projects, count: projects.length });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/projects/:id/files ──────────────────────────────────

const UploadFileSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1).default('application/octet-stream'),
  base64Data: z.string().min(1),
  description: z.string().optional(),
});

app.post('/api/projects/:id/files', async (req, res, next) => {
  try {
    const projectId = req.params.id;
    const data = UploadFileSchema.parse(req.body);
    logger.info('📁 files:upload', { projectId, fileName: data.fileName });

    // Validate project exists
    const projectDoc = await db.collection('projects').doc(projectId).get();
    if (!projectDoc.exists) {
      res.status(404).json({ error: `Проект "${projectId}" не найден` });
      return;
    }

    // Decode base64
    const buffer = Buffer.from(data.base64Data, 'base64');
    const fileSizeBytes = buffer.length;

    // Max 50MB
    if (fileSizeBytes > 50 * 1024 * 1024) {
      res.status(400).json({ error: 'Файл слишком большой (максимум 50MB)' });
      return;
    }

    // Determine version number — count existing files with same name
    const existingFilesSnap = await db.collection('projects').doc(projectId)
      .collection('files')
      .where('name', '==', data.fileName)
      .orderBy('version', 'desc')
      .limit(1)
      .get();

    const version = existingFilesSnap.empty ? 1 : (existingFilesSnap.docs[0].data().version || 0) + 1;

    // Storage path with version: /projects/{projectId}/blueprints/{version}_{filename}
    const storagePath = `projects/${projectId}/blueprints/v${version}_${data.fileName}`;
    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);

    await file.save(buffer, {
      metadata: {
        contentType: data.contentType,
        metadata: {
          projectId,
          version: String(version),
          originalName: data.fileName,
          uploadedBy: req.agentUserId || 'agent',
        },
      },
    });

    // Generate signed URL (30-day expiry)
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });

    // Save metadata to Firestore subcollection
    const fileDocRef = await db.collection('projects').doc(projectId)
      .collection('files').add({
        name: data.fileName,
        path: storagePath,
        url: signedUrl,
        size: fileSizeBytes,
        contentType: data.contentType,
        description: data.description || '',
        version,
        uploadedBy: req.agentUserId || 'agent',
        uploadedAt: FieldValue.serverTimestamp(),
      });

    logger.info('📁 files:uploaded', { projectId, fileId: fileDocRef.id, version, size: fileSizeBytes });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'file_uploaded',
      endpoint: `/api/projects/${projectId}/files`,
      metadata: { projectId, fileId: fileDocRef.id, fileName: data.fileName, version, size: fileSizeBytes },
    });

    res.status(201).json({
      fileId: fileDocRef.id,
      name: data.fileName,
      version,
      url: signedUrl,
      size: fileSizeBytes,
      path: storagePath,
    });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/projects/:id/files ───────────────────────────────────

app.get('/api/projects/:id/files', async (req, res, next) => {
  try {
    const projectId = req.params.id;
    logger.info('📁 files:list', { projectId });

    // Validate project exists
    const projectDoc = await db.collection('projects').doc(projectId).get();
    if (!projectDoc.exists) {
      res.status(404).json({ error: `Проект "${projectId}" не найден` });
      return;
    }

    const filesSnap = await db.collection('projects').doc(projectId)
      .collection('files')
      .orderBy('uploadedAt', 'desc')
      .get();

    const files = filesSnap.docs.map((d) => {
      const f = d.data();
      return {
        id: d.id,
        name: f.name,
        path: f.path,
        url: f.url,
        size: f.size,
        contentType: f.contentType || 'application/octet-stream',
        description: f.description || '',
        version: f.version || 1,
        uploadedBy: f.uploadedBy || 'unknown',
        uploadedAt: f.uploadedAt?.toDate?.()?.toISOString() || null,
      };
    });

    // Group by filename for version view
    const grouped: Record<string, typeof files> = {};
    for (const file of files) {
      if (!grouped[file.name]) grouped[file.name] = [];
      grouped[file.name].push(file);
    }

    res.json({ files, grouped, count: files.length });
  } catch (e) {
    next(e);
  }
});

// ═══════════════════════════════════════════════════════════════════
// BLUEPRINT SPLIT — Estimator V3 Phase 2
// ═══════════════════════════════════════════════════════════════════

const BlueprintSplitSchema = z.object({
  projectId: z.string().min(1),
  fileId: z.string().min(1),
});

app.post('/api/blueprint/split', async (req, res, next) => {
  try {
    const data = BlueprintSplitSchema.parse(req.body);
    logger.info('📄 blueprint:split', { projectId: data.projectId, fileId: data.fileId });

    // 1. Validate project exists
    const projectDoc = await db.collection('projects').doc(data.projectId).get();
    if (!projectDoc.exists) {
      res.status(404).json({ error: `Проект "${data.projectId}" не найден` });
      return;
    }

    // 2. Get file metadata from Firestore
    const fileDoc = await db.collection('projects').doc(data.projectId)
      .collection('files').doc(data.fileId).get();
    if (!fileDoc.exists) {
      res.status(404).json({ error: `Файл "${data.fileId}" не найден` });
      return;
    }

    const fileMeta = fileDoc.data()!;
    if (!fileMeta.contentType?.includes('pdf')) {
      res.status(400).json({ error: 'Только PDF файлы можно разбить на страницы' });
      return;
    }

    // 3. Download PDF from Storage
    const bucket = admin.storage().bucket();
    const sourceFile = bucket.file(fileMeta.path);
    const [exists] = await sourceFile.exists();
    if (!exists) {
      res.status(404).json({ error: 'Файл не найден в Storage' });
      return;
    }

    const [pdfBuffer] = await sourceFile.download();
    logger.info('📄 blueprint:split — downloaded PDF', { size: pdfBuffer.length });

    // 4. Parse PDF and split into individual pages
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const pageCount = pdfDoc.getPageCount();
    logger.info('📄 blueprint:split — pages', { pageCount });

    if (pageCount === 0) {
      res.status(400).json({ error: 'PDF не содержит страниц' });
      return;
    }

    // 5. Split each page into a separate PDF and save to Storage
    const pages: Array<{
      pageNumber: number;
      path: string;
      url: string;
      size: number;
      width: number;
      height: number;
    }> = [];

    const basePath = `projects/${data.projectId}/rasterized`;

    for (let i = 0; i < pageCount; i++) {
      const singlePageDoc = await PDFDocument.create();
      const [copiedPage] = await singlePageDoc.copyPages(pdfDoc, [i]);
      singlePageDoc.addPage(copiedPage);

      const pageBytes = await singlePageDoc.save();
      const pageBuffer = Buffer.from(pageBytes);

      const pagePath = `${basePath}/page-${i + 1}.pdf`;
      const pageFile = bucket.file(pagePath);

      await pageFile.save(pageBuffer, {
        metadata: {
          contentType: 'application/pdf',
          metadata: {
            projectId: data.projectId,
            sourceFileId: data.fileId,
            pageNumber: String(i + 1),
            totalPages: String(pageCount),
          },
        },
      });

      // Generate signed URL (30-day expiry)
      const [signedUrl] = await pageFile.getSignedUrl({
        action: 'read',
        expires: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });

      // Get page dimensions
      const pageObj = pdfDoc.getPage(i);
      const { width, height } = pageObj.getSize();

      pages.push({
        pageNumber: i + 1,
        path: pagePath,
        url: signedUrl,
        size: pageBuffer.length,
        width: Math.round(width),
        height: Math.round(height),
      });
    }

    // 6. Save split metadata to Firestore
    await db.collection('projects').doc(data.projectId)
      .collection('blueprint_pages').doc(data.fileId).set({
        sourceFileId: data.fileId,
        sourceFileName: fileMeta.name,
        totalPages: pageCount,
        pages,
        splitAt: FieldValue.serverTimestamp(),
        splitBy: req.agentUserId || 'agent',
      });

    logger.info('📄 blueprint:split — complete', { projectId: data.projectId, pageCount });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'blueprint_split',
      endpoint: '/api/blueprint/split',
      metadata: { projectId: data.projectId, fileId: data.fileId, pageCount },
    });

    res.status(200).json({
      projectId: data.projectId,
      fileId: data.fileId,
      totalPages: pageCount,
      pages,
      message: `PDF разбит на ${pageCount} страниц`,
    });
  } catch (e) {
    next(e);
  }
});

// ═══════════════════════════════════════════════════════════════════
// BLACKBOARD — Estimator V3 Phase 3
// ═══════════════════════════════════════════════════════════════════

const CreateBlackboardSchema = z.object({
  projectId: z.string().min(1),
  version: z.number().int().min(1).default(1),
  zones: z.array(z.string()).default([]),
  extracted_elements: z.array(z.any()).default([]),
  rfis: z.array(z.any()).default([]),
  estimate_summary: z.record(z.any()).default({}),
  status: z.enum(['in_progress', 'completed', 'review_needed']).default('in_progress'),
});

app.post('/api/blackboard', async (req, res, next) => {
  try {
    const data = CreateBlackboardSchema.parse(req.body);
    logger.info('📋 blackboard:create', { projectId: data.projectId, version: data.version });

    // Validate project exists
    const projectDoc = await db.collection('projects').doc(data.projectId).get();
    if (!projectDoc.exists) {
      res.status(404).json({ error: `Проект "${data.projectId}" не найден` });
      return;
    }

    // Check if blackboard already exists for this project+version
    const existingSnap = await db.collection('estimate_blackboard')
      .where('projectId', '==', data.projectId)
      .where('version', '==', data.version)
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      // Update existing
      const existingDoc = existingSnap.docs[0];
      await existingDoc.ref.update({
        zones: data.zones,
        extracted_elements: data.extracted_elements,
        rfis: data.rfis,
        estimate_summary: data.estimate_summary,
        status: data.status,
        updatedAt: FieldValue.serverTimestamp(),
      });

      logger.info('📋 blackboard:updated', { blackboardId: existingDoc.id });
      res.json({
        blackboardId: existingDoc.id,
        updated: true,
        message: `Blackboard v${data.version} обновлён`,
      });
      return;
    }

    // Create new blackboard
    const docRef = await db.collection('estimate_blackboard').add({
      projectId: data.projectId,
      version: data.version,
      zones: data.zones,
      extracted_elements: data.extracted_elements,
      rfis: data.rfis,
      estimate_summary: data.estimate_summary,
      status: data.status,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: req.agentUserId || 'agent',
    });

    logger.info('📋 blackboard:created', { blackboardId: docRef.id });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'blackboard_created',
      endpoint: '/api/blackboard',
      metadata: { blackboardId: docRef.id, projectId: data.projectId, version: data.version },
    });

    res.status(201).json({
      blackboardId: docRef.id,
      message: `Blackboard v${data.version} создан`,
    });
  } catch (e) {
    next(e);
  }
});

app.get('/api/blackboard/:projectId', async (req, res, next) => {
  try {
    const projectId = req.params.projectId;
    const version = req.query.version ? Number(req.query.version) : undefined;
    logger.info('📋 blackboard:get', { projectId, version });

    let q: admin.firestore.Query = db.collection('estimate_blackboard')
      .where('projectId', '==', projectId);

    if (version) {
      q = q.where('version', '==', version);
    }

    q = q.orderBy('version', 'desc').limit(1);
    const snap = await q.get();

    if (snap.empty) {
      res.status(404).json({ error: 'Blackboard не найден для проекта' });
      return;
    }

    const doc = snap.docs[0];
    const data = doc.data();

    res.json({
      blackboardId: doc.id,
      projectId: data.projectId,
      version: data.version,
      zones: data.zones || [],
      extracted_elements: data.extracted_elements || [],
      rfis: data.rfis || [],
      estimate_summary: data.estimate_summary || {},
      status: data.status,
      createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      updatedAt: data.updatedAt?.toDate?.()?.toISOString() || null,
    });
  } catch (e) {
    next(e);
  }
});

// ─── Error Handler (must be last) ──────────────────────────────────

app.use(errorHandler);

// ─── Export as Firebase Function ────────────────────────────────────

export const agentApi = functions
  .runWith({ minInstances: 1, memory: '512MB', timeoutSeconds: 120 })
  .https.onRequest(app);
