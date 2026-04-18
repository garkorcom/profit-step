/**
 * Zod schemas for wh_documents + lines.
 *
 * Covers the shared "create draft" shape. Post/void payloads are small and
 * live in the route layer in Phase 1.
 */

import { z } from 'zod';

export const DocTypeSchema = z.enum(['receipt', 'issue', 'transfer', 'count', 'adjustment', 'reversal']);
export const DocStatusSchema = z.enum(['draft', 'ready_for_review', 'posted', 'voided', 'expired']);
export const DocSourceSchema = z.enum(['ui', 'api', 'ai', 'import']);
export const PhaseCodeSchema = z.enum([
  'rough_in',
  'trim',
  'service',
  'service_call',
  'change_order',
  'warranty',
]);
export const CostCategorySchema = z.enum(['materials', 'equipment', 'consumables']);
export const IssueReasonSchema = z.enum([
  'project_installation',
  'project_service_call',
  'project_warranty',
  'internal_shop_use',
  'damage_warehouse',
  'damage_transit',
  'loss_theft',
  'return_to_vendor',
]);

export const PROJECT_REQUIRED_REASONS: readonly string[] = [
  'project_installation',
  'project_service_call',
  'project_warranty',
];

export const CreateWhDocumentLineSchema = z
  .object({
    itemId: z.string().min(1),
    uom: z.string().min(1),
    qty: z.number().positive(),
    unitCost: z.number().nonnegative().optional(),
    note: z.string().max(500).optional(),
    systemQty: z.number().nonnegative().optional(),
    countedQty: z.number().nonnegative().optional(),
    projectId: z.string().optional(),
    phaseCode: PhaseCodeSchema.optional(),
    costCategory: CostCategorySchema.optional(),
    rawText: z.string().optional(),
    matchConfidence: z.number().min(0).max(1).optional(),
  })
  .strict();

/**
 * "Create draft document" contract. Used by POST /api/warehouse/documents.
 */
export const CreateWhDocumentSchema = z
  .object({
    docType: DocTypeSchema,
    eventDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
    sourceLocationId: z.string().optional(),
    destinationLocationId: z.string().optional(),
    locationId: z.string().optional(),
    reason: z.string().optional(),
    projectId: z.string().optional(),
    phaseCode: PhaseCodeSchema.optional(),
    costCategory: CostCategorySchema.optional(),
    vendorId: z.string().optional(),
    vendorReceiptNumber: z.string().optional(),
    lines: z.array(CreateWhDocumentLineSchema).min(1),
    note: z.string().max(2000).optional(),
    attachmentUrls: z.array(z.string().url()).optional(),
    source: DocSourceSchema.default('api'),
    reservationExpiresAt: z.string().datetime().optional(),
    aiSessionId: z.string().optional(),
    idempotencyKey: z.string().optional(),
    relatedTaskId: z.string().optional(),
    totals: z
      .object({
        subtotal: z.number().nonnegative(),
        tax: z.number().nonnegative().optional(),
        total: z.number().nonnegative(),
        currency: z.string().length(3).default('USD'),
      })
      .optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.docType === 'receipt' && !data.destinationLocationId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'receipt requires destinationLocationId', path: ['destinationLocationId'] });
    }
    if (data.docType === 'issue' && !data.sourceLocationId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'issue requires sourceLocationId', path: ['sourceLocationId'] });
    }
    if (data.docType === 'transfer') {
      if (!data.sourceLocationId || !data.destinationLocationId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'transfer requires both sourceLocationId and destinationLocationId', path: ['sourceLocationId'] });
      } else if (data.sourceLocationId === data.destinationLocationId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'transfer source and destination must differ', path: ['destinationLocationId'] });
      }
    }
    if ((data.docType === 'count' || data.docType === 'adjustment') && !data.locationId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${data.docType} requires locationId`, path: ['locationId'] });
    }
    if (data.docType === 'issue' && data.reason && PROJECT_REQUIRED_REASONS.includes(data.reason) && !data.projectId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Issue with reason "${data.reason}" requires projectId`,
        path: ['projectId'],
      });
    }
  });

export type CreateWhDocumentInput = z.infer<typeof CreateWhDocumentSchema>;
