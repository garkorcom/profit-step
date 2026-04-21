import type { SessionId, WorkerId, ClientId, ProjectId } from './shared-ids';
import type { Period } from './period';

export type ShiftType =
  | 'regular'
  | 'overtime'
  | 'night'
  | 'holiday'
  | 'travel'
  | 'standby';

export type SessionStatus = 'active' | 'completed' | 'auto_closed' | 'corrected';

export interface Session {
  readonly id: SessionId;
  readonly workerId: WorkerId;
  readonly clientId?: ClientId;
  readonly projectId?: ProjectId;
  readonly shiftGroupId?: string;
  readonly type: ShiftType;
  readonly status: SessionStatus;
  readonly startTime: Date;
  readonly endTime?: Date;
  readonly durationMinutes?: number;
  readonly hourlyRate: number;
  readonly earnings: number;
  readonly description?: string;
  readonly geoStart?: { lat: number; lng: number };
  readonly geoEnd?: { lat: number; lng: number };
  readonly photoUrl?: string;
}

export interface TimeService {
  getSession(id: SessionId): Promise<Session | null>;
  listByWorker(workerId: WorkerId, period: Period): Promise<Session[]>;
  listByClient(clientId: ClientId, period: Period): Promise<Session[]>;
  listActive(): Promise<Session[]>;

  sumHoursByWorker(workerId: WorkerId, period: Period): Promise<number>;
  sumLaborCostByClient(clientId: ClientId, period: Period): Promise<number>;
  sumEarningsByWorker(workerId: WorkerId, period: Period): Promise<number>;

  listWorkersOnClient(clientId: ClientId, period: Period): Promise<WorkerId[]>;
}
