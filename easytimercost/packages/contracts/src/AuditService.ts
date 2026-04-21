import type { WorkerId } from './shared-ids';
import type { Period } from './period';

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'approve'
  | 'reject'
  | 'submit'
  | 'lock'
  | 'unlock'
  | 'pay';

export interface AuditEntry {
  readonly id: string;
  readonly actorId: WorkerId;
  readonly action: AuditAction;
  readonly entityType: string;
  readonly entityId: string;
  readonly at: Date;
  readonly before?: Record<string, unknown>;
  readonly after?: Record<string, unknown>;
  readonly reason?: string;
  readonly ip?: string;
  readonly userAgent?: string;
}

export interface AuditEntryInput {
  readonly actorId: WorkerId;
  readonly action: AuditAction;
  readonly entityType: string;
  readonly entityId: string;
  readonly before?: Record<string, unknown>;
  readonly after?: Record<string, unknown>;
  readonly reason?: string;
}

export interface AuditService {
  log(entry: AuditEntryInput): Promise<void>;
  queryByEntity(entityType: string, entityId: string): Promise<AuditEntry[]>;
  queryByActor(actorId: WorkerId, period: Period): Promise<AuditEntry[]>;
}
