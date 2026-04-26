/**
 * WorkSessionPort — read-only access to `work_sessions/{id}` filtered by task.
 *
 * Used by `TaskService.aggregateActuals` (called on `complete` transition)
 * to populate `Task.actualDurationMinutes` and `Task.totalEarnings`.
 *
 * See spec/04-storage/data-dependencies.md §work_sessions.
 */

import type { TaskId, UserId, WorkSessionId } from '../../domain/identifiers';

export interface WorkSessionSnapshot {
  id: WorkSessionId;
  relatedTaskId?: TaskId;
  employeeId: UserId;
  startTime: number;
  endTime?: number;
  durationMinutes?: number;
  hourlyRate?: number;
  sessionEarnings?: number;
  status: 'active' | 'paused' | 'completed' | 'discarded';
}

export interface WorkSessionAggregate {
  totalDurationMinutes: number;
  totalEarnings: number;
  earliestStartAt: number | null;
  latestEndAt: number | null;
}

export interface WorkSessionPort {
  findByTask(taskId: TaskId): Promise<WorkSessionSnapshot[]>;
  /**
   * Sum across all sessions for a task. Used during `complete` to
   * populate Task.actualDurationMinutes / totalEarnings.
   */
  aggregateForTask(taskId: TaskId): Promise<WorkSessionAggregate>;
}
