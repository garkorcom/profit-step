/**
 * Read-only diagnostic for incident 2026-04-28.
 *
 * Counts work_sessions docs and reports how many lack `companyId` —
 * the key field on which RLS read rule was tightened in PR #95
 * (deployed 2026-04-28T00:39 UTC). If most/all docs lack it, that
 * explains why dashboards/finance show 0 starting today.
 *
 * Pure read. Writes nothing. No secrets in output.
 *
 * Run:
 *   GOOGLE_APPLICATION_CREDENTIALS unset → uses gcloud ADC
 *   node functions/scripts/diagnose-work-sessions.js
 */
const admin = require('firebase-admin');

admin.initializeApp({ projectId: 'profit-step' });
const db = admin.firestore();

(async () => {
  const TZ_BOUNDARY = new Date('2026-01-01T00:00:00Z');

  console.log('Querying work_sessions (this may take a minute on a busy collection)...');

  // Page through to count without holding everything in memory at once.
  let total = 0;
  let withCompanyId = 0;
  let emptyCompanyId = 0;
  let missingCompanyId = 0;
  let yearTotal = 0;
  let yearWithCompanyId = 0;
  let yearMissing = 0;
  let employeeIdNumber = 0;
  let employeeIdString = 0;

  // Type / status breakdowns for visibility
  const byType = {};
  const sampleMissing = [];

  let last = null;
  while (true) {
    let q = db.collection('work_sessions').orderBy('__name__').limit(1000);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      total++;
      const d = doc.data();
      const startTs = d.startTime?.toMillis?.();
      const inYear = startTs ? startTs >= TZ_BOUNDARY.getTime() : false;
      if (inYear) yearTotal++;

      const cid = d.companyId;
      if (cid === undefined) {
        missingCompanyId++;
        if (inYear) yearMissing++;
        if (sampleMissing.length < 5) sampleMissing.push({
          id: doc.id,
          employeeIdType: typeof d.employeeId,
          status: d.status,
          type: d.type || 'regular',
          startTime: d.startTime?.toDate?.()?.toISOString() || null,
          hasEmployeeName: !!d.employeeName,
        });
      } else if (typeof cid === 'string' && cid.length === 0) {
        emptyCompanyId++;
        if (inYear) yearMissing++;
      } else {
        withCompanyId++;
        if (inYear) yearWithCompanyId++;
      }

      const t = typeof d.employeeId;
      if (t === 'number') employeeIdNumber++;
      else if (t === 'string') employeeIdString++;

      const typeKey = d.type || 'regular';
      byType[typeKey] = (byType[typeKey] || 0) + 1;
    }

    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 1000) break;
  }

  console.log('\n=== work_sessions diagnostic ===');
  console.log(`Total docs:               ${total}`);
  console.log(`  with companyId:         ${withCompanyId}`);
  console.log(`  with empty companyId:   ${emptyCompanyId}`);
  console.log(`  missing companyId:      ${missingCompanyId}`);
  console.log(`  hidden by RLS (no/empty companyId): ${missingCompanyId + emptyCompanyId} (${((missingCompanyId + emptyCompanyId) / Math.max(1, total) * 100).toFixed(1)}%)`);
  console.log('');
  console.log(`Year-to-date (>= 2026-01-01):`);
  console.log(`  total:                  ${yearTotal}`);
  console.log(`  with companyId:         ${yearWithCompanyId}`);
  console.log(`  hidden by RLS:          ${yearMissing} (${(yearMissing / Math.max(1, yearTotal) * 100).toFixed(1)}%)`);
  console.log('');
  console.log(`employeeId field types (whole collection):`);
  console.log(`  number (Telegram id):   ${employeeIdNumber}`);
  console.log(`  string (Firebase UID):  ${employeeIdString}`);
  console.log('');
  console.log(`Type breakdown (whole collection):`);
  for (const k of Object.keys(byType).sort()) {
    console.log(`  ${k.padEnd(22)} ${byType[k]}`);
  }
  console.log('');
  console.log(`Sample of 5 docs missing companyId (no PII, ids only):`);
  for (const s of sampleMissing) {
    console.log(`  ${s.id}: employeeId=${s.employeeIdType}, status=${s.status}, type=${s.type}, startTime=${s.startTime}`);
  }

  process.exit(0);
})().catch(err => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
