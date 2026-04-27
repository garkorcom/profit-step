/**
 * PatchTaskCommand — DTO for partially updating a task via the REST adapter.
 *
 * Mirrors the contract in `spec/05-api/rest-endpoints.md §PATCH /tasks/:id`:
 * lifecycle and identity-typed fields MUST NOT be mutated through this path
 * (lifecycle changes go through the transition state machine instead). The
 * HTTP layer is responsible for whitelisting fields against
 * `tasktotime/adapters/firestore/FirestoreTaskRepository.ts:PATCH_FORBIDDEN_KEYS`
 * and rejecting `taskNumber` / `source` (immutable post-create).
 *
 * The handler performs the idempotency reservation via `IdempotencyPort`
 * (mirroring `TaskService.createTask`'s pattern) and then dispatches into
 * `TaskRepository.patch` — itself a guarded partial update that re-validates
 * the forbidden-key list at the storage boundary.
 */

import type { UserRef } from '../../domain/Task';

/**
 * Subset of patchable fields. Intentionally typed as `Record<string, unknown>`
 * — the HTTP schema enforces shape; the domain layer re-enforces invariants
 * via `TaskRepository.patch`.
 */
export type PatchTaskFields = Record<string, unknown>;

export interface PatchTaskCommand {
  /** Idempotency key — stable per user-action (header or body). */
  idempotencyKey: string;
  /** Author derived from auth, never client input. */
  by: UserRef;
  /** Target task id. */
  taskId: string;
  /** Partial update payload — already whitelisted by the HTTP schema. */
  patch: PatchTaskFields;
}
