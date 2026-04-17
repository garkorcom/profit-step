/**
 * verify-balance-formula.ts
 *
 * Read-only smoke test: compare worker bot balance vs time-tracking API balance
 * for every employee with work_sessions in the current payroll year.
 *
 * Background: on 2026-04-14/15 balance formula was "unified" across bot and
 * dashboard (commits 761fe8c, 20cf9a5). However, actual source differs:
 *
 *   bot (functions/src/triggers/telegram/handlers/sessionManager.ts:312):
 *     balance = earned + adjustments - paid - expenses   (includes costs)
 *
 *   api (functions/src/agent/routes/timeTracking.ts:778):
 *     balance = earned - paid + adjustments              (NO expenses)
 *
 * An employee with $N in costs/expenses will see $N difference between what
 * the bot shows and what the admin dashboard shows. This script flags every
 * such case so Denis can decide which formula is authoritative.
 *
 * USAGE:
 *   # Requires service account key at functions/serviceAccountKey.json
 *   # OR GOOGLE_APPLICATION_CREDENTIALS env var.
 *   npx ts-node scripts/verify-balance-formula.ts
 *
 *   # Write results to file:
 *   npx ts-node scripts/verify-balance-formula.ts > /tmp/balance-audit.txt
 *
 * DOES NOT WRITE ANYTHING. Read-only against prod Firestore.
 */

import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';

const KEY_PATHS = [
  path.resolve(__dirname, '..', 'functions', 'serviceAccountKey.json'),
  path.resolve(__dirname, '..', 'serviceAccountKey.json'),
];

function initAdmin() {
  if (admin.apps.length > 0) return;

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp();
    return;
  }

  for (const p of KEY_PATHS) {
    if (fs.existsSync(p)) {
      const key = require(p);
      admin.initializeApp({
        credential: admin.credential.cert(key),
        projectId: key.project_id,
      });
      return;
    }
  }

  const adcPath = path.join(
    process.env.HOME || '~',
    '.config/gcloud/application_default_credentials.json',
  );
  if (fs.existsSync(adcPath)) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.GOOGLE_CLOUD_PROJECT || 'profit-step',
    });
    return;
  }

  throw new Error(
    'No credentials found. Run `gcloud auth application-default login --project=profit-step` OR set GOOGLE_APPLICATION_CREDENTIALS OR place serviceAccountKey.json in functions/ or repo root.',
  );
}

interface EmployeeBuckets {
  employeeId: string;
  employeeName: string;
  earned: number;       // regular non-voided sessions
  paid: number;         // type='payment', absolute value
  adjustments: number;  // type='correction' OR 'manual_adjustment'
  expenses: number;     // from costs collection
  sessionCount: number;
}

async function main() {
  initAdmin();
  const db = admin.firestore();

  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const yearStartTs = admin.firestore.Timestamp.fromDate(yearStart);

  console.log(`Querying work_sessions since ${yearStart.toISOString()}...`);
  const sessionsSnap = await db
    .collection('work_sessions')
    .where('startTime', '>=', yearStartTs)
    .get();

  console.log(`Found ${sessionsSnap.size} sessions. Aggregating by employee...`);

  const byEmployee = new Map<string, EmployeeBuckets>();
  sessionsSnap.docs.forEach((d) => {
    const s = d.data();
    const id = String(s.employeeId || 'unknown');
    if (!byEmployee.has(id)) {
      byEmployee.set(id, {
        employeeId: id,
        employeeName: s.employeeName || 'Unknown',
        earned: 0,
        paid: 0,
        adjustments: 0,
        expenses: 0,
        sessionCount: 0,
      });
    }
    const b = byEmployee.get(id)!;
    const amount = s.sessionEarnings || 0;
    const type = s.type || 'regular';
    if (type === 'payment') {
      b.paid += Math.abs(amount);
    } else if (type === 'correction' || type === 'manual_adjustment') {
      // bot treats both as "adjustments", api treats only manual_adjustment —
      // we compute BOTH formulas below, so stash as adjustments here
      b.adjustments += amount;
    } else {
      if (!s.isVoided) b.earned += amount;
    }
    b.sessionCount += 1;
    if (s.employeeName && s.employeeName.length > b.employeeName.length) {
      b.employeeName = s.employeeName;
    }
  });

  console.log(`Querying costs collection since ${yearStart.toISOString()}...`);
  const costsSnap = await db
    .collection('costs')
    .where('createdAt', '>=', yearStartTs)
    .get();

  console.log(`Found ${costsSnap.size} cost records. Attributing expenses...`);

  costsSnap.docs.forEach((d) => {
    const c = d.data();
    const id = String(c.userId || '');
    if (!id) return;
    if (!byEmployee.has(id)) return; // no sessions this year — skip
    const b = byEmployee.get(id)!;
    b.expenses += Math.abs(c.amount || 0);
  });

  const rows = Array.from(byEmployee.values())
    .map((b) => ({
      ...b,
      balanceBot: +(b.earned + b.adjustments - b.paid - b.expenses).toFixed(2),
      balanceApi: +(b.earned - b.paid + b.adjustments).toFixed(2),
    }))
    .map((b) => ({ ...b, diff: +(b.balanceApi - b.balanceBot).toFixed(2) }));

  const mismatched = rows.filter((r) => Math.abs(r.diff) > 0.01);
  mismatched.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  console.log('\n===== BALANCE FORMULA AUDIT =====');
  console.log(`Total employees with sessions YTD: ${rows.length}`);
  console.log(`Employees where bot and API disagree: ${mismatched.length}`);
  console.log(
    `Root cause of disagreement: bot subtracts expenses ($${rows
      .reduce((s, r) => s + r.expenses, 0)
      .toFixed(2)} total), API does not.\n`
  );

  if (mismatched.length === 0) {
    console.log('No disagreements. Either no one has expenses, or formulas are actually in sync.');
    process.exit(0);
  }

  console.log('Top 20 disagreements (|bot - api| desc):');
  console.log(
    'employee_name'.padEnd(30) +
      'bot_balance'.padStart(14) +
      'api_balance'.padStart(14) +
      'diff'.padStart(12) +
      'expenses'.padStart(12)
  );
  console.log('-'.repeat(82));
  mismatched.slice(0, 20).forEach((r) => {
    console.log(
      (r.employeeName || r.employeeId).slice(0, 28).padEnd(30) +
        r.balanceBot.toFixed(2).padStart(14) +
        r.balanceApi.toFixed(2).padStart(14) +
        r.diff.toFixed(2).padStart(12) +
        r.expenses.toFixed(2).padStart(12)
    );
  });

  const totalDiff = mismatched.reduce((s, r) => s + Math.abs(r.diff), 0);
  console.log(`\nTotal absolute |diff| across all mismatched: $${totalDiff.toFixed(2)}`);
  console.log(
    '\nACTION ITEM: decide which formula is authoritative, then sync the other end.'
  );
  console.log(
    '  - If bot is right: fix timeTracking.ts:778 to subtract expenses.'
  );
  console.log(
    "  - If API is right: fix sessionManager.ts:312 to NOT subtract expenses (remove the 'costs' query)."
  );
  console.log(
    '\nAlso: the comment in sessionManager.ts:265 claims it matches payroll.ts::calculatePayrollBuckets(),'
  );
  console.log(
    "but that function doesn't exist — the comment is stale from the refactor. Fix or remove."
  );
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
