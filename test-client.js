const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from frontend env file
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });
dotenv.config({ path: path.resolve(__dirname, '..', '.env.production') });

const firebaseConfig = {
    apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
    authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
    storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.REACT_APP_FIREBASE_APP_ID,
};

// Error if no valid config
if (!firebaseConfig.projectId) {
    console.error("Missing Firebase Config! Env:", Object.keys(process.env).filter(k => k.startsWith('REACT_APP')));
    process.exit(1);
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkVictor() {
    console.log("Searching for Victor in prod DB via Client SDK...");
    try {
        let victor = null;

        // Note: For regular clients, we might not have permission to list all users, 
        // but let's try. Often 'workers' is readable.
        const workersSnap = await getDocs(collection(db, 'workers'));
        workersSnap.forEach(doc => {
            const data = doc.data();
            if (data.name && data.name.toLowerCase().includes('victor') || data.name && data.name.toLowerCase().includes('виктор')) {
                victor = { id: doc.id, collection: 'workers', ...data };
            }
        });

        if (!victor) {
            const usersSnap = await getDocs(collection(db, 'users'));
            usersSnap.forEach(doc => {
                const data = doc.data();
                if (data.name && data.name.toLowerCase().includes('victor') || data.name && data.name.toLowerCase().includes('виктор')) {
                    victor = { id: doc.id, collection: 'users', ...data };
                }
            });
        }

        if (victor) {
            console.log(`✅ FOUND VICTOR: ID=${victor.id}, NAME=${victor.name}`);

            const startOfMarch = new Date('2026-03-01T00:00:00.000Z');

            console.log("\n--- WORK SESSIONS (March 2026) ---");
            const sessionsSnap = await getDocs(collection(db, 'workSessions'));
            let sessionCount = 0;
            sessionsSnap.forEach(doc => {
                const d = doc.data();
                if (d.userId === victor.id) {
                    if (d.startTime && d.startTime.toDate() >= startOfMarch) {
                        console.log(`[${doc.id}] status=${d.status}, start=${d.startTime.toDate().toISOString()}`);
                        sessionCount++;
                    }
                }
            });
            console.log(`Total March sessions: ${sessionCount}`);

            console.log("\n--- AUDIT EVENTS (March 2026) ---");
            const auditSnap = await getDocs(collection(db, 'auditEvents'));
            let auditCount = 0;
            auditSnap.forEach(doc => {
                const d = doc.data();
                if (d.userId === victor.id && d.timestamp && d.timestamp.toDate() >= startOfMarch) {
                    console.log(`[${doc.id}] action=${d.action} module=${d.module}`);
                    auditCount++;
                }
            });
            console.log(`Total March audit events: ${auditCount}`);

            console.log("\n--- BOT LOGS (March 2026) ---");
            const logsSnap = await getDocs(collection(db, 'botLogs'));
            let logsCount = 0;
            logsSnap.forEach(doc => {
                const d = doc.data();
                if (d.workerId === victor.id && d.timestamp && d.timestamp.toDate() >= startOfMarch) {
                    console.log(`[${doc.id}] time=${d.timestamp.toDate().toISOString()} action=${d.action} text="${d.text}"`);
                    logsCount++;
                }
            });
            console.log(`Total March bot logs: ${logsCount}`);

        } else {
            console.log("❌ VICTOR NOT FOUND in accessible documents.");
        }
    } catch (e) {
        console.error("Firestore Error. Might be permission denied.", e.message);
    }
}

checkVictor().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
