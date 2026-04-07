/**
 * @fileoverview ERP V4.0 — Frontend API Client
 *
 * Callable function wrappers for Punch List, Work Acts,
 * Payment Schedule, Warranty Tasks, NPS, Plan vs Fact.
 */

import { getFunctions, httpsCallable } from 'firebase/functions';

const functions = getFunctions(undefined, 'us-central1');

/** Standard callable response wrapper */
interface ErpResponse<T = unknown> {
  success?: boolean;
  data?: T;
  error?: string;
}

// ═══════════════════════════════════════
// PUNCH LIST
// ═══════════════════════════════════════

export const punchListApi = {
  create: async (data: {
    projectId: string;
    projectName?: string;
    clientId: string;
    clientName?: string;
    workActId?: string;
    title: string;
    items?: Array<{
      description: string;
      photoUrls?: string[];
      location?: string;
      priority?: string;
      assigneeId?: string;
      assigneeName?: string;
      notes?: string;
    }>;
  }): Promise<ErpResponse> => {
    const fn = httpsCallable(functions, 'createPunchList');
    const result = await fn(data);
    return result.data as ErpResponse;
  },

  getByProject: async (projectId: string): Promise<ErpResponse<Array<Record<string, unknown>>>> => {
    const fn = httpsCallable(functions, 'getPunchLists');
    const result = await fn({ projectId });
    return result.data as ErpResponse<Array<Record<string, unknown>>>;
  },

  updateItem: async (data: {
    punchListId: string;
    itemId: string;
    status: string;
    fixedPhotoUrls?: string[];
    notes?: string;
  }): Promise<ErpResponse> => {
    const fn = httpsCallable(functions, 'updatePunchListItem');
    const result = await fn(data);
    return result.data as ErpResponse;
  },
};

// ═══════════════════════════════════════
// WORK ACTS
// ═══════════════════════════════════════

export const workActsApi = {
  create: async (data: {
    projectId: string;
    projectName?: string;
    clientId: string;
    clientName?: string;
    estimateId?: string;
    phaseName: string;
    phaseDescription?: string;
    plannedAmount: number;
  }): Promise<ErpResponse> => {
    const fn = httpsCallable(functions, 'createWorkAct');
    const result = await fn(data);
    return result.data as ErpResponse;
  },

  getByProject: async (projectId: string): Promise<ErpResponse<Array<Record<string, unknown>>>> => {
    const fn = httpsCallable(functions, 'getWorkActs');
    const result = await fn({ projectId });
    return result.data as ErpResponse<Array<Record<string, unknown>>>;
  },

  update: async (data: {
    workActId: string;
    status?: string;
    actualAmount?: number;
    completionPercent?: number;
  }): Promise<ErpResponse> => {
    const fn = httpsCallable(functions, 'updateWorkAct');
    const result = await fn(data);
    return result.data as ErpResponse;
  },
};

// ═══════════════════════════════════════
// PAYMENT SCHEDULE
// ═══════════════════════════════════════

export const paymentScheduleApi = {
  create: async (data: {
    projectId: string;
    projectName?: string;
    clientId: string;
    clientName?: string;
    estimateId: string;
    totalAmount?: number;
    milestones?: Array<{
      milestoneName: string;
      workActId?: string;
      amount: number;
      percentOfTotal?: number;
      dueDate?: string;
    }>;
  }): Promise<ErpResponse> => {
    const fn = httpsCallable(functions, 'createPaymentSchedule');
    const result = await fn(data);
    return result.data as ErpResponse;
  },

  getByEstimate: async (estimateId: string): Promise<ErpResponse<Array<Record<string, unknown>>>> => {
    const fn = httpsCallable(functions, 'getPaymentSchedule');
    const result = await fn({ estimateId });
    return result.data as ErpResponse<Array<Record<string, unknown>>>;
  },

  getByProject: async (projectId: string): Promise<ErpResponse<Array<Record<string, unknown>>>> => {
    const fn = httpsCallable(functions, 'getPaymentSchedule');
    const result = await fn({ projectId });
    return result.data as ErpResponse<Array<Record<string, unknown>>>;
  },

  updateMilestone: async (data: {
    scheduleId: string;
    milestoneId: string;
    status?: string;
    paidAmount?: number;
    invoiceId?: string;
  }): Promise<ErpResponse> => {
    const fn = httpsCallable(functions, 'updatePaymentMilestone');
    const result = await fn(data);
    return result.data as ErpResponse;
  },
};

// ═══════════════════════════════════════
// WARRANTY TASKS
// ═══════════════════════════════════════

export const warrantyApi = {
  create: async (data: {
    projectId: string;
    projectName?: string;
    clientId: string;
    clientName?: string;
    description: string;
    photoUrls?: string[];
    priority?: string;
    warrantyExpiresAt?: string;
  }): Promise<ErpResponse> => {
    const fn = httpsCallable(functions, 'createWarrantyTask');
    const result = await fn(data);
    return result.data as ErpResponse;
  },

  getByProject: async (projectId: string): Promise<ErpResponse<Array<Record<string, unknown>>>> => {
    const fn = httpsCallable(functions, 'getWarrantyTasks');
    const result = await fn({ projectId });
    return result.data as ErpResponse<Array<Record<string, unknown>>>;
  },
};

// ═══════════════════════════════════════
// NPS
// ═══════════════════════════════════════

export const npsApi = {
  trigger: async (data: {
    projectId: string;
    projectName?: string;
    clientId: string;
    clientName?: string;
    contactEmail?: string;
    contactPhone?: string;
    channel?: string;
  }): Promise<ErpResponse> => {
    const fn = httpsCallable(functions, 'triggerNps');
    const result = await fn(data);
    return result.data as ErpResponse;
  },

  getStatus: async (projectId: string): Promise<ErpResponse<Array<Record<string, unknown>>>> => {
    const fn = httpsCallable(functions, 'getNpsStatus');
    const result = await fn({ projectId });
    return result.data as ErpResponse<Array<Record<string, unknown>>>;
  },
};

// ═══════════════════════════════════════
// PLAN vs FACT
// ═══════════════════════════════════════

export const planVsFactApi = {
  get: async (params: { projectId?: string; clientId?: string }): Promise<ErpResponse<Record<string, unknown>>> => {
    const fn = httpsCallable(functions, 'getPlanVsFact');
    const result = await fn(params);
    return result.data as ErpResponse<Record<string, unknown>>;
  },
};
