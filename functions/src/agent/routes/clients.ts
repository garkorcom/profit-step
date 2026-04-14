/**
 * Client Routes — POST, PATCH, GET list/search/:id, duplicates-scan, merge
 */
import { Router } from 'express';
import { db, FieldValue, logger, logAgentActivity, getCachedClients, Fuse } from '../routeContext';
import { logAudit, AuditHelpers, extractAuditContext } from '../utils/auditLogger';
import { normalizePhone, looksLikePhone } from '../utils/phone';
import { CreateClientSchema, UpdateClientSchema } from '../schemas';

const router = Router();

// ─── Geo distance helper (Haversine formula) ───────────────────────
const GEO_DUPLICATE_THRESHOLD_KM = 0.15; // 150 meters — same building/lot

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── POST /api/clients ──────────────────────────────────────────────

router.post('/api/clients', async (req, res, next) => {
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

    // Duplicate detection — multi-criteria: phone, name, geo (skip if force=true)
    if (!req.body.force) {
      const existingClients = await getCachedClients();
      const candidates: Array<{ clientId: string; name: string; address: string | null; phone: string | null; matchField: string; score: number }> = [];
      const seenIds = new Set<string>();

      // 1. Exact phone match (highest confidence)
      if (data.phone) {
        const normPhone = normalizePhone(data.phone);
        if (normPhone) {
          existingClients.forEach((c: any) => {
            if (c.phone && normalizePhone(c.phone) === normPhone && !seenIds.has(c.id)) {
              candidates.push({ clientId: c.id, name: c.name, address: c.address || null, phone: c.phone || null, matchField: 'phone', score: 1.0 });
              seenIds.add(c.id);
            }
          });
        }
      }

      // 2. Geo proximity match (within 150m — same building)
      if (data.geo?.lat && data.geo?.lng) {
        existingClients.forEach((c: any) => {
          if (c.geo?.lat && c.geo?.lng && !seenIds.has(c.id)) {
            const dist = haversineKm(data.geo!.lat, data.geo!.lng, c.geo.lat, c.geo.lng);
            if (dist <= GEO_DUPLICATE_THRESHOLD_KM) {
              candidates.push({ clientId: c.id, name: c.name, address: c.address || null, phone: c.phone || null, matchField: 'geo', score: +(1 - dist / GEO_DUPLICATE_THRESHOLD_KM).toFixed(3) });
              seenIds.add(c.id);
            }
          }
        });
      }

      // 3. Fuzzy name match
      const dupFuse = new Fuse(existingClients, { keys: ['name'], threshold: 0.3 });
      dupFuse.search(data.name, { limit: 3 }).forEach((r: any) => {
        if (!seenIds.has(r.item.id)) {
          candidates.push({ clientId: r.item.id, name: r.item.name, address: r.item.address || null, phone: r.item.phone || null, matchField: 'name', score: r.score });
          seenIds.add(r.item.id);
        }
      });

      if (candidates.length > 0) {
        logger.info('👤 clients:duplicate_warning', { name: data.name, candidates: candidates.length });
        res.status(200).json({
          warning: 'possible_duplicate',
          message: `Found ${candidates.length} similar client(s). Pass "force": true to create anyway.`,
          candidates,
        });
        return;
      }
    }

    // Normalize phone before storage
    const normalizedPhone = normalizePhone(data.phone);

    const clientAuditCtx = extractAuditContext(req);
    const docRef = db.collection('clients').doc();
    await docRef.set({
      name: data.name,
      address: data.address || '',
      contactPerson: data.contactPerson || '',
      phone: normalizedPhone,
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

    // Data quality warnings (non-blocking)
    const warnings: string[] = [];
    if (!data.phone && !data.email) warnings.push('No phone or email provided — client may be unreachable');
    if (!data.address) warnings.push('No address provided');

    res.status(201).json({ clientId: docRef.id, name: data.name, warnings: warnings.length ? warnings : undefined });
  } catch (e) {
    next(e);
  }
});

// ─── PATCH /api/clients/:id ─────────────────────────────────────────

router.patch('/api/clients/:id', async (req, res, next) => {
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
    if (data.phone !== undefined) updatePayload.phone = normalizePhone(data.phone);
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

router.get('/api/clients/list', async (req, res, next) => {
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

router.get('/api/clients/search', async (req, res, next) => {
  try {
    const query = req.query.q as string;
    if (!query || query.length < 2) {
      res.status(400).json({ error: 'Query must be at least 2 characters' });
      return;
    }

    // Normalize phone queries for better matching
    const searchQuery = looksLikePhone(query) ? normalizePhone(query) : query;
    logger.info('🔍 clients:search', { query, searchQuery });
    const clients = await getCachedClients();
    const fuse = new Fuse(clients, { keys: ['name', 'address', 'phone', 'email'], threshold: 0.4 });
    const results = fuse.search(searchQuery, { limit: 5 }).map((r: any) => ({
      clientId: r.item.id,
      clientName: r.item.name,
      address: r.item.address,
      phone: r.item.phone || null,
      email: r.item.email || null,
      score: r.score,
    }));

    logger.info('🔍 clients:search results', { query, count: results.length });
    res.json({ results, count: results.length });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/clients/check-duplicates ─────────────────────────────

router.get('/api/clients/check-duplicates', async (req, res, next) => {
  try {
    const name = req.query.name as string;
    const phone = req.query.phone as string;
    const address = req.query.address as string;

    if (!name && !phone && !address) {
      res.status(400).json({ error: 'At least one of: name, phone, address is required' });
      return;
    }

    logger.info('🔍 clients:check-duplicates', { name, phone, address });
    const clients = await getCachedClients();
    const duplicates: Array<{ clientId: string; name: string; address: string | null; phone: string | null; matchField: string; score: number }> = [];

    // Exact phone match (highest priority)
    if (phone) {
      const normalized = normalizePhone(phone);
      clients.forEach((c: any) => {
        if (c.phone && normalizePhone(c.phone) === normalized) {
          duplicates.push({ clientId: c.id, name: c.name, address: c.address || null, phone: c.phone || null, matchField: 'phone', score: 1.0 });
        }
      });
    }

    // Fuzzy name match
    if (name) {
      const nameFuse = new Fuse(clients, { keys: ['name'], threshold: 0.3 });
      nameFuse.search(name, { limit: 5 }).forEach((r: any) => {
        // Avoid duplicate entries if same client matched by phone
        if (!duplicates.some(d => d.clientId === r.item.id)) {
          duplicates.push({ clientId: r.item.id, name: r.item.name, address: r.item.address || null, phone: r.item.phone || null, matchField: 'name', score: r.score });
        }
      });
    }

    // Fuzzy address match
    if (address) {
      const addrFuse = new Fuse(clients, { keys: ['address'], threshold: 0.4 });
      addrFuse.search(address, { limit: 5 }).forEach((r: any) => {
        if (!duplicates.some(d => d.clientId === r.item.id)) {
          duplicates.push({ clientId: r.item.id, name: r.item.name, address: r.item.address || null, phone: r.item.phone || null, matchField: 'address', score: r.score });
        }
      });
    }

    res.json({ duplicates, count: duplicates.length });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/clients/duplicates-scan ──────────────────────────────
// Scans all clients and groups potential duplicates by phone, name, geo

router.get('/api/clients/duplicates-scan', async (req, res, next) => {
  try {
    logger.info('🔍 clients:duplicates-scan');
    const clients = await getCachedClients();

    // Build groups: keyed by canonical identifier
    const phoneGroups = new Map<string, string[]>(); // normalizedPhone → clientId[]
    const geoCluster: Array<{ id: string; lat: number; lng: number }> = [];

    // Pass 1 — group by normalized phone
    clients.forEach((c: any) => {
      if (c.phone) {
        const norm = normalizePhone(c.phone);
        if (norm && norm.length >= 7) {
          const existing = phoneGroups.get(norm) || [];
          existing.push(c.id);
          phoneGroups.set(norm, existing);
        }
      }
      if (c.geo?.lat && c.geo?.lng) {
        geoCluster.push({ id: c.id, lat: c.geo.lat, lng: c.geo.lng });
      }
    });

    // Pass 2 — fuzzy name pairs (O(n²) but n is small — typically <200 clients)
    const nameFuse = new Fuse(clients, { keys: ['name'], threshold: 0.25, includeScore: true });
    const nameGroups = new Map<string, Set<string>>();
    const processedNamePairs = new Set<string>();

    clients.forEach((c: any) => {
      const matches = nameFuse.search(c.name, { limit: 5 });
      matches.forEach((m: any) => {
        if (m.item.id === c.id) return; // skip self
        const pairKey = [c.id, m.item.id].sort().join('|');
        if (processedNamePairs.has(pairKey)) return;
        processedNamePairs.add(pairKey);

        // Find or create group
        let groupKey = c.id;
        for (const [gk, v] of nameGroups) {
          if (v.has(c.id) || v.has(m.item.id)) { groupKey = gk; break; }
        }
        const group = nameGroups.get(groupKey) || new Set<string>();
        group.add(c.id);
        group.add(m.item.id);
        nameGroups.set(groupKey, group);
      });
    });

    // Pass 3 — geo proximity clustering
    const geoGroups = new Map<string, Set<string>>();
    for (let i = 0; i < geoCluster.length; i++) {
      for (let j = i + 1; j < geoCluster.length; j++) {
        const dist = haversineKm(geoCluster[i].lat, geoCluster[i].lng, geoCluster[j].lat, geoCluster[j].lng);
        if (dist <= GEO_DUPLICATE_THRESHOLD_KM) {
          let groupKey = geoCluster[i].id;
          for (const [gk, v] of geoGroups) {
            if (v.has(geoCluster[i].id) || v.has(geoCluster[j].id)) { groupKey = gk; break; }
          }
          const group = geoGroups.get(groupKey) || new Set<string>();
          group.add(geoCluster[i].id);
          group.add(geoCluster[j].id);
          geoGroups.set(groupKey, group);
        }
      }
    }

    // Merge all signals into unified duplicate groups
    const clientMap = new Map<string, any>();
    clients.forEach((c: any) => clientMap.set(c.id, c));

    interface DuplicateGroup {
      clients: Array<{ clientId: string; name: string; address: string | null; phone: string | null }>;
      matchReasons: string[];
      confidence: 'high' | 'medium' | 'low';
    }

    const mergedGroups = new Map<string, { ids: Set<string>; reasons: Set<string> }>();

    // Add phone groups (high confidence)
    for (const [phone, ids] of phoneGroups) {
      if (ids.length < 2) continue;
      const sortedKey = ids.sort().join('|');
      const existing = mergedGroups.get(sortedKey) || { ids: new Set(ids), reasons: new Set<string>() };
      ids.forEach(id => existing.ids.add(id));
      existing.reasons.add(`phone_match:${phone}`);
      mergedGroups.set(sortedKey, existing);
    }

    // Add name groups
    for (const [, nameSet] of nameGroups) {
      if (nameSet.size < 2) continue;
      const ids = Array.from(nameSet).sort();
      // Check if this group overlaps with existing
      let merged = false;
      for (const [, v] of mergedGroups) {
        if (ids.some(id => v.ids.has(id))) {
          ids.forEach(id => v.ids.add(id));
          v.reasons.add('fuzzy_name');
          merged = true;
          break;
        }
      }
      if (!merged) {
        mergedGroups.set(ids.join('|'), { ids: new Set(ids), reasons: new Set(['fuzzy_name']) });
      }
    }

    // Add geo groups
    for (const [, geoSet] of geoGroups) {
      if (geoSet.size < 2) continue;
      const ids = Array.from(geoSet).sort();
      let merged = false;
      for (const [, v] of mergedGroups) {
        if (ids.some(id => v.ids.has(id))) {
          ids.forEach(id => v.ids.add(id));
          v.reasons.add('geo_proximity');
          merged = true;
          break;
        }
      }
      if (!merged) {
        mergedGroups.set(ids.join('|'), { ids: new Set(ids), reasons: new Set(['geo_proximity']) });
      }
    }

    // Convert to response format
    const duplicateGroups: DuplicateGroup[] = [];
    for (const [, group] of mergedGroups) {
      const reasons = Array.from(group.reasons);
      const hasPhone = reasons.some(r => r.startsWith('phone_match'));
      const multiSignal = reasons.length >= 2;

      duplicateGroups.push({
        clients: Array.from(group.ids).map(id => {
          const c = clientMap.get(id);
          return { clientId: id, name: c?.name || 'Unknown', address: c?.address || null, phone: c?.phone || null };
        }),
        matchReasons: reasons,
        confidence: hasPhone ? 'high' : multiSignal ? 'medium' : 'low',
      });
    }

    // Sort: high confidence first
    const order = { high: 0, medium: 1, low: 2 };
    duplicateGroups.sort((a, b) => order[a.confidence] - order[b.confidence]);

    logger.info('🔍 clients:duplicates-scan done', { groups: duplicateGroups.length, totalClients: clients.length });
    res.json({ duplicateGroups, groupCount: duplicateGroups.length, totalClients: clients.length });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/clients/merge ──────────────────────────────────────
// Merge sourceId into targetId: moves all references, merges data, archives source

const COLLECTIONS_WITH_CLIENT_ID = [
  'projects',
  'gtd_tasks',
  'costs',
  'work_sessions',
  'estimates',
  'sites',
  'project_ledger',
  'shopping_lists',
  'project_locations',
  'activity_logs',
] as const;

router.post('/api/clients/merge', async (req, res, next) => {
  try {
    const { sourceId, targetId, dryRun } = req.body as { sourceId?: string; targetId?: string; dryRun?: boolean };

    if (!sourceId || !targetId) {
      res.status(400).json({ error: 'sourceId and targetId are required' });
      return;
    }
    if (sourceId === targetId) {
      res.status(400).json({ error: 'sourceId and targetId must be different' });
      return;
    }

    logger.info('🔀 clients:merge', { sourceId, targetId, dryRun });

    // Verify both clients exist
    const [sourceDoc, targetDoc] = await Promise.all([
      db.collection('clients').doc(sourceId).get(),
      db.collection('clients').doc(targetId).get(),
    ]);

    if (!sourceDoc.exists) {
      res.status(404).json({ error: `Source client "${sourceId}" not found` });
      return;
    }
    if (!targetDoc.exists) {
      res.status(404).json({ error: `Target client "${targetId}" not found` });
      return;
    }

    const sourceData = sourceDoc.data()!;
    const targetData = targetDoc.data()!;

    // Count references in all collections
    const refCounts: Record<string, number> = {};
    const refSnapshots: Record<string, FirebaseFirestore.QuerySnapshot> = {};

    await Promise.all(COLLECTIONS_WITH_CLIENT_ID.map(async (col) => {
      const snap = await db.collection(col).where('clientId', '==', sourceId).get();
      refCounts[col] = snap.size;
      refSnapshots[col] = snap;
    }));

    const totalRefs = Object.values(refCounts).reduce((a, b) => a + b, 0);
    logger.info('🔀 clients:merge refs found', { sourceId, totalRefs, refCounts });

    if (dryRun) {
      res.json({
        dryRun: true,
        source: { id: sourceId, name: sourceData.name, address: sourceData.address, phone: sourceData.phone },
        target: { id: targetId, name: targetData.name, address: targetData.address, phone: targetData.phone },
        referencesToUpdate: refCounts,
        totalReferences: totalRefs,
      });
      return;
    }

    // Execute merge in batches (Firestore limit: 500 ops per batch)
    const BATCH_LIMIT = 400; // leave room for client doc updates
    let batchOps = 0;
    let batch = db.batch();
    let batchCount = 0;

    for (const col of COLLECTIONS_WITH_CLIENT_ID) {
      const snap = refSnapshots[col];
      for (const doc of snap.docs) {
        const update: Record<string, any> = { clientId: targetId };
        // Also update clientName if present
        const docData = doc.data();
        if (docData.clientName && docData.clientName === sourceData.name) {
          update.clientName = targetData.name;
        }
        batch.update(doc.ref, update);
        batchOps++;

        if (batchOps >= BATCH_LIMIT) {
          await batch.commit();
          batchCount++;
          batch = db.batch();
          batchOps = 0;
        }
      }
    }

    // Merge client data: fill target's empty fields from source
    const mergedFields: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() };
    const fieldsToMerge = ['phone', 'email', 'contactPerson', 'address', 'notes', 'company', 'geo', 'type', 'nearbyStores', 'accessCredentials'] as const;

    for (const field of fieldsToMerge) {
      const targetVal = targetData[field];
      const sourceVal = sourceData[field];
      // Fill empty target fields from source
      if ((!targetVal || targetVal === '') && sourceVal && sourceVal !== '') {
        mergedFields[field] = field === 'phone' ? normalizePhone(sourceVal) : sourceVal;
      }
    }

    // Merge notes (append source notes if different)
    if (sourceData.notes && sourceData.notes !== targetData.notes) {
      const existingNotes = targetData.notes || '';
      mergedFields.notes = existingNotes
        ? `${existingNotes}\n--- Merged from ${sourceData.name} ---\n${sourceData.notes}`
        : sourceData.notes;
    }

    batch.update(db.collection('clients').doc(targetId), mergedFields);
    batchOps++;

    // Archive source client (soft delete)
    batch.update(db.collection('clients').doc(sourceId), {
      status: 'merged',
      mergedInto: targetId,
      mergedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    batchOps++;

    await batch.commit();
    batchCount++;

    // Invalidate client cache
    await db.doc('_cache/active_clients').update({ stale: true }).catch(() => {});

    // Audit log
    const mergeAuditCtx = extractAuditContext(req);
    await logAudit(AuditHelpers.update(
      'client', targetId,
      { mergeSource: sourceId, sourceName: sourceData.name },
      { mergedFields: Object.keys(mergedFields), refsUpdated: totalRefs },
      mergeAuditCtx.performedBy,
      mergeAuditCtx.source as any,
    ));

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'client_merged',
      endpoint: '/api/clients/merge',
      metadata: { sourceId, targetId, sourceName: sourceData.name, targetName: targetData.name, totalRefs, refCounts },
    });

    logger.info('🔀 clients:merge complete', { sourceId, targetId, totalRefs, batchCount });
    res.json({
      merged: true,
      source: { id: sourceId, name: sourceData.name, status: 'merged' },
      target: { id: targetId, name: targetData.name },
      referencesUpdated: refCounts,
      totalReferences: totalRefs,
      mergedFields: Object.keys(mergedFields).filter(k => k !== 'updatedAt'),
    });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/clients/:id ──────────────────────────────────────────

router.get('/api/clients/:id', async (req, res, next) => {
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
