import { z } from 'zod';

// ─── Warehouse Schemas ─────────────────────────────────────────────

export const WAREHOUSE_TYPES = ['physical', 'vehicle'] as const;
export type WarehouseType = (typeof WAREHOUSE_TYPES)[number];

/**
 * Warehouse create schema.
 *
 * Two flavors:
 *   - 'physical' (default) — fixed location, optional clientId/projectId
 *     binding. This is the legacy shape and matches all existing
 *     Firestore documents in the `warehouses` collection.
 *   - 'vehicle' — mobile (truck/van/transit). Requires licensePlate.
 *
 * All vehicle-specific fields (type, location, licensePlate) are
 * additive — existing physical warehouse creates without `type`
 * default to 'physical' and continue to work as before.
 */
export const CreateWarehouseSchema = z.object({
  // Existing fields (unchanged behavior)
  name: z.string().min(1),
  clientId: z.string().optional(),
  projectId: z.string().optional(),
  address: z.string().optional(),
  description: z.string().optional(),
  idempotencyKey: z.string().optional(),
  // New additive fields for vehicle/fleet support
  type: z.enum(WAREHOUSE_TYPES).default('physical'),
  location: z.string().optional(),
  licensePlate: z.string().optional(),
}).refine(
  data => data.type !== 'vehicle' || (data.licensePlate != null && data.licensePlate.length > 0),
  { message: 'licensePlate is required when type is "vehicle"', path: ['licensePlate'] },
);

/**
 * Warehouse update schema — partial update, at least one field required.
 *
 * Note: vehicle refine is NOT applied here because partial updates
 * may legitimately change type and licensePlate in separate calls.
 * The PATCH /api/inventory/warehouses/:id route applies the
 * "vehicle => licensePlate" check server-side after merging with
 * the existing document.
 */
export const UpdateWarehouseSchema = z.object({
  name: z.string().min(1).optional(),
  clientId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  address: z.string().optional(),
  description: z.string().optional(),
  type: z.enum(WAREHOUSE_TYPES).optional(),
  location: z.string().optional(),
  licensePlate: z.string().optional(),
}).refine(
  data => Object.keys(data).length > 0,
  { message: 'At least one field required' },
);

// ─── Inventory Item Schemas ────────────────────────────────────────

export const INVENTORY_CATEGORIES = [
  'electrical', 'plumbing', 'audio_video', 'hardware', 'other',
] as const;

export const INVENTORY_UNITS = [
  'pcs', 'pack', 'roll', 'ft', 'box', 'spool', 'm', 'kg', 'l',
] as const;

export const CreateInventoryItemSchema = z.object({
  warehouseId: z.string().min(1),
  name: z.string().min(1),
  quantity: z.number().min(0),
  unit: z.enum(INVENTORY_UNITS).default('pcs'),
  category: z.enum(INVENTORY_CATEGORIES).default('other'),
  minStock: z.number().min(0).optional(),
  barcode: z.string().optional(),
  photoUrl: z.string().optional(),
  notes: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

export const UpdateInventoryItemSchema = z.object({
  name: z.string().min(1).optional(),
  quantity: z.number().min(0).optional(),
  unit: z.enum(INVENTORY_UNITS).optional(),
  category: z.enum(INVENTORY_CATEGORIES).optional(),
  minStock: z.number().min(0).optional(),
  barcode: z.string().optional(),
  photoUrl: z.string().optional(),
  notes: z.string().optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field required' });

export const ListInventoryItemsQuerySchema = z.object({
  warehouseId: z.string().optional(),
  category: z.string().optional(),
  limit: z.coerce.number().min(1).max(500).default(100),
  offset: z.coerce.number().min(0).default(0),
});

// ─── Transaction Schemas ───────────────────────────────────────────

export const CreateInventoryTransactionSchema = z.object({
  warehouseId: z.string().min(1),
  itemId: z.string().min(1),
  type: z.enum(['in', 'out', 'transfer']),
  quantity: z.number().min(0),
  toWarehouseId: z.string().optional(),
  relatedTaskId: z.string().optional(),
  notes: z.string().optional(),
});

export const ListInventoryTransactionsQuerySchema = z.object({
  warehouseId: z.string().optional(),
  itemId: z.string().optional(),
  type: z.enum(['in', 'out', 'transfer']).optional(),
  limit: z.coerce.number().min(1).max(500).default(50),
  offset: z.coerce.number().min(0).default(0),
});

// ─── Norm Schemas ─────────────────────────────────────────────────

export const NormItemSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.enum(INVENTORY_UNITS).default('pcs'),
});

export const CreateNormSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  warehouseId: z.string().min(1),
  items: z.array(NormItemSchema).min(1),
});

export const WriteOffByNormSchema = z.object({
  normId: z.string().min(1),
  taskId: z.string().min(1),
  quantity: z.number().positive(),
  notes: z.string().optional(),
});
