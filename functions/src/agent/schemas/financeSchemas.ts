import { z } from 'zod';

export const ProjectStatusQuery = z.object({
  clientId: z.string().min(1).optional(),
  clientName: z.string().min(2).optional(),
}).refine((d) => d.clientId || d.clientName, {
  message: 'Требуется clientId или clientName',
});

export const FinanceBatchSchema = z.object({
  transactions: z.array(z.object({
    id: z.string().min(1),
    date: z.string(),
    rawDescription: z.string(),
    cleanMerchant: z.string(),
    amount: z.number(),
    paymentType: z.enum(['company', 'cash']),
    categoryId: z.string(),
    projectId: z.string().nullable().optional(),
    confidence: z.enum(['high', 'low']),
  }))
});

export const FinanceApproveSchema = z.object({
  transactions: z.array(z.object({
    id: z.string().min(1),
    date: z.string(),
    rawDescription: z.string(),
    cleanMerchant: z.string(),
    amount: z.number(),
    paymentType: z.enum(['company', 'cash']),
    categoryId: z.string(),
    projectId: z.string().nullable().optional(),
    employeeId: z.string().nullable().optional(),
    employeeName: z.string().nullable().optional(),
    confidence: z.enum(['high', 'low']),
    taxAmount: z.number().optional().default(0),
  }))
});

export const FinanceUndoSchema = z.object({
  transactionIds: z.array(z.string().min(1)),
});
