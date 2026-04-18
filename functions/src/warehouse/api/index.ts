/**
 * Warehouse API module — HTTP + tool-calling surface.
 *
 * Consumed by functions/src/agent/agentApi.ts. Exports a single Express
 * router that covers documents / balances / ledger / items / locations /
 * norms. Integration with the live agent token auth happens at the
 * agentApi level (middleware precedes this router).
 */

export { default as warehouseRouter } from './routes';
export { runPostDocument, runVoidDocument, nextDocNumber } from './firestoreAdapter';
export { sendWarehouseError, httpStatusFor, wrapRoute } from './errorHandler';
