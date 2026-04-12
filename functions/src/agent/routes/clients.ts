/**
 * Client Routes — POST, PATCH, GET list/search/:id
 */
import { Router } from 'express';
import { db, FieldValue, logger, logAgentActivity, getCachedClients, Fuse } from '../routeContext';
import { logAudit, AuditHelpers, extractAuditContext } from '../utils/auditLogger';
import { CreateClientSchema, UpdateClientSchema } from '../schemas';
import { requireScope } from '../agentMiddleware';

const router = Router();

// ─── POST /api/clients ──────────────────────────────────────────────

router.post('/api/clients', requireScope('clients:write', 'admin'), async (req, res, next) => {
  try {
    const data = CreateClientSchema.parse(req.body);
    logger.info('👤 clients:create', { name: data.name, type: data.type });

    // Dedup check
    if (data.idempotencyKey) {
      const keyDoc = await db.doc(`_idempotency/${data.idempotencyKey}`).get();
      if (keyDoc.exists) {
        const existing = keyDoc.data()!;
        logger.info('👤 clients:deduplicated', { clientId: existing.entityId });
        res.status(200).json({ clientId: existing.entityId, deduplicated: true });
        return;
      }
    }

    const clientAuditCtx = extractAuditContext(req);
    const docRef = db.collection('clients').doc();
    await docRef.set({
      name: data.name,
      address: data.address || '',
      contactPerson: data.contactPerson || '',
      phone: data.phone || '',
      email: data.email || '',
      notes: data.notes || '',
      type: data.type || null,
      company: data.company || null,
      geo: data.geo || null,
      status: 'active',
      source: clientAuditCtx.source || 'openclaw',
      createdBy: clientAuditCtx.performedBy,
      createdBySource: clientAuditCtx.source,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Store idempotency key
    if (data.idempotencyKey) {
      await db.doc(`_idempotency/${data.idempotencyKey}`).set({
        entityId: docRef.id,
        collection: 'clients',
        expiresAt: Date.now() + 24 * 3600_000,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    // Invalidate client cache
    await db.doc('_cache/active_clients').update({ stale: true }).catch(() => {});

    logger.info('👤 clients:created', { clientId: docRef.id });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'client_created',
      endpoint: '/api/clients',
      metadata: { clientId: docRef.id, name: data.name, type: data.type },
    });

    await logAudit(AuditHelpers.create('client', docRef.id, { name: data.name, type: data.type }, clientAuditCtx.performedBy, clientAuditCtx.source as any));

    res.status(201).json({ clientId: docRef.id, name: data.name });
  } catch (e) {
    next(e);
  }
});

// ─── PATCH /api/clients/:id ─────────────────────────────────────────

router.patch('/api/clients/:id', requireScope('clients:write', 'admin'), async (req, res, next) => {
  try {
    const clientId = req.params.id;
    const data = UpdateClientSchema.parse(req.body);
    logger.info('👤 clients:update', { clientId, fields: Object.keys(data) });

    // Verify client exists
    const clientRef = db.collection('clients').doc(clientId);
    const clientDoc = await clientRef.get();
    if (!clientDoc.exists) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    // Build update payload (only provided fields)
    const clientUpdateCtx = extractAuditContext(req);
    const oldClientData = clientDoc.data()!;
    const updatePayload: Record<string, any> = {
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: clientUpdateCtx.performedBy,
      updatedBySource: clientUpdateCtx.source,
    };
    if (data.name !== undefined) updatePayload.name = data.name;
    if (data.address !== undefined) updatePayload.address = data.address;
    if (data.contactPerson !== undefined) updatePayload.contactPerson = data.contactPerson;
    if (data.phone !== undefined) updatePayload.phone = data.phone;
    if (data.email !== undefined) updatePayload.email = data.email;
    if (data.notes !== undefined) updatePayload.notes = data.notes;
    if (data.type !== undefined) updatePayload.type = data.type;
    if (data.company !== undefined) updatePayload.company = data.company;
    if (data.geo !== undefined) updatePayload.geo = data.geo;
    if (data.nearbyStores !== undefined) updatePayload.nearbyStores = data.nearbyStores;
    if (data.accessCredentials !== undefined) updatePayload.accessCredentials = data.accessCredentials;

    await clientRef.update(updatePayload);

    // Invalidate client cache
    await db.doc('_cache/active_clients').update({ stale: true }).catch(() => {});

    logger.info('👤 clients:updated', { clientId, updatedFields: Object.keys(updatePayload) });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'client_updated',
      endpoint: `/api/clients/${clientId}`,
      metadata: { clientId, updatedFields: Object.keys(data) },
    });

    const clientFrom: Record<string, any> = {};
    const clientTo: Record<string, any> = {};
    for (const key of Object.keys(data)) {
      if ((data as any)[key] !== undefined) {
        clientFrom[key] = oldClientData[key] ?? null;
        clientTo[key] = (data as any)[key];
      }
    }
    await logAudit(AuditHelpers.update('client', clientId, clientFrom, clientTo, clientUpdateCtx.performedBy, clientUpdateCtx.source as any));

    res.json({ clientId, updated: true });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/clients/list ───────────────────────────────────────────

router.get('/api/clients/list', requireScope('clients:read', 'admin'), async (req, res, next) => {
  try {
    const limitParam = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const status = req.query.status as string;

    logger.info('👤 clients:list', { limit: limitParam, status });
    const clients = await getCachedClients();

    let filtered = clients;
    if (status) {
      filtered = clients.filter((c: any) => c.status === status);
    }

    const result = filtered.slice(0, limitParam).map((c: any) => ({
      clientId: c.id,
      name: c.name,
      address: c.address || null,
      phone: c.phone || null,
      email: c.email || null,
      status: c.status || null,
      type: c.type || null,
    }));

    res.json({ clients: result, count: result.length, total: filtered.length });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/clients/search ────────────────────────────────────────

router.get('/api/clients/search', requireScope('clients:read', 'admin'), async (req, res, next) => {
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

// ─── GET /api/clients/:id ──────────────────────────────────────────

router.get('/api/clients/:id', requireScope('clients:read', 'admin'), async (req, res, next) => {
  try {
    const clientId = req.params.id;
    logger.info('👤 clients:profile', { clientId });

    const clientDoc = await db.collection('clients').doc(clientId).get();
    if (!clientDoc.exists) {
      res.status(404).json({ error: `Клиент "${clientId}" не найден` });
      return;
    }

    const client = { id: clientDoc.id, ...clientDoc.data() };

    const [projectsSnap, tasksSnap, costsSnap, sessionsSnap, estimatesSnap, sitesSnap] = await Promise.all([
      db.collection('projects').where('clientId', '==', clientId).get(),
      db.collection('gtd_tasks').where('clientId', '==', clientId).limit(50).get(),
      db.collection('costs').where('clientId', '==', clientId).where('status', '==', 'confirmed').get(),
      db.collection('work_sessions').where('clientId', '==', clientId).where('status', '==', 'completed').get(),
      db.collection('estimates').where('clientId', '==', clientId).limit(20).get(),
      db.collection('sites').where('clientId', '==', clientId).get(),
    ]);

    const projects = projectsSnap.docs.map(d => ({ id: d.id, name: d.data().name, status: d.data().status }));

    const tasks = {
      total: tasksSnap.size,
      byStatus: {} as Record<string, number>,
      items: tasksSnap.docs.slice(0, 10).map(d => ({
        id: d.id, title: d.data().title, status: d.data().status, priority: d.data().priority,
      })),
    };
    tasksSnap.docs.forEach(d => {
      const s = d.data().status || 'unknown';
      tasks.byStatus[s] = (tasks.byStatus[s] || 0) + 1;
    });

    let costsTotal = 0;
    const costsByCategory: Record<string, number> = {};
    costsSnap.docs.forEach(d => {
      const c = d.data();
      costsTotal += c.amount || 0;
      costsByCategory[c.category] = (costsByCategory[c.category] || 0) + (c.amount || 0);
    });

    let totalTimeMinutes = 0;
    let totalEarnings = 0;
    sessionsSnap.docs.forEach(d => {
      totalTimeMinutes += d.data().durationMinutes || 0;
      totalEarnings += d.data().sessionEarnings || 0;
    });

    const estimates = estimatesSnap.docs.map(d => ({
      id: d.id, status: d.data().status, total: d.data().total,
    }));

    const sites = sitesSnap.docs.map(d => ({
      id: d.id, address: d.data().address, status: d.data().status,
    }));

    res.json({
      client,
      projects,
      tasks,
      costs: { total: +costsTotal.toFixed(2), count: costsSnap.size, byCategory: costsByCategory },
      timeTracking: {
        totalMinutes: totalTimeMinutes,
        totalHours: +(totalTimeMinutes / 60).toFixed(1),
        totalEarnings: +totalEarnings.toFixed(2),
        sessionCount: sessionsSnap.size,
      },
      estimates,
      sites,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
