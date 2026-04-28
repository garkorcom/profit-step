/**
 * Backfill `companyId` on work_sessions docs that lack it (incident 2026-04-28).
 *
 * After PR #95 deployed strict RLS read rules requiring companyId, ~25% of
 * historical work_sessions became invisible to Web UI. This script resolves
 * each orphan's companyId via the users collection and writes it back.
 *
 * Two passes are needed because employeeId is heterogeneous:
 *   - string  → users/{uid}.companyId
 *   - number  → users where telegramId == String(employeeId).companyId
 *
 * Run modes:
 *   DRY_RUN=1 node functions/scripts/backfill-work-sessions-companyid.js
 *     - Reads everything, writes nothing. Reports counts.
 *   node functions/scripts/backfill-work-sessions-companyid.js
 *     - Actually writes companyId where resolvable.
 */

const admin = require('firebase-admin');

const DRY_RUN = process.env.DRY_RUN === '1' || process.argv.includes('--dry-run');

admin.initializeApp({ projectId: 'profit-step' });
const db = admin.firestore();

(async () => {
  const mode = DRY_RUN ? 'DRY-RUN (no writes)' : 'WRITE (will update Firestore)';
  console.log(`Mode: ${mode}\n`);

  // 1. Build telegramId → companyId AND uid → companyId maps from users.
  console.log('Building user identity map from `users` collection...');
  const usersSnap = await db.collection('users').get();
  const uidToCompanyId = new Map();
  const telegramIdToCompanyId = new Map();
  let usersWithCompany = 0;
  let usersTotal = 0;
  for (const uDoc of usersSnap.docs) {
    usersTotal++;
    const u = uDoc.data();
    const cid = typeof u.companyId === 'string' && u.companyId.length > 0 ? u.companyId : null;
    if (!cid) continue;
    usersWithCompany++;
    uidToCompanyId.set(uDoc.id, cid);
    if (u.telegramId !== undefined && u.telegramId !== null) {
      telegramIdToCompanyId.set(String(u.telegramId), cid);
    }
  }
  console.log(`  users total:           ${usersTotal}`);
  console.log(`  users with companyId:  ${usersWithCompany}`);
  console.log(`  uid map entries:       ${uidToCompanyId.size}`);
  console.log(`  telegramId map entries:${telegramIdToCompanyId.size}\n`);

  // 2. Page through work_sessions; for each missing companyId, try to resolve.
  console.log('Scanning work_sessions for missing companyId...');
  const fixable = []; // { id, resolvedCompanyId, via }
  const orphans = []; // { id, employeeId, employeeIdType, reason }

  let last = null;
  let scanned = 0;
  let alreadyHasCid = 0;

  while (true) {
    let q = db.collection('work_sessions').orderBy('__name__').limit(1000);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      scanned++;
      const d = doc.data();
      const cid = d.companyId;
      const hasCid = typeof cid === 'string' && cid.length > 0;
      if (hasCid) {
        alreadyHasCid++;
        continue;
      }

      const eid = d.employeeId;
      const eidType = typeof eid;
      let resolved = null;
      let via = null;
      if (eidType === 'string') {
        resolved = uidToCompanyId.get(eid) || null;
        via = 'uid';
      } else if (eidType === 'number') {
        resolved = telegramIdToCompanyId.get(String(eid)) || null;
        via = 'telegramId';
      }

      if (resolved) {
        fixable.push({ id: doc.id, resolvedCompanyId: resolved, via });
      } else {
        orphans.push({
          id: doc.id,
          employeeId: eid,
          employeeIdType: eidType,
          reason: eidType === 'string'
            ? 'no users/{uid} doc, or that user has no companyId'
            : eidType === 'number'
              ? 'no users with matching telegramId, or that user has no companyId'
              : `employeeId is ${eidType}`,
        });
      }
    }

    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 1000) break;
  }

  console.log(`\nScan complete:`);
  console.log(`  total work_sessions scanned:  ${scanned}`);
  console.log(`  already had companyId:        ${alreadyHasCid}`);
  console.log(`  missing companyId — fixable:  ${fixable.length}`);
  console.log(`  missing companyId — orphans:  ${orphans.length}`);

  // Group fixable by resolved companyId for visibility.
  const cidFreq = new Map();
  for (const f of fixable) cidFreq.set(f.resolvedCompanyId, (cidFreq.get(f.resolvedCompanyId) || 0) + 1);
  console.log(`\nFixable docs grouped by resolved companyId:`);
  for (const [cid, n] of [...cidFreq.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cid}  →  ${n} sessions`);
  }

  // Show orphan reasons
  const orphanReasonFreq = new Map();
  for (const o of orphans) orphanReasonFreq.set(o.reason, (orphanReasonFreq.get(o.reason) || 0) + 1);
  if (orphans.length > 0) {
    console.log(`\nOrphans grouped by reason:`);
    for (const [r, n] of orphanReasonFreq) {
      console.log(`  ${n}  ${r}`);
    }
    console.log(`\nFirst 10 orphans (id + employeeId snapshot for forensics):`);
    for (const o of orphans.slice(0, 10)) {
      console.log(`  ${o.id}  employeeId=${JSON.stringify(o.employeeId)} (${o.employeeIdType})`);
    }
  }

  if (DRY_RUN) {
    console.log(`\nDRY-RUN — no writes performed. Re-run without DRY_RUN=1 to apply.`);
    process.exit(0);
  }

  // 3. Apply writes in batches of 500.
  if (fixable.length === 0) {
    console.log('\nNothing to fix. Exiting.');
    process.exit(0);
  }
  console.log(`\nApplying ${fixable.length} updates in batches of 500...`);
  let written = 0;
  for (let i = 0; i < fixable.length; i += 500) {
    const slice = fixable.slice(i, i + 500);
    const batch = db.batch();
    for (const f of slice) {
      batch.update(db.collection('work_sessions').doc(f.id), {
        companyId: f.resolvedCompanyId,
        backfilled: { at: admin.firestore.FieldValue.serverTimestamp(), via: f.via, source: 'incident-2026-04-28' },
      });
    }
    await batch.commit();
    written += slice.length;
    console.log(`  committed batch: ${written}/${fixable.length}`);
  }
  console.log(`\nDone. Wrote companyId on ${written} sessions.`);
  if (orphans.length > 0) {
    console.log(`${orphans.length} sessions remain orphaned (no resolvable user) — manual review needed.`);
  }

  process.exit(0);
})().catch(err => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
