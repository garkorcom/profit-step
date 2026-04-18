/**
 * Migration runner.
 *
 * Tracks applied migrations in `wh_migrations_applied` so repeated runs
 * are idempotent. Each migration exports `id`, `description`, and `run`.
 *
 * Convention: file name `NNN-slug.ts` keeps chronological ordering.
 */

import type * as admin from 'firebase-admin';

export interface Migration {
  id: string; // stable, e.g. "001-drop-legacy"
  description: string;
  run: (db: admin.firestore.Firestore, options: MigrationOptions) => Promise<MigrationResult>;
}

export interface MigrationOptions {
  dryRun: boolean;
  verbose?: boolean;
  /** Passed to individual migrations (e.g. cutover timestamp for seeds). */
  params?: Record<string, unknown>;
}

export interface MigrationResult {
  id: string;
  dryRun: boolean;
  appliedAt: string;
  summary: Record<string, unknown>;
}

const APPLIED_COLLECTION = 'wh_migrations_applied';

export async function hasRun(db: admin.firestore.Firestore, id: string): Promise<boolean> {
  const doc = await db.collection(APPLIED_COLLECTION).doc(id).get();
  return doc.exists;
}

export async function markApplied(db: admin.firestore.Firestore, id: string, summary: Record<string, unknown>): Promise<void> {
  await db.collection(APPLIED_COLLECTION).doc(id).set({
    id,
    appliedAt: new Date().toISOString(),
    summary,
  });
}

export async function runMigration(db: admin.firestore.Firestore, migration: Migration, options: MigrationOptions): Promise<MigrationResult> {
  if (!options.dryRun) {
    const already = await hasRun(db, migration.id);
    if (already) {
      return {
        id: migration.id,
        dryRun: false,
        appliedAt: 'already-applied',
        summary: { skipped: true },
      };
    }
  }

  const result = await migration.run(db, options);

  if (!options.dryRun) {
    await markApplied(db, migration.id, result.summary);
  }

  return result;
}
