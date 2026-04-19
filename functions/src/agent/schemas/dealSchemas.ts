import { z } from 'zod';

// ─── Deal Schemas (CRM overhaul spec §5.1, Client Journey Sprint 1.1) ────
//
// Note: `leads` collection is the current simplified funnel. `deals` is the
// fuller CRM Deal entity from the spec. They coexist — leads stays for
// inbound lead capture from landing pages, deals carries the full
// pipeline + value + estimate/meeting/project linkage for post-capture work.

export const DEAL_STAGES = [
  'new',           // just created
  'survey_scheduled',
  'survey_done',
  'estimate_draft',
  'estimate_sent',
  'negotiation',
  'won',
  'lost',
] as const;

export type DealStage = (typeof DEAL_STAGES)[number];

export const DEAL_STATUSES = ['open', 'won', 'lost'] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

export const DEAL_PRIORITIES = ['low', 'medium', 'high'] as const;

const MoneySchema = z.object({
  amount: z.number().min(0),
  currency: z.string().default('USD'),
});

/**
 * Create schema. clientId is required — a Deal without a Client is a Lead.
 * Pipeline / stage defaults allow the caller to omit and get sensible
 * starting values; value is optional at creation time.
 */
export const CreateDealSchema = z.object({
  clientId: z.string().min(1),
  title: z.string().min(1).default('Новая сделка'),
  pipelineId: z.string().optional(),
  stage: z.enum(DEAL_STAGES).default('new'),
  status: z.enum(DEAL_STATUSES).default('open'),
  value: MoneySchema.optional(),
  priority: z.enum(DEAL_PRIORITIES).default('medium'),
  expectedCloseDate: z.string().datetime().optional(),
  source: z.string().optional(), // landing / referral / call-in / manual
  workAddress: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).default([]),
  idempotencyKey: z.string().optional(),
});

/**
 * Update — partial. `lost_reason` enforced server-side (route handler)
 * when status flips to 'lost', not via schema refine (refines can't
 * see pre-existing state).
 */
export const UpdateDealSchema = z.object({
  title: z.string().min(1).optional(),
  pipelineId: z.string().optional(),
  stage: z.enum(DEAL_STAGES).optional(),
  status: z.enum(DEAL_STATUSES).optional(),
  value: MoneySchema.optional(),
  priority: z.enum(DEAL_PRIORITIES).optional(),
  expectedCloseDate: z.string().datetime().optional(),
  actualCloseDate: z.string().datetime().optional(),
  lostReason: z.string().optional(),
  source: z.string().optional(),
  workAddress: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  projectId: z.string().optional(),
  primaryEstimateId: z.string().optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field required',
});

export const ListDealsQuerySchema = z.object({
  clientId: z.string().optional(),
  status: z.enum(DEAL_STATUSES).optional(),
  stage: z.enum(DEAL_STAGES).optional(),
  ownerId: z.string().optional(),
  limit: z.coerce.number().min(1).max(200).default(50),
  offset: z.coerce.number().min(0).default(0),
});
