/**
 * Read-only diagnostic for "пропало время" symptom on Gennadiy.
 *
 * Finds:
 *   - Employee/User docs whose name matches Гена/Геннадий/Genna*
 *   - For each match: count work_sessions, breakdown by companyId presence,
 *     by employeeId type (number/string), recent samples.
 *
 * Why this matters (CLAUDE.md memory "Strict RLS = three companions"):
 *   PR #95 tightened firestore.rules so client-side reads of work_sessions
 *   require resource.data.companyId == getUserCompany(). Sessions written
 *   before that fix (or by a path that didn't include companyId) are
 *   invisible to the web UI but visible to bot/admin SDK.
 *
 * NO WRITES. NO DELETES. Pure read.
 */

const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp({
    credential: applicationDefault(),
    projectId: process.env.GOOGLE_CLOUD_PROJECT || 'profit-step',
});

const db = getFirestore();

const NAME_NEEDLES = ['геннад', 'gennad', 'гена', 'gena'];

function isMatch(name) {
    if (!name) return false;
    const lc = String(name).toLowerCase();
    return NAME_NEEDLES.some(n => lc.includes(n));
}

async function findCandidates() {
    const candidates = []; // { source, id, employeeId, name, companyId, telegramId, raw }

    // Employees collection (legacy worker registry).
    const empSnap = await db.collection('employees').get();
    for (const doc of empSnap.docs) {
        const d = doc.data() || {};
        if (isMatch(d.name) || isMatch(d.displayName) || isMatch(d.fullName)) {
            candidates.push({
                source: 'employees',
                id: doc.id,
                employeeId: d.employeeId ?? doc.id,
                name: d.name || d.displayName || d.fullName,
                companyId: d.companyId,
                telegramId: d.telegramId,
                hourlyRate: d.hourlyRate,
            });
        }
    }

    // Users collection (platform users).
    const userSnap = await db.collection('users').get();
    for (const doc of userSnap.docs) {
        const d = doc.data() || {};
        const nameField = d.displayName || d.name || d.fullName || d.email;
        if (isMatch(nameField)) {
            candidates.push({
                source: 'users',
                id: doc.id,
                employeeId: doc.id,
                name: nameField,
                companyId: d.companyId,
                telegramId: d.telegramId,
                role: d.role,
            });
        }
    }

    return candidates;
}

async function summariseSessions(candidate) {
    const ids = [
        candidate.id,
        candidate.employeeId,
        candidate.telegramId, // bot writes telegramId as numeric employeeId
    ].filter(Boolean);

    // Query each id form (string + number variant) so we mirror the bot's dedupe.
    const queryIds = new Set();
    for (const id of ids) {
        if (id == null) continue;
        queryIds.add(String(id));
        if (/^-?\d+$/.test(String(id))) queryIds.add(Number(id));
    }

    let total = 0;
    let withCompanyId = 0;
    let withoutCompanyId = 0;
    let companyIdSystem = 0;
    let employeeIdNumber = 0;
    let employeeIdString = 0;
    const byCompany = new Map();
    const byStatus = new Map();
    const recent = [];

    for (const qid of queryIds) {
        const snap = await db
            .collection('work_sessions')
            .where('employeeId', '==', qid)
            .limit(500)
            .get();
        for (const doc of snap.docs) {
            const d = doc.data() || {};
            total += 1;
            if (d.companyId === undefined || d.companyId === null) {
                withoutCompanyId += 1;
            } else if (d.companyId === 'system') {
                companyIdSystem += 1;
                withCompanyId += 1;
            } else {
                withCompanyId += 1;
                byCompany.set(d.companyId, (byCompany.get(d.companyId) ?? 0) + 1);
            }
            if (typeof d.employeeId === 'number') employeeIdNumber += 1;
            else if (typeof d.employeeId === 'string') employeeIdString += 1;
            const status = d.status ?? '(undefined)';
            byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
            const startMs = d.startTime?.toMillis?.() ?? 0;
            recent.push({ id: doc.id, startMs, ...d });
        }
    }
    recent.sort((a, b) => b.startMs - a.startMs);

    return {
        queryIds: [...queryIds],
        total,
        withCompanyId,
        withoutCompanyId,
        companyIdSystem,
        employeeIdNumber,
        employeeIdString,
        byCompany: [...byCompany.entries()],
        byStatus: [...byStatus.entries()],
        sampleRecent: recent.slice(0, 5).map(s => ({
            id: s.id,
            employeeId: s.employeeId,
            employeeIdType: typeof s.employeeId,
            companyId: s.companyId ?? null,
            status: s.status,
            startTime: s.startTime?.toDate?.()?.toISOString?.() ?? null,
            endTime: s.endTime?.toDate?.()?.toISOString?.() ?? null,
            durationMinutes: s.durationMinutes ?? null,
        })),
        sampleOldest: recent.slice(-3).map(s => ({
            id: s.id,
            companyId: s.companyId ?? null,
            employeeIdType: typeof s.employeeId,
            startTime: s.startTime?.toDate?.()?.toISOString?.() ?? null,
        })),
    };
}

async function main() {
    console.log('=== Searching for Gennadiy candidates ===');
    const candidates = await findCandidates();
    if (candidates.length === 0) {
        console.log('No candidates matched names containing: гена / геннадий / gena / gennad');
        return;
    }
    for (const c of candidates) {
        console.log('\n— Candidate —');
        console.log(JSON.stringify(c, null, 2));
        const sum = await summariseSessions(c);
        console.log(JSON.stringify(sum, null, 2));
    }

    // Bonus: global stats on work_sessions companyId coverage (sample of 1000).
    console.log('\n=== Global work_sessions sample (first 1000) ===');
    const sample = await db.collection('work_sessions').limit(1000).get();
    let g_with = 0, g_without = 0, g_system = 0, num_emp = 0, str_emp = 0;
    for (const doc of sample.docs) {
        const d = doc.data() || {};
        if (d.companyId === undefined || d.companyId === null) g_without += 1;
        else if (d.companyId === 'system') { g_system += 1; g_with += 1; }
        else g_with += 1;
        if (typeof d.employeeId === 'number') num_emp += 1;
        else if (typeof d.employeeId === 'string') str_emp += 1;
    }
    console.log({
        sampled: sample.size,
        withCompanyId: g_with,
        withoutCompanyId: g_without,
        companyIdSystem: g_system,
        employeeIdNumber: num_emp,
        employeeIdString: str_emp,
    });
}

main().catch(err => {
    console.error('FAILED:', err);
    process.exit(1);
});
