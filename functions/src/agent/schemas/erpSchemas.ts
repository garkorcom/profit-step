import { z } from 'zod';

export const ChangeOrderItemSchema = z.object({
  id: z.string(),
  catalogItemId: z.string().optional(),
  description: z.string().min(1),
  type: z.enum(['material', 'labor', 'subcontract', 'equipment', 'other']),
  quantity: z.number().positive(),
  unit: z.string().min(1),
  unitCostPrice: z.number().nonnegative(),
  totalCost: z.number().nonnegative(),
  unitClientPrice: z.number().nonnegative(),
  totalClientPrice: z.number().nonnegative(),
  markupPercent: z.number().min(0).max(500),
});

export const CreateChangeOrderSchema = z.object({
  projectId: z.string().min(1),
  projectName: z.string().min(1),
  clientId: z.string().min(1),
  clientName: z.string().min(1),
  parentEstimateId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  items: z.array(ChangeOrderItemSchema).min(1),
  defaultMarkupPercent: z.number().min(0).max(500).default(20),
  idempotencyKey: z.string().optional(),
});

export const UpdateChangeOrderSchema = z.object({
  status: z.enum(['draft', 'pending', 'approved', 'rejected']).optional(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  items: z.array(ChangeOrderItemSchema).optional(),
  rejectionReason: z.string().optional(),
  approvedBy: z.string().optional(),
}).refine((data: any) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});

export const ListChangeOrdersQuerySchema = z.object({
  projectId: z.string().optional(),
  clientId: z.string().optional(),
  clientName: z.string().min(2).optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const PurchaseOrderItemSchema = z.object({
  id: z.string(),
  catalogItemId: z.string().optional(),
  catalogItemName: z.string().optional(),
  description: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.string().min(1),
  unitPrice: z.number().nonnegative(),
  total: z.number().nonnegative(),
  plannedUnitPrice: z.number().nonnegative().optional(),
});

export const CreatePurchaseOrderSchema = z.object({
  projectId: z.string().min(1),
  projectName: z.string().min(1),
  clientId: z.string().min(1),
  clientName: z.string().min(1),
  vendor: z.string().min(1),
  vendorContact: z.string().optional(),
  items: z.array(PurchaseOrderItemSchema).min(1),
  category: z.enum(['materials', 'tools', 'reimbursement', 'fuel', 'housing', 'food', 'permit', 'other']),
  taxAmount: z.number().nonnegative().optional(),
  receiptPhotoUrl: z.string().optional(),
  receiptPhotoUrls: z.array(z.string()).optional(),
  status: z.enum(['draft', 'submitted', 'approved', 'received', 'cancelled']).default('received'),
  purchaseDate: z.string().optional(),
  taskId: z.string().optional(),
  taskTitle: z.string().optional(),
  estimateId: z.string().optional(),
  plannedTotal: z.number().nonnegative().optional(),
  idempotencyKey: z.string().optional(),
});

export const ListPurchaseOrdersQuerySchema = z.object({
  projectId: z.string().optional(),
  clientId: z.string().optional(),
  clientName: z.string().min(2).optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const PlanVsFactQuerySchema = z.object({
  clientId: z.string().optional(),
  clientName: z.string().min(2).optional(),
  projectId: z.string().optional(),
}).refine((d: any) => d.clientId || d.clientName || d.projectId, {
  message: 'Requires clientId, clientName, or projectId',
});
