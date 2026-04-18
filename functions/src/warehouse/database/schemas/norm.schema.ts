/**
 * Zod schemas for wh_norms.
 */

import { z } from 'zod';

export const NormItemSchema = z
  .object({
    itemId: z.string().min(1),
    qtyPerUnit: z.number().positive(),
    note: z.string().max(500).optional(),
  })
  .strict();

export const CreateWhNormSchema = z
  .object({
    taskType: z
      .string()
      .min(1)
      .regex(/^[a-z][a-z0-9_]*$/, 'taskType must be snake_case'),
    name: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    items: z.array(NormItemSchema).min(1),
    estimatedLaborHours: z.number().positive().optional(),
  })
  .strict();

export type CreateWhNormInput = z.infer<typeof CreateWhNormSchema>;

export const UpdateWhNormSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).optional(),
    items: z.array(NormItemSchema).min(1).optional(),
    estimatedLaborHours: z.number().positive().optional(),
  })
  .strict();
