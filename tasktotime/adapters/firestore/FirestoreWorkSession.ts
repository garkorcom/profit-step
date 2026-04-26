/**
 * FirestoreWorkSession — `work_sessions/` adapter.
 *
 * Implements {@link WorkSessionPort} on top of Firebase Admin Firestore.
 * Read-only — work_sessions are written by the existing time-tracking
 * module (worker bot + backend). tasktotime only reads them to aggregate
 * actuals at `complete` lifecycle action.
 *
 * See spec/04-storage/adapter-mapping.md §13 WorkSessionPort.
 *
 * Indexes:
 *   - `relatedTaskId + startTime(desc)`  (EXISTING — firestore.indexes.json:737-749)
 *   - `relatedTaskId + status`           (NEW PR-A — extends existing)
 *
 * Conventions:
 *   - Timestamps converted at the boundary via `toEpochMs`.
 *   - Aggregates computed in memory (no Firestore aggregation API).
 */

import type { Firestore } from 'firebase-admin/firestore';

import type {
  WorkSessionPort,
  WorkSessionSnapshot,
  WorkSessionAggregate,
} from '../../ports/work/WorkSessionPort';
import {
  asTaskId,
  asUserId,
  asWorkSessionId,
  type TaskId,
} from '../../domain/identifiers';
import { mapFirestoreError } from '../errors';
import { type AdapterLogger, noopLogger, toEpochMs } from './_shared';

const COLLECTION = 'work_sessions';

export class FirestoreWorkSession implements WorkSessionPort {
  constructor(
    private readonly db: Firestore,
    private readonly logger: AdapterLogger = noopLogger,
  ) {}

  /**
   * List sessions for a task, newest first.
   *
   * Adapter mapping (§13 row 1):
   *   `where relatedTaskId == X .orderBy startTime desc`.
   * Existing index: `(relatedTaskId, startTime desc)`.
   */
  async findByTask(taskId: TaskId): Promise<WorkSessionSnapshot[]> {
    try {
      const q = this.db
        .collection(COLLECTION)
        .where('relatedTaskId', '==', taskId)
        .orderBy('startTime', 'desc');
      const snap = await q.get();
      return snap.docs
        .map((d) => {
          const data = d.data();
          return data ? mapToSnapshot(data, d.id) : null;
        })
        .filter((x): x is WorkSessionSnapshot => x !== null);
    } catch (err) {
      this.logger.error?.('FirestoreWorkSession.findByTask failed', { taskId, err });
      throw mapFirestoreError(err, { op: 'WorkSession.findByTask', taskId });
    }
  }

  /**
   * Aggregate completed sessions for a task → totals + time bracket.
   * Used by `TaskService.complete` to populate `Task.actualDurationMinutes`,
   * `Task.totalEarnings`, and the actual start/end window.
   *
   * Adapter mapping (§13 row 2):
   *   `where relatedTaskId == X .where status == 'completed'` then reduce.
   * New index: `(relatedTaskId, status)`.
   */
  async aggregateForTask(taskId: TaskId): Promise<WorkSessionAggregate> {
    try {
      const q = this.db
        .collection(COLLECTION)
        .where('relatedTaskId', '==', taskId)
        .where('status', '==', 'completed');
      const snap = await q.get();

      let totalDurationMinutes = 0;
      let totalEarnings = 0;
      let earliestStartAt: number | null = null;
      let latestEndAt: number | null = null;

      for (const d of snap.docs) {
        const data = d.data();
        if (!data) continue;
        const dur = typeof data.durationMinutes === 'number' ? data.durationMinutes : 0;
        const earn = typeof data.sessionEarnings === 'number' ? data.sessionEarnings : 0;
        totalDurationMinutes += dur;
        totalEarnings += earn;

        const start = toEpochMs(data.startTime);
        if (start != null && (earliestStartAt === null || start < earliestStartAt)) {
          earliestStartAt = start;
        }
        const end = toEpochMs(data.endTime);
        if (end != null && (latestEndAt === null || end > latestEndAt)) {
          latestEndAt = end;
        }
      }

      return {
        totalDurationMinutes,
        totalEarnings,
        earliestStartAt,
        latestEndAt,
      };
    } catch (err) {
      this.logger.error?.('FirestoreWorkSession.aggregateForTask failed', {
        taskId,
        err,
      });
      throw mapFirestoreError(err, {
        op: 'WorkSession.aggregateForTask',
        taskId,
      });
    }
  }
}

// ─── Internal: Firestore data → WorkSessionSnapshot ────────────────────

function mapToSnapshot(
  data: FirebaseFirestore.DocumentData,
  id: string,
): WorkSessionSnapshot {
  const status = (data.status ?? 'completed') as WorkSessionSnapshot['status'];
  const result: WorkSessionSnapshot = {
    id: asWorkSessionId(id),
    employeeId: asUserId(String(data.employeeId ?? '')),
    startTime: toEpochMs(data.startTime) ?? 0,
    status,
  };
  if (typeof data.relatedTaskId === 'string' && data.relatedTaskId.length > 0) {
    result.relatedTaskId = asTaskId(data.relatedTaskId);
  }
  const endTime = toEpochMs(data.endTime);
  if (endTime != null) result.endTime = endTime;
  if (typeof data.durationMinutes === 'number') {
    result.durationMinutes = data.durationMinutes;
  }
  if (typeof data.hourlyRate === 'number') {
    result.hourlyRate = data.hourlyRate;
  }
  if (typeof data.sessionEarnings === 'number') {
    result.sessionEarnings = data.sessionEarnings;
  }
  return result;
}
