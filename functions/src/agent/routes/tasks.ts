/**
 * GTD Task Routes — CRUD + batch-update (5 endpoints)
 */
import { Router } from 'express';
import * as admin from 'firebase-admin';

import { db, FieldValue, Timestamp, logger, logAgentActivity, fuzzySearchClient } from '../routeContext';
import { logAudit, AuditHelpers, extractAuditContext } from '../utils/auditLogger';
import { requireScope } from '../agentMiddleware';
import { publishTaskEvent } from '../utils/eventPublisher';
import {
  CreateGTDTaskSchema,
  ListTasksQuerySchema,
  UpdateTaskSchema,
  BatchUpdateTasksSchema,
} from '../schemas';

const router = Router();

// ─── POST /api/gtd-tasks/batch-update ──────────────────────────────

router.post('/api/gtd-tasks/batch-update', requireScope('tasks:write', 'admin'), async (req, res, next) => {
  try {
    const data = BatchUpdateTasksSchema.parse(req.body);
    logger.info('📋 tasks:batch-update', { count: data.taskIds.length, fields: Object.keys(data.update) });

    const auditCtx = extractAuditContext(req);
    const batch = db.batch();
    const updatePayload: Record<string, any> = {
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: auditCtx.performedBy,
      updatedBySource: auditCtx.source,
    };
    Object.entries(data.update).forEach(([k, v]) => { if (v !== undefined) updatePayload[k] = v; });

    let updatedCount = 0;
    const notFound: string[] = [];

    for (const taskId of data.taskIds) {
      const ref = db.collection('gtd_tasks').doc(taskId);
      const doc = await ref.get();
      if (doc.exists) { batch.update(ref, updatePayload); updatedCount++; }
      else { notFound.push(taskId); }
    }

    if (updatedCount > 0) await batch.commit();

    await logAgentActivity({
      userId: req.agentUserId!, action: 'tasks_batch_updated',
      endpoint: '/api/gtd-tasks/batch-update',
      metadata: { updatedCount, notFoundCount: notFound.length, fields: Object.keys(data.update) },
    });

    // Audit log for batch update
    for (const taskId of data.taskIds) {
      if (!notFound.includes(taskId)) {
        await logAudit({
          action: 'BATCH_UPDATE',
          entityType: 'gtd_task',
          entityId: taskId,
          changes: { to: data.update },
          source: auditCtx.source as any,
          performedBy: auditCtx.performedBy,
          performedByName: auditCtx.performedByName,
        });
      }
    }

    res.json({ updated: updatedCount, notFound: notFound.length > 0 ? notFound : undefined });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/gtd-tasks ───────────────────────────────────────────

router.post('/api/gtd-tasks', requireScope('tasks:write', 'admin'), async (req, res, next) => {
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

    const createAuditCtx = extractAuditContext(req);
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
      siteId: data.siteId || null,
      projectId: data.projectId || null,
      source: createAuditCtx.source || 'openclaw',
      createdBy: createAuditCtx.performedBy,
      createdBySource: createAuditCtx.source,
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

    await logAudit(AuditHelpers.create('gtd_task', docRef.id, { title: data.title, status: data.status, priority: data.priority }, createAuditCtx.performedBy, createAuditCtx.source as any));

    // Publish event for agent consumption
    publishTaskEvent('created', docRef.id, `Task created: ${data.title}`, {
      title: data.title, clientId: data.clientId, assigneeId: data.assigneeId, priority: data.priority,
    }, data.assigneeId || null);

    res.status(201).json({ taskId: docRef.id });
  } catch (e) {
    next(e);
  }
});


// ─── GET /api/gtd-tasks/list ───────────────────────────────────────

router.get('/api/gtd-tasks/list', requireScope('tasks:read', 'admin'), async (req, res, next) => {
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

    // Scope: non-admin agents only see tasks assigned to them
    const isAdmin = (req.agentScopes || []).includes('admin');
    const role = req.agentRole || 'user';
    const isManagerOrAbove = ['superadmin', 'company_admin', 'admin', 'manager'].includes(role);

    if (!isAdmin && !isManagerOrAbove && !params.assigneeId) {
      // Workers see only their own tasks (assigned or owned)
      q = q.where('assigneeId', '==', req.agentUserId);
    }

    if (clientId) {
      q = q.where('clientId', '==', clientId);
    }
    if (req.query.projectId) {
      q = q.where('projectId', '==', req.query.projectId);
    }
    if (params.assigneeId) {
      q = q.where('assigneeId', '==', params.assigneeId);
    }
    if (params.priority) {
      q = q.where('priority', '==', params.priority);
    }

    // Status filter: comma-separated → 'in' query
    if (params.status) {
      const statuses = params.status.split(',').map((s: string) => s.trim()).filter(Boolean);
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
    const tasks = snap.docs.map((d: admin.firestore.QueryDocumentSnapshot) => {
      const t = d.data();
      return {
        id: d.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        clientId: t.clientId,
        clientName: t.clientName,
        projectId: t.projectId || null,
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

router.patch('/api/gtd-tasks/:id', requireScope('tasks:write', 'admin'), async (req, res, next) => {
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

    const updateAuditCtx = extractAuditContext(req);
    const oldData = taskDoc.data()!;
    const updatePayload: Record<string, any> = {
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: updateAuditCtx.performedBy,
      updatedBySource: updateAuditCtx.source,
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

    // Project assignment
    if (data.projectId !== undefined) updatePayload.projectId = data.projectId;

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

    // Build from/to diff for audit
    const changedFrom: Record<string, any> = {};
    const changedTo: Record<string, any> = {};
    for (const key of Object.keys(data)) {
      if ((data as any)[key] !== undefined) {
        changedFrom[key] = oldData[key] ?? null;
        changedTo[key] = (data as any)[key];
      }
    }
    await logAudit(AuditHelpers.update('gtd_task', taskId, changedFrom, changedTo, updateAuditCtx.performedBy, updateAuditCtx.source as any));

    // Publish event
    const action = data.status === 'done' ? 'completed' : data.assigneeId ? 'assigned' : 'updated';
    publishTaskEvent(action, taskId, `Task ${action}: ${oldData.title}`, {
      title: oldData.title, status: data.status, assigneeId: data.assigneeId || oldData.assigneeId,
    }, data.assigneeId || oldData.assigneeId || null);

    res.json({ taskId, updated: true });
  } catch (e) {
    next(e);
  }
});


// ─── DELETE /api/gtd-tasks/:id (Phase 2) ───────────────────────────

router.delete('/api/gtd-tasks/:id', requireScope('tasks:write', 'admin'), async (req, res, next) => {
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

    const archiveAuditCtx = extractAuditContext(req);
    await taskRef.update({
      status: 'archived',
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: archiveAuditCtx.performedBy,
      updatedBySource: archiveAuditCtx.source,
    });

    logger.info('📋 tasks:archived', { taskId });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'task_archived',
      endpoint: `/api/gtd-tasks/${taskId}`,
      metadata: { taskId, previousStatus: taskData.status, title: taskData.title },
    });

    await logAudit(AuditHelpers.delete('gtd_task', taskId, { title: taskData.title, previousStatus: taskData.status }, archiveAuditCtx.performedBy, archiveAuditCtx.source as any));

    res.json({ taskId, archived: true, message: 'Задача удалена (archived)' });
  } catch (e) {
    next(e);
  }
});

export default router;
