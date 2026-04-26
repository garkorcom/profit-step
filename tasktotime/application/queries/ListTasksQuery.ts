/**
 * ListTasksQuery — DTO for listing tasks with filters.
 */

import type { TaskLifecycle } from '../../domain/lifecycle';

export interface ListTasksQuery {
  companyId: string;
  lifecycle?: TaskLifecycle[];
  bucket?: Array<'inbox' | 'next' | 'someday' | 'archive'>;
  assigneeId?: string;
  parentTaskId?: string | null;
  projectId?: string;
  clientId?: string;
  isSubtask?: boolean;
  archivedOnly?: boolean;
  dueBefore?: number;
  search?: string;
  limit?: number;
  cursor?: string;
  orderBy?: 'createdAt' | 'updatedAt' | 'dueAt' | 'priority' | 'taskNumber';
  direction?: 'asc' | 'desc';
}
