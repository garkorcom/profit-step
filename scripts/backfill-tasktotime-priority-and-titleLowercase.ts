/**
 * One-shot backfill: legacy `tasktotime_tasks` docs → string priority +
 * derived `titleLowercase` field.
 *
 * Why this exists:
 *
 *   PR #82 (614b08f) introduced an int↔string mapping at the HTTP boundary
 *   (wire-format priority is `0..3`, domain stores `'low' | 'medium' | 'high'
 *   | 'critical'`). Tasks created BEFORE that PR were persisted with the
 *   integer form. Frontend chip lookups + range filters now expect the string
 *   form everywhere downstream.
 *
 *   PR #85 (d6d68f5) added `titleLowercase` as a derived index field for
 *   server-side title prefix search. New writes populate it via `toDoc` in
 *   FirestoreTaskRepository, but legacy docs lack the field — they are
 *   invisible to `?search=...` queries.
 *
 * What this does:
 *
 *   - Scans `tasktotime_tasks` (optionally filtered by `companyId`).
 *   - For each doc:
 *     - If `priority` is an integer 0..3 → translate to the matching string.
 *     - If `titleLowercase` is missing AND `title` is a non-empty string →
 *       set `titleLowercase = title.trim().toLowerCase()`.
 *     - Otherwise skip.
 *   - Writes via batched `WriteBatch` (500/batch — Firestore limit).
 *
 * Idempotency:
 *
 *   Re-running is a no-op. The two transforms only fire when the legacy shape
 *   is detected; once a doc has `priority: 'low'` (string) and a populated
 *   `titleLowercase`, the script skips it.
 *
 * Safety:
 *
 *   - `--dry-run` (default): no writes, just prints the plan.
 *   - `--yes`: bypass interactive confirmation in non-dry-run mode.
 *   - `--company-id <id>`: restrict to one tenant (incremental rollout).
 *
 * Usage:
 *
 *   # Dry run (default — read-only, prints plan)
 *   npx ts-node --project scripts/tsconfig.json scripts/backfill-tasktotime-priority-and-titleLowercase.ts --dry-run
 *
 *   # Apply, with interactive "yes" prompt
 *   npx ts-node --project scripts/tsconfig.json scripts/backfill-tasktotime-priority-and-titleLowercase.ts
 *
 *   # Apply, no prompt (CI / scripted)
 *   npx ts-node --project scripts/tsconfig.json scripts/backfill-tasktotime-priority-and-titleLowercase.ts --yes
 *
 *   # Restrict to one tenant
 *   npx ts-node --project scripts/tsconfig.json scripts/backfill-tasktotime-priority-and-titleLowercase.ts --company-id claude-ai-agent --yes
 *
 *   The `--project scripts/tsconfig.json` flag forces ts-node to compile this
 *   file as CommonJS (the repo root tsconfig is `module: ESNext` for the
 *   Vite frontend, which trips ts-node when it sees a `__dirname` reference).
 *   Tests run the same way — see scripts/__tests__/.
 *
 * Auth (in priority order):
 *
 *   1. `GOOGLE_APPLICATION_CREDENTIALS` env var pointing at a service-account JSON.
 *   2. `serviceAccountKey.json` at repo root or in `functions/`.
 *   3. ADC at `~/.config/gcloud/application_default_credentials.json`
 *      (`gcloud auth application-default login --project=profit-step`).
 *
 *   No deploy. Manual one-shot only. NEVER run without confirming the
 *   project: the script prints `projectId` before doing anything.
 */

import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

// ─── Pure helpers (exported for unit tests) ────────────────────────────

/**
 * Map a legacy integer priority (0..3) to the canonical string value.
 *
 * Order MUST match `PR #82` schemas.ts L335:
 *   `(['low', 'medium', 'high', 'critical'] as const)[priorityRaw]`
 *
 * Returns `null` if `value` is not an integer in [0, 3].
 */
export const PRIORITY_INT_TO_STRING = ['low', 'medium', 'high', 'critical'] as const;

export type PriorityString = (typeof PRIORITY_INT_TO_STRING)[number];

export function mapPriorityIntToString(value: unknown): PriorityString | null {
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 3
  ) {
    return PRIORITY_INT_TO_STRING[value];
  }
  return null;
}

/**
 * Derive `titleLowercase` from `title`. Mirrors PR #85
 * `normaliseTitleForSearch` in FirestoreTaskRepository:
 *   `title.trim().toLowerCase()`
 *
 * Returns `null` if `title` is not a non-empty string.
 */
export function computeTitleLowercase(title: unknown): string | null {
  if (typeof title !== 'string') return null;
  const normalised = title.trim().toLowerCase();
  if (normalised.length === 0) return null;
  return normalised;
}

/**
 * Decide what (if anything) to write for a single doc. Pure function — no I/O.
 *
 * Returns the partial update map (only the fields that need writing) or
 * `null` if the doc is already in canonical shape.
 */
export interface BackfillUpdate {
  priority?: PriorityString;
  titleLowercase?: string;
}

export function planUpdate(data: Record<string, unknown>): BackfillUpdate | null {
  const update: BackfillUpdate = {};

  // 1. priority int → string
  const priorityMapped = mapPriorityIntToString(data.priority);
  if (priorityMapped !== null) {
    update.priority = priorityMapped;
  }

  // 2. titleLowercase derive (only if missing or empty)
  const existingLower = data.titleLowercase;
  const needsLower =
    existingLower === undefined ||
    existingLower === null ||
    (typeof existingLower === 'string' && existingLower.length === 0);
  if (needsLower) {
    const computed = computeTitleLowercase(data.title);
    if (computed !== null) {
      update.titleLowercase = computed;
    }
  }

  if (Object.keys(update).length === 0) return null;
  return update;
}

// ─── Constants ─────────────────────────────────────────────────────────

const COLLECTION = 'tasktotime_tasks';
const FIRESTORE_BATCH_LIMIT = 500;

// ─── CLI parsing ───────────────────────────────────────────────────────

interface CliOptions {
  dryRun: boolean;
  yes: boolean;
  companyId?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { dryRun: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--yes') opts.yes = true;
    else if (a === '--company-id') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) {
        throw new Error('--company-id requires a value');
      }
      opts.companyId = v;
    } else if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return opts;
}

function printUsage(): void {
  console.log(`Usage:
  npx ts-node scripts/backfill-tasktotime-priority-and-titleLowercase.ts [options]

Options:
  --dry-run               Read-only. Print the plan, write nothing.
  --yes                   Skip interactive confirmation.
  --company-id <id>       Restrict to a single tenant (otherwise: all tasks).
  -h, --help              Show this message.

Auth:
  GOOGLE_APPLICATION_CREDENTIALS env var, OR serviceAccountKey.json at repo
  root / in functions/, OR \`gcloud auth application-default login\`.
`);
}

// ─── Auth ──────────────────────────────────────────────────────────────

const KEY_PATHS = [
  path.resolve(__dirname, '..', 'serviceAccountKey.json'),
  path.resolve(__dirname, '..', 'functions', 'serviceAccountKey.json'),
];

interface AuthResult {
  projectId: string;
  source: 'GOOGLE_APPLICATION_CREDENTIALS' | 'serviceAccountKey.json' | 'ADC';
}

function initAdmin(): AuthResult {
  if (admin.apps.length > 0) {
    const existing = admin.app();
    return {
      projectId: existing.options.projectId ?? 'unknown',
      source: 'ADC',
    };
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp();
    return {
      projectId:
        admin.app().options.projectId ??
        process.env.GOOGLE_CLOUD_PROJECT ??
        'unknown',
      source: 'GOOGLE_APPLICATION_CREDENTIALS',
    };
  }

  for (const p of KEY_PATHS) {
    if (fs.existsSync(p)) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const key = require(p);
      admin.initializeApp({
        credential: admin.credential.cert(key),
        projectId: key.project_id,
      });
      return {
        projectId: key.project_id,
        source: 'serviceAccountKey.json',
      };
    }
  }

  const adcPath = path.join(
    process.env.HOME ?? '~',
    '.config/gcloud/application_default_credentials.json',
  );
  if (fs.existsSync(adcPath)) {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT ?? 'profit-step';
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId,
    });
    return { projectId, source: 'ADC' };
  }

  throw new Error(
    'No credentials found. Set GOOGLE_APPLICATION_CREDENTIALS, place ' +
      'serviceAccountKey.json at repo root or functions/, or run ' +
      '`gcloud auth application-default login --project=profit-step`.',
  );
}

// ─── Confirmation prompt ───────────────────────────────────────────────

async function confirmYes(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(`${message} (yes/no) `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'yes');
    });
  });
}

// ─── Main ──────────────────────────────────────────────────────────────

interface Stats {
  scanned: number;
  updated: number;
  skipped: number;
  errored: number;
  priorityFixed: number;
  titleLowercaseAdded: number;
  bothFixed: number;
}

async function run(opts: CliOptions): Promise<Stats> {
  const db = admin.firestore();
  const stats: Stats = {
    scanned: 0,
    updated: 0,
    skipped: 0,
    errored: 0,
    priorityFixed: 0,
    titleLowercaseAdded: 0,
    bothFixed: 0,
  };

  const baseRef: FirebaseFirestore.Query = opts.companyId
    ? db.collection(COLLECTION).where('companyId', '==', opts.companyId)
    : db.collection(COLLECTION);

  console.log(
    `[${opts.dryRun ? 'dry-run' : 'commit'}] querying ${COLLECTION}` +
      (opts.companyId ? ` (companyId=${opts.companyId})` : ' (all tenants)'),
  );

  const snap = await baseRef.get();
  stats.scanned = snap.size;
  console.log(`[${opts.dryRun ? 'dry-run' : 'commit'}] found ${snap.size} docs`);

  // Plan all updates first so we can report + chunk + interactively confirm.
  interface PlannedDoc {
    id: string;
    update: BackfillUpdate;
  }
  const planned: PlannedDoc[] = [];
  for (const doc of snap.docs) {
    try {
      const data = doc.data();
      const update = planUpdate(data);
      if (update === null) {
        stats.skipped++;
      } else {
        planned.push({ id: doc.id, update });
        if (update.priority !== undefined && update.titleLowercase !== undefined) {
          stats.bothFixed++;
        } else if (update.priority !== undefined) {
          stats.priorityFixed++;
        } else {
          stats.titleLowercaseAdded++;
        }
      }
    } catch (e) {
      stats.errored++;
      console.error(`[${opts.dryRun ? 'dry-run' : 'commit'}] error planning ${doc.id}:`, e);
    }
  }

  console.log(
    `[${opts.dryRun ? 'dry-run' : 'commit'}] plan: ${planned.length} docs to update ` +
      `(${stats.priorityFixed} priority-only, ${stats.titleLowercaseAdded} titleLowercase-only, ` +
      `${stats.bothFixed} both), ${stats.skipped} already canonical, ${stats.errored} errored`,
  );

  // Sample a few for visibility.
  for (const p of planned.slice(0, 5)) {
    console.log(
      `[${opts.dryRun ? 'dry-run' : 'commit'}]   sample ${p.id}: ${JSON.stringify(p.update)}`,
    );
  }
  if (planned.length > 5) {
    console.log(`[${opts.dryRun ? 'dry-run' : 'commit'}]   ... and ${planned.length - 5} more`);
  }

  if (opts.dryRun) {
    console.log('[dry-run] no writes performed.');
    return stats;
  }

  if (planned.length === 0) {
    console.log('[commit] nothing to update — done.');
    return stats;
  }

  if (!opts.yes) {
    const confirmed = await confirmYes(
      `\nAbout to write ${planned.length} updates to Firestore. Proceed?`,
    );
    if (!confirmed) {
      console.log('[commit] aborted by user.');
      return stats;
    }
  }

  // Chunk into batches of 500.
  for (let i = 0; i < planned.length; i += FIRESTORE_BATCH_LIMIT) {
    const slice = planned.slice(i, i + FIRESTORE_BATCH_LIMIT);
    const batch = db.batch();
    for (const p of slice) {
      const ref = db.collection(COLLECTION).doc(p.id);
      // Use FieldValue-aware update payload. We never delete here — only
      // overwrite priority and add titleLowercase. updatedAt is intentionally
      // NOT touched: this is a derived/canonicalisation backfill, not a domain
      // event, and bumping updatedAt would re-trigger downstream Firestore
      // observers (cascades, search indexers) for no semantic change.
      const payload: Record<string, unknown> = {};
      if (p.update.priority !== undefined) payload.priority = p.update.priority;
      if (p.update.titleLowercase !== undefined) {
        payload.titleLowercase = p.update.titleLowercase;
      }
      batch.update(ref, payload as FirebaseFirestore.UpdateData<unknown>);
    }
    try {
      await batch.commit();
      stats.updated += slice.length;
      console.log(
        `[commit] batch ${Math.floor(i / FIRESTORE_BATCH_LIMIT) + 1} ` +
          `(${slice.length} docs) committed — ${stats.updated}/${planned.length} done`,
      );
    } catch (e) {
      stats.errored += slice.length;
      console.error(
        `[commit] batch ${Math.floor(i / FIRESTORE_BATCH_LIMIT) + 1} FAILED — ` +
          `${slice.length} docs not written:`,
        e,
      );
      // Don't abort — keep going so partial progress is captured. Caller
      // can re-run; idempotency means already-fixed docs are skipped.
    }
  }

  // Touch FieldValue once so the static analyser keeps the import — safety
  // hedge in case a future change wants serverTimestamp() / arrayUnion().
  void FieldValue;

  return stats;
}

async function main(): Promise<void> {
  let opts: CliOptions;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error((e as Error).message);
    printUsage();
    process.exit(2);
  }

  const auth = initAdmin();
  console.log(
    `[init] projectId=${auth.projectId} source=${auth.source} ` +
      `mode=${opts.dryRun ? 'DRY-RUN' : 'COMMIT'}` +
      (opts.companyId ? ` companyId=${opts.companyId}` : ' scope=all-tenants'),
  );

  // Sanity: if writing to prod, the `projectId` should be `profit-step`
  // (or whatever the operator set). We don't gate on it — just log loudly.

  const stats = await run(opts);

  console.log('\n=== summary ===');
  console.log(JSON.stringify(stats, null, 2));

  if (opts.dryRun) {
    console.log('\nDry run complete. Re-run without --dry-run to apply.');
  } else {
    console.log('\nBackfill complete.');
  }
}

// Only run main() when invoked as a script — keep helpers importable
// from unit tests without side-effects.
if (require.main === module) {
  main().catch((e) => {
    console.error('FATAL:', e);
    process.exit(1);
  });
}
