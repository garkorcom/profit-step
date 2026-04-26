/**
 * Sample Task fixtures — one task per lifecycle state.
 *
 * Used by tests to avoid hand-rolling boilerplate. Each fixture is a
 * function that returns a fresh Task on each call (so tests don't share
 * mutable references).
 */

import type { Task, EpochMs } from '../../domain/Task';
import { asTaskId, asCompanyId, asUserId, asProjectId, asClientId } from '../../domain/identifiers';
import { makeTask } from '../test-helpers/makeTask';

const T0: EpochMs = 1_700_000_000_000 as EpochMs;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const user = (id: string, name: string) => ({
  id: asUserId(id),
  name,
});

export function draftTask(): Task {
  return makeTask({
    id: asTaskId('task_draft'),
    taskNumber: 'T-2026-1001',
    title: 'Draft: review demolition plan',
    lifecycle: 'draft',
    createdBy: user('user_pm', 'PM Bob'),
    assignedTo: user('user_pm', 'PM Bob'),
    createdAt: T0,
    updatedAt: T0,
    dueAt: (T0 + 7 * DAY) as EpochMs,
    estimatedDurationMinutes: 120,
    companyId: asCompanyId('company_acme'),
    projectId: asProjectId('proj_remodel'),
    clientId: asClientId('client_jim'),
  });
}

export function readyTask(): Task {
  return makeTask({
    id: asTaskId('task_ready'),
    taskNumber: 'T-2026-1002',
    title: 'Ready: install drywall',
    lifecycle: 'ready',
    createdBy: user('user_pm', 'PM Bob'),
    assignedTo: user('user_worker', 'Worker Alice'),
    createdAt: T0,
    updatedAt: T0 + 1 * HOUR,
    dueAt: (T0 + 5 * DAY) as EpochMs,
    plannedStartAt: (T0 + 1 * DAY) as EpochMs,
    estimatedDurationMinutes: 240,
    companyId: asCompanyId('company_acme'),
    projectId: asProjectId('proj_remodel'),
    clientId: asClientId('client_jim'),
    history: [
      {
        type: 'create',
        at: T0,
        by: user('user_pm', 'PM Bob'),
        action: 'create',
        to: 'draft',
      },
      {
        type: 'transition',
        at: T0 + 1 * HOUR,
        by: user('user_pm', 'PM Bob'),
        from: 'draft',
        to: 'ready',
        action: 'ready',
      },
    ],
  });
}

export function startedTask(): Task {
  const now: EpochMs = (T0 + 2 * DAY) as EpochMs;
  return makeTask({
    id: asTaskId('task_started'),
    taskNumber: 'T-2026-1003',
    title: 'Started: paint living room',
    lifecycle: 'started',
    createdBy: user('user_pm', 'PM Bob'),
    assignedTo: user('user_worker', 'Worker Alice'),
    createdAt: T0,
    updatedAt: now,
    dueAt: (T0 + 6 * DAY) as EpochMs,
    plannedStartAt: (T0 + 2 * DAY) as EpochMs,
    actualStartAt: now,
    estimatedDurationMinutes: 360,
    companyId: asCompanyId('company_acme'),
  });
}

export function blockedTask(): Task {
  return makeTask({
    id: asTaskId('task_blocked'),
    taskNumber: 'T-2026-1004',
    title: 'Blocked: install electrical (waiting permit)',
    lifecycle: 'blocked',
    blockedReason: 'Waiting for city permit approval',
    createdBy: user('user_pm', 'PM Bob'),
    assignedTo: user('user_electrician', 'Electrician Carlos'),
    createdAt: T0,
    updatedAt: (T0 + 3 * DAY) as EpochMs,
    dueAt: (T0 + 10 * DAY) as EpochMs,
    estimatedDurationMinutes: 480,
    companyId: asCompanyId('company_acme'),
  });
}

export function completedTask(): Task {
  const completedAt: EpochMs = (T0 + 4 * DAY) as EpochMs;
  return makeTask({
    id: asTaskId('task_completed'),
    taskNumber: 'T-2026-1005',
    title: 'Completed: tile bathroom',
    lifecycle: 'completed',
    createdBy: user('user_pm', 'PM Bob'),
    assignedTo: user('user_worker', 'Worker Alice'),
    createdAt: T0,
    updatedAt: completedAt,
    dueAt: (T0 + 5 * DAY) as EpochMs,
    plannedStartAt: (T0 + 1 * DAY) as EpochMs,
    actualStartAt: (T0 + 1 * DAY) as EpochMs,
    completedAt,
    estimatedDurationMinutes: 480,
    actualDurationMinutes: 540,
    totalEarnings: 270,
    bonusOnTime: { amount: 50, currency: 'USD' },
    companyId: asCompanyId('company_acme'),
  });
}

export function acceptedTask(): Task {
  const completedAt: EpochMs = (T0 + 4 * DAY) as EpochMs;
  const acceptedAt: EpochMs = (completedAt + 1 * DAY) as EpochMs;
  return makeTask({
    id: asTaskId('task_accepted'),
    taskNumber: 'T-2026-1006',
    title: 'Accepted: cabinet installation',
    lifecycle: 'accepted',
    createdBy: user('user_pm', 'PM Bob'),
    assignedTo: user('user_worker', 'Worker Alice'),
    createdAt: T0,
    updatedAt: acceptedAt,
    dueAt: (T0 + 5 * DAY) as EpochMs,
    completedAt,
    acceptedAt,
    actualDurationMinutes: 600,
    totalEarnings: 300,
    acceptance: {
      url: 'https://storage.example/acts/T-2026-1006.pdf',
      signedAt: acceptedAt,
      signedBy: 'client_jim',
      signedByName: 'Jim Dvorkin',
      notes: 'Looks good',
    },
    companyId: asCompanyId('company_acme'),
  });
}

export function cancelledTask(): Task {
  return makeTask({
    id: asTaskId('task_cancelled'),
    taskNumber: 'T-2026-1007',
    title: 'Cancelled: pressure wash deck',
    lifecycle: 'cancelled',
    createdBy: user('user_pm', 'PM Bob'),
    assignedTo: user('user_worker', 'Worker Alice'),
    createdAt: T0,
    updatedAt: (T0 + 1 * DAY) as EpochMs,
    dueAt: (T0 + 3 * DAY) as EpochMs,
    companyId: asCompanyId('company_acme'),
  });
}
