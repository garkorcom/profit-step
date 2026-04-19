/**
 * Zod schemas for wh_items.
 *
 * These are the runtime validators. Types in warehouse/core/types.ts are
 * the compile-time contract; schemas here enforce shape at API boundaries.
 */

import { z } from 'zod';

export const PurchaseUOMSchema = z
  .object({
    uom: z.string().min(1),
    factor: z.number().positive(),
    isDefault: z.boolean(),
  })
  .strict();

export const CreateWhItemSchema = z
  .object({
    sku: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Z0-9][A-Z0-9_-]*$/, 'SKU must be uppercase alphanumeric with dashes/underscores'),
    name: z.string().min(1).max(200),
    category: z.string().min(1),
    baseUOM: z.string().min(1).max(16),
    purchaseUOMs: z.array(PurchaseUOMSchema).min(1),
    allowedIssueUOMs: z.array(z.string().min(1)).min(1),
    lastPurchasePrice: z.number().nonnegative().default(0),
    averageCost: z.number().nonnegative().default(0),
    defaultPurchasePrice: z.number().nonnegative().optional(),
    minStock: z.number().nonnegative().optional(),
    reorderPoint: z.number().nonnegative().optional(),
    allowNegativeStock: z.boolean().optional(),
    isTrackable: z.boolean().default(false),
    requiresSerialNumber: z.boolean().optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict()
  .refine((data) => data.purchaseUOMs.filter((p) => p.isDefault).length === 1, {
    message: 'Exactly one purchaseUOM must have isDefault: true',
    path: ['purchaseUOMs'],
  })
  .refine((data) => data.purchaseUOMs.some((p) => p.uom === data.baseUOM) || data.allowedIssueUOMs.includes(data.baseUOM), {
    message: 'baseUOM must appear in purchaseUOMs or allowedIssueUOMs',
    path: ['baseUOM'],
  });

export type CreateWhItemInput = z.infer<typeof CreateWhItemSchema>;

export const UpdateWhItemSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    category: z.string().min(1).optional(),
    minStock: z.number().nonnegative().optional(),
    reorderPoint: z.number().nonnegative().optional(),
    allowNegativeStock: z.boolean().optional(),
    isTrackable: z.boolean().optional(),
    notes: z.string().max(2000).optional(),
    // Intentionally NOT permitting mutation of: baseUOM, purchaseUOMs,
    // stockByLocation (there is no such field now — enforced at posting layer),
    // lastPurchasePrice, averageCost (mutated only by postDocument).
  })
  .strict();
