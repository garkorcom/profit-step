/**
 * Inventory Routes — warehouse/stock management
 * POST /api/inventory/items — create item
 * GET /api/inventory/items — list items
 * PATCH /api/inventory/items/:id — update item
 * POST /api/inventory/movements — record movement
 * GET /api/inventory/movements — movement history
 */

import * as express from 'express';
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import {
  CreateInventoryItemSchema,
  UpdateInventoryItemSchema,
  CreateMovementSchema,
} from '../schemas/inventorySchemas';
import { logAgentActivity } from '../agentHelpers';

const router = express.Router();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const logger = functions.logger;

// ─── POST /api/inventory/items ──────────────────────────────────────

router.post('/api/inventory/items', async (req, res, next) => {
  try {
    const data = CreateInventoryItemSchema.parse(req.body);
    logger.info('📦 inventory:create', { name: data.name, quantity: data.quantity });

    const docRef = db.collection('inventory_items').doc();
    await docRef.set({
      ...data,
      companyId: req.agentUserId,
      currentQuantity: data.quantity,
      totalIn: data.quantity,
      totalOut: 0,
      source: 'openclaw',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'inventory_item_created',
      endpoint: '/api/inventory/items',
      metadata: { itemId: docRef.id, name: data.name, quantity: data.quantity },
    });

    res.status(201).json({ itemId: docRef.id, name: data.name, quantity: data.quantity });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/inventory/items ───────────────────────────────────────

router.get('/api/inventory/items', async (req, res, next) => {
  try {
    const { clientId, projectId, category, location } = req.query;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);

    let query: admin.firestore.Query = db.collection('inventory_items');

    if (clientId) query = query.where('clientId', '==', clientId);
    if (projectId) query = query.where('projectId', '==', projectId);
    if (category) query = query.where('category', '==', category);
    if (location) query = query.where('location', '==', location);

    const snap = await query.limit(limit).get();

    const items = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        name: data.name,
        brand: data.brand || null,
        sku: data.sku || null,
        category: data.category,
        currentQuantity: data.currentQuantity,
        unit: data.unit,
        unitLength: data.unitLength || null,
        location: data.location || null,
        locationDescription: data.locationDescription || null,
        clientId: data.clientId || null,
        projectId: data.projectId || null,
        notes: data.notes || null,
        totalIn: data.totalIn || 0,
        totalOut: data.totalOut || 0,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      };
    });

    res.json({ items, count: items.length });
  } catch (e) {
    next(e);
  }
});

// ─── PATCH /api/inventory/items/:id ─────────────────────────────────

router.patch('/api/inventory/items/:id', async (req, res, next) => {
  try {
    const data = UpdateInventoryItemSchema.parse(req.body);
    const itemId = req.params.id;
    logger.info('📦 inventory:update', { itemId });

    const docRef = db.collection('inventory_items').doc(itemId);
    const doc = await docRef.get();
    if (!doc.exists) {
      res.status(404).json({ error: 'Товар не найден' });
      return;
    }

    const updatePayload: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (data.name !== undefined) updatePayload.name = data.name;
    if (data.quantity !== undefined) updatePayload.currentQuantity = data.quantity;
    if (data.location !== undefined) updatePayload.location = data.location;
    if (data.locationDescription !== undefined) updatePayload.locationDescription = data.locationDescription;
    if (data.notes !== undefined) updatePayload.notes = data.notes;
    if (data.category !== undefined) updatePayload.category = data.category;

    await docRef.update(updatePayload);
    res.json({ itemId, updated: true });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/inventory/movements ──────────────────────────────────

router.post('/api/inventory/movements', async (req, res, next) => {
  try {
    const data = CreateMovementSchema.parse(req.body);
    logger.info('📦 inventory:movement', { itemId: data.itemId, type: data.type, quantity: data.quantity });

    // Get item
    const itemRef = db.collection('inventory_items').doc(data.itemId);
    const itemDoc = await itemRef.get();
    if (!itemDoc.exists) {
      res.status(404).json({ error: 'Товар не найден' });
      return;
    }

    const item = itemDoc.data()!;
    let newQuantity = item.currentQuantity || 0;

    switch (data.type) {
      case 'in':
        newQuantity += data.quantity;
        break;
      case 'out':
      case 'writeoff':
        newQuantity = Math.max(0, newQuantity - data.quantity);
        break;
      case 'transfer':
        // quantity stays same, location changes
        break;
      case 'adjustment':
        newQuantity = data.quantity; // set exact
        break;
    }

    // Record movement
    const movRef = db.collection('inventory_movements').doc();
    await movRef.set({
      itemId: data.itemId,
      itemName: item.name,
      type: data.type,
      quantity: data.quantity,
      quantityBefore: item.currentQuantity || 0,
      quantityAfter: newQuantity,
      fromLocation: data.fromLocation || item.location || null,
      toLocation: data.toLocation || null,
      reason: data.reason || null,
      taskId: data.taskId || null,
      projectId: data.projectId || item.projectId || null,
      userId: req.agentUserId,
      source: 'openclaw',
      createdAt: FieldValue.serverTimestamp(),
    });

    // Update item
    const itemUpdate: Record<string, unknown> = {
      currentQuantity: newQuantity,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (data.type === 'in') itemUpdate.totalIn = FieldValue.increment(data.quantity);
    if (data.type === 'out' || data.type === 'writeoff') itemUpdate.totalOut = FieldValue.increment(data.quantity);
    if (data.toLocation) itemUpdate.location = data.toLocation;

    await itemRef.update(itemUpdate);

    res.status(201).json({
      movementId: movRef.id,
      itemId: data.itemId,
      type: data.type,
      quantityBefore: item.currentQuantity || 0,
      quantityAfter: newQuantity,
      message: `${data.type}: ${item.name} ${data.quantity} ${item.unit}`,
    });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/inventory/movements ───────────────────────────────────

router.get('/api/inventory/movements', async (req, res, next) => {
  try {
    const { itemId, type, projectId } = req.query;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    let query: admin.firestore.Query = db.collection('inventory_movements');

    if (itemId) query = query.where('itemId', '==', itemId);
    if (type) query = query.where('type', '==', type);
    if (projectId) query = query.where('projectId', '==', projectId);

    const snap = await query.limit(limit).get();

    const movements = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        itemId: data.itemId,
        itemName: data.itemName,
        type: data.type,
        quantity: data.quantity,
        quantityBefore: data.quantityBefore,
        quantityAfter: data.quantityAfter,
        fromLocation: data.fromLocation || null,
        toLocation: data.toLocation || null,
        reason: data.reason || null,
        taskId: data.taskId || null,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      };
    });

    res.json({ movements, count: movements.length });
  } catch (e) {
    next(e);
  }
});

export default router;
