import { z } from 'zod';

export const CreateInventoryItemSchema = z.object({
  name: z.string().min(1),
  brand: z.string().optional(),
  sku: z.string().optional(),
  category: z.enum(['cable_management', 'fasteners', 'tape', 'cleaning', 'audio', 'electrical', 'tools', 'enclosures', 'other']).default('other'),
  quantity: z.number().min(0),
  unit: z.enum(['pcs', 'pack', 'roll', 'ft', 'box', 'spool']).default('pcs'),
  unitLength: z.string().optional(), // e.g. "25ft"
  location: z.string().optional(),
  locationDescription: z.string().optional(),
  clientId: z.string().optional(),
  projectId: z.string().optional(),
  notes: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

export const UpdateInventoryItemSchema = z.object({
  name: z.string().min(1).optional(),
  quantity: z.number().min(0).optional(),
  location: z.string().optional(),
  locationDescription: z.string().optional(),
  notes: z.string().optional(),
  category: z.string().optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field required' });

export const CreateMovementSchema = z.object({
  itemId: z.string().min(1),
  type: z.enum(['in', 'out', 'transfer', 'writeoff', 'adjustment']),
  quantity: z.number().min(0),
  fromLocation: z.string().optional(),
  toLocation: z.string().optional(),
  reason: z.string().optional(),
  taskId: z.string().optional(),
  projectId: z.string().optional(),
});
