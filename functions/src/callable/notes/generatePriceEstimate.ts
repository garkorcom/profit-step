/**
 * @fileoverview AI Price Estimate for tasks
 * 
 * Uses Gemini to analyze task description and suggest pricing
 * 
 * @module callable/notes/generatePriceEstimate
 */

import * as functions from 'firebase-functions';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { safeConfig } from '../../utils/safeConfig';

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || safeConfig().gemini?.api_key;

const PRICE_ESTIMATE_PROMPT = `Ты — эксперт-оценщик строительных работ в США (Флорида).
Проанализируй описание задачи и предложи ценовой диапазон.

📍 РЕГИОН: {region}
📝 ЗАДАЧА: 
"{taskDescription}"

📋 ЧЕКЛИСТ:
{checklist}

═══════════════════════════════════════════════════════════
УЧИТЫВАЙ:
1. Рыночные ставки подрядчиков в регионе
2. Сложность работы
3. Примерное время выполнения
4. Материалы (если упоминаются)

ВЕРНИ ТОЛЬКО JSON:
{
  "lowPrice": 100,
  "highPrice": 200,
  "suggestedPrice": 150,
  "estimatedHours": 3,
  "reasoning": "Краткое объяснение оценки"
}
═══════════════════════════════════════════════════════════`;

interface PriceEstimateResult {
    lowPrice: number;
    highPrice: number;
    suggestedPrice: number;
    estimatedHours?: number;
    reasoning?: string;
}

/**
 * Generate AI price estimate for a task
 */
export const generatePriceEstimate = functions
    .region('us-central1')
    .https.onCall(async (data, context): Promise<PriceEstimateResult> => {
        // Auth check
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');
        }

        const { noteId, taskDescription, checklist, region } = data;

        if (!noteId && !taskDescription) {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'Either noteId or taskDescription is required'
            );
        }

        // If noteId provided, load note data
        let description = taskDescription || '';
        let checklistText = '';

        if (noteId) {
            const noteSnap = await db.collection('notes').doc(noteId).get();
            if (!noteSnap.exists) {
                throw new functions.https.HttpsError('not-found', 'Note not found');
            }
            const noteData = noteSnap.data()!;
            description = noteData.description || noteData.title || '';

            if (noteData.checklist?.length) {
                checklistText = noteData.checklist
                    .map((item: { text: string }) => `- ${item.text}`)
                    .join('\n');
            }
        } else if (checklist?.length) {
            checklistText = checklist.map((item: string) => `- ${item}`).join('\n');
        }

        if (!GEMINI_API_KEY) {
            throw new functions.https.HttpsError('internal', 'GEMINI_API_KEY not configured');
        }

        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

        const prompt = PRICE_ESTIMATE_PROMPT
            .replace('{region}', region || 'Florida, USA')
            .replace('{taskDescription}', description)
            .replace('{checklist}', checklistText || '(нет чеклиста)');

        try {
            const result = await model.generateContent({
                contents: [{ role: 'user', parts: [{ text: prompt }] }]
            });

            const responseText = result.response.text().trim();

            // Clean up response
            const jsonText = responseText
                .replace(/```json\n?/g, '')
                .replace(/```\n?/g, '')
                .trim();

            const parsed = JSON.parse(jsonText);

            const estimate: PriceEstimateResult = {
                lowPrice: parsed.lowPrice || 0,
                highPrice: parsed.highPrice || 0,
                suggestedPrice: parsed.suggestedPrice || parsed.lowPrice || 0,
                estimatedHours: parsed.estimatedHours,
                reasoning: parsed.reasoning
            };

            logger.info('Price estimate generated', {
                noteId,
                estimate,
                userId: context.auth.uid
            });

            // If noteId provided, save to note
            if (noteId) {
                await db.collection('notes').doc(noteId).update({
                    'financials.aiSuggestedPrice': estimate.suggestedPrice,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }

            return estimate;

        } catch (error) {
            logger.error('Price estimate failed', error);
            throw new functions.https.HttpsError('internal', 'Failed to generate estimate');
        }
    });
