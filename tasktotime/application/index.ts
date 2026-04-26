/**
 * Application layer — barrel export. Use cases living between domain and
 * adapters. Pure orchestration; receives ports + services via constructor DI.
 */

export * from './commands';
export * from './queries';
export * from './handlers';
