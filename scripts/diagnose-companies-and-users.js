/**
 * READ-ONLY: list companies + count users/employees missing companyId.
 */
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp({ credential: applicationDefault(), projectId: process.env.GOOGLE_CLOUD_PROJECT || 'profit-step' });
const db = getFirestore();

async function main() {
    const companies = await db.collection('companies').get();
    console.log('=== Companies ===');
    for (const doc of companies.docs) {
        const d = doc.data() || {};
        console.log({ id: doc.id, name: d.name, ownerId: d.ownerId, memberCount: d.memberCount });
    }

    console.log('\n=== Users (with vs without companyId) ===');
    const users = await db.collection('users').get();
    let with_co = 0, without_co = 0;
    const orphans = [];
    for (const doc of users.docs) {
        const d = doc.data() || {};
        if (d.companyId) with_co += 1;
        else {
            without_co += 1;
            orphans.push({
                id: doc.id,
                name: d.displayName || d.name || d.email,
                role: d.role,
                telegramId: d.telegramId,
            });
        }
    }
    console.log({ total: users.size, with_co, without_co });
    console.log('Sample orphans (first 20):');
    for (const u of orphans.slice(0, 20)) console.log(JSON.stringify(u));

    console.log('\n=== Employees (with vs without companyId) ===');
    const emps = await db.collection('employees').get();
    let e_with = 0, e_without = 0;
    const e_orphans = [];
    for (const doc of emps.docs) {
        const d = doc.data() || {};
        if (d.companyId) e_with += 1;
        else {
            e_without += 1;
            e_orphans.push({ id: doc.id, name: d.name, telegramId: d.telegramId, hourlyRate: d.hourlyRate });
        }
    }
    console.log({ total: emps.size, e_with, e_without });
    console.log('Sample orphan employees (first 10):');
    for (const e of e_orphans.slice(0, 10)) console.log(JSON.stringify(e));
}

main().catch(err => { console.error(err); process.exit(1); });
