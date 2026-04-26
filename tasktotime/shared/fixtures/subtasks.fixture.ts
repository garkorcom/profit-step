/**
 * Subtasks fixture: parent + 5 subtasks for rollup tests.
 */

import type { Task, EpochMs } from '../../domain/Task';
import { asTaskId } from '../../domain/identifiers';
import { makeTask } from '../test-helpers/makeTask';

const T0: EpochMs = 1_700_000_000_000 as EpochMs;
const DAY = 24 * 60 * 60 * 1000;

export function parentWithFiveSubtasks(): { parent: Task; subtasks: Task[] } {
  const parentId = asTaskId('parent_remodel');
  const parent = makeTask({
    id: parentId,
    title: 'Bathroom remodel',
    lifecycle: 'started',
    isSubtask: false,
    subtaskIds: [
      asTaskId('sub_demo'),
      asTaskId('sub_plumbing'),
      asTaskId('sub_drywall'),
      asTaskId('sub_tile'),
      asTaskId('sub_paint'),
    ],
    createdAt: T0,
    updatedAt: T0 + 1 * DAY,
    dueAt: (T0 + 30 * DAY) as EpochMs,
    estimatedDurationMinutes: 60 * 40,
    costInternal: { amount: 1000, currency: 'USD' },
    priceClient: { amount: 2500, currency: 'USD' },
  });

  const subtasks: Task[] = [
    // 2 accepted, 1 completed, 1 started, 1 blocked
    makeTask({
      id: asTaskId('sub_demo'),
      title: 'Demo old fixtures',
      lifecycle: 'accepted',
      isSubtask: true,
      parentTaskId: parentId,
      createdAt: T0,
      updatedAt: T0 + 1 * DAY,
      dueAt: (T0 + 5 * DAY) as EpochMs,
      completedAt: (T0 + 4 * DAY) as EpochMs,
      acceptedAt: (T0 + 5 * DAY) as EpochMs,
      estimatedDurationMinutes: 240,
      actualDurationMinutes: 220,
      costInternal: { amount: 100, currency: 'USD' },
      priceClient: { amount: 250, currency: 'USD' },
    }),
    makeTask({
      id: asTaskId('sub_plumbing'),
      title: 'Rough-in plumbing',
      lifecycle: 'accepted',
      isSubtask: true,
      parentTaskId: parentId,
      createdAt: T0,
      updatedAt: T0 + 8 * DAY,
      dueAt: (T0 + 10 * DAY) as EpochMs,
      completedAt: (T0 + 8 * DAY) as EpochMs,
      acceptedAt: (T0 + 9 * DAY) as EpochMs,
      estimatedDurationMinutes: 480,
      actualDurationMinutes: 510,
      costInternal: { amount: 300, currency: 'USD' },
      priceClient: { amount: 700, currency: 'USD' },
    }),
    makeTask({
      id: asTaskId('sub_drywall'),
      title: 'Hang drywall',
      lifecycle: 'completed',
      isSubtask: true,
      parentTaskId: parentId,
      createdAt: T0,
      updatedAt: T0 + 12 * DAY,
      dueAt: (T0 + 13 * DAY) as EpochMs,
      completedAt: (T0 + 12 * DAY) as EpochMs,
      estimatedDurationMinutes: 360,
      actualDurationMinutes: 380,
      costInternal: { amount: 200, currency: 'USD' },
      priceClient: { amount: 500, currency: 'USD' },
    }),
    makeTask({
      id: asTaskId('sub_tile'),
      title: 'Install tile',
      lifecycle: 'started',
      isSubtask: true,
      parentTaskId: parentId,
      createdAt: T0,
      updatedAt: T0 + 14 * DAY,
      dueAt: (T0 + 18 * DAY) as EpochMs,
      actualStartAt: (T0 + 14 * DAY) as EpochMs,
      estimatedDurationMinutes: 480,
      actualDurationMinutes: 200,
      costInternal: { amount: 250, currency: 'USD' },
      priceClient: { amount: 600, currency: 'USD' },
    }),
    makeTask({
      id: asTaskId('sub_paint'),
      title: 'Paint walls',
      lifecycle: 'blocked',
      blockedReason: 'Waiting on tile completion',
      isSubtask: true,
      parentTaskId: parentId,
      createdAt: T0,
      updatedAt: T0 + 14 * DAY,
      dueAt: (T0 + 22 * DAY) as EpochMs,
      estimatedDurationMinutes: 240,
      costInternal: { amount: 150, currency: 'USD' },
      priceClient: { amount: 450, currency: 'USD' },
    }),
  ];

  return { parent, subtasks };
}
