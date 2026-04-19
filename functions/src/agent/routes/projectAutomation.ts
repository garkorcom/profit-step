/**
 * Project automation routes (Client Journey Sprint 3.1):
 *   POST /api/projects/:id/generate-tasks-from-estimate
 *   POST /api/projects/:id/init-folders
 *
 * Both are idempotent: re-running doesn't duplicate.
 */

import { Router } from 'express';

import { db, FieldValue, logAgentActivity } from '../routeContext';

const router = Router();

// ─── POST /api/projects/:id/generate-tasks-from-estimate ──────────

router.post('/api/projects/:id/generate-tasks-from-estimate', async (req, res, next) => {
  try {
    const projectId = req.params.id;
    const estimateIdOverride = typeof req.body?.estimateId === 'string' ? req.body.estimateId : null;

    const projectSnap = await db.collection('projects').doc(projectId).get();
    if (!projectSnap.exists) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const project = projectSnap.data()!;

    // Resolve estimate: explicit or project.estimateId
    const estimateId = estimateIdOverride ?? project.estimateId;
    if (!estimateId) {
      res.status(400).json({ error: 'No estimateId on project; pass { estimateId } in body' });
      return;
    }
    const estimateSnap = await db.collection('estimates').doc(estimateId).get();
    if (!estimateSnap.exists) {
      res.status(404).json({ error: 'Estimate not found', estimateId });
      return;
    }
    const estimate = estimateSnap.data()!;

    const items = (estimate.clientItems ?? estimate.items ?? []) as Array<Record<string, unknown>>;
    if (items.length === 0) {
      res.status(400).json({ error: 'Estimate has no items' });
      return;
    }

    // Idempotency — check if any gtd_task already has sourceEstimateItemId from
    // this estimate. If yes, skip generation.
    const existing = await db
      .collection('gtd_tasks')
      .where('projectId', '==', projectId)
      .where('sourceEstimateId', '==', estimateId)
      .limit(1)
      .get();
    if (!existing.empty) {
      res.status(200).json({
        projectId,
        estimateId,
        generated: 0,
        alreadyExisted: true,
        message: 'Tasks already generated for this estimate',
      });
      return;
    }

    const ownerId = req.agentUserId || project.projectManager || 'system';
    const createdIds: string[] = [];
    const batch = db.batch();
    for (const item of items) {
      const qty = typeof item.quantity === 'number' ? item.quantity : 1;
      const unit = typeof item.unit === 'string' ? item.unit : 'шт';
      const unitPrice = typeof item.unitPrice === 'number' ? item.unitPrice : 0;
      const total = typeof item.total === 'number' ? item.total : unitPrice * qty;

      const taskRef = db.collection('gtd_tasks').doc();
      batch.set(taskRef, {
        title: typeof item.description === 'string' ? item.description : '(позиция сметы)',
        status: 'inbox',
        priority: 'medium',
        projectId,
        clientId: project.clientId ?? null,
        clientName: project.clientName ?? null,
        companyId: project.companyId ?? null,
        sourceEstimateId: estimateId,
        sourceEstimateItemId: item.sourceTaskId ?? null,
        billable: true,
        production: true,
        unit,
        quantity: qty,
        rate: unitPrice,
        estimatedPriceClient: total,
        ownerId,
        createdBy: ownerId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      createdIds.push(taskRef.id);
    }
    await batch.commit();

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'project_tasks_generated',
      endpoint: `/api/projects/${projectId}/generate-tasks-from-estimate`,
      metadata: { projectId, estimateId, count: createdIds.length },
    });

    res.status(201).json({
      projectId,
      estimateId,
      generated: createdIds.length,
      taskIds: createdIds,
    });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/projects/:id/init-folders ──────────────────────────

router.post('/api/projects/:id/init-folders', async (req, res, next) => {
  try {
    const projectId = req.params.id;
    const projectSnap = await db.collection('projects').doc(projectId).get();
    if (!projectSnap.exists) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const project = projectSnap.data()!;

    // Idempotency — skip if folderTree marker exists
    if (project.folderTreeInitialized) {
      res.status(200).json({ projectId, initialized: false, message: 'Folders already initialized' });
      return;
    }

    // Build folder map: array of {path, description}.
    // We don't create real GCS folders here — Storage is implicit; we record
    // the expected structure on the project doc so UI can render the tree
    // and uploads know where to place files.
    const folders = [
      { path: '_project-docs/', description: 'Договор, КП, акты, подписи' },
      { path: '_photos/', description: 'Фотоотчёты с объекта' },
      { path: '_invoices/', description: 'Счета клиенту' },
      { path: '_materials/', description: 'Чеки + документы поставщиков' },
      { path: 'tasks/', description: 'Папки задач (auto-создаются при задаче)' },
    ];

    await db.collection('projects').doc(projectId).update({
      folderTree: folders,
      folderTreeInitialized: true,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'project_folders_initialized',
      endpoint: `/api/projects/${projectId}/init-folders`,
      metadata: { projectId, folderCount: folders.length },
    });

    res.status(201).json({ projectId, initialized: true, folders });
    return;
  } catch (e) {
    next(e);
  }
});

export default router;
