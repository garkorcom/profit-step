/**
 * Domain — public API barrel.
 *
 * This is what the application layer and adapters import from. Pure
 * TypeScript — no Firebase / no MUI / no `react`.
 */

// Identifiers + branded types
export * from './identifiers';

// Task aggregate + sub-types
export * from './Task';

// Lifecycle / transitions
export * from './lifecycle';
export * from './transitions';
export * from './validation';

// Graph / scheduling
export * from './dependencies';
export * from './criticalPath';
export * from './autoShift';
export * from './rollup';
export * from './derivedStates';

// Errors / events
export * from './errors';
export * from './events';

// Policies
export * from './policies/AutoApprovePolicy';
export * from './policies/BonusPenaltyPolicy';
export * from './policies/WikiInheritancePolicy';

// Services (DI-injected; require ports for I/O)
export * from './services';
