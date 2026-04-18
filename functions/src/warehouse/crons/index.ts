/**
 * Warehouse scheduled functions (crons).
 *
 * Each module exports a pure function that does the computation; the
 * production scheduled-function wrappers are opted-in from
 * `functions/src/index.ts` when Denis is ready to deploy them.
 *
 * For MVP we only expose the pure logic — Firebase `pubsub.schedule`
 * wrappers are trivial 5-line glue and can be added without touching
 * core code.
 */

export {
  analyzeSingleTaskUsage,
  detectAnomaliesBatch,
  type PostedIssueSummary,
  type AnomalyReport,
  type DetectAnomaliesOptions,
} from './anomalyWatcher';

export {
  buildLowStockReorder,
  type LowStockReorderInput,
  type LowStockReorderReport,
  type ReorderLine,
} from './lowStockReorder';

export {
  findDeadStock,
  type DeadStockInput,
  type DeadStockReport,
  type DeadStockLine,
} from './deadStockReport';
