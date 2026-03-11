const admin = require('firebase-admin');

// Ensure we have credentials
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error("Please set GOOGLE_APPLICATION_CREDENTIALS");
    process.exit(1);
}

admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: "https://profit-step.firebaseio.com"
});

const db = admin.firestore();

async function run() {
    console.log("Searching for Victor...");
    let victor = null;

    // Search users
    const users = await db.collection('users').get();
    for (const doc of users.docs) {
        const d = doc.data();
        if ((d.name && d.name.toLowerCase().includes('victor')) ||
            (d.name && d.name.toLowerCase().includes('виктор'))) {
            victor = { id: doc.id, collection: 'users', ...d };
            break;
        }
    }

    // Search workers if not found in users
    if (!victor) {
        const workers = await db.collection('workers').get();
        for (const doc of workers.docs) {
            const d = doc.data();
            if ((d.name && d.name.toLowerCase().includes('victor')) ||
                (d.name && d.name.toLowerCase().includes('виктор'))) {
                victor = { id: doc.id, collection: 'workers', ...d };
                break;
            }
        }
    }

    if (victor) {
        console.log(`\n✅ FOUND VICTOR: ID=${victor.id}, NAME=${victor.name}, COLLECTION=${victor.collection}, ROLE=${victor.role || victor.systemRole || 'none'}\n`);

        const startOfMarch = new Date('2026-03-01T00:00:00.000Z');

        console.log("--- WORK SESSIONS (March 2026) ---");
        const sessions = await db.collection('workSessions')
            .where('userId', '==', victor.id)
            .get();

        let sessionCount = 0;
        sessions.forEach(doc => {
            const d = doc.data();
            if (d.startTime && d.startTime.toDate() >= startOfMarch) {
                console.log(`[${doc.id}] status=${d.status}, start=${d.startTime.toDate().toISOString()}, end=${d.endTime ? d.endTime.toDate().toISOString() : 'NULL'}, cost=${d.calculatedCost}`);
                sessionCount++;
            }
        });
        if (sessionCount === 0) console.log("No work sessions found in March.");

        console.log("\n--- AUDIT EVENTS (March 2026) ---");
        const auditEvents = await db.collection('auditEvents')
            .where('userId', '==', victor.id)
            .get();

        let auditCount = 0;
        auditEvents.forEach(doc => {
            const d = doc.data();
            if (d.timestamp && d.timestamp.toDate() >= startOfMarch) {
                console.log(`[${doc.id}] time=${d.timestamp.toDate().toISOString()} action=${d.action} module=${d.module} details=${JSON.stringify(d.details || {})}`);
                auditCount++;
            }
        });
        if (auditCount === 0) console.log("No audit events found in March.");

        console.log("\n--- BOT LOGS (March 2026) ---");
        const botLogs = await db.collection('botLogs').where('workerId', '==', victor.id).get();
        let logCount = 0;
        botLogs.forEach(doc => {
            const d = doc.data();
            if (d.timestamp && d.timestamp.toDate() >= startOfMarch) {
                console.log(`[${doc.id}] time=${d.timestamp.toDate().toISOString()} action=${d.action} text="${d.text}" state=${d.state}`);
                logCount++;
            }
        });
        if (logCount === 0) console.log("No bot logs found in March.");

        console.log("\n--- BOT STATES ---");
        const state1 = await db.collection('botStates').doc(victor.id).get();
        if (state1.exists) console.log(`botStates/${victor.id}:`, state1.data());

        // Sometimes telegram ID is different from userId, check if he has telegramId mapping
        if (victor.telegramId) {
            console.log(`\n--- BOT STATES (by telegramId: ${victor.telegramId}) ---`);
            const state2 = await db.collection('botStates').doc(victor.telegramId.toString()).get();
            if (state2.exists) console.log(`botStates/${victor.telegramId}:`, state2.data());
        }

    } else {
        console.log("❌ VICTOR NOT FOUND in users or workers collections.");
    }
}
run().catch(console.error);
