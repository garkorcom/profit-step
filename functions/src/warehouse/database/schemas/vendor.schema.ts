/**
 * Zod schemas for wh_vendors.
 */

import { z } from 'zod';

export const VendorTypeSchema = z.enum(['big_box', 'local_supply', 'subcontractor_proxy', 'online']);

export const CreateWhVendorSchema = z
  .object({
    name: z.string().min(1).max(100),
    vendorType: VendorTypeSchema,
    contactEmail: z.string().email().optional(),
    contactPhone: z.string().max(32).optional(),
    contactName: z.string().max(100).optional(),
    defaultPaymentTerms: z.string().max(100).optional(),
    preferredForCategories: z.array(z.string()).optional(),
    apiEndpoint: z.string().url().optional(),
    apiCredentialsKey: z.string().optional(),
  })
  .strict();
