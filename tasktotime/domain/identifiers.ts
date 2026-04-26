/**
 * Branded types for type-safe identifiers.
 *
 * Branded (a.k.a. opaque) types prevent accidentally passing a `clientId`
 * where a `taskId` is expected — at compile time. At runtime they are plain
 * strings; the brand exists only in the type system.
 *
 * Usage:
 *   const taskId: TaskId = 'task_123' as TaskId;
 *   const clientId: ClientId = 'client_xyz' as ClientId;
 *   // taskId = clientId; // ← compile error
 *
 * See spec/01-overview/hexagonal-blueprint.md §1 — domain layer is pure
 * TypeScript with branded types for identifiers. No Firebase imports.
 */

declare const __brand: unique symbol;
type Brand<TBase, TBrand extends string> = TBase & {
  readonly [__brand]: TBrand;
};

// ─── Domain identifiers ────────────────────────────────────────────────

/** Task document id in `tasktotime_tasks/{id}`. */
export type TaskId = Brand<string, 'TaskId'>;

/** Company tenant id (RLS scope). */
export type CompanyId = Brand<string, 'CompanyId'>;

/** Firebase Auth uid in `users/{uid}`. */
export type UserId = Brand<string, 'UserId'>;

/** Project document id in `projects/{id}`. */
export type ProjectId = Brand<string, 'ProjectId'>;

/** Client document id in `clients/{id}`. */
export type ClientId = Brand<string, 'ClientId'>;

/** Site document id in `sites/{id}`. */
export type SiteId = Brand<string, 'SiteId'>;

/** Estimate document id in `estimates/{id}`. */
export type EstimateId = Brand<string, 'EstimateId'>;

/** Estimate item id (subdoc within estimate). */
export type EstimateItemId = Brand<string, 'EstimateItemId'>;

/** Note document id in `notes/{id}` — used as AI source. */
export type NoteId = Brand<string, 'NoteId'>;

/** Contact document id in `contacts/{id}`. */
export type ContactId = Brand<string, 'ContactId'>;

/** Inventory catalog item id. */
export type CatalogItemId = Brand<string, 'CatalogItemId'>;

/** File metadata id in `files/{id}`. */
export type FileId = Brand<string, 'FileId'>;

/** Work session id (`work_sessions/{id}`). */
export type WorkSessionId = Brand<string, 'WorkSessionId'>;

/** Payroll period id (e.g. "2026-W17"). */
export type PayrollPeriodId = Brand<string, 'PayrollPeriodId'>;

// ─── Constructors / converters ─────────────────────────────────────────

/**
 * Cast a plain string to `TaskId`. Use only at the boundary (adapters,
 * deserialization). Inside domain code, accept `TaskId` directly.
 */
export const asTaskId = (s: string): TaskId => s as TaskId;
export const asCompanyId = (s: string): CompanyId => s as CompanyId;
export const asUserId = (s: string): UserId => s as UserId;
export const asProjectId = (s: string): ProjectId => s as ProjectId;
export const asClientId = (s: string): ClientId => s as ClientId;
export const asSiteId = (s: string): SiteId => s as SiteId;
export const asEstimateId = (s: string): EstimateId => s as EstimateId;
export const asEstimateItemId = (s: string): EstimateItemId => s as EstimateItemId;
export const asNoteId = (s: string): NoteId => s as NoteId;
export const asContactId = (s: string): ContactId => s as ContactId;
export const asCatalogItemId = (s: string): CatalogItemId => s as CatalogItemId;
export const asFileId = (s: string): FileId => s as FileId;
export const asWorkSessionId = (s: string): WorkSessionId => s as WorkSessionId;
export const asPayrollPeriodId = (s: string): PayrollPeriodId => s as PayrollPeriodId;
