/**
 * Types for Client Dashboard API responses.
 * Mirrors functions/src/agent/schemas/dashboardClientSchemas.ts
 */

// ─── Red Flags ─────────────────────────────────────────────────────

export type RedFlagCode =
  | 'low_margin'
  | 'over_budget'
  | 'unpaid_14d'
  | 'stagnation'
  | 'unbilled_work'
  | 'ar_high';

export interface RedFlag {
  code: RedFlagCode;
  severity: 'red' | 'yellow';
  title: string;
  description: string;
  value: number | null;
  threshold: number | null;
}

export type MarginColor = 'green' | 'yellow' | 'red';

// ─── Summary ───────────────────────────────────────────────────────

export interface ClientSummary {
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

// ─── Labor Log ─────────────────────────────────────────────────────

export type LaborPeriod = 'week' | 'month' | 'all';

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

export interface LaborLogData {
  period: string;
  employees: LaborEmployee[];
  totals: {
    hours: number;
    cost: number;
    sessions: number;
  };
}

// ─── Timeline ──────────────────────────────────────────────────────

export type TimelineEventType =
  | 'estimate_created'
  | 'payment_received'
  | 'session_started'
  | 'session_ended'
  | 'task_completed'
  | 'photo_added'
  | 'material_purchased'
  | 'cost_added';

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  title: string;
  description: string;
  amount: number | null;
  timestamp: string;
  actorId: string | null;
  actorName: string | null;
}

export interface TimelineData {
  events: TimelineEvent[];
  hasMore: boolean;
  total: number;
}

// ─── Cost Breakdown ────────────────────────────────────────────────

export type CostCategoryType = 'materials' | 'labor' | 'subcontractors' | 'other';

export interface CostCategoryItem {
  id: string;
  description: string;
  amount: number;
  date: string;
}

export interface CostCategory {
  category: CostCategoryType;
  amount: number;
  percent: number;
  items: CostCategoryItem[];
}

export interface CostsBreakdown {
  total: number;
  categories: CostCategory[];
}
