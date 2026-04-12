import { z } from 'zod';

export const CreateEstimateSchema = z.object({
  clientId: z.string().min(1).optional(),
  clientName: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional(),
  siteId: z.string().optional(),
  estimateType: z.enum(['internal', 'commercial']).optional(),
  items: z.array(z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    quantity: z.number().min(0),
    unitPrice: z.number().min(0),
    total: z.number().min(0),
    type: z.enum(['labor', 'material', 'service', 'other']),
  })).min(1),
  notes: z.string().optional(),
  terms: z.string().optional(),
  validUntil: z.string().optional(),
  taxRate: z.number().min(0).max(100).optional(),
});

export const ListEstimatesQuerySchema = z.object({
  clientId: z.string().optional(),
  clientName: z.string().min(2).optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const UpdateEstimateSchema = z.object({
  estimateType: z.enum(['internal', 'commercial']).optional(),
  status: z.enum(['draft', 'sent', 'approved', 'rejected', 'converted']).optional(),
  items: z.array(z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    quantity: z.number().min(0),
    unitPrice: z.number().min(0),
    total: z.number().min(0),
    type: z.enum(['labor', 'material', 'service', 'other']),
  })).optional(),
  notes: z.string().optional(),
  terms: z.string().optional(),
  validUntil: z.string().nullable().optional(),
  taxRate: z.number().min(0).max(100).optional(),
}).refine((data: any) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});

export const CreateProjectSchema = z.object({
  clientId: z.string().min(1).optional(),
  clientName: z.string().min(1).optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['work', 'estimate', 'financial', 'other']).default('work'),
  address: z.string().optional(),
  areaSqft: z.number().optional(),
  projectType: z.string().optional(),
  facilityUse: z.string().optional(),
});

export const ListProjectsQuerySchema = z.object({
  clientId: z.string().optional(),
  clientName: z.string().min(2).optional(),
  status: z.string().optional(),
  type: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const UploadFileSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1).default('application/octet-stream'),
  base64Data: z.string().min(1),
  description: z.string().optional(),
});

export const BlueprintSplitSchema = z.object({
  projectId: z.string().min(1),
  fileId: z.string().min(1),
});

export const CreateBlackboardSchema = z.object({
  projectId: z.string().min(1),
  version: z.number().int().min(1).default(1),
  zones: z.array(z.string()).default([]),
  extracted_elements: z.array(z.any()).default([]),
  rfis: z.array(z.any()).default([]),
  estimate_summary: z.record(z.any()).default({}),
  status: z.enum(['in_progress', 'completed', 'review_needed']).default('in_progress'),
});

export const CreateSiteSchema = z.object({
  clientId: z.string().min(1),
  name: z.string().min(1),
  address: z.string().min(1),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  geo: z.object({
    lat: z.number(),
    lng: z.number(),
  }).optional(),
  sqft: z.number().optional(),
  type: z.enum(['residential', 'commercial', 'industrial']).optional(),
  permitNumber: z.string().optional(),
  status: z.enum(['active', 'completed', 'on_hold']).default('active'),
});

export const UpdateSiteSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  geo: z.object({
    lat: z.number(),
    lng: z.number(),
  }).optional(),
  sqft: z.number().optional(),
  type: z.enum(['residential', 'commercial', 'industrial']).optional(),
  permitNumber: z.string().optional(),
  status: z.enum(['active', 'completed', 'on_hold']).optional(),
}).refine((data: any) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});
