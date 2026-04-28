/**
 * Read-only point-in-time backup of all finance- and time-tracking-related
 * Firestore data. Captured 2026-04-28 before any further write actions
 * (rules rollback, second backfill) so we have a definitive restore point.
 *
 * Output: ~/profit-step-backup-<UTC-ISO>.json — kept outside the repo.
 *
 * Collections snapshotted:
 *   work_sessions  — all time/payroll/payment/correction records
 *   costs          — business-expense ledger
 *   payroll_periods (if exists) — closed payroll period summaries
 *   users          — needed to map employeeId → companyId for forensic restore
 *
 * Firestore Timestamps are converted to { _ts: ISO } so the JSON round-trips.
 *
 * Run:
 *   node functions/scripts/backup-finance-and-time.js
 */
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const os = require('os');

admin.initializeApp({ projectId: 'profit-step' });
const db = admin.firestore();

// Recursive Timestamp-aware JSON sanitizer.
function sanitize(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (value instanceof admin.firestore.Timestamp) return { _ts: value.toDate().toISOString() };
  if (value instanceof Date) return { _ts: value.toISOString() };
  if (Array.isArray(value)) return value.map(sanitize);
  // Plain object: recurse
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = sanitize(v);
  }
  return out;
}

async function snapshotCollection(name) {
  console.log(`Reading ${name}...`);
  const snap = await db.collection(name).get();
  const docs = [];
  for (const doc of snap.docs) {
    docs.push({ id: doc.id, data: sanitize(doc.data()) });
  }
  console.log(`  ${name}: ${docs.length} docs`);
  return docs;
}

(async () => {
  const startedAt = new Date();
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(os.homedir(), `profit-step-backup-${stamp}.json`);

  const dump = {
    backup_meta: {
      created_at: startedAt.toISOString(),
      project: 'profit-step',
      reason: 'incident-2026-04-28 — pre-rules-rollback restore point',
      ruleset_active_at_backup: 'projects/profit-step/rulesets/963f15b5-5d85-4bf9-a9d4-83f826408746',
    },
    work_sessions: [],
    costs: [],
    payroll_periods: [],
    users: [],
  };

  dump.work_sessions = await snapshotCollection('work_sessions');
  dump.costs = await snapshotCollection('costs');

  // payroll_periods may or may not exist
  try {
    dump.payroll_periods = await snapshotCollection('payroll_periods');
  } catch (e) {
    console.log(`  payroll_periods: collection missing or empty (${e.message})`);
  }

  // users — only what we need to reconstruct identity (no auth tokens etc.)
  console.log('Reading users (filtered to identity-relevant fields)...');
  const usersSnap = await db.collection('users').get();
  for (const doc of usersSnap.docs) {
    const d = doc.data();
    dump.users.push({
      id: doc.id,
      data: sanitize({
        displayName: d.displayName,
        name: d.name,
        email: d.email,
        role: d.role,
        companyId: d.companyId,
        telegramId: d.telegramId,
        hourlyRate: d.hourlyRate,
        createdAt: d.createdAt,
      }),
    });
  }
  console.log(`  users: ${dump.users.length} docs (identity-only fields)`);

  const json = JSON.stringify(dump, null, 2);
  fs.writeFileSync(outPath, json);
  const sizeKb = Math.round(json.length / 1024);

  console.log(`\nBackup complete.`);
  console.log(`  file: ${outPath}`);
  console.log(`  size: ${sizeKb} KB`);
  console.log(`  work_sessions: ${dump.work_sessions.length}`);
  console.log(`  costs:         ${dump.costs.length}`);
  console.log(`  payroll_periods: ${dump.payroll_periods.length}`);
  console.log(`  users:         ${dump.users.length}`);

  process.exit(0);
})().catch(err => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
