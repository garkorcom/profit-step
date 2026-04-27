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
  PatchTaskCommand,
  PatchTaskFields,
  DeleteTaskCommand,
  RemoveDependencyCommand,
} from '../../application';
import type { ListTasksQuery } from '../../application/queries/ListTasksQuery';
import type {
  Money,
  Priority,
  TaskBucket,
  TaskSource,
  UserRef,
} from '../../domain/Task';
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

/**
 * Keys the wire format MUST refuse for `PATCH /tasks/:id`.
 *
 * Two layers share this contract:
 *   1. The Firestore adapter
 *      (`tasktotime/adapters/firestore/FirestoreTaskRepository.ts:PATCH_FORBIDDEN_KEYS`)
 *      additionally rejects state-machine fields (`lifecycle`, `history`,
 *      `transitions`) — those flow through the transition handler.
 *   2. The HTTP schema (here) ALSO rejects identity / source-of-truth fields
 *      that the storage adapter happens to allow but that MUST be immutable
 *      from any external caller: `taskNumber` and `source`.
 *
 * Keep the union in sync if either side adds a new restriction. The
 * forbidden-key check must happen BEFORE the `IdempotencyPort.reserve`
 * call so a malformed request cannot consume an idempotency slot.
 */
const PATCH_HTTP_FORBIDDEN_KEYS: readonly string[] = [
  // Mirror of the Firestore adapter's PATCH_FORBIDDEN_KEYS — copied to keep
  // the HTTP layer free of an inbound dependency on a side adapter.
  'lifecycle',
  'history',
  'transitions',
  'id',
  'companyId',
  'createdAt',
  'createdBy',
  // Additionally locked at the HTTP boundary (immutable post-create).
  'taskNumber',
  'source',
];

/**
 * Whitelist of keys that may flow through `PATCH /tasks/:id`.
 *
 * Anything outside this set is treated as a validation error so that the
 * domain types act as the single source of truth for shape — adding a new
 * patchable field requires an explicit edit here AND a matching parser
 * branch below. This is more conservative than just diff-ing the forbidden
 * list against `Object.keys(Task)`, because some Task fields (e.g.
 * `subtaskRollup`, `wiki`) are computed/derived and have their own update
 * paths.
 *
 * Categories below match the layout in `tasktotime/domain/Task.ts:Task` for
 * easier grep-ability when extending.
 */
const PATCHABLE_KEYS = new Set<string>([
  // Core content
  'title',
  'description',
  'memo',
  // Lifecycle config (NOT lifecycle itself — that is forbidden)
  'bucket',
  'priority',
  'blockedReason',
  // People
  'assignedTo',
  'reviewedBy',
  'coAssignees',
  'requiredHeadcount',
  'linkedContactIds',
  // Time
  'plannedStartAt',
  'dueAt',
  'estimatedDurationMinutes',
  // Dependencies (auto-shift toggle only — `dependsOn` flows through the
  // dedicated /dependencies endpoints)
  'autoShiftEnabled',
  // Hierarchy
  'parentTaskId',
  'category',
  'phase',
  // Money
  'costInternal',
  'priceClient',
  'bonusOnTime',
  'penaltyOverdue',
  'hourlyRate',
  // Linking
  'clientId',
  'clientName',
  'projectId',
  'projectName',
  'sourceEstimateId',
  'sourceEstimateItemId',
  'sourceNoteId',
  'linkedTaskIds',
  // Visibility
  'clientVisible',
  'internalOnly',
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

  // Priority — wire format is integer 0..3 (low/medium/high/critical) but the
  // domain stores it as a string. Map at the boundary so downstream code
  // (Firestore writes, frontend chip lookups) never sees the int form.
  const priorityRaw = body.priority;
  let priorityResolved: Priority | undefined;
  if (
    typeof priorityRaw === 'number' &&
    Number.isInteger(priorityRaw) &&
    priorityRaw >= 0 &&
    priorityRaw <= 3
  ) {
    priorityResolved = (['low', 'medium', 'high', 'critical'] as const)[priorityRaw];
  } else if (
    typeof priorityRaw === 'string' &&
    (['low', 'medium', 'high', 'critical'] as const).includes(priorityRaw as Priority)
  ) {
    priorityResolved = priorityRaw as Priority;
  } else {
    errors.push({
      path: 'priority',
      message: 'must be an integer in 0..3 or a Priority string',
    });
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
    priority: priorityResolved!,
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
    query.orderBy === 'taskNumber' ||
    query.orderBy === 'titleLowercase'
  ) {
    filter.orderBy = query.orderBy;
  }
  if (query.direction === 'asc' || query.direction === 'desc') {
    filter.direction = query.direction;
  }

  if (errors.length > 0) return fail(errors);
  return ok(filter);
}

// ─── Idempotency-key extraction ────────────────────────────────────────

/**
 * Pull the idempotency key from an Express-style `req.headers`-or-`req.body`
 * pair. Both location paths are valid per `spec/05-api/rest-endpoints.md`:
 *
 *   1. `Idempotency-Key` HTTP header (preferred for REST clients).
 *   2. `idempotencyKey` body field (used by AI / voice flows that synthesise
 *      the request through the agent gateway).
 *
 * Returns `undefined` if neither location holds a non-empty string. Callers
 * raise the validation error themselves so the path-of-failure stays
 * consistent with the rest of the parser.
 *
 * The `headers` argument is typed loosely (`Record<string, unknown>`)
 * because Express's `IncomingHttpHeaders` is a string-or-array-of-strings
 * map; we coerce only when it's actually a non-empty string.
 */
export function extractIdempotencyKey(
  headers: Record<string, unknown> | undefined,
  body: unknown,
): string | undefined {
  // Header case-insensitive — Express normalises to lowercase, but be
  // defensive and check the canonical RFC casing too.
  const headerValue =
    (headers && (headers['idempotency-key'] ?? headers['Idempotency-Key'])) ??
    undefined;
  if (typeof headerValue === 'string' && headerValue.length > 0) {
    return headerValue;
  }
  if (isObject(body)) {
    const v = body['idempotencyKey'];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

// ─── Patch / delete / remove-dependency schemas ─────────────────────────

/**
 * Parse a `Money` patch fragment. Same shape as `parseMoney` but used for
 * `PATCH` payloads where the field is OPTIONAL — returns `undefined` when
 * the key is absent. Validation errors append to the shared `errors` list.
 */
function parseOptionalMoney(
  raw: unknown,
  errors: ParseError[],
  path: string,
): Money | undefined {
  if (raw === undefined) return undefined;
  return parseMoney(raw, errors, path);
}

/**
 * Parse `PATCH /api/tasktotime/tasks/:id` body.
 *
 * Behaviour:
 *   - Forbidden keys (see `PATCH_HTTP_FORBIDDEN_KEYS`) cause a 400 with the
 *     OFFENDING key in the error path so callers can pinpoint which field
 *     was rejected.
 *   - Unknown keys (anything outside `PATCHABLE_KEYS` and the forbidden
 *     list) are also rejected with `unknown_field`. We deliberately do NOT
 *     silently drop them — that would let typos pass review unnoticed.
 *   - Each known key is shape-validated with `optString` / `optNumber` /
 *     `optBoolean` / typed parsers (UserRef / Money / TaskBucket / Priority).
 *   - At least one field must be present; an empty patch returns a 400.
 *
 * Returns the assembled `PatchTaskCommand` ready for `PatchTaskHandler`.
 */
export function parsePatchTaskBody(
  taskId: string,
  body: unknown,
  by: UserRef,
  idempotencyKey: string,
): ParseResult<PatchTaskCommand> {
  if (!isObject(body)) {
    return fail([{ path: '', message: 'request body must be an object' }]);
  }
  const errors: ParseError[] = [];

  // Forbidden-key check first — before walking the patch body so that a
  // single illegal key short-circuits with a clean error path. Skip the
  // `idempotencyKey` field itself (handled by `extractIdempotencyKey`).
  const incomingKeys = Object.keys(body).filter(
    (k) => k !== 'idempotencyKey',
  );
  const forbidden = incomingKeys.filter((k) =>
    PATCH_HTTP_FORBIDDEN_KEYS.includes(k),
  );
  if (forbidden.length > 0) {
    return fail(
      forbidden.map((k) => ({
        path: k,
        message: `field is not patchable; use the dedicated endpoint instead`,
      })),
    );
  }

  const unknown = incomingKeys.filter((k) => !PATCHABLE_KEYS.has(k));
  if (unknown.length > 0) {
    return fail(
      unknown.map((k) => ({
        path: k,
        message: `unknown_field — not in PATCHABLE_KEYS`,
      })),
    );
  }

  if (incomingKeys.length === 0) {
    return fail([
      {
        path: '',
        message: 'patch body must contain at least one patchable field',
      },
    ]);
  }

  const patch: PatchTaskFields = {};

  // Strings
  for (const key of [
    'title',
    'description',
    'memo',
    'blockedReason',
    'clientId',
    'clientName',
    'projectId',
    'projectName',
    'sourceEstimateId',
    'sourceEstimateItemId',
    'sourceNoteId',
    'parentTaskId',
  ]) {
    if (key in body) {
      const v = optString(body, key);
      if (v === undefined) {
        errors.push({
          path: key,
          message: 'must be a non-empty string',
        });
      } else {
        patch[key] = v;
      }
    }
  }

  // Numbers
  for (const key of [
    'requiredHeadcount',
    'plannedStartAt',
    'dueAt',
    'estimatedDurationMinutes',
    'hourlyRate',
  ]) {
    if (key in body) {
      const v = optNumber(body, key);
      if (v === undefined) {
        errors.push({ path: key, message: 'must be a finite number' });
      } else {
        patch[key] = v;
      }
    }
  }

  // Booleans
  for (const key of [
    'autoShiftEnabled',
    'clientVisible',
    'internalOnly',
  ]) {
    if (key in body) {
      const v = optBoolean(body, key);
      if (v === undefined) {
        errors.push({ path: key, message: 'must be a boolean' });
      } else {
        patch[key] = v;
      }
    }
  }

  // bucket / priority — enums
  if ('bucket' in body) {
    const raw = body.bucket;
    if (typeof raw !== 'string' || !VALID_BUCKETS.has(raw as TaskBucket)) {
      errors.push({
        path: 'bucket',
        message: `must be one of ${[...VALID_BUCKETS].join(' | ')}`,
      });
    } else {
      patch.bucket = raw as TaskBucket;
    }
  }
  if ('priority' in body) {
    const raw = body.priority;
    if (
      typeof raw === 'number' &&
      Number.isInteger(raw) &&
      raw >= 0 &&
      raw <= 3
    ) {
      patch.priority = (['low', 'medium', 'high', 'critical'] as const)[raw];
    } else if (
      typeof raw === 'string' &&
      (['low', 'medium', 'high', 'critical'] as const).includes(
        raw as Priority,
      )
    ) {
      patch.priority = raw as Priority;
    } else {
      errors.push({
        path: 'priority',
        message: 'must be an integer in 0..3 or a Priority string',
      });
    }
  }

  // category / phase — typed string passthrough (further validated by domain)
  if ('category' in body) {
    if (typeof body.category !== 'string') {
      errors.push({ path: 'category', message: 'must be a string' });
    } else {
      patch.category = body.category;
    }
  }
  if ('phase' in body) {
    if (typeof body.phase !== 'string') {
      errors.push({ path: 'phase', message: 'must be a string' });
    } else {
      patch.phase = body.phase;
    }
  }

  // assignedTo / reviewedBy — UserRef
  if ('assignedTo' in body) {
    const ref = parseUserRef(body.assignedTo, errors, 'assignedTo');
    if (ref) patch.assignedTo = ref;
  }
  if ('reviewedBy' in body) {
    const ref = parseUserRef(body.reviewedBy, errors, 'reviewedBy');
    if (ref) patch.reviewedBy = ref;
  }

  // coAssignees — UserRef[]
  if ('coAssignees' in body) {
    if (!Array.isArray(body.coAssignees)) {
      errors.push({
        path: 'coAssignees',
        message: 'must be an array of UserRef',
      });
    } else {
      const refs: UserRef[] = [];
      body.coAssignees.forEach((raw, i) => {
        const ref = parseUserRef(raw, errors, `coAssignees[${i}]`);
        if (ref) refs.push(ref);
      });
      patch.coAssignees = refs;
    }
  }

  // linkedContactIds / linkedTaskIds — string[]
  for (const key of ['linkedContactIds', 'linkedTaskIds']) {
    if (key in body) {
      const raw = body[key];
      if (!isStringArray(raw)) {
        errors.push({
          path: key,
          message: 'must be an array of non-empty strings',
        });
      } else {
        patch[key] = raw;
      }
    }
  }

  // Money fields
  for (const key of [
    'costInternal',
    'priceClient',
    'bonusOnTime',
    'penaltyOverdue',
  ]) {
    if (key in body) {
      const m = parseOptionalMoney(body[key], errors, key);
      if (m !== undefined) patch[key] = m;
    }
  }

  if (errors.length > 0) return fail(errors);
  return ok({
    idempotencyKey,
    by,
    taskId,
    patch,
  });
}

/**
 * Parse `DELETE /api/tasktotime/tasks/:id` body. The body is OPTIONAL — the
 * caller may omit it entirely. The only field consumed is `idempotencyKey`,
 * which the HTTP handler usually pre-extracts via `extractIdempotencyKey`.
 *
 * Why this exists at all (vs. inline in the handler): keeping all schema
 * shaping in one file means the OpenAPI contract has a single source.
 */
export function parseDeleteTaskParams(
  taskId: string,
  by: UserRef,
  idempotencyKey: string,
): ParseResult<DeleteTaskCommand> {
  if (typeof taskId !== 'string' || taskId.length === 0) {
    return fail([
      { path: 'id', message: 'taskId path param required' },
    ]);
  }
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
    return fail([
      {
        path: 'idempotencyKey',
        message: 'must be supplied via Idempotency-Key header or body',
      },
    ]);
  }
  return ok({ idempotencyKey, by, taskId });
}

/**
 * Parse `DELETE /api/tasktotime/tasks/:id/dependencies/:depId` route params.
 * `depId` is interpreted as the predecessor task id (= `to` side of the
 * edge). The convention follows `spec/05-api/rest-endpoints.md`: edges live
 * on `from.dependsOn[]` and the `:depId` segment names the target.
 */
export function parseRemoveDependencyParams(
  fromTaskId: string,
  depId: string,
  by: UserRef,
  idempotencyKey: string,
): ParseResult<RemoveDependencyCommand> {
  const errors: ParseError[] = [];
  if (typeof fromTaskId !== 'string' || fromTaskId.length === 0) {
    errors.push({ path: 'id', message: 'taskId path param required' });
  }
  if (typeof depId !== 'string' || depId.length === 0) {
    errors.push({ path: 'depId', message: 'depId path param required' });
  }
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
    errors.push({
      path: 'idempotencyKey',
      message: 'must be supplied via Idempotency-Key header or body',
    });
  }
  if (errors.length > 0) return fail(errors);
  return ok({
    idempotencyKey,
    by,
    fromTaskId,
    toTaskId: depId,
  });
}

// ─── Re-exports for tests ─────────────────────────────────────────────
export { PATCH_HTTP_FORBIDDEN_KEYS, PATCHABLE_KEYS };
