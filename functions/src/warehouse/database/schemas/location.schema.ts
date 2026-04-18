/**
 * Zod schemas for wh_locations.
 */

import { z } from 'zod';

export const LocationTypeSchema = z.enum(['warehouse', 'van', 'site', 'quarantine']);

export const NegativeStockPolicySchema = z.enum(['blocked', 'allowed', 'allowed_with_alert']);

export const CreateWhLocationSchema = z
  .object({
    name: z.string().min(1).max(100),
    locationType: LocationTypeSchema,
    ownerEmployeeId: z.string().min(1).optional(),
    licensePlate: z.string().min(1).max(32).optional(),
    relatedClientId: z.string().min(1).optional(),
    relatedProjectId: z.string().min(1).optional(),
    address: z.string().max(500).optional(),
    negativeStockOverride: NegativeStockPolicySchema.optional(),
    twoPhaseTransferEnabled: z.boolean().default(false),
  })
  .strict()
  .refine(
    (data) => {
      if (data.locationType === 'van') return !!data.ownerEmployeeId;
      return true;
    },
    { message: 'Van locations require ownerEmployeeId', path: ['ownerEmployeeId'] },
  );

export type CreateWhLocationInput = z.infer<typeof CreateWhLocationSchema>;

export const UpdateWhLocationSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    ownerEmployeeId: z.string().min(1).optional(),
    licensePlate: z.string().min(1).max(32).optional(),
    address: z.string().max(500).optional(),
    negativeStockOverride: NegativeStockPolicySchema.optional(),
    twoPhaseTransferEnabled: z.boolean().optional(),
  })
  .strict();
