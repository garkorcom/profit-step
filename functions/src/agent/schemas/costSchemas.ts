import { z } from 'zod';

export const CreateCostSchema = z.object({
  clientId: z.string().min(1),
  clientName: z.string().min(1),
  category: z.enum(['materials', 'tools', 'reimbursement', 'fuel', 'housing', 'food', 'permit', 'other']),
  amount: z.number().positive().max(1_000_000),
  description: z.string().optional(),
  idempotencyKey: z.string().min(1).optional(),
  taskId: z.string().optional(),
  siteId: z.string().optional(),
});

export const ListCostsQuerySchema = z.object({
  clientId: z.string().optional(),
  clientName: z.string().min(2).optional(),
  category: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  sortBy: z.enum(['createdAt', 'amount', 'category']).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});
