import { z } from 'zod';

/** All event domains the webhook system supports */
export const WEBHOOK_EVENT_DOMAINS = [
  'task', 'session', 'cost', 'estimate', 'project',
  'inventory', 'payroll', 'alert', 'team', 'user',
] as const;

export type WebhookEventDomain = typeof WEBHOOK_EVENT_DOMAINS[number];

/**
 * Event pattern matching: supports 'task.created', 'task.*', '*.completed', '*'
 */
export const WebhookEventPatternSchema = z.string().regex(
  /^(\*|[a-z_]+)\.(\*|[a-z_]+)$/,
  'Pattern must be "domain.action" (e.g. "task.created", "task.*", "*.completed")',
);

export const CreateWebhookSchema = z.object({
  url: z.string().url().max(2048),
  events: z.array(WebhookEventPatternSchema).min(1).max(50),
  description: z.string().max(200).optional(),
  active: z.boolean().default(true),
});

export const UpdateWebhookSchema = z.object({
  url: z.string().url().max(2048).optional(),
  events: z.array(WebhookEventPatternSchema).min(1).max(50).optional(),
  description: z.string().max(200).optional(),
  active: z.boolean().optional(),
});

/** Event payload sent to webhook URL */
export interface WebhookEvent {
  id: string;               // unique event ID
  type: string;             // e.g. "task.created"
  timestamp: string;        // ISO-8601
  data: Record<string, unknown>;
}
