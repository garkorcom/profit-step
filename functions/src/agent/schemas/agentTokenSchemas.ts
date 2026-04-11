import { z } from 'zod';

export const CreateAgentTokenSchema = z.object({
  employeeId: z.string().min(1).describe('Firebase UID of the employee'),
  label: z.string().min(1).max(100).describe('Human-readable label, e.g. "Vasya laptop"'),
  expiresInDays: z.number().int().min(1).max(365).default(90),
  scopes: z.array(z.enum([
    'tasks:read', 'tasks:write',
    'time:read', 'time:write',
    'costs:read', 'costs:write',
    'clients:read', 'clients:write',
    'projects:read', 'projects:write',
    'estimates:read', 'estimates:write',
    'inventory:read', 'inventory:write',
    'erp:read', 'erp:write',
    'events:read',
    'dashboard:read',
    'admin',
  ])).min(1).describe('Permission scopes for this token'),
});

export const ListAgentTokensSchema = z.object({
  employeeId: z.string().optional(),
  includeRevoked: z.coerce.boolean().default(false),
});

export const EventsQuerySchema = z.object({
  since: z.string().describe('ISO 8601 timestamp — return events after this time'),
  types: z.string().optional().describe('Comma-separated event types: task,session,cost,estimate,project'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
