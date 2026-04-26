/**
 * makeTask — builder for Task with sane defaults.
 *
 * Used in tests + fixtures. Override only the fields you care about.
 */

import type { Task, EpochMs, UserRef } from '../../domain/Task';
import {
  asCompanyId,
  asTaskId,
  asUserId,
  type TaskId,
} from '../../domain/identifiers';

let counter = 0;
export function nextTaskId(): TaskId {
  counter += 1;
  return asTaskId(`task_${String(counter).padStart(4, '0')}`);
}

export function resetTaskIdCounter(start = 0): void {
  counter = start;
}

const DEFAULT_USER: UserRef = {
  id: asUserId('user_default'),
  name: 'Default User',
};

export function makeTask(overrides: Partial<Task> = {}): Task {
  const id = overrides.id ?? nextTaskId();
  const now: EpochMs = (overrides.createdAt ?? 1_700_000_000_000) as EpochMs;
  const dueAt: EpochMs = (overrides.dueAt ?? now + 7 * 24 * 60 * 60 * 1000) as EpochMs;

  const defaults: Task = {
    id,
    companyId: asCompanyId('company_default'),
    taskNumber: 'T-2026-0001',
    title: 'Sample task',
    lifecycle: 'draft',
    bucket: 'next',
    priority: 'medium',
    createdBy: DEFAULT_USER,
    assignedTo: DEFAULT_USER,
    requiredHeadcount: 1,
    createdAt: now,
    updatedAt: now,
    dueAt,
    estimatedDurationMinutes: 60,
    actualDurationMinutes: 0,
    autoShiftEnabled: false,
    isCriticalPath: false,
    slackMinutes: 0,
    isSubtask: false,
    subtaskIds: [],
    wikiInheritsFromParent: false,
    costInternal: { amount: 0, currency: 'USD' },
    priceClient: { amount: 0, currency: 'USD' },
    totalEarnings: 0,
    materialsCostPlanned: 0,
    materialsCostActual: 0,
    source: 'web',
    aiEstimateUsed: false,
    history: [],
    clientVisible: false,
    internalOnly: false,
  };

  return { ...defaults, ...overrides };
}
