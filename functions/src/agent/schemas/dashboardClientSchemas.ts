/**
 * Zod schemas for Client Dashboard API endpoints.
 *
 * Validates query parameters for:
 *   GET /api/dashboard/client/:id/summary
 *   GET /api/dashboard/client/:id/labor-log
 *   GET /api/dashboard/client/:id/timeline
 *   GET /api/dashboard/client/:id/costs-breakdown
 */

import { z } from 'zod';

// ─── Query Schemas ─────────────────────────────────────────────────

export const ClientIdParamSchema = z.object({
  id: z.string().min(1, 'clientId is required'),
});

export const LaborLogQuerySchema = z.object({
  period: z.enum(['week', 'month', 'all']).default('month'),
});

export const TimelineQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ─── Response Types (shared with frontend via copy) ────────────────

export const MARGIN_THRESHOLDS = {
  green: 30,
  yellow: 20,
} as const;

export type MarginColor = 'green' | 'yellow' | 'red';

export function computeMarginColor(marginPercent: number): MarginColor {
  if (marginPercent >= MARGIN_THRESHOLDS.green) return 'green';
  if (marginPercent >= MARGIN_THRESHOLDS.yellow) return 'yellow';
  return 'red';
}

// ─── Red Flag Types ────────────────────────────────────────────────

export const RED_FLAG_CODES = [
  'low_margin',
  'over_budget',
  'unpaid_14d',
  'stagnation',
  'unbilled_work',
  'ar_high',
] as const;

export type RedFlagCode = (typeof RED_FLAG_CODES)[number];

export interface RedFlag {
  code: RedFlagCode;
  severity: 'red' | 'yellow';
  title: string;
  description: string;
  value: number | null;
  threshold: number | null;
}

// ─── Response Interfaces ───────────────────────────────────────────

export interface ClientSummaryResponse {
  clientId: string;
  clientName: string;
  clientAddress: string;
  clientPhone: string;
  clientType: string;
  estimateTotal: number;
  materialsCost: number;
  laborCost: number;
  subsCost: number;
  otherCost: number;
  totalSpent: number;
  invoiced: number;
  received: number;
  balance: number;
  profit: number;
  marginPercent: number;
  marginColor: MarginColor;
  redFlags: RedFlag[];
  updatedAt: string;
}

export interface LaborEmployee {
  employeeId: string;
  employeeName: string;
  totalMinutes: number;
  totalHours: number;
  totalCost: number;
  lastVisit: string;
  sessionCount: number;
  efficiency: number | null;
}

export interface LaborLogResponse {
  period: string;
  employees: LaborEmployee[];
  totals: {
    hours: number;
    cost: number;
    sessions: number;
  };
}

export interface TimelineEvent {
  id: string;
  type:
    | 'estimate_created'
    | 'payment_received'
    | 'session_started'
    | 'session_ended'
    | 'task_completed'
    | 'photo_added'
    | 'material_purchased'
    | 'cost_added';
  title: string;
  description: string;
  amount: number | null;
  timestamp: string;
  actorId: string | null;
  actorName: string | null;
}

export interface TimelineResponse {
  events: TimelineEvent[];
  hasMore: boolean;
  total: number;
}

export interface CostCategory {
  category: 'materials' | 'labor' | 'subcontractors' | 'other';
  amount: number;
  percent: number;
  items: Array<{
    id: string;
    description: string;
    amount: number;
    date: string;
  }>;
}

export interface CostsBreakdownResponse {
  total: number;
  categories: CostCategory[];
}
