/**
 * HTTP request schemas — hand-rolled validators.
 *
 * The root workspace doesn't ship `zod`, so each schema is a small
 * type-narrowing function that returns either a fully-typed command/query or
 * a structured error payload. Keeping the shape close to a Zod safeParse
 * makes it easy to swap in Zod (or io-ts, etc.) later if the dep ever
 * lands.
 *
 * Validation philosophy:
 *   - Required fields explicitly checked.
 *   - Types narrowed with `typeof` / `Array.isArray`.
 *   - Numeric ranges checked where the domain is known (priority 0..3, etc.).
 *   - Anything not validated here is forwarded as-is to the application
 *     layer; the domain re-validates business invariants there.
 *
 * The error payload mirrors Zod: `{ ok: false, errors: [{ path, message }] }`
 * so the error middleware can format consistently.
 */

import type {
  CreateTaskCommand,
  AddDependencyCommand,
  TransitionTaskCommand,
  UpdateWikiCommand,
} from '../../application';
import type { ListTasksQuery } from '../../application/queries/ListTasksQuery';
import type { Priority, TaskBucket, TaskSource, UserRef } from '../../domain/Task';
import type { TaskLifecycle, TransitionAction } from '../../domain/lifecycle';

// ─── Result shape ───────────────────────────────────────────────────────

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: ParseError[] };

export interface ParseError {
  path: string;
  message: string;
}

const VALID_BUCKETS = new Set<TaskBucket>([
  'inbox',
  'next',
  'someday',
  'archive',
]);
const VALID_SOURCES = new Set<TaskSource>([
  'web',
  'telegram',
  'voice',
  'ai',
  'estimate_decompose',
  'api',
]);
const VALID_DEPENDENCY_TYPES = new Set<AddDependencyCommand['type']>([
  'finish_to_start',
  'start_to_start',
  'finish_to_finish',
  'start_to_finish',
]);
const VALID_TRANSITION_ACTIONS = new Set<TransitionAction>([
  'create',
  'ready',
  'start',
  'block',
  'unblock',
  'complete',
  'accept',
  'cancel',
]);
const VALID_LIFECYCLES = new Set<TaskLifecycle>([
  'draft',
  'ready',
  'started',
  'blocked',
  'completed',
  'accepted',
  'cancelled',
]);

// ─── Common helpers ────────────────────────────────────────────────────

function ok<T>(value: T): ParseResult<T> {
  return { ok: true, value };
}

function fail(errors: ParseError[]): ParseResult<never> {
  return { ok: false, errors };
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function requireString(
  obj: Record<string, unknown>,
  key: string,
  errors: ParseError[],
  parent = '',
): string | undefined {
  const v = obj[key];
  if (typeof v !== 'string' || v.length === 0) {
    errors.push({ path: parent + key, message: 'must be a non-empty string' });
    return undefined;
  }
  return v;
}

function requireNumber(
  obj: Record<string, unknown>,
  key: string,
  errors: ParseError[],
  parent = '',
): number | undefined {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    errors.push({ path: parent + key, message: 'must be a finite number' });
    return undefined;
  }
  return v;
}

function optString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function optNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function optBoolean(obj: Record<string, unknown>, key: string): boolean | undefined {
  const v = obj[key];
  return typeof v === 'boolean' ? v : undefined;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function parseUserRef(
  raw: unknown,
  errors: ParseError[],
  path: string,
): UserRef | undefined {
  if (!isObject(raw)) {
    errors.push({ path, message: 'must be an object { id, name }' });
    return undefined;
  }
  const id = requireString(raw, 'id', errors, `${path}.`);
  const name = requireString(raw, 'name', errors, `${path}.`);
  if (id && name) {
    const ref: UserRef = { id, name };
    if (
      raw.role === 'executor' ||
      raw.role === 'reviewer' ||
      raw.role === 'observer'
    ) {
      ref.role = raw.role;
    }
    return ref;
  }
  return undefined;
}

function parseMoney(
  raw: unknown,
  errors: ParseError[],
  path: string,
): { amount: number; currency: 'USD' | 'RUB' | 'EUR' } | undefined {
  if (!isObject(raw)) {
    errors.push({
      path,
      message: 'must be an object { amount, currency }',
    });
    return undefined;
  }
  const amount = requireNumber(raw, 'amount', errors, `${path}.`);
  const currency = raw.currency;
  if (currency !== 'USD' && currency !== 'RUB' && currency !== 'EUR') {
    errors.push({
      path: `${path}.currency`,
      message: `must be one of 'USD' | 'RUB' | 'EUR'`,
    });
    return undefined;
  }
  if (amount == null) return undefined;
  return { amount, currency };
}

// ─── Schemas ────────────────────────────────────────────────────────────

/** `POST /api/tasktotime/tasks` */
export function parseCreateTaskBody(
  body: unknown,
  by: UserRef,
): ParseResult<CreateTaskCommand> {
  if (!isObject(body)) {
    return fail([{ path: '', message: 'request body must be an object' }]);
  }
  const errors: ParseError[] = [];

  const idempotencyKey = requireString(body, 'idempotencyKey', errors);
  const companyId = requireString(body, 'companyId', errors);
  const title = requireString(body, 'title', errors);
  const dueAt = requireNumber(body, 'dueAt', errors);
  const estimatedDurationMinutes = requireNumber(
    body,
    'estimatedDurationMinutes',
    errors,
  );

  const bucketRaw = body.bucket;
  if (typeof bucketRaw !== 'string' || !VALID_BUCKETS.has(bucketRaw as TaskBucket)) {
    errors.push({
      path: 'bucket',
      message: `must be one of ${[...VALID_BUCKETS].join(' | ')}`,
    });
  }

  const priorityRaw = body.priority;
  if (
    typeof priorityRaw !== 'number' ||
    !Number.isInteger(priorityRaw) ||
    priorityRaw < 0 ||
    priorityRaw > 3
  ) {
    errors.push({ path: 'priority', message: 'must be an integer in 0..3' });
  }

  const sourceRaw = body.source;
  if (typeof sourceRaw !== 'string' || !VALID_SOURCES.has(sourceRaw as TaskSource)) {
    errors.push({
      path: 'source',
      message: `must be one of ${[...VALID_SOURCES].join(' | ')}`,
    });
  }

  const requiredHeadcount = requireNumber(body, 'requiredHeadcount', errors);
  const assignedTo = parseUserRef(body.assignedTo, errors, 'assignedTo');

  const costInternal = parseMoney(body.costInternal, errors, 'costInternal');
  const priceClient = parseMoney(body.priceClient, errors, 'priceClient');

  if (errors.length > 0) return fail(errors);

  const command: CreateTaskCommand = {
    idempotencyKey: idempotencyKey!,
    by,
    companyId: companyId!,
    title: title!,
    dueAt: dueAt!,
    estimatedDurationMinutes: estimatedDurationMinutes!,
    bucket: bucketRaw as TaskBucket,
    priority: priorityRaw as Priority,
    source: sourceRaw as TaskSource,
    requiredHeadcount: requiredHeadcount!,
    assignedTo: assignedTo!,
    costInternal: costInternal!,
    priceClient: priceClient!,
    description: optString(body, 'description'),
    memo: optString(body, 'memo'),
    parentTaskId: optString(body, 'parentTaskId'),
    clientId: optString(body, 'clientId'),
    clientName: optString(body, 'clientName'),
    projectId: optString(body, 'projectId'),
    projectName: optString(body, 'projectName'),
    sourceEstimateId: optString(body, 'sourceEstimateId'),
    sourceEstimateItemId: optString(body, 'sourceEstimateItemId'),
    sourceNoteId: optString(body, 'sourceNoteId'),
    plannedStartAt: optNumber(body, 'plannedStartAt'),
    clientVisible: optBoolean(body, 'clientVisible'),
    internalOnly: optBoolean(body, 'internalOnly'),
    initialLifecycle:
      body.initialLifecycle === 'ready' ? 'ready' : 'draft',
  };
  if (isStringArray(body.linkedContactIds)) {
    command.linkedContactIds = body.linkedContactIds;
  }
  if (Array.isArray(body.coAssignees)) {
    const refs: UserRef[] = [];
    body.coAssignees.forEach((raw, i) => {
      const ref = parseUserRef(raw, errors, `coAssignees[${i}]`);
      if (ref) refs.push(ref);
    });
    if (errors.length > 0) return fail(errors);
    command.coAssignees = refs;
  }
  if (isObject(body.reviewedBy)) {
    const ref = parseUserRef(body.reviewedBy, errors, 'reviewedBy');
    if (errors.length > 0) return fail(errors);
    if (ref) command.reviewedBy = ref;
  }
  if (typeof body.category === 'string') {
    command.category = body.category as CreateTaskCommand['category'];
  }
  if (typeof body.phase === 'string') {
    command.phase = body.phase as CreateTaskCommand['phase'];
  }

  return ok(command);
}

/** `POST /api/tasktotime/tasks/:id/transition` */
export function parseTransitionBody(
  taskId: string,
  body: unknown,
  by: UserRef,
): ParseResult<TransitionTaskCommand> {
  if (!isObject(body)) {
    return fail([{ path: '', message: 'request body must be an object' }]);
  }
  const errors: ParseError[] = [];

  const idempotencyKey = requireString(body, 'idempotencyKey', errors);
  const action = body.action;
  if (
    typeof action !== 'string' ||
    !VALID_TRANSITION_ACTIONS.has(action as TransitionAction)
  ) {
    errors.push({
      path: 'action',
      message: `must be one of ${[...VALID_TRANSITION_ACTIONS].join(' | ')}`,
    });
  }

  if (errors.length > 0) return fail(errors);
  const command: TransitionTaskCommand = {
    taskId,
    action: action as TransitionAction,
    by,
    reason: optString(body, 'reason'),
    blockedReason: optString(body, 'blockedReason'),
    idempotencyKey: idempotencyKey!,
  };
  if (isObject(body.acceptance)) {
    // The application/domain layer validates the AcceptanceAct shape further;
    // here we just forward it as a structurally compatible object.
    command.acceptance = body.acceptance as unknown as TransitionTaskCommand['acceptance'];
  }
  return ok(command);
}

/** `POST /api/tasktotime/tasks/:id/dependencies` */
export function parseAddDependencyBody(
  fromTaskId: string,
  body: unknown,
  by: UserRef,
): ParseResult<AddDependencyCommand> {
  if (!isObject(body)) {
    return fail([{ path: '', message: 'request body must be an object' }]);
  }
  const errors: ParseError[] = [];

  const toTaskId = requireString(body, 'toTaskId', errors);
  const type = body.type;
  if (
    typeof type !== 'string' ||
    !VALID_DEPENDENCY_TYPES.has(type as AddDependencyCommand['type'])
  ) {
    errors.push({
      path: 'type',
      message: `must be one of ${[...VALID_DEPENDENCY_TYPES].join(' | ')}`,
    });
  }
  const isHardBlock = body.isHardBlock;
  if (typeof isHardBlock !== 'boolean') {
    errors.push({ path: 'isHardBlock', message: 'must be a boolean' });
  }

  if (errors.length > 0) return fail(errors);

  return ok({
    fromTaskId,
    toTaskId: toTaskId!,
    type: type as AddDependencyCommand['type'],
    isHardBlock: isHardBlock as boolean,
    lagMinutes: optNumber(body, 'lagMinutes'),
    reason: optString(body, 'reason'),
    by,
  });
}

/** `PUT /api/tasktotime/tasks/:id/wiki` */
export function parseUpdateWikiBody(
  taskId: string,
  body: unknown,
  by: UserRef,
): ParseResult<UpdateWikiCommand> {
  if (!isObject(body)) {
    return fail([{ path: '', message: 'request body must be an object' }]);
  }
  const errors: ParseError[] = [];

  const contentMd = body.contentMd;
  if (typeof contentMd !== 'string') {
    errors.push({ path: 'contentMd', message: 'must be a string' });
  }
  const expectedVersion = requireNumber(body, 'expectedVersion', errors);

  if (errors.length > 0) return fail(errors);

  return ok({
    taskId,
    contentMd: contentMd as string,
    expectedVersion: expectedVersion!,
    by,
    changeSummary: optString(body, 'changeSummary'),
  });
}

/** `GET /api/tasktotime/tasks` query string. */
export function parseListTasksQuery(
  query: Record<string, unknown>,
): ParseResult<ListTasksQuery> {
  const errors: ParseError[] = [];
  const companyId = requireString(query, 'companyId', errors);
  if (errors.length > 0) return fail(errors);

  const filter: ListTasksQuery = { companyId: companyId! };

  if (typeof query.lifecycle === 'string') {
    const arr = query.lifecycle.split(',').filter(Boolean) as TaskLifecycle[];
    if (arr.every((l) => VALID_LIFECYCLES.has(l))) {
      filter.lifecycle = arr;
    } else {
      errors.push({
        path: 'lifecycle',
        message: 'comma-separated lifecycle values are not all valid',
      });
    }
  }
  if (typeof query.bucket === 'string') {
    const arr = query.bucket.split(',').filter(Boolean) as TaskBucket[];
    if (arr.every((b) => VALID_BUCKETS.has(b))) {
      filter.bucket = arr;
    } else {
      errors.push({ path: 'bucket', message: 'invalid bucket value' });
    }
  }
  if (typeof query.assigneeId === 'string') filter.assigneeId = query.assigneeId;
  if (typeof query.parentTaskId === 'string') {
    filter.parentTaskId = query.parentTaskId === 'null' ? null : query.parentTaskId;
  }
  if (typeof query.projectId === 'string') filter.projectId = query.projectId;
  if (typeof query.clientId === 'string') filter.clientId = query.clientId;
  if (query.isSubtask === 'true' || query.isSubtask === 'false') {
    filter.isSubtask = query.isSubtask === 'true';
  }
  if (query.archivedOnly === 'true') filter.archivedOnly = true;
  if (typeof query.dueBefore === 'string') {
    const n = Number(query.dueBefore);
    if (Number.isFinite(n)) filter.dueBefore = n;
  }
  if (typeof query.search === 'string' && query.search.length > 0) {
    filter.search = query.search;
  }
  if (typeof query.limit === 'string') {
    const n = Number(query.limit);
    if (Number.isInteger(n) && n > 0 && n <= 200) filter.limit = n;
  }
  if (typeof query.cursor === 'string' && query.cursor.length > 0) {
    filter.cursor = query.cursor;
  }
  if (
    query.orderBy === 'createdAt' ||
    query.orderBy === 'updatedAt' ||
    query.orderBy === 'dueAt' ||
    query.orderBy === 'priority' ||
    query.orderBy === 'taskNumber'
  ) {
    filter.orderBy = query.orderBy;
  }
  if (query.direction === 'asc' || query.direction === 'desc') {
    filter.direction = query.direction;
  }

  if (errors.length > 0) return fail(errors);
  return ok(filter);
}
