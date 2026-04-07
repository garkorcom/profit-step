/**
 * Inventory Routes — warehouse & stock management (13 endpoints)
 *
 * Warehouses:
 *   POST   /api/inventory/warehouses      — create warehouse
 *   GET    /api/inventory/warehouses      — list warehouses
 *   GET    /api/inventory/warehouses/:id  — warehouse details + items
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
  CreateInventoryItemSchema,
  UpdateInventoryItemSchema,
  ListInventoryItemsQuerySchema,
  CreateInventoryTransactionSchema,
  ListInventoryTransactionsQuerySchema,
  CreateNormSchema,
  WriteOffByNormSchema,
} from '../schemas';

const router = Router();

// ═══════════════════════════════════════════════════════════════════
//  WAREHOUSES
// ═══════════════════════════════════════════════════════════════════

// ─── POST /api/inventory/warehouses ────────────────────────────────

router.post('/api/inventory/warehouses', async (req, res, next) => {
  try {
    const data = CreateWarehouseSchema.parse(req.body);
    logger.info('🏭 warehouse:create', { name: data.name });

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
      name: data.name,
      clientId: data.clientId || null,
      projectId: data.projectId || null,
      address: data.address || '',
      description: data.description || '',
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

    logger.info('🏭 warehouse:created', { warehouseId: docRef.id });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'warehouse_created',
      endpoint: '/api/inventory/warehouses',
      metadata: { warehouseId: docRef.id, name: data.name, clientId: data.clientId },
    });

    await logAudit(AuditHelpers.create('warehouse', docRef.id, { name: data.name, clientId: data.clientId }, auditCtx.performedBy, auditCtx.source as any));

    res.status(201).json({ warehouseId: docRef.id, name: data.name });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/inventory/warehouses ─────────────────────────────────

router.get('/api/inventory/warehouses', async (req, res, next) => {
  try {
    const { clientId, projectId } = req.query;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    logger.info('🏭 warehouse:list', { clientId, limit });

    let q: admin.firestore.Query = db.collection('warehouses');
    if (clientId) q = q.where('clientId', '==', clientId);
    if (projectId) q = q.where('projectId', '==', projectId);
    q = q.orderBy('createdAt', 'desc').limit(limit);

    const snap = await q.get();
    const warehouses = snap.docs.map(d => {
      const w = d.data();
      return {
        id: d.id,
        name: w.name,
        clientId: w.clientId || null,
        projectId: w.projectId || null,
        address: w.address || null,
        description: w.description || null,
        createdAt: w.createdAt?.toDate?.()?.toISOString() || null,
        updatedAt: w.updatedAt?.toDate?.()?.toISOString() || null,
      };
    });

    res.json({ warehouses, count: warehouses.length });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/inventory/warehouses/:id ─────────────────────────────

router.get('/api/inventory/warehouses/:id', async (req, res, next) => {
  try {
    const warehouseId = req.params.id;
    logger.info('🏭 warehouse:details', { warehouseId });

    const whDoc = await db.collection('warehouses').doc(warehouseId).get();
    if (!whDoc.exists) {
      res.status(404).json({ error: 'Склад не найден' });
      return;
    }

    const warehouse = { id: whDoc.id, ...whDoc.data() };

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

export default router;
