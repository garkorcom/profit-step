import type { ClientId, ProjectId, WorkerId } from './shared-ids';
import type { Period } from './period';

export interface Client {
  readonly id: ClientId;
  readonly name: string;
  readonly contactEmail?: string;
  readonly contactPhone?: string;
  readonly active: boolean;
}

export interface Project {
  readonly id: ProjectId;
  readonly clientId: ClientId;
  readonly name: string;
  readonly status: 'draft' | 'active' | 'on_hold' | 'completed' | 'cancelled';
  readonly budget?: {
    readonly labor?: number;
    readonly materials?: number;
    readonly subcontractor?: number;
    readonly total: number;
  };
}

export interface ProjectPnL {
  readonly projectId: ProjectId;
  readonly period: Period;
  readonly revenue: number;
  readonly laborCost: number;
  readonly materialsCost: number;
  readonly subcontractorCost: number;
  readonly overheadAllocation: number;
  readonly totalCost: number;
  readonly grossMargin: number;
  readonly marginPct: number;
  readonly budgetVariance?: {
    readonly labor: number;
    readonly materials: number;
    readonly total: number;
  };
}

export interface ClientFilter {
  readonly active?: boolean;
  readonly assignedPmId?: WorkerId;
}

export interface ClientService {
  getClient(id: ClientId): Promise<Client | null>;
  list(filter?: ClientFilter): Promise<Client[]>;

  getProject(id: ProjectId): Promise<Project | null>;
  listProjectsByClient(clientId: ClientId): Promise<Project[]>;

  getPnL(projectId: ProjectId, period: Period): Promise<ProjectPnL>;
  getClientRollup(clientId: ClientId, period: Period): Promise<ProjectPnL[]>;
}
