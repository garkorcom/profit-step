/**
 * AIAuditPort — append-only log for AI-driven flows.
 *
 * Records prompt + response + token cost + user edits for every AI call
 * (generate_task / estimate_minutes / modify_task / decompose_estimate /
 * decompose_task). Used for accuracy analysis and cost tracking.
 *
 * See spec/04-storage/data-dependencies.md §aiAuditLogs.
 */

import type { CompanyId, UserId, TaskId } from '../../domain/identifiers';

export interface AIAuditEntry {
  id?: string;
  companyId: CompanyId;
  userId: UserId;
  taskId?: TaskId;
  flow:
    | 'generate_task'
    | 'estimate_minutes'
    | 'modify_task'
    | 'decompose_estimate'
    | 'decompose_task';
  prompt: string;
  response: unknown;
  confidence?: number;
  model: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  userEdits?: unknown;
  createdAt: number;
}

export interface AIAuditPort {
  append(entry: AIAuditEntry): Promise<{ id: string }>;
}
