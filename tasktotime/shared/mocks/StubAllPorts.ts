/**
 * StubAllPorts — convenience factory for ALL 21+ ports as in-memory stubs.
 *
 * Use in service-level tests to avoid wiring 12+ deps by hand. Override
 * specific ports as needed.
 */

import { InMemoryTaskRepository } from './InMemoryTaskRepository';
import { InMemoryTransitionLog } from './InMemoryTransitionLog';
import { StubClientLookup } from './StubClientLookup';
import { StubUserLookup } from './StubUserLookup';
import { FakeClock } from './FakeClock';
import {
  NoopTelegramNotifier,
  NoopEmailNotifier,
  NoopPushNotifier,
} from './NoopNotifier';

import type { ProjectLookupPort } from '../../ports/lookups/ProjectLookupPort';
import type { EmployeeLookupPort } from '../../ports/lookups/EmployeeLookupPort';
import type { ContactLookupPort } from '../../ports/lookups/ContactLookupPort';
import type { SiteLookupPort } from '../../ports/lookups/SiteLookupPort';
import type { EstimatePort } from '../../ports/lookups/EstimatePort';
import type { NotePort } from '../../ports/lookups/NotePort';
import type { InventoryCatalogPort } from '../../ports/inventory/InventoryCatalogPort';
import type { InventoryTxPort } from '../../ports/inventory/InventoryTxPort';
import type {
  WorkSessionPort,
  WorkSessionAggregate,
} from '../../ports/work/WorkSessionPort';
import type {
  PayrollPort,
  PayrollAdjustmentInput,
  PayrollAdjustmentReason,
} from '../../ports/work/PayrollPort';
import type { AIAuditPort, AIAuditEntry } from '../../ports/ai/AIAuditPort';
import type { AICachePort, AICacheEntry } from '../../ports/ai/AICachePort';
import type { IdempotencyPort } from '../../ports/ai/IdempotencyPort';
import type { BigQueryAuditPort, AuditEvent } from '../../ports/infra/BigQueryAuditPort';
import type {
  StorageUploadPort,
  StorageUploadInput,
  StorageUploadResult,
} from '../../ports/infra/StorageUploadPort';
import type {
  WeatherForecastPort,
  WeatherForecastInput,
  WeatherDay,
} from '../../ports/infra/WeatherForecastPort';
import type { FilePort, FileMetadata } from '../../ports/infra/FilePort';
import type { IdGeneratorPort } from '../../ports/infra/IdGeneratorPort';
import { asTaskId, type TaskId, type CompanyId } from '../../domain/identifiers';

// ─── Stub implementations of remaining ports ────────────────────────────

class StubProjectLookup implements ProjectLookupPort {
  async findById() {
    return null;
  }
  async findByClientId() {
    return [];
  }
  async listActive() {
    return [];
  }
}

class StubEmployeeLookup implements EmployeeLookupPort {
  async findById() {
    return null;
  }
  async findByTelegramId() {
    return null;
  }
}

class StubContactLookup implements ContactLookupPort {
  async findById() {
    return null;
  }
  async findByIds() {
    return [];
  }
  async findByProject() {
    return [];
  }
}

class StubSiteLookup implements SiteLookupPort {
  async findById() {
    return null;
  }
  async findByClient() {
    return [];
  }
}

class StubEstimateLookup implements EstimatePort {
  async findById() {
    return null;
  }
  async findItem() {
    return null;
  }
  async findActiveByProject() {
    return [];
  }
}

class StubNoteLookup implements NotePort {
  async findById() {
    return null;
  }
}

class StubInventoryCatalog implements InventoryCatalogPort {
  async findById() {
    return null;
  }
  async findByIds() {
    return [];
  }
  async search() {
    return [];
  }
}

class StubInventoryTx implements InventoryTxPort {
  async findByTask() {
    return [];
  }
  async sumActualCostByTask() {
    return 0;
  }
}

export class FakeWorkSessionPort implements WorkSessionPort {
  public aggregates = new Map<TaskId, WorkSessionAggregate>();
  setAggregate(taskId: TaskId, agg: WorkSessionAggregate): void {
    this.aggregates.set(taskId, agg);
  }
  async findByTask() {
    return [];
  }
  async aggregateForTask(taskId: TaskId): Promise<WorkSessionAggregate> {
    return (
      this.aggregates.get(taskId) ?? {
        totalDurationMinutes: 0,
        totalEarnings: 0,
        earliestStartAt: null,
        latestEndAt: null,
      }
    );
  }
}

export class InMemoryPayroll implements PayrollPort {
  public adjustments: Array<PayrollAdjustmentInput & { id: string }> = [];
  async appendAdjustment(input: PayrollAdjustmentInput): Promise<{ id: string }> {
    const id = `adj_${this.adjustments.length + 1}`;
    this.adjustments.push({ ...input, id });
    return { id };
  }
  async hasAdjustmentForTask(
    taskId: TaskId,
    reason: PayrollAdjustmentReason,
  ): Promise<boolean> {
    return this.adjustments.some(
      (a) => a.taskId === taskId && a.reason === reason,
    );
  }
}

class StubAIAudit implements AIAuditPort {
  public entries: AIAuditEntry[] = [];
  async append(entry: AIAuditEntry): Promise<{ id: string }> {
    const id = `ai_${this.entries.length + 1}`;
    this.entries.push({ ...entry, id });
    return { id };
  }
}

class StubAICache implements AICachePort {
  private store = new Map<string, AICacheEntry<unknown>>();
  async get<T = unknown>(key: string): Promise<AICacheEntry<T> | null> {
    return (this.store.get(key) as AICacheEntry<T> | undefined) ?? null;
  }
  async set<T = unknown>(key: string, value: T, ttlMs: number): Promise<void> {
    this.store.set(key, {
      key,
      value,
      hitCount: 0,
      expiresAt: Date.now() + ttlMs,
    });
  }
  async incrementHit(key: string): Promise<void> {
    const e = this.store.get(key);
    if (e) e.hitCount += 1;
  }
}

export class InMemoryIdempotency implements IdempotencyPort {
  private reservations = new Map<string, number>();

  async reserve(key: string, ttlMs: number = 5 * 60 * 1000): Promise<boolean> {
    const now = Date.now();
    const exp = this.reservations.get(key);
    if (exp !== undefined && exp > now) return false;
    this.reservations.set(key, now + ttlMs);
    return true;
  }
  async isProcessed(key: string): Promise<boolean> {
    const exp = this.reservations.get(key);
    return exp !== undefined && exp > Date.now();
  }
  async release(key: string): Promise<void> {
    this.reservations.delete(key);
  }
}

class StubBigQueryAudit implements BigQueryAuditPort {
  public events: AuditEvent[] = [];
  async log(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
}

class StubStorageUpload implements StorageUploadPort {
  async upload(input: StorageUploadInput): Promise<StorageUploadResult> {
    const sizeBytes =
      typeof input.data === 'string'
        ? input.data.length
        : (input.data as Uint8Array).byteLength ?? 0;
    return {
      url: `mem://${input.path}`,
      pathRef: input.path,
      sizeBytes,
    };
  }
  async signedUrl(pathRef: string): Promise<string> {
    return `mem://${pathRef}?signed=true`;
  }
  async delete(): Promise<void> {
    /* no-op */
  }
}

class StubWeatherForecast implements WeatherForecastPort {
  async forecast(_input: WeatherForecastInput): Promise<WeatherDay[]> {
    return [];
  }
}

class StubFilePort implements FilePort {
  public files = new Map<string, FileMetadata>();
  async findByTask() {
    return [];
  }
  async findById() {
    return null;
  }
  async registerUpload(meta: Omit<FileMetadata, 'id'>) {
    const id = `file_${this.files.size + 1}` as FileMetadata['id'];
    this.files.set(id, { ...meta, id });
    return { id };
  }
}

export class FakeIdGenerator implements IdGeneratorPort {
  private taskCounter = 0;
  private numberCounter = 0;

  newTaskId(): TaskId {
    this.taskCounter += 1;
    return asTaskId(`task_gen_${this.taskCounter}`);
  }

  async nextTaskNumber(_companyId: CompanyId, year: number): Promise<string> {
    this.numberCounter += 1;
    return `T-${year}-${String(this.numberCounter).padStart(4, '0')}`;
  }
}

// ─── Bundle factory ─────────────────────────────────────────────────────

export interface AllPorts {
  taskRepo: InMemoryTaskRepository;
  transitionLog: InMemoryTransitionLog;
  clientLookup: StubClientLookup;
  projectLookup: StubProjectLookup;
  userLookup: StubUserLookup;
  employeeLookup: StubEmployeeLookup;
  contactLookup: StubContactLookup;
  siteLookup: StubSiteLookup;
  estimatePort: StubEstimateLookup;
  notePort: StubNoteLookup;
  inventoryCatalog: StubInventoryCatalog;
  inventoryTx: StubInventoryTx;
  workSessions: FakeWorkSessionPort;
  payroll: InMemoryPayroll;
  aiAudit: StubAIAudit;
  aiCache: StubAICache;
  idempotency: InMemoryIdempotency;
  telegram: NoopTelegramNotifier;
  email: NoopEmailNotifier;
  push: NoopPushNotifier;
  bigQueryAudit: StubBigQueryAudit;
  storageUpload: StubStorageUpload;
  weatherForecast: StubWeatherForecast;
  filePort: StubFilePort;
  clock: FakeClock;
  idGenerator: FakeIdGenerator;
}

export function makeAllPorts(initialEpochMs?: number): AllPorts {
  return {
    taskRepo: new InMemoryTaskRepository(),
    transitionLog: new InMemoryTransitionLog(),
    clientLookup: new StubClientLookup(),
    projectLookup: new StubProjectLookup(),
    userLookup: new StubUserLookup(),
    employeeLookup: new StubEmployeeLookup(),
    contactLookup: new StubContactLookup(),
    siteLookup: new StubSiteLookup(),
    estimatePort: new StubEstimateLookup(),
    notePort: new StubNoteLookup(),
    inventoryCatalog: new StubInventoryCatalog(),
    inventoryTx: new StubInventoryTx(),
    workSessions: new FakeWorkSessionPort(),
    payroll: new InMemoryPayroll(),
    aiAudit: new StubAIAudit(),
    aiCache: new StubAICache(),
    idempotency: new InMemoryIdempotency(),
    telegram: new NoopTelegramNotifier(),
    email: new NoopEmailNotifier(),
    push: new NoopPushNotifier(),
    bigQueryAudit: new StubBigQueryAudit(),
    storageUpload: new StubStorageUpload(),
    weatherForecast: new StubWeatherForecast(),
    filePort: new StubFilePort(),
    clock: new FakeClock(initialEpochMs),
    idGenerator: new FakeIdGenerator(),
  };
}
