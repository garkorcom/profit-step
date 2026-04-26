/**
 * EstimatePort — read-only access to `estimates/{id}` + items.
 *
 * Used during estimate-decompose flow (Phase 2 ETL of estimate items into
 * tasks). See spec/02-data-model/task-interface.md §sourceEstimateId/sourceEstimateItemId.
 */

import type {
  CompanyId,
  ProjectId,
  EstimateId,
  EstimateItemId,
} from '../../domain/identifiers';

export interface EstimateItemSnapshot {
  id: EstimateItemId;
  description: string;
  qty: number;
  unitPrice: number;
  totalAmount: number;
  category?: string;
}

export interface EstimateSnapshot {
  id: EstimateId;
  companyId: CompanyId;
  projectId: ProjectId;
  status: 'draft' | 'sent' | 'signed' | 'rejected';
  totalAmount: number;
  items: EstimateItemSnapshot[];
  signedAt?: number;
}

export interface EstimatePort {
  findById(id: EstimateId): Promise<EstimateSnapshot | null>;
  findItem(
    estimateId: EstimateId,
    itemId: EstimateItemId,
  ): Promise<EstimateItemSnapshot | null>;
  findActiveByProject(projectId: ProjectId): Promise<EstimateSnapshot[]>;
}
