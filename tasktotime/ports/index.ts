/**
 * Ports — barrel export. All ports are pure TypeScript interfaces.
 *
 * NOTE: Importing from this index pulls in *type-only* surface area; runtime
 * implementations live under `tasktotime/adapters/...` (Phase 2).
 */

export * from './repositories';
export * from './lookups';
export * from './inventory';
export * from './work';
export * from './ai';
export * from './notify';
export * from './infra';
