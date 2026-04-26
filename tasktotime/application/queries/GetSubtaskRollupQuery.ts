/**
 * GetSubtaskRollupQuery — DTO for fetching computed rollup of a parent task.
 */

export interface GetSubtaskRollupQuery {
  parentTaskId: string;
  includeArchived?: boolean;
}
