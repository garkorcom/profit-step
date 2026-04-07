/**
 * @fileoverview Types for the SiteDashboard module.
 * Replaces 37 `any` annotations in the original monolith.
 */

// ─── ERP V4 Document Types ────────────────────────────────

export interface PaymentMilestone {
  id: string;
  milestoneName: string;
  amount: number;
  paidAmount: number;
  status: 'pending' | 'invoiced' | 'partially_paid' | 'paid' | 'overdue';
}

export interface PaymentSchedule {
  id: string;
  totalAmount: number;
  totalPaid: number;
  totalPending: number;
  milestones?: PaymentMilestone[];
}

export interface NpsRequest {
  id: string;
  status: 'pending' | 'sent' | 'responded';
  score?: number;
  reviewText?: string;
  channel?: string;
}

export interface PunchListItem {
  id: string;
  description: string;
  location?: string;
  priority: 'minor' | 'major' | 'critical';
  status: 'open' | 'fixed' | 'verified';
}

export interface PunchList {
  id: string;
  title: string;
  openItems: number;
  fixedItems: number;
  verifiedItems: number;
  isResolved?: boolean;
  items?: PunchListItem[];
}

export interface WorkAct {
  id: string;
  number: string;
  phaseName: string;
  plannedAmount: number;
  actualAmount: number;
  status: 'draft' | 'ready_to_sign' | 'signed' | 'punch_list' | 'disputed';
  blockedByPunchList?: boolean;
  punchListId?: string;
}

export interface WarrantyTask {
  id: string;
  description: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'resolved';
  cost: number;
}

export interface PlanVsFactData {
  planned?: { total: number };
  actual?: { total: number };
  variance?: { total: number };
  margin?: { actual: number };
  alerts?: string[];
}

export interface PurchaseOrder {
  id: string;
  vendor: string;
  category?: string;
  status: 'draft' | 'approved' | 'ordered' | 'received';
  total: number;
  variancePercent?: number;
}

export interface ChangeOrder {
  id: string;
  number: string;
  title: string;
  status: 'draft' | 'approved' | 'rejected';
  internalTotal: number;
  clientTotal: number;
}

// ─── Cost & Session types ─────────────────────────────────

export interface CostRecord {
  id: string;
  description?: string;
  notes?: string;
  category?: string;
  amount: number;
  date?: string;
  createdAt?: { toDate: () => Date };
}

export interface WorkSession {
  id: string;
  employeeName?: string;
  durationMinutes?: number;
  hourlyRate?: number;
  status?: string;
  clientId?: string;
  startTime?: { toDate: () => Date };
}

// ─── Estimate extensions ──────────────────────────────────

export interface EstimateLineItem {
  description?: string;
  name?: string;
  quantity?: number;
  rate?: number;
  unitPrice?: number;
  amount?: number;
}

// ─── Computed summaries ───────────────────────────────────

export interface CostsSummary {
  total: number;
  byCategory: Record<string, number>;
}

export interface EmployeeSummary {
  name: string;
  minutes: number;
  earnings: number;
}

export interface SessionsSummary {
  totalMinutes: number;
  totalEarnings: number;
  byEmployee: Record<string, EmployeeSummary>;
}

// ─── Status / display config ──────────────────────────────

export const STATUS_CONFIG: Record<string, { label: string; color: 'success' | 'default' | 'warning' }> = {
  active: { label: 'Active', color: 'success' },
  completed: { label: 'Completed', color: 'default' },
  on_hold: { label: 'On Hold', color: 'warning' },
};

export const TYPE_LABELS: Record<string, string> = {
  residential: '🏠 Residential',
  commercial: '🏢 Commercial',
  industrial: '🏭 Industrial',
};

export const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#f44336',
  high: '#ff9800',
  medium: '#ff9800',
  normal: '#2196f3',
  low: '#9e9e9e',
};

export const ESTIMATE_STATUS_COLORS: Record<string, 'success' | 'primary' | 'error' | 'warning' | 'info' | 'default'> = {
  approved: 'success',
  sent: 'primary',
  rejected: 'error',
  draft: 'warning',
  converted: 'info',
};
