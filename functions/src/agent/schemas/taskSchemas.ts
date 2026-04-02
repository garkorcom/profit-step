import { z } from 'zod';

export const CreateGTDTaskSchema = z.object({
  title: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
  clientId: z.string().optional(),
  clientName: z.string().optional(),
  assigneeId: z.string().optional(),
  assigneeName: z.string().optional(),
  priority: z.enum(['high', 'medium', 'low', 'none']).default('none'),
  status: z.enum(['inbox', 'next_action', 'waiting', 'projects', 'estimate', 'someday']).default('inbox'),
  description: z.string().optional(),
  dueDate: z.string().optional(),
  estimatedDurationMinutes: z.number().optional(),
  taskType: z.string().optional(),
  siteId: z.string().optional(),
  projectId: z.string().optional(),
});

export const ListTasksQuerySchema = z.object({
  clientId: z.string().optional(),
  clientName: z.string().min(2).optional(),
  status: z.string().optional(),
  assigneeId: z.string().optional(),
  priority: z.enum(['high', 'medium', 'low', 'none']).optional(),
  dueBefore: z.string().optional(),
  dueAfter: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  sortBy: z.enum(['createdAt', 'dueDate', 'priority', 'updatedAt']).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export const UpdateTaskSchema = z.object({
  status: z.enum([
    'inbox', 'next_action', 'waiting', 'projects', 'estimate', 'someday', 'completed', 'archived',
  ]).optional(),
  priority: z.enum(['high', 'medium', 'low', 'none']).optional(),
  dueDate: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  assigneeName: z.string().nullable().optional(),
  description: z.string().optional(),
  title: z.string().min(1).optional(),
  estimatedDurationMinutes: z.number().positive().optional(),
  parentTaskId: z.string().optional(),
  isSubtask: z.boolean().optional(),
  budgetAmount: z.number().optional(),
  paidAmount: z.number().optional(),
  budgetCategory: z.string().optional(),
  progressPercentage: z.number().min(0).max(100).optional(),
  payments: z.array(z.object({
    id: z.string(),
    amount: z.number().positive(),
    date: z.any(),
    note: z.string().optional(),
    method: z.enum(['check', 'wire', 'cash', 'card']).optional(),
    createdBy: z.string(),
    createdAt: z.any(),
  })).optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});

export const BatchUpdateTasksSchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1).max(50),
  update: z.object({
    status: z.enum(['inbox', 'next_action', 'waiting', 'projects', 'estimate', 'someday', 'completed', 'archived']).optional(),
    priority: z.enum(['high', 'medium', 'low', 'none']).optional(),
    assigneeId: z.string().optional(),
    assigneeName: z.string().optional(),
  }).refine(data => Object.keys(data).length > 0, {
    message: 'At least one update field required',
  }),
});
