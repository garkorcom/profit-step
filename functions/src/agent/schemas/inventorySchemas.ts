import { z } from 'zod';

// ─── Warehouse Schemas ─────────────────────────────────────────────

export const CreateWarehouseSchema = z.object({
  name: z.string().min(1),
  clientId: z.string().optional(),
  projectId: z.string().optional(),
  address: z.string().optional(),
  description: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

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
