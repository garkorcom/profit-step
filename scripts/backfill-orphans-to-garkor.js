/**
 * Backfill companyId = GARKOR on orphan users/employees and their work_sessions.
 *
 * Context: incident "у части работников пропало время Гена" 2026-05-07.
 * Root cause: 4 user docs + 13 employee docs are missing `companyId`.
 * `resolveHourlyRate` returns `companyId: null`, the bot writes
 * `work_sessions` with companyId undefined, and RLS hides them from the UI.
 *
 * Denis confirmed all of them belong to GARKOR Corp.
 *
 * Order of writes (safe-first):
 *   1. user / employee docs get companyId.
 *   2. their work_sessions (matched by all employeeId variants) get
 *      companyId.
 *
 * Default mode = dry-run (no writes). Pass `--execute` to commit.
 */

const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const GARKOR_COMPANY_ID = '1zZzK2wFuG6hkQ48ADwt';
const EXECUTE = process.argv.includes('--execute');

initializeApp({
    credential: applicationDefault(),
    projectId: process.env.GOOGLE_CLOUD_PROJECT || 'profit-step',
});
const db = getFirestore();

const ORPHAN_USERS = [
    { id: '28qkjSiIMRu0UuxpYE78', telegramId: '9999000001', name: 'Александр Крылов' },
    { id: 'ZKrGrEdSHJuxeGlNvLAt', telegramId: '8486848203', name: 'Геннадий Кортяк' },
    { id: 'oJE7oKJma84LmPVHjETH', telegramId: '1242576164', name: 'Nikolai Krinichkin' },
    { id: 'zZUdHiN6BwJbaEiKGpbX', telegramId: '9999000002', name: 'John (Anything Electric)' },
];

function buildIdVariants(uid, telegramId) {
    const out = new Set();
    if (uid) out.add(uid);
    if (telegramId != null) {
        const tgStr = String(telegramId);
        out.add(tgStr);
        if (/^-?\d+$/.test(tgStr)) out.add(Number(tgStr));
    }
    return [...out];
}

async function loadOrphanEmployees() {
    const snap = await db.collection('employees').get();
    const out = [];
    for (const doc of snap.docs) {
        const d = doc.data() || {};
        if (d.companyId) continue;
        out.push({ id: doc.id, name: d.name, telegramId: d.telegramId });
    }
    return out;
}

async function querySessionsForVariants(variants) {
    const docsById = new Map();
    for (const v of variants) {
        const snap = await db
            .collection('work_sessions')
            .where('employeeId', '==', v)
            .limit(1000)
            .get();
        for (const doc of snap.docs) {
            const d = doc.data() || {};
            // Only count sessions that need backfill (companyId missing/null).
            if (d.companyId === undefined || d.companyId === null) {
                docsById.set(doc.id, d);
            }
        }
    }
    return docsById;
}

async function main() {
    console.log(`Mode: ${EXECUTE ? 'EXECUTE (writing)' : 'DRY-RUN (no writes)'}`);
    console.log(`Target companyId: ${GARKOR_COMPANY_ID} (GARKOR Corp)\n`);

    const userPlan = []; // { id, name, sessionsToFix }
    const employeePlan = [];
    let totalSessionsToFix = 0;

    // ── User orphans ───────────────────────────────────────────────────
    console.log('=== USER ORPHANS ===');
    for (const u of ORPHAN_USERS) {
        const variants = buildIdVariants(u.id, u.telegramId);
        const sessions = await querySessionsForVariants(variants);
        userPlan.push({ ...u, variants, sessionsToFix: sessions });
        totalSessionsToFix += sessions.size;
        console.log(`  ${u.name} (${u.id}) tg=${u.telegramId}`);
        console.log(`    variants: ${JSON.stringify(variants)}`);
        console.log(`    work_sessions to backfill: ${sessions.size}`);
    }

    // ── Employee orphans ───────────────────────────────────────────────
    console.log('\n=== EMPLOYEE ORPHANS ===');
    const employees = await loadOrphanEmployees();
    for (const e of employees) {
        const variants = buildIdVariants(e.id, e.telegramId);
        // Skip session lookup if employee.id duplicates a user's telegramId we already processed.
        const sessions = await querySessionsForVariants(variants);
        employeePlan.push({ ...e, variants, sessionsToFix: sessions });
        totalSessionsToFix += sessions.size;
        console.log(`  ${e.name} (${e.id}) tg=${e.telegramId}`);
        console.log(`    variants: ${JSON.stringify(variants)}`);
        console.log(`    work_sessions to backfill: ${sessions.size}`);
    }

    console.log('\n=== SUMMARY ===');
    console.log(`User docs to update: ${userPlan.length}`);
    console.log(`Employee docs to update: ${employeePlan.length}`);
    console.log(`work_sessions to backfill (dedup'd by doc id): ${totalSessionsToFix}`);

    if (!EXECUTE) {
        console.log('\nDRY-RUN complete. Re-run with --execute to write.');
        return;
    }

    // ── EXECUTE PHASE 1: parent docs ───────────────────────────────────
    console.log('\n=== EXECUTING PHASE 1: parent docs ===');
    const updatedAt = FieldValue.serverTimestamp();
    for (const u of userPlan) {
        await db.collection('users').doc(u.id).update({
            companyId: GARKOR_COMPANY_ID,
            companyIdBackfilledAt: updatedAt,
            companyIdBackfillReason: 'incident_2026-05-07_orphan_user_lost_time',
        });
        console.log(`  user ${u.id} (${u.name}) → companyId set`);
    }
    for (const e of employeePlan) {
        await db.collection('employees').doc(e.id).update({
            companyId: GARKOR_COMPANY_ID,
            companyIdBackfilledAt: updatedAt,
            companyIdBackfillReason: 'incident_2026-05-07_orphan_employee',
        });
        console.log(`  employee ${e.id} (${e.name}) → companyId set`);
    }

    // ── EXECUTE PHASE 2: work_sessions in batches ──────────────────────
    console.log('\n=== EXECUTING PHASE 2: work_sessions ===');
    const allSessions = new Map();
    for (const u of userPlan) for (const [id, d] of u.sessionsToFix) allSessions.set(id, d);
    for (const e of employeePlan) for (const [id, d] of e.sessionsToFix) allSessions.set(id, d);

    let written = 0;
    const BATCH = 400;
    const ids = [...allSessions.keys()];
    for (let i = 0; i < ids.length; i += BATCH) {
        const slice = ids.slice(i, i + BATCH);
        const wb = db.batch();
        for (const id of slice) {
            wb.update(db.collection('work_sessions').doc(id), {
                companyId: GARKOR_COMPANY_ID,
                companyIdBackfilledAt: updatedAt,
                companyIdBackfillReason: 'incident_2026-05-07_orphan_session',
            });
        }
        await wb.commit();
        written += slice.length;
        console.log(`  batch ${i / BATCH + 1}: ${slice.length} sessions updated (total: ${written}/${ids.length})`);
    }

    console.log('\n✅ DONE');
    console.log(`   users updated: ${userPlan.length}`);
    console.log(`   employees updated: ${employeePlan.length}`);
    console.log(`   work_sessions updated: ${written}`);
}

main().catch(err => { console.error('FAILED:', err); process.exit(1); });
