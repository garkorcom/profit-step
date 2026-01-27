import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize if needed (though usually initialized in index.ts)
if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

export const diagnoseBot = functions.https.onRequest(async (req: functions.https.Request, res: functions.Response) => {
    const config = functions.config();
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

    res.status(200).json(report);
});

async function checkGemini() {
    const apiKey = process.env.GEMINI_API_KEY || functions.config().gemini?.api_key;
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
