/**
 * Adapters — composition entry point.
 *
 * Re-exports the firestore-side and external-side adapter classes plus the
 * shared error types. Provides a `createAdapters(deps)` factory that wires
 * each adapter to its dependencies in one place.
 *
 * The factory return type is the **port interfaces** (not the concrete
 * classes) so application code stays coupled only to ports. Callers that
 * need a concrete subtype can still import the class directly from the
 * sub-barrels (`./firestore`, `./external`).
 *
 * See spec/04-storage/adapter-mapping.md and spec/01-overview/hexagonal-blueprint.md.
 */

import type { Firestore } from 'firebase-admin/firestore';
import type { Messaging } from 'firebase-admin/messaging';
import type { Storage } from 'firebase-admin/storage';

import type { TaskRepository, TransitionLogPort } from '../ports/repositories';
import type {
  ClientLookupPort,
  ContactLookupPort,
  EstimatePort,
  NotePort,
  ProjectLookupPort,
  SiteLookupPort,
  UserLookupPort,
} from '../ports/lookups';
import type { EmployeeLookupPort } from '../ports/lookups/EmployeeLookupPort';
import type {
  InventoryCatalogPort,
  InventoryTxPort,
} from '../ports/inventory';
import type { PayrollPort, WorkSessionPort } from '../ports/work';
import type {
  AIAuditPort,
  AICachePort,
  IdempotencyPort,
} from '../ports/ai';
import type {
  EmailNotifyPort,
  PushNotifyPort,
  TelegramNotifyPort,
} from '../ports/notify';
import type {
  BigQueryAuditPort,
  ClockPort,
  FilePort,
  IdGeneratorPort,
  StorageUploadPort,
  WeatherForecastPort,
} from '../ports/infra';

import {
  FirestoreAIAudit,
  FirestoreAICache,
  FirestoreClientLookup,
  FirestoreContactLookup,
  FirestoreEmployeeLookup,
  FirestoreEstimate,
  FirestoreFile,
  FirestoreIdGenerator,
  FirestoreIdempotency,
  FirestoreInventoryCatalog,
  FirestoreInventoryTx,
  FirestoreNote,
  FirestorePayroll,
  FirestoreProjectLookup,
  FirestoreSiteLookup,
  FirestoreTaskRepository,
  FirestoreTransitionLog,
  FirestoreUserLookup,
  FirestoreWorkSession,
  RealClock,
  type AdapterLogger,
} from './firestore';
import {
  BigQueryAuditAdapter,
  BrevoEmailNotifyAdapter,
  FCMPushNotifyAdapter,
  FirebaseStorageUploadAdapter,
  MockWeatherForecastAdapter,
  TelegramNotifyAdapter,
  type BigQueryLike,
} from './external';

// ─── Sub-barrel re-exports ─────────────────────────────────────────────

export * from './errors';
export * from './firestore';
export * from './external';

// ─── Adapter bundle ─────────────────────────────────────────────────────

export interface Adapters {
  // §1, §2 — task aggregate
  taskRepo: TaskRepository;
  transitionLog: TransitionLogPort;
  // §3-9 — read-side lookups
  clientLookup: ClientLookupPort;
  projectLookup: ProjectLookupPort;
  userLookup: UserLookupPort;
  employeeLookup: EmployeeLookupPort;
  contactLookup: ContactLookupPort;
  siteLookup: SiteLookupPort;
  // §10, §11 — content
  estimate: EstimatePort;
  note: NotePort;
  // §12, §13 — work + payroll
  workSession: WorkSessionPort;
  payroll: PayrollPort;
  // §14 — inventory
  inventoryCatalog: InventoryCatalogPort;
  inventoryTx: InventoryTxPort;
  // §15-17 — AI audit / cache / idempotency
  aiAudit: AIAuditPort;
  aiCache: AICachePort;
  idempotency: IdempotencyPort;
  // §24 — file metadata
  file: FilePort;
  // §25, §26 — clock + id generator
  clock: ClockPort;
  idGenerator: IdGeneratorPort;
  // §18-23 — external services
  telegram: TelegramNotifyPort;
  email: EmailNotifyPort;
  push: PushNotifyPort;
  bigQueryAudit: BigQueryAuditPort;
  storage: StorageUploadPort;
  weather: WeatherForecastPort;
}

export interface CreateAdaptersDeps {
  /** Firebase Admin Firestore handle. */
  db: Firestore;
  /** Firebase Admin Messaging handle (for FCM push). */
  messaging: Messaging;
  /** Firebase Admin Storage handle. */
  storage: Storage;
  /** BigQuery client (structural — see `BigQueryLike` for the surface used). */
  bigquery: BigQueryLike;

  /** Telegram bot token (resolved from Secret Manager by composition root). */
  telegramBotToken: string;
  /** Brevo (Sendinblue) API key. */
  brevoApiKey: string;
  /** Default `from` address for outbound email (e.g. `noreply@profit-step.dev`). */
  brevoSenderEmail: string;
  /** Display name shown alongside the from address. */
  brevoSenderName: string;

  /** Default GCS bucket — used when callers don't pass `input.bucket`. */
  defaultStorageBucket: string;

  /** Optional IANA timezone for `RealClock.todayIso` (defaults to UTC). */
  clockTimezone?: string;

  /** Optional shared logger. Each adapter accepts the same instance. */
  logger?: AdapterLogger;

  /**
   * Optional override of the BigQuery dataset/table — useful for
   * sandbox/emulator runs. Defaults to `profit_step_dwh.tasktotime_audit_events_log`.
   */
  bigqueryDatasetId?: string;
  bigqueryTableId?: string;
}

/**
 * Compose every tasktotime adapter from a single deps bundle.
 *
 * Composition root (typically in `functions/src/agent/...`) builds the deps
 * once at boot and passes the resulting bundle into application services and
 * REST handlers.
 */
export function createAdapters(deps: CreateAdaptersDeps): Adapters {
  const { db, logger } = deps;

  return {
    taskRepo: new FirestoreTaskRepository(db, logger),
    transitionLog: new FirestoreTransitionLog(db, logger),

    clientLookup: new FirestoreClientLookup(db, logger),
    projectLookup: new FirestoreProjectLookup(db, logger),
    userLookup: new FirestoreUserLookup(db, logger),
    employeeLookup: new FirestoreEmployeeLookup(db, logger),
    contactLookup: new FirestoreContactLookup(db, logger),
    siteLookup: new FirestoreSiteLookup(db, logger),

    estimate: new FirestoreEstimate(db, logger),
    note: new FirestoreNote(db, logger),

    workSession: new FirestoreWorkSession(db, logger),
    payroll: new FirestorePayroll(db, logger),

    inventoryCatalog: new FirestoreInventoryCatalog(db, logger),
    inventoryTx: new FirestoreInventoryTx(db, logger),

    aiAudit: new FirestoreAIAudit(db, logger),
    aiCache: new FirestoreAICache(db, logger),
    idempotency: new FirestoreIdempotency(db, logger),

    file: new FirestoreFile(db, logger),

    clock: new RealClock(deps.clockTimezone),
    idGenerator: new FirestoreIdGenerator(db, logger),

    telegram: new TelegramNotifyAdapter(db, deps.telegramBotToken, logger),
    email: new BrevoEmailNotifyAdapter(
      db,
      deps.brevoApiKey,
      deps.brevoSenderEmail,
      deps.brevoSenderName,
      logger,
    ),
    push: new FCMPushNotifyAdapter(db, deps.messaging, logger),
    bigQueryAudit: new BigQueryAuditAdapter({
      bigquery: deps.bigquery,
      datasetId: deps.bigqueryDatasetId,
      tableId: deps.bigqueryTableId,
      db,
      logger,
    }),
    storage: new FirebaseStorageUploadAdapter(
      deps.storage,
      deps.defaultStorageBucket,
      logger,
    ),
    weather: new MockWeatherForecastAdapter(logger),
  };
}
