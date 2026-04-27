/**
 * Map a Firestore document data + id into a domain `Task`. Wraps the
 * existing `tasktotime/adapters/firestore/_shared.timestampsToEpochs`
 * walker, which converts every `Timestamp` (top-level + nested) into
 * `EpochMs = number`.
 *
 * Used by Cloud Function trigger wrappers in `functions/src/tasktotime/
 * triggers/firestore/`. The pure adapter handlers consume `Task` (with
 * `EpochMs`) — this thin mapper bridges the wire shape.
 */

import type { DocumentData } from 'firebase-admin/firestore';

import { timestampsToEpochs } from '../../../../tasktotime/adapters/firestore/_shared';
import type { Task } from '../../../../tasktotime/domain/Task';

/**
 * Returned `Task` may have missing fields if Firestore stored an incomplete
 * doc — the adapter handlers guard against this with explicit null checks
 * (e.g. `if (!after) return skipped(...)`). The cast is intentional: at
 * the trigger boundary we trust Firestore + the application write paths to
 * supply a well-formed shape, and treat anything else as a defensive skip.
 */
export function taskFromSnapshot(data: DocumentData, id: string): Task {
  const converted = timestampsToEpochs({ ...data }) as Record<string, unknown>;
  return { ...converted, id } as unknown as Task;
}
