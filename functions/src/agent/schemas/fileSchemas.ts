import { z } from 'zod';

// ─── File Categories ──────────────────────────────────────────────

export const FILE_CATEGORIES = [
  'photo', 'document', 'receipt', 'blueprint', 'signature',
  'estimate', 'invoice', 'permit', 'other',
] as const;

export type FileCategory = typeof FILE_CATEGORIES[number];

// ─── Upload (base64) ─────────────────────────────────────────────

export const UploadFileBodySchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1).default('application/octet-stream'),
  base64Data: z.string().min(1),
  category: z.enum(FILE_CATEGORIES).default('other'),
  description: z.string().max(500).optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  // Entity links (at least one recommended)
  clientId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  costId: z.string().min(1).optional(),
  estimateId: z.string().min(1).optional(),
});

// ─── Upload from URL ──────────────────────────────────────────────

export const UploadFromUrlBodySchema = z.object({
  sourceUrl: z.string().url(),
  fileName: z.string().min(1).optional(), // auto-detect if omitted
  contentType: z.string().min(1).optional(),
  category: z.enum(FILE_CATEGORIES).default('other'),
  description: z.string().max(500).optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  clientId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  costId: z.string().min(1).optional(),
});

// ─── Search / List ────────────────────────────────────────────────

export const FileSearchQuerySchema = z.object({
  clientId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  costId: z.string().min(1).optional(),
  category: z.enum(FILE_CATEGORIES).optional(),
  tag: z.string().min(1).optional(),
  dateFrom: z.string().optional(), // ISO date
  dateTo: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ─── Stats ────────────────────────────────────────────────────────

export const FileStatsQuerySchema = z.object({
  clientId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
});

// ─── Update Metadata ──────────────────────────────────────────────

export const UpdateFileSchema = z.object({
  description: z.string().max(500).optional(),
  category: z.enum(FILE_CATEGORIES).optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  // Allow re-linking
  clientId: z.string().min(1).nullable().optional(),
  projectId: z.string().min(1).nullable().optional(),
  taskId: z.string().min(1).nullable().optional(),
  costId: z.string().min(1).nullable().optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});
