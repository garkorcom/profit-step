/**
 * Inventory Routes — warehouse & stock management (15 endpoints)
 *
 * Warehouses (supports physical + vehicle/fleet types):
 *   POST   /api/inventory/warehouses      — create warehouse
 *   GET    /api/inventory/warehouses      — list warehouses (type/archived filters)
 *   GET    /api/inventory/warehouses/:id  — warehouse details + items
 *   PATCH  /api/inventory/warehouses/:id  — update warehouse
 *   DELETE /api/inventory/warehouses/:id  — archive warehouse (soft-delete)
 *
 * Items:
 *   POST   /api/inventory/items           — add item
 *   PATCH  /api/inventory/items/:id       — update item
 *   DELETE /api/inventory/items/:id       — delete item
 *   GET    /api/inventory/items           — list items (warehouseId filter)
 *
 * Transactions:
 *   POST   /api/inventory/transactions       — record movement (in/out/transfer)
 *   POST   /api/inventory/transactions/task  — bulk task materials
 *   GET    /api/inventory/transactions       — movement history
 *
 * Norms:
 *   POST   /api/inventory/norms              — create norm
 *   GET    /api/inventory/norms              — list norms
 *   GET    /api/inventory/norms/:id          — norm details
 *   POST   /api/inventory/write-off-by-norm  — write off by norm
 */
import { Router } from 'express';
import * as admin from 'firebase-admin';

import { db, FieldValue, logger, logAgentActivity } from '../routeContext';
import { logAudit, AuditHelpers, extractAuditContext } from '../utils/auditLogger';
import {
  CreateWarehouseSchema,
  UpdateWarehouseSchema,
  CreateInventoryItemSchema,
  UpdateInventoryItemSchema,
  ListInventoryItemsQuerySchema,
  CreateInventoryTransactionSchema,
  ListInventoryTransactionsQuerySchema,
  CreateNormSchema,
  WriteOffByNormSchema,
} from '../schemas';
import {
  InventoryService,
  CatalogItemNotFoundError,
  InsufficientStockError,
  InventoryValidationError,
} from '../services/inventoryService';

const router = Router();

/**
 * V3: unified write path. Service owns stock mutations for the advanced
 * journal-based collections (inventory_catalog + inventory_transactions_v2).
 * Legacy routes below still touch warehouses/inventory_items/inventory_transactions
 * — they'll migrate once PR-C data migration runs (see WAREHOUSE_SPEC_V3 Phase 0).
 */
const inventoryService = new InventoryService(db);

// ═══════════════════════════════════════════════════════════════════
//  WAREHOUSES
// ═══════════════════════════════════════════════════════════════════

// ─── POST /api/inventory/warehouses ────────────────────────────────

router.post('/api/inventory/warehouses', async (req, res, next) => {
  try {
    const data = CreateWarehouseSchema.parse(req.body);
    logger.info('🏭 warehouse:create', { name: data.name, type: data.type });

    // Dedup
    if (data.idempotencyKey) {
      const keyDoc = await db.doc(`_idempotency/${data.idempotencyKey}`).get();
      if (keyDoc.exists) {
        const existing = keyDoc.data()!;
        logger.info('🏭 warehouse:deduplicated', { warehouseId: existing.entityId });
        res.status(200).json({ warehouseId: existing.entityId, deduplicated: true });
        return;
      }
    }

    const auditCtx = extractAuditContext(req);
    const docRef = await db.collection('warehouses').add({
      // Existing fields
      name: data.name,
      clientId: data.clientId || null,
      projectId: data.projectId || null,
      address: data.address || '',
      description: data.description || '',
      // Vehicle/fleet support
      type: data.type,
      location: data.location || null,
      licensePlate: data.licensePlate || null,
      archived: false,
      // V3: RLS scoping — null means shared pool
      ownerEmployeeId: data.ownerEmployeeId ?? null,
      createdBy: auditCtx.performedBy,
      createdBySource: auditCtx.source,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (data.idempotencyKey) {
      await db.doc(`_idempotency/${data.idempotencyKey}`).set({
        entityId: docRef.id,
        collection: 'warehouses',
        expiresAt: Date.now() + 24 * 3600_000,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    logger.info('🏭 warehouse:created', { warehouseId: docRef.id, type: data.type });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'warehouse_created',
      endpoint: '/api/inventory/warehouses',
      metadata: { warehouseId: docRef.id, name: data.name, type: data.type, clientId: data.clientId },
    });

    await logAudit(AuditHelpers.create('warehouse', docRef.id, { name: data.name, type: data.type, clientId: data.clientId }, auditCtx.performedBy, auditCtx.source as any));

    res.status(201).json({
      warehouseId: docRef.id,
      name: data.name,
      type: data.type,
      licensePlate: data.licensePlate || null,
    });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/inventory/warehouses ─────────────────────────────────

router.get('/api/inventory/warehouses', async (req, res, next) => {
  try {
    const { clientId, projectId, type, includeArchived } = req.query;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    logger.info('🏭 warehouse:list', { clientId, projectId, type, includeArchived, limit });

    let q: admin.firestore.Query = db.collection('warehouses');

    // ── RLS (V3): worker/driver see warehouses they own OR created ──
    // We filter by createdBy first (Firestore single-clause limitation); the
    // ownerEmployeeId path is enforced below by the per-doc filter so that
    // shared-pool warehouses (ownerEmployeeId=null) and owned warehouses
    // both surface for the employee. Foreman role sees own + team.
    const rlsRole = req.effectiveRole || 'admin';
    const rlsUserId = req.effectiveUserId || req.agentUserId;
    if (rlsRole === 'worker' || rlsRole === 'driver') {
      q = q.where('createdBy', '==', rlsUserId);
    }

    if (clientId) q = q.where('clientId', '==', clientId);
    if (projectId) q = q.where('projectId', '==', projectId);
    if (type) q = q.where('type', '==', type);
    q = q.orderBy('createdAt', 'desc').limit(limit);

    const snap = await q.get();

    // Filter archived in JS rather than Firestore `where` — legacy
    // documents (created before this field existed) will not match a
    // `where('archived', '==', false)` query, so we'd drop them.
    // Trade-off: extra reads for archived docs; acceptable given low
    // expected archive volume. Can switch to Firestore filter after
    // a one-time backfill of the field.
    const warehouses = snap.docs
      .map(d => {
        const w = d.data();
        return {
          id: d.id,
          name: w.name,
          clientId: w.clientId || null,
          projectId: w.projectId || null,
          address: w.address || null,
          description: w.description || null,
          type: w.type || 'physical',
          location: w.location || null,
          licensePlate: w.licensePlate || null,
          archived: w.archived ?? false,
          ownerEmployeeId: w.ownerEmployeeId ?? null,
          createdAt: w.createdAt?.toDate?.()?.toISOString() || null,
          updatedAt: w.updatedAt?.toDate?.()?.toISOString() || null,
        };
      })
      .filter(w => includeArchived === 'true' || !w.archived);

    res.json({ warehouses, count: warehouses.length });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/inventory/warehouses/:id ─────────────────────────────

router.get('/api/inventory/warehouses/:id', async (req, res, next) => {
  try {
    const warehouseId = req.params.id;
    const { includeArchived } = req.query;
    logger.info('🏭 warehouse:details', { warehouseId, includeArchived });

    const whDoc = await db.collection('warehouses').doc(warehouseId).get();
    if (!whDoc.exists) {
      res.status(404).json({ error: 'Склад не найден' });
      return;
    }

    const w = whDoc.data()!;

    // Hide archived warehouses unless explicitly requested
    if (w.archived === true && includeArchived !== 'true') {
      res.status(404).json({ error: 'Склад архивирован' });
      return;
    }

    const warehouse = {
      id: whDoc.id,
      name: w.name,
      clientId: w.clientId || null,
      projectId: w.projectId || null,
      address: w.address || null,
      description: w.description || null,
      type: w.type || 'physical',
      location: w.location || null,
      licensePlate: w.licensePlate || null,
      archived: w.archived ?? false,
      ownerEmployeeId: w.ownerEmployeeId ?? null,
      createdAt: w.createdAt?.toDate?.()?.toISOString() || null,
      updatedAt: w.updatedAt?.toDate?.()?.toISOString() || null,
    };

    // Fetch items in this warehouse
    const itemsSnap = await db.collection('inventory_items')
      .where('warehouseId', '==', warehouseId)
      .limit(200)
      .get();

    const items = itemsSnap.docs.map(d => {
      const it = d.data();
      return {
        id: d.id,
        name: it.name,
        quantity: it.quantity,
        unit: it.unit,
        category: it.category,
        minStock: it.minStock || null,
        barcode: it.barcode || null,
        photoUrl: it.photoUrl || null,
        createdAt: it.createdAt?.toDate?.()?.toISOString() || null,
      };
    });

    res.json({ warehouse, items, itemCount: items.length });
  } catch (e) {
    next(e);
  }
});

// ─── PATCH /api/inventory/warehouses/:id ───────────────────────────

router.patch('/api/inventory/warehouses/:id', async (req, res, next) => {
  try {
    const data = UpdateWarehouseSchema.parse(req.body);
    const warehouseId = req.params.id;
    logger.info('🏭 warehouse:update', { warehouseId, fields: Object.keys(data) });

    const docRef = db.collection('warehouses').doc(warehouseId);
    const doc = await docRef.get();
    if (!doc.exists) {
      res.status(404).json({ error: 'Склад не найден' });
      return;
    }
    const existing = doc.data()!;
    if (existing.archived === true) {
      res.status(409).json({ error: 'Нельзя редактировать архивированный склад' });
      return;
    }

    // Server-side "vehicle => licensePlate" guard. Applies to the
    // MERGED state (existing + patch), not just the patch, so partial
    // updates don't accidentally violate the invariant.
    const finalType = data.type ?? existing.type ?? 'physical';
    const finalPlate = data.licensePlate ?? existing.licensePlate;
    if (finalType === 'vehicle' && (!finalPlate || finalPlate.length === 0)) {
      res.status(400).json({
        error: 'licensePlate is required when type is "vehicle"',
        path: ['licensePlate'],
      });
      return;
    }

    // Build update payload — only include fields explicitly in the request
    const updatePayload: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (data.name !== undefined) updatePayload.name = data.name;
    if (data.clientId !== undefined) updatePayload.clientId = data.clientId;
    if (data.projectId !== undefined) updatePayload.projectId = data.projectId;
    if (data.address !== undefined) updatePayload.address = data.address;
    if (data.description !== undefined) updatePayload.description = data.description;
    if (data.type !== undefined) updatePayload.type = data.type;
    if (data.location !== undefined) updatePayload.location = data.location;
    if (data.licensePlate !== undefined) updatePayload.licensePlate = data.licensePlate;
    if (data.ownerEmployeeId !== undefined) updatePayload.ownerEmployeeId = data.ownerEmployeeId;

    await docRef.update(updatePayload);

    const auditCtx = extractAuditContext(req);
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'warehouse_updated',
      endpoint: `/api/inventory/warehouses/${warehouseId}`,
      metadata: { warehouseId, fields: Object.keys(data) },
    });
    await logAudit(AuditHelpers.update('warehouse', warehouseId, existing, data, auditCtx.performedBy, auditCtx.source as any));

    res.json({ warehouseId, updated: true });
  } catch (e) {
    next(e);
  }
});

// ─── DELETE /api/inventory/warehouses/:id ──────────────────────────

router.delete('/api/inventory/warehouses/:id', async (req, res, next) => {
  try {
    const warehouseId = req.params.id;
    const force = req.query.force === 'true';
    logger.info('🏭 warehouse:archive', { warehouseId, force });

    const docRef = db.collection('warehouses').doc(warehouseId);
    const doc = await docRef.get();
    if (!doc.exists) {
      res.status(404).json({ error: 'Склад не найден' });
      return;
    }
    const existing = doc.data()!;
    if (existing.archived === true) {
      res.status(409).json({ error: 'Склад уже архивирован' });
      return;
    }

    // Safety: refuse to archive a warehouse that still has stocked items
    // unless the caller explicitly passes ?force=true. Prevents orphaning
    // inventory_items whose warehouseId points at an archived warehouse.
    if (!force) {
      const itemsSnap = await db.collection('inventory_items')
        .where('warehouseId', '==', warehouseId)
        .where('quantity', '>', 0)
        .limit(1)
        .get();
      if (!itemsSnap.empty) {
        res.status(409).json({
          error: 'Нельзя архивировать склад с остатками. Обнулите inventory_items или передайте ?force=true',
        });
        return;
      }
    }

    await docRef.update({
      archived: true,
      archivedAt: FieldValue.serverTimestamp(),
      archivedBy: req.agentUserId,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const auditCtx = extractAuditContext(req);
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'warehouse_archived',
      endpoint: `/api/inventory/warehouses/${warehouseId}`,
      metadata: { warehouseId, name: existing.name, forced: force },
    });
    await logAudit(AuditHelpers.delete('warehouse', warehouseId, { name: existing.name, type: existing.type }, auditCtx.performedBy, auditCtx.source as any));

    res.json({ warehouseId, archived: true });
  } catch (e) {
    next(e);
  }
});

// ═══════════════════════════════════════════════════════════════════
//  INVENTORY ITEMS
// ═══════════════════════════════════════════════════════════════════

// ─── POST /api/inventory/items ─────────────────────────────────────

router.post('/api/inventory/items', async (req, res, next) => {
  try {
    const data = CreateInventoryItemSchema.parse(req.body);
    logger.info('📦 item:create', { name: data.name, warehouseId: data.warehouseId, quantity: data.quantity });

    // Dedup
    if (data.idempotencyKey) {
      const keyDoc = await db.doc(`_idempotency/${data.idempotencyKey}`).get();
      if (keyDoc.exists) {
        const existing = keyDoc.data()!;
        logger.info('📦 item:deduplicated', { itemId: existing.entityId });
        res.status(200).json({ itemId: existing.entityId, deduplicated: true });
        return;
      }
    }

    // Verify warehouse exists
    const whDoc = await db.collection('warehouses').doc(data.warehouseId).get();
    if (!whDoc.exists) {
      res.status(404).json({ error: 'Склад не найден' });
      return;
    }

    const auditCtx = extractAuditContext(req);
    const docRef = await db.collection('inventory_items').add({
      warehouseId: data.warehouseId,
      name: data.name,
      quantity: data.quantity,
      unit: data.unit,
      category: data.category,
      minStock: data.minStock || null,
      barcode: data.barcode || null,
      photoUrl: data.photoUrl || null,
      notes: data.notes || '',
      createdBy: auditCtx.performedBy,
      createdBySource: auditCtx.source,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (data.idempotencyKey) {
      await db.doc(`_idempotency/${data.idempotencyKey}`).set({
        entityId: docRef.id,
        collection: 'inventory_items',
        expiresAt: Date.now() + 24 * 3600_000,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    logger.info('📦 item:created', { itemId: docRef.id });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'inventory_item_created',
      endpoint: '/api/inventory/items',
      metadata: { itemId: docRef.id, name: data.name, warehouseId: data.warehouseId, quantity: data.quantity },
    });

    await logAudit(AuditHelpers.create('inventory_item', docRef.id, { name: data.name, warehouseId: data.warehouseId, quantity: data.quantity, category: data.category }, auditCtx.performedBy, auditCtx.source as any));

    res.status(201).json({ itemId: docRef.id, name: data.name, quantity: data.quantity });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/inventory/items ──────────────────────────────────────

router.get('/api/inventory/items', async (req, res, next) => {
  try {
    const params = ListInventoryItemsQuerySchema.parse(req.query);
    logger.info('📦 item:list', { warehouseId: params.warehouseId, category: params.category, limit: params.limit });

    let q: admin.firestore.Query = db.collection('inventory_items');

    // ── RLS: worker/driver restricted to items they added ──
    const rlsRole = req.effectiveRole || 'admin';
    const rlsUserId = req.effectiveUserId || req.agentUserId;
    if (rlsRole === 'worker' || rlsRole === 'driver') {
      q = q.where('createdBy', '==', rlsUserId);
    }

    if (params.warehouseId) q = q.where('warehouseId', '==', params.warehouseId);
    if (params.category) q = q.where('category', '==', params.category);

    // Count total before pagination
    const countSnap = await q.count().get();
    const total = countSnap.data().count;

    if (params.offset > 0) q = q.offset(params.offset);
    q = q.limit(params.limit);

    const snap = await q.get();
    const items = snap.docs.map(d => {
      const it = d.data();
      return {
        id: d.id,
        warehouseId: it.warehouseId,
        name: it.name,
        quantity: it.quantity,
        unit: it.unit,
        category: it.category,
        minStock: it.minStock || null,
        barcode: it.barcode || null,
        photoUrl: it.photoUrl || null,
        notes: it.notes || null,
        createdAt: it.createdAt?.toDate?.()?.toISOString() || null,
        updatedAt: it.updatedAt?.toDate?.()?.toISOString() || null,
      };
    });

    res.json({ items, total, hasMore: params.offset + items.length < total });
  } catch (e) {
    next(e);
  }
});

// ─── PATCH /api/inventory/items/:id ────────────────────────────────

router.patch('/api/inventory/items/:id', async (req, res, next) => {
  try {
    const itemId = req.params.id;
    const data = UpdateInventoryItemSchema.parse(req.body);
    logger.info('📦 item:update', { itemId, fields: Object.keys(data) });

    const itemRef = db.collection('inventory_items').doc(itemId);
    const itemDoc = await itemRef.get();
    if (!itemDoc.exists) {
      res.status(404).json({ error: 'Товар не найден' });
      return;
    }

    const auditCtx = extractAuditContext(req);
    const oldData = itemDoc.data()!;
    const updatePayload: Record<string, any> = {
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: auditCtx.performedBy,
      updatedBySource: auditCtx.source,
    };

    if (data.name !== undefined) updatePayload.name = data.name;
    if (data.quantity !== undefined) updatePayload.quantity = data.quantity;
    if (data.unit !== undefined) updatePayload.unit = data.unit;
    if (data.category !== undefined) updatePayload.category = data.category;
    if (data.minStock !== undefined) updatePayload.minStock = data.minStock;
    if (data.barcode !== undefined) updatePayload.barcode = data.barcode;
    if (data.photoUrl !== undefined) updatePayload.photoUrl = data.photoUrl;
    if (data.notes !== undefined) updatePayload.notes = data.notes;

    await itemRef.update(updatePayload);

    logger.info('📦 item:updated', { itemId });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'inventory_item_updated',
      endpoint: `/api/inventory/items/${itemId}`,
      metadata: { itemId, fields: Object.keys(data) },
    });

    // Audit diff
    const changedFrom: Record<string, any> = {};
    const changedTo: Record<string, any> = {};
    for (const key of Object.keys(data)) {
      if ((data as any)[key] !== undefined) {
        changedFrom[key] = oldData[key] ?? null;
        changedTo[key] = (data as any)[key];
      }
    }
    await logAudit(AuditHelpers.update('inventory_item', itemId, changedFrom, changedTo, auditCtx.performedBy, auditCtx.source as any));

    res.json({ itemId, updated: true });
  } catch (e) {
    next(e);
  }
});

// ─── DELETE /api/inventory/items/:id ───────────────────────────────

router.delete('/api/inventory/items/:id', async (req, res, next) => {
  try {
    const itemId = req.params.id;
    logger.info('📦 item:delete', { itemId });

    const itemRef = db.collection('inventory_items').doc(itemId);
    const itemDoc = await itemRef.get();
    if (!itemDoc.exists) {
      res.status(404).json({ error: 'Товар не найден' });
      return;
    }

    const itemData = itemDoc.data()!;
    const auditCtx = extractAuditContext(req);

    await itemRef.delete();

    logger.info('📦 item:deleted', { itemId });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'inventory_item_deleted',
      endpoint: `/api/inventory/items/${itemId}`,
      metadata: { itemId, name: itemData.name, warehouseId: itemData.warehouseId },
    });

    await logAudit(AuditHelpers.delete('inventory_item', itemId, { name: itemData.name, warehouseId: itemData.warehouseId, quantity: itemData.quantity }, auditCtx.performedBy, auditCtx.source as any));

    res.json({ itemId, deleted: true, message: 'Товар удалён' });
  } catch (e) {
    next(e);
  }
});

// ═══════════════════════════════════════════════════════════════════
//  TRANSACTIONS (movements: in / out / transfer)
// ═══════════════════════════════════════════════════════════════════

// ─── POST /api/inventory/transactions ──────────────────────────────

router.post('/api/inventory/transactions', async (req, res, next) => {
  try {
    const data = CreateInventoryTransactionSchema.parse(req.body);
    logger.info('📦 tx:create', { itemId: data.itemId, type: data.type, quantity: data.quantity });

    // Verify item exists
    const itemRef = db.collection('inventory_items').doc(data.itemId);
    const itemDoc = await itemRef.get();
    if (!itemDoc.exists) {
      res.status(404).json({ error: 'Товар не найден' });
      return;
    }

    const item = itemDoc.data()!;
    let newQuantity = item.quantity || 0;

    switch (data.type) {
      case 'in':
        newQuantity += data.quantity;
        break;
      case 'out':
        if (newQuantity < data.quantity) {
          res.status(400).json({ error: `Недостаточно на складе: ${newQuantity} < ${data.quantity}` });
          return;
        }
        newQuantity -= data.quantity;
        break;
      case 'transfer':
        if (newQuantity < data.quantity) {
          res.status(400).json({ error: `Недостаточно для перемещения: ${newQuantity} < ${data.quantity}` });
          return;
        }
        newQuantity -= data.quantity;
        break;
    }

    const auditCtx = extractAuditContext(req);

    // Record transaction
    const txRef = await db.collection('inventory_transactions').add({
      warehouseId: data.warehouseId,
      itemId: data.itemId,
      itemName: item.name,
      type: data.type,
      quantity: data.quantity,
      quantityBefore: item.quantity || 0,
      quantityAfter: newQuantity,
      toWarehouseId: data.toWarehouseId || null,
      relatedTaskId: data.relatedTaskId || null,
      notes: data.notes || null,
      performedBy: auditCtx.performedBy,
      performedBySource: auditCtx.source,
      createdAt: FieldValue.serverTimestamp(),
    });

    // Update item quantity
    await itemRef.update({
      quantity: newQuantity,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: auditCtx.performedBy,
      updatedBySource: auditCtx.source,
    });

    // If transfer — create receiving item or update quantity on target warehouse
    if (data.type === 'transfer' && data.toWarehouseId) {
      // Find same item (by name + category) in target warehouse
      const targetSnap = await db.collection('inventory_items')
        .where('warehouseId', '==', data.toWarehouseId)
        .where('name', '==', item.name)
        .limit(1)
        .get();

      if (targetSnap.empty) {
        // Create new item in target warehouse
        await db.collection('inventory_items').add({
          warehouseId: data.toWarehouseId,
          name: item.name,
          quantity: data.quantity,
          unit: item.unit,
          category: item.category,
          minStock: item.minStock || null,
          barcode: item.barcode || null,
          photoUrl: item.photoUrl || null,
          notes: '',
          createdBy: auditCtx.performedBy,
          createdBySource: auditCtx.source,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        // Add quantity to existing item
        const targetRef = targetSnap.docs[0].ref;
        await targetRef.update({
          quantity: admin.firestore.FieldValue.increment(data.quantity),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }

    // If relatedTaskId — update task.materialsUsed
    if (data.relatedTaskId) {
      const taskRef = db.collection('gtd_tasks').doc(data.relatedTaskId);
      const taskDoc = await taskRef.get();
      if (taskDoc.exists) {
        await taskRef.update({
          materialsUsed: FieldValue.arrayUnion({
            itemId: data.itemId,
            itemName: item.name,
            quantity: data.quantity,
            transactionId: txRef.id,
          }),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }

    logger.info('📦 tx:created', { txId: txRef.id, type: data.type });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'inventory_transaction_created',
      endpoint: '/api/inventory/transactions',
      metadata: { txId: txRef.id, itemId: data.itemId, type: data.type, quantity: data.quantity, relatedTaskId: data.relatedTaskId || null },
    });

    await logAudit(AuditHelpers.create('inventory_transaction', txRef.id, {
      itemId: data.itemId, type: data.type, quantity: data.quantity,
      quantityBefore: item.quantity || 0, quantityAfter: newQuantity,
      warehouseId: data.warehouseId,
    }, auditCtx.performedBy, auditCtx.source as any));

    res.status(201).json({
      transactionId: txRef.id,
      itemId: data.itemId,
      type: data.type,
      quantityBefore: item.quantity || 0,
      quantityAfter: newQuantity,
      message: `${data.type}: ${item.name} x${data.quantity} ${item.unit}`,
    });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/inventory/transactions/task — bulk task materials ───

router.post('/api/inventory/transactions/task', async (req, res, next) => {
  try {
    const { taskId, warehouseId, items } = req.body as {
      taskId: string;
      warehouseId: string;
      items: Array<{ itemId: string; quantity: number; notes?: string }>;
    };

    if (!taskId || !warehouseId || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'taskId, warehouseId, and items[] required' });
      return;
    }

    logger.info('📦 tx:task-bulk', { taskId, warehouseId, itemCount: items.length });

    // Verify task exists
    const taskRef = db.collection('gtd_tasks').doc(taskId);
    const taskDoc = await taskRef.get();
    if (!taskDoc.exists) {
      res.status(404).json({ error: 'Задача не найдена' });
      return;
    }

    const auditCtx = extractAuditContext(req);
    const results: Array<{ itemId: string; itemName: string; transactionId: string; quantityBefore: number; quantityAfter: number }> = [];
    const materialsUsed: Array<{ itemId: string; itemName: string; quantity: number; transactionId: string }> = [];

    for (const entry of items) {
      const itemRef = db.collection('inventory_items').doc(entry.itemId);
      const itemDoc = await itemRef.get();
      if (!itemDoc.exists) {
        res.status(404).json({ error: `Товар ${entry.itemId} не найден` });
        return;
      }

      const item = itemDoc.data()!;
      const quantityBefore = item.quantity || 0;
      const quantityAfter = quantityBefore - entry.quantity;

      if (quantityAfter < 0) {
        res.status(400).json({ error: `Недостаточно ${item.name}: ${quantityBefore} < ${entry.quantity}` });
        return;
      }

      // Create transaction
      const txRef = await db.collection('inventory_transactions').add({
        warehouseId,
        itemId: entry.itemId,
        itemName: item.name,
        type: 'out',
        quantity: entry.quantity,
        quantityBefore,
        quantityAfter,
        toWarehouseId: null,
        relatedTaskId: taskId,
        notes: entry.notes || null,
        performedBy: auditCtx.performedBy,
        performedBySource: auditCtx.source,
        createdAt: FieldValue.serverTimestamp(),
      });

      // Update item quantity
      await itemRef.update({
        quantity: quantityAfter,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: auditCtx.performedBy,
        updatedBySource: auditCtx.source,
      });

      results.push({ itemId: entry.itemId, itemName: item.name, transactionId: txRef.id, quantityBefore, quantityAfter });
      materialsUsed.push({ itemId: entry.itemId, itemName: item.name, quantity: entry.quantity, transactionId: txRef.id });

      await logAudit(AuditHelpers.create('inventory_transaction', txRef.id, {
        itemId: entry.itemId, type: 'out', quantity: entry.quantity,
        quantityBefore, quantityAfter, warehouseId, relatedTaskId: taskId,
      }, auditCtx.performedBy, auditCtx.source as any));
    }

    // Update task.materialsUsed
    await taskRef.update({
      materialsUsed: FieldValue.arrayUnion(...materialsUsed),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'inventory_task_materials',
      endpoint: '/api/inventory/transactions/task',
      metadata: { taskId, warehouseId, itemCount: items.length, transactionIds: results.map(r => r.transactionId) },
    });

    res.status(201).json({
      taskId,
      transactionsCreated: results.length,
      transactions: results,
      message: `${results.length} материалов списано на задачу ${taskId}`,
    });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/inventory/transactions ───────────────────────────────

router.get('/api/inventory/transactions', async (req, res, next) => {
  try {
    const params = ListInventoryTransactionsQuerySchema.parse(req.query);
    logger.info('📦 tx:list', { warehouseId: params.warehouseId, itemId: params.itemId, limit: params.limit });

    let q: admin.firestore.Query = db.collection('inventory_transactions');

    // ── RLS: worker/driver see only own transactions ──
    const rlsRole = req.effectiveRole || 'admin';
    const rlsUserId = req.effectiveUserId || req.agentUserId;
    if (rlsRole === 'worker' || rlsRole === 'driver') {
      q = q.where('performedBy', '==', rlsUserId);
    } else if (rlsRole === 'foreman') {
      const teamUids = req.effectiveTeamMemberUids || [];
      const allUids = Array.from(new Set([rlsUserId!, ...teamUids]));
      if (allUids.length <= 30) {
        q = q.where('performedBy', 'in', allUids);
      } else {
        q = q.where('performedBy', '==', rlsUserId);
      }
    }

    if (params.warehouseId) q = q.where('warehouseId', '==', params.warehouseId);
    if (params.itemId) q = q.where('itemId', '==', params.itemId);
    if (params.type) q = q.where('type', '==', params.type);

    q = q.orderBy('createdAt', 'desc');

    const countSnap = await q.count().get();
    const total = countSnap.data().count;

    if (params.offset > 0) q = q.offset(params.offset);
    q = q.limit(params.limit);

    const snap = await q.get();
    const transactions = snap.docs.map(d => {
      const tx = d.data();
      return {
        id: d.id,
        warehouseId: tx.warehouseId,
        itemId: tx.itemId,
        itemName: tx.itemName,
        type: tx.type,
        quantity: tx.quantity,
        quantityBefore: tx.quantityBefore,
        quantityAfter: tx.quantityAfter,
        toWarehouseId: tx.toWarehouseId || null,
        relatedTaskId: tx.relatedTaskId || null,
        notes: tx.notes || null,
        performedBy: tx.performedBy || null,
        createdAt: tx.createdAt?.toDate?.()?.toISOString() || null,
      };
    });

    res.json({ transactions, total, hasMore: params.offset + transactions.length < total });
  } catch (e) {
    next(e);
  }
});

// ═══════════════════════════════════════════════════════════════════
//  NORMS (material consumption standards)
// ═══════════════════════════════════════════════════════════════════

// ─── POST /api/inventory/norms ────────────────────────────────────

router.post('/api/inventory/norms', async (req, res, next) => {
  try {
    const data = CreateNormSchema.parse(req.body);
    logger.info('📋 norm:create', { id: data.id, name: data.name });

    // Check if norm already exists
    const existingDoc = await db.collection('inventory_norms').doc(data.id).get();
    if (existingDoc.exists) {
      res.status(409).json({ error: `Норматив "${data.id}" уже существует` });
      return;
    }

    const auditCtx = extractAuditContext(req);
    await db.collection('inventory_norms').doc(data.id).set({
      name: data.name,
      warehouseId: data.warehouseId,
      items: data.items,
      createdBy: auditCtx.performedBy,
      createdBySource: auditCtx.source,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    logger.info('📋 norm:created', { id: data.id });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'inventory_norm_created',
      endpoint: '/api/inventory/norms',
      metadata: { normId: data.id, name: data.name, itemCount: data.items.length },
    });

    await logAudit(AuditHelpers.create('inventory_norm', data.id, { name: data.name, warehouseId: data.warehouseId, itemCount: data.items.length }, auditCtx.performedBy, auditCtx.source as any));

    res.status(201).json({ normId: data.id, name: data.name, itemCount: data.items.length });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/inventory/norms ─────────────────────────────────────

router.get('/api/inventory/norms', async (req, res, next) => {
  try {
    logger.info('📋 norm:list');
    const snap = await db.collection('inventory_norms').get();
    const norms = snap.docs.map(d => ({
      id: d.id,
      ...d.data(),
      createdAt: d.data().createdAt?.toDate?.()?.toISOString() || null,
      updatedAt: d.data().updatedAt?.toDate?.()?.toISOString() || null,
    }));
    res.json({ norms, count: norms.length });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/inventory/norms/:id ─────────────────────────────────

router.get('/api/inventory/norms/:id', async (req, res, next) => {
  try {
    const normId = req.params.id;
    logger.info('📋 norm:details', { normId });

    const doc = await db.collection('inventory_norms').doc(normId).get();
    if (!doc.exists) {
      res.status(404).json({ error: 'Норматив не найден' });
      return;
    }

    const data = doc.data()!;
    res.json({
      id: doc.id,
      ...data,
      createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      updatedAt: data.updatedAt?.toDate?.()?.toISOString() || null,
    });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/inventory/write-off-by-norm ────────────────────────

router.post('/api/inventory/write-off-by-norm', async (req, res, next) => {
  try {
    const data = WriteOffByNormSchema.parse(req.body);
    logger.info('📋 norm:write-off', { normId: data.normId, taskId: data.taskId, quantity: data.quantity });

    // Get norm
    const normDoc = await db.collection('inventory_norms').doc(data.normId).get();
    if (!normDoc.exists) {
      res.status(404).json({ error: `Норматив "${data.normId}" не найден` });
      return;
    }

    const norm = normDoc.data()!;

    // Verify task exists
    const taskRef = db.collection('gtd_tasks').doc(data.taskId);
    const taskDoc = await taskRef.get();
    if (!taskDoc.exists) {
      res.status(404).json({ error: 'Задача не найдена' });
      return;
    }

    const auditCtx = extractAuditContext(req);
    const results: Array<{
      itemId: string; itemName: string; transactionId: string;
      quantityWrittenOff: number; quantityBefore: number; quantityAfter: number;
    }> = [];
    const materialsUsed: Array<{ itemId: string; itemName: string; quantity: number; transactionId: string }> = [];

    for (const normItem of norm.items) {
      const writeOffQty = normItem.quantity * data.quantity;

      const itemRef = db.collection('inventory_items').doc(normItem.itemId);
      const itemDoc = await itemRef.get();
      if (!itemDoc.exists) {
        res.status(404).json({ error: `Товар ${normItem.itemId} из норматива не найден` });
        return;
      }

      const item = itemDoc.data()!;
      const quantityBefore = item.quantity || 0;
      const quantityAfter = quantityBefore - writeOffQty;

      if (quantityAfter < 0) {
        res.status(400).json({
          error: `Недостаточно ${item.name}: на складе ${quantityBefore}, нужно ${writeOffQty} (${normItem.quantity} x ${data.quantity})`,
        });
        return;
      }

      // Create transaction
      const txRef = await db.collection('inventory_transactions').add({
        warehouseId: norm.warehouseId,
        itemId: normItem.itemId,
        itemName: item.name,
        type: 'out',
        quantity: writeOffQty,
        quantityBefore,
        quantityAfter,
        toWarehouseId: null,
        relatedTaskId: data.taskId,
        normId: data.normId,
        notes: data.notes || `Списание по нормативу "${norm.name}" x${data.quantity}`,
        performedBy: auditCtx.performedBy,
        performedBySource: auditCtx.source,
        createdAt: FieldValue.serverTimestamp(),
      });

      // Update item quantity
      await itemRef.update({
        quantity: quantityAfter,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: auditCtx.performedBy,
        updatedBySource: auditCtx.source,
      });

      results.push({
        itemId: normItem.itemId, itemName: item.name, transactionId: txRef.id,
        quantityWrittenOff: writeOffQty, quantityBefore, quantityAfter,
      });
      materialsUsed.push({ itemId: normItem.itemId, itemName: item.name, quantity: writeOffQty, transactionId: txRef.id });

      await logAudit(AuditHelpers.create('inventory_transaction', txRef.id, {
        itemId: normItem.itemId, type: 'out', quantity: writeOffQty,
        quantityBefore, quantityAfter, warehouseId: norm.warehouseId,
        relatedTaskId: data.taskId, normId: data.normId,
      }, auditCtx.performedBy, auditCtx.source as any));
    }

    // Update task.materialsUsed
    await taskRef.update({
      materialsUsed: FieldValue.arrayUnion(...materialsUsed),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'inventory_write_off_by_norm',
      endpoint: '/api/inventory/write-off-by-norm',
      metadata: { normId: data.normId, taskId: data.taskId, stationQty: data.quantity, transactionCount: results.length },
    });

    res.status(201).json({
      normId: data.normId,
      taskId: data.taskId,
      stationsQuantity: data.quantity,
      transactionsCreated: results.length,
      transactions: results,
      message: `Списано по нормативу "${norm.name}" x${data.quantity} на задачу ${data.taskId}`,
    });
  } catch (e) {
    next(e);
  }
});

// ═══════════════════════════════════════════════════════════════════
//  V3 ENDPOINTS (unified journal-based system, spec WAREHOUSE_SPEC_V3)
// ═══════════════════════════════════════════════════════════════════

/**
 * POST /api/inventory/v3/transactions
 *
 * Authoritative write path for the unified catalog (inventory_catalog +
 * inventory_transactions_v2). Everything routes through InventoryService
 * so stock cache and journal never drift.
 */
router.post('/api/inventory/v3/transactions', async (req, res, next) => {
  try {
    const auditCtx = extractAuditContext(req);
    const input = {
      catalogItemId: String(req.body.catalogItemId ?? ''),
      type: req.body.type,
      qty: Number(req.body.qty),
      fromLocation: req.body.fromLocation,
      toLocation: req.body.toLocation,
      unitPrice: req.body.unitPrice,
      performedBy: auditCtx.performedBy,
      performedByName: req.body.performedByName,
      relatedTaskId: req.body.relatedTaskId,
      relatedTaskTitle: req.body.relatedTaskTitle,
      relatedClientId: req.body.relatedClientId,
      relatedClientName: req.body.relatedClientName,
      relatedCostId: req.body.relatedCostId,
      relatedNormId: req.body.relatedNormId,
      transactionGroupId: req.body.transactionGroupId,
      transferRequestId: req.body.transferRequestId,
      idempotencyKey: req.body.idempotencyKey,
      note: req.body.note,
      source: (auditCtx.source as 'api' | 'bot' | 'ui' | 'cron') ?? 'api',
    };

    logger.info('📦 v3tx:create', {
      catalogItemId: input.catalogItemId,
      type: input.type,
      qty: input.qty,
    });

    const result = await inventoryService.commitTransaction(input);

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'inventory_v3_transaction_created',
      endpoint: '/api/inventory/v3/transactions',
      metadata: {
        transactionId: result.transactionId,
        catalogItemId: result.catalogItemId,
        type: result.type,
        qty: result.qty,
        stockBefore: result.stockBefore,
        stockAfter: result.stockAfter,
        deduplicated: result.deduplicated ?? false,
      },
    });

    await logAudit(
      AuditHelpers.create(
        'inventory_transaction_v2',
        result.transactionId,
        {
          catalogItemId: result.catalogItemId,
          type: result.type,
          qty: result.qty,
          stockBefore: result.stockBefore,
          stockAfter: result.stockAfter,
        },
        auditCtx.performedBy,
        auditCtx.source as never,
      ),
    );

    res.status(result.deduplicated ? 200 : 201).json(result);
  } catch (e) {
    if (e instanceof CatalogItemNotFoundError) {
      res.status(404).json({ error: e.message });
      return;
    }
    if (e instanceof InsufficientStockError) {
      res.status(400).json({
        error: e.message,
        available: e.available,
        requested: e.requested,
        location: e.location,
      });
      return;
    }
    if (e instanceof InventoryValidationError) {
      res.status(400).json({ error: e.message });
      return;
    }
    next(e);
  }
});

/**
 * GET /api/inventory/v3/barcode/:code
 *
 * Barcode/SKU lookup against inventory_catalog. Used by the Telegram bot's
 * future /scan command (spec §8.3) and by any UI offering quick-scan flow.
 * Falls back to V1 `inventory_items.barcode` so the endpoint works in the
 * mixed-state window before migration runs.
 *
 * Returns the matching catalog item + current stock snapshot (RLS-aware).
 */
router.get('/api/inventory/v3/barcode/:code', async (req, res, next) => {
  try {
    const code = req.params.code;
    if (!code) {
      res.status(400).json({ error: 'barcode code required' });
      return;
    }

    logger.info('🔍 v3:barcode', { code });

    // V3 catalog (preferred)
    const v3Snap = await db
      .collection('inventory_catalog')
      .where('sku', '==', code)
      .limit(1)
      .get();

    if (!v3Snap.empty) {
      const doc = v3Snap.docs[0];
      const data = doc.data();
      res.json({
        source: 'v3',
        item: {
          id: doc.id,
          name: data.name,
          sku: data.sku ?? null,
          category: data.category,
          unit: data.unit,
          totalStock: data.totalStock ?? 0,
          stockByLocation: data.stockByLocation ?? {},
          minStock: data.minStock ?? 0,
          isTrackable: data.isTrackable ?? false,
        },
      });
      return;
    }

    // V1 fallback
    const v1Snap = await db
      .collection('inventory_items')
      .where('barcode', '==', code)
      .limit(1)
      .get();

    if (!v1Snap.empty) {
      const doc = v1Snap.docs[0];
      const data = doc.data();
      res.json({
        source: 'v1',
        item: {
          id: doc.id,
          name: data.name,
          sku: data.barcode ?? null,
          category: data.category,
          unit: data.unit,
          warehouseId: data.warehouseId,
          quantity: data.quantity ?? 0,
          minStock: data.minStock ?? null,
        },
      });
      return;
    }

    res.status(404).json({ error: 'No item matches this barcode', code });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/inventory/v3/recalculate/:catalogItemId
 *
 * Admin repair tool — replays inventory_transactions_v2 journal to rebuild
 * inventory_catalog cache for one item. Expensive, don't run in hot paths.
 */
router.post('/api/inventory/v3/recalculate/:catalogItemId', async (req, res, next) => {
  try {
    if (req.effectiveRole && req.effectiveRole !== 'admin') {
      res.status(403).json({ error: 'recalculate requires admin role' });
      return;
    }

    const { catalogItemId } = req.params;
    logger.info('🔄 v3:recalculate', { catalogItemId });

    const result = await inventoryService.recalculateStock(catalogItemId);

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'inventory_v3_recalculated',
      endpoint: `/api/inventory/v3/recalculate/${catalogItemId}`,
      metadata: {
        catalogItemId,
        totalStock: result.totalStock,
        transactionsReplayed: result.transactionsReplayed,
      },
    });

    res.json(result);
  } catch (e) {
    next(e);
  }
});

export default router;
