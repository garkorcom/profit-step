/**
 * Single entry-point for all environment and secret access in Cloud Functions.
 *
 * Code outside this directory MUST NOT read `process.env.*` directly for
 * anything defined here — import from `../../config` instead. This keeps the
 * surface area of configuration small and makes the dependency graph of each
 * function visible in its `{ secrets: [...] }` binding.
 */

export * from './secrets';
export * from './env';
