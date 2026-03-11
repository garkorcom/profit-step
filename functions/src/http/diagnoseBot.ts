import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { safeConfig } from '../utils/safeConfig';

// Initialize if needed (though usually initialized in index.ts)
if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

export const diagnoseBot = functions.https.onRequest(async (req: functions.https.Request, res: functions.Response) => {
    const config = safeConfig();
    const envToken = process.env.WORKER_BOT_TOKEN;
    const configToken = config.worker_bot?.token;

    // Check Firestore Connectivity
    let firestoreStatus = 'unknown';
    try {
        await db.collection('employees').limit(1).get();
        firestoreStatus = 'connected';
    } catch (e: any) {
        firestoreStatus = `error: ${e.message}`;
    }

    const report = {
        timestamp: new Date().toISOString(),
        environment: {
            nodeVersion: process.version,
            projectId: process.env.GCLOUD_PROJECT || 'unknown',
        },
        configuration: {
            hasEnvToken: !!envToken,
            envTokenLength: envToken?.length || 0,
            hasConfigToken: !!configToken,
            configTokenLength: configToken?.length || 0,
            tokenSource: envToken ? 'process.env' : (configToken ? 'functions.config' : 'none'),
        },
        services: {
            firestore: firestoreStatus,
            gemini: await checkGemini()
        },
        request: {
            headers: req.headers,
            method: req.method
        }
    };

    if (req.query.victor === '1') {
        const victorLogs: any = { status: 'victor search started' };
        try {
            let victorId = null;
            const usersSnap = await db.collection('users').get();
            usersSnap.forEach(doc => {
                const d = doc.data();
                if (d.name && d.name.toLowerCase().includes('victor') || d.name && d.name.toLowerCase().includes('виктор')) victorId = doc.id;
            });
            if (!victorId) {
                const wSnap = await db.collection('workers').get();
                wSnap.forEach(doc => {
                    const d = doc.data();
                    if (d.name && d.name.toLowerCase().includes('victor') || d.name && d.name.toLowerCase().includes('виктор')) victorId = doc.id;
                });
            }
            victorLogs.victorId = victorId;
            if (victorId) {
                const marchStart = new Date('2026-03-01T00:00:00Z');

                // bot logs
                const logsSnap = await db.collection('botLogs').where('workerId', '==', victorId).get();
                victorLogs.botLogs = [];
                logsSnap.forEach(d => {
                    const data = d.data();
                    if (data.timestamp && data.timestamp.toDate() >= marchStart) victorLogs.botLogs.push({ id: d.id, ...data });
                });

                // work sessions
                const sessionsSnap = await db.collection('workSessions').where('userId', '==', victorId).get();
                victorLogs.workSessions = [];
                sessionsSnap.forEach(d => {
                    const data = d.data();
                    if (data.startTime && data.startTime.toDate() >= marchStart) victorLogs.workSessions.push({ id: d.id, ...data });
                });

                const auditSnap = await db.collection('auditEvents').where('userId', '==', victorId).get();
                victorLogs.auditEvents = [];
                auditSnap.forEach(d => {
                    const data = d.data();
                    if (data.timestamp && data.timestamp.toDate() >= marchStart) victorLogs.auditEvents.push({ id: d.id, ...data });
                });

                const botState = await db.collection('botStates').doc(victorId).get();
                victorLogs.botState = botState.data() || null;
            }
        } catch (e: any) {
            victorLogs.error = e.message;
        }
        res.status(200).json(victorLogs);
        return;
    }

    if (req.query.victor === '4') {
        const victorId = 'CShLUHitm9c3eBxUvdCZgAa333l1';
        const telegramId = '492031182';
        const victorLogs: any = { status: 'victor search started', victorId, telegramId };

        try {
            const marchStart = new Date('2026-03-01T00:00:00Z');

            // bot_logs using telegramId
            const logsSnap = await db.collection('bot_logs').where('workerId', '==', Number(telegramId)).get();
            const logsSnapStr = await db.collection('bot_logs').where('workerId', '==', telegramId).get();
            victorLogs.bot_logs_by_telegramId = [];
            logsSnap.forEach(d => {
                const data = d.data();
                if (data.timestamp && data.timestamp.toDate() >= marchStart) victorLogs.bot_logs_by_telegramId.push({ id: d.id, ...data });
            });
            logsSnapStr.forEach(d => {
                const data = d.data();
                if (data.timestamp && data.timestamp.toDate() >= marchStart) victorLogs.bot_logs_by_telegramId.push({ id: d.id, ...data });
            });

            // work_sessions using userId
            const sessionsSnap = await db.collection('work_sessions').where('employeeId', '==', victorId).get();
            const sessionsSnapTg = await db.collection('work_sessions').where('employeeId', '==', Number(telegramId)).get();
            victorLogs.work_sessions = [];
            sessionsSnap.forEach(d => {
                const data = d.data();
                if (data.startTime && data.startTime.toDate() >= marchStart) victorLogs.work_sessions.push({ id: d.id, ...data });
            });
            sessionsSnapTg.forEach(d => {
                const data = d.data();
                if (data.startTime && data.startTime.toDate() >= marchStart) victorLogs.work_sessions.push({ id: d.id, ...data });
            });

            // audit_events by userId
            const auditSnap = await db.collection('audit_events').where('userId', '==', victorId).get();
            victorLogs.audit_events = [];
            auditSnap.forEach(d => {
                const data = d.data();
                if (data.timestamp && data.timestamp.toDate() >= marchStart) victorLogs.audit_events.push({ id: d.id, ...data });
            });

            // bot states
            const botStateByTg = await db.collection('bot_states').doc(telegramId).get();
            victorLogs.bot_state_telegramId = botStateByTg.data() || null;

        } catch (e: any) {
            victorLogs.error = e.message;
        }
        res.status(200).json(victorLogs);
        return;
    }

    res.status(200).json(report);
});

async function checkGemini() {
    const apiKey = process.env.GEMINI_API_KEY || safeConfig().gemini?.api_key;
    if (!apiKey) return { status: 'missing_key' };

    const models = ['gemini-2.0-flash', 'gemini-1.5-flash-latest', 'gemini-1.5-flash', 'gemini-1.5-flash-001', 'gemini-pro'];
    const attempts = [];

    const genAI = new GoogleGenerativeAI(apiKey);

    for (const modelName of models) {
        try {
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent('Hello');
            const text = result.response.text();
            return { status: 'ok', model: modelName, response: text, attempts };
        } catch (e: any) {
            attempts.push({ model: modelName, error: e.message });
        }
    }

    return { status: 'all_failed', attempts };
}
