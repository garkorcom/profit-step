/**
 * Domain services — barrel export.
 *
 * Single entry-point for adapters / application layer. Each service is a
 * class with constructor injection of its required ports.
 */

export {
  TaskService,
  type TaskServiceDeps,
  type CreateTaskInput,
  type TaskDraft,
  type TransitionInput,
  type TransitionOutcome,
  type ActualsAggregate,
  isoWeekId,
} from './TaskService';

export {
  DependencyService,
  type DependencyServiceDeps,
  type CycleCheckResult,
  type AutoShiftPlan,
  type CriticalPathSummary,
} from './DependencyService';

export {
  WikiRollupService,
  type WikiRollupServiceDeps,
  type RolledUpWiki,
  type RolledUpWikiSection,
  type WikiRollupOptions,
} from './WikiRollupService';
