/**
 * GetTaskQuery — DTO for fetching a single task by id.
 */

export interface GetTaskQuery {
  taskId: string;
  /** If true, includes computed `subtaskRollup` and effective wiki. */
  withRollup?: boolean;
}
