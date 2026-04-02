import { z } from 'zod';

export const CreateClientSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  contactPerson: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  notes: z.string().optional(),
  type: z.enum(['residential', 'commercial', 'industrial']).optional(),
  company: z.string().optional(),
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
  company: z.string().optional(),
  geo: z.object({
    lat: z.number(),
    lng: z.number(),
  }).optional(),
  nearbyStores: z.array(z.string()).optional(),
  accessCredentials: z.array(z.any()).optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});
