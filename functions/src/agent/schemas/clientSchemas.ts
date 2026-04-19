import { z } from 'zod';

// ─── Client Card V2 additive enums ────────────────────────────────

export const LIFECYCLE_STAGES = ['lead', 'prospect', 'active', 'repeat', 'churned', 'vip'] as const;
export const CLIENT_SEGMENTS = ['A', 'B', 'C', 'VIP'] as const;
export const CHURN_RISKS = ['low', 'medium', 'high'] as const;
export const PREFERRED_CHANNELS = ['phone', 'email', 'telegram', 'whatsapp'] as const;

const DecisionMakerSchema = z.object({
  name: z.string().min(1),
  role: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  isPrimary: z.boolean().optional(),
});

const TaxInfoSchema = z.object({
  ein: z.string().optional(),
  taxExempt: z.boolean().optional(),
  taxRate: z.number().min(0).max(1).optional(),
});

const BillingInfoSchema = z.object({
  billingName: z.string().optional(),
  billingAddress: z.string().optional(),
  bankAccount: z.string().optional(),
  routingNumber: z.string().optional(),
  paymentTerms: z.string().optional(),
});

// Fields allowed on PATCH (manual-editable by manager).
// Computed metrics (healthScore, ltv, churnRisk, etc.) are NOT in this list
// — they're materialized by cron/triggers, not the UI.
export const ClientV2ManualFieldsSchema = z.object({
  lifecycleStage: z.enum(LIFECYCLE_STAGES).optional(),
  segment: z.enum(CLIENT_SEGMENTS).optional(),
  referralByClientId: z.string().nullable().optional(),
  preferredChannel: z.enum(PREFERRED_CHANNELS).optional(),
  preferredLanguage: z.enum(['ru', 'en']).optional(),
  timezone: z.string().optional(),
  taxInfo: TaxInfoSchema.optional(),
  billingInfo: BillingInfoSchema.optional(),
  currency: z.string().optional(),
  decisionMakers: z.array(DecisionMakerSchema).optional(),
  npsScore: z.number().min(0).max(10).nullable().optional(),
});

export const CreateClientSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  contactPerson: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  notes: z.string().optional(),
  type: z.enum(['residential', 'commercial', 'industrial']).optional(),
  company: z.string().nullable().optional(),
  geo: z.object({
    lat: z.number(),
    lng: z.number(),
  }).optional(),
  idempotencyKey: z.string().min(1).optional(),
});

export const UpdateClientSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().optional(),
  contactPerson: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  notes: z.string().optional(),
  type: z.enum(['residential', 'commercial', 'industrial']).optional(),
  company: z.string().nullable().optional(),
  geo: z.object({
    lat: z.number(),
    lng: z.number(),
  }).optional(),
  nearbyStores: z.array(z.string()).optional(),
  accessCredentials: z.array(z.any()).optional(),
  // V2 additive manual fields — merge with existing
  lifecycleStage: z.enum(LIFECYCLE_STAGES).optional(),
  segment: z.enum(CLIENT_SEGMENTS).optional(),
  referralByClientId: z.string().nullable().optional(),
  preferredChannel: z.enum(PREFERRED_CHANNELS).optional(),
  preferredLanguage: z.enum(['ru', 'en']).optional(),
  timezone: z.string().optional(),
  taxInfo: TaxInfoSchema.optional(),
  billingInfo: BillingInfoSchema.optional(),
  currency: z.string().optional(),
  decisionMakers: z.array(DecisionMakerSchema).optional(),
  npsScore: z.number().min(0).max(10).nullable().optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});
