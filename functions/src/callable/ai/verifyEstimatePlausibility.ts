import * as functions from 'firebase-functions';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';
import { GoogleGenerativeAI, Schema, SchemaType } from '@google/generative-ai';
import { BlueprintAgentResult } from '../../types/blueprint.types';
import { GEMINI_API_KEY as _GEMINI } from '../../config';

if (admin.apps.length === 0) admin.initializeApp();

const GEMINI_API_KEY = () => _GEMINI.value();

const PLAUSIBILITY_SYSTEM_PROMPT = `You are a Master Electrician and Senior Estimator Quality Assurance AI.
Your job is to review the aggregated quantities of an electrical takeoff against the basic facts of the project and flag any IMPOSSIBLE or HIGHLY UNLIKELY anomalies, which usually stem from AI hallucinations (e.g. overcounting).

Consider the scale of the project (e.g., standard residential vs commercial) and standard electrical codes.
Examples of anomalies:
- A 1500 sq ft house having 15 electrical panels (impossible).
- A 3-bedroom apartment having 40 ceiling fans (highly unlikely).
- 200 smoke detectors in a small single-story house (impossible).
- Standard residential project taking a 4000A main switchboard (hallucination).

You must return a list of suspected anomalies and a clear, brief reason for why it is flagged. Do not flag things that are just "generous", only flag those that are fundamentally flawed or physically impossible for the space.`;

const anomalySchema: Schema = {
    type: SchemaType.ARRAY,
    description: "List of anomalies detected in the estimate.",
    items: {
        type: SchemaType.OBJECT,
        properties: {
            itemKey: {
                type: SchemaType.STRING,
                description: "The ID of the item (e.g., 'subpanel_200', 'smoke').",
            },
            reason: {
                type: SchemaType.STRING,
                description: "Brief reason why this quantity is absurd for the given project scale.",
            },
        },
        required: ["itemKey", "reason"],
    },
};

/**
 * Callable function: verifyEstimatePlausibilityCallable
 * Input: { aggregatedResult: BlueprintAgentResult, sqFt?: number, stories?: number, projectType?: string }
 * Output: { anomalies: { itemKey: string, reason: string }[] }
 */
export const verifyEstimatePlausibilityCallable = functions
    .region('us-central1')
    .runWith({ timeoutSeconds: 30, memory: '256MB', secrets: [_GEMINI] })
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Auth required');
        }

        const aggregatedResult: BlueprintAgentResult = data.aggregatedResult;
        const { sqFt, stories, projectType } = data;
        if (!aggregatedResult || Object.keys(aggregatedResult).length === 0) {
            return { anomalies: [] };
        }

        if (!GEMINI_API_KEY()) {
            throw new functions.https.HttpsError('internal', 'GEMINI_API_KEY missing');
        }

        logger.info(`🔍 Plausibility Check starting for project size: ${sqFt} sqft, ${stories} stories, Type: ${projectType}`);

        try {
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY());
            const model = genAI.getGenerativeModel({
                model: 'gemini-2.5-flash',
                systemInstruction: PLAUSIBILITY_SYSTEM_PROMPT,
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: anomalySchema,
                    temperature: 0.1,
                }
            });

            // Construct the analysis payload
            const payloadText = `
### PROJECT CONTEXT ###
Type: ${projectType || 'Unknown'}
Area (Sq Ft): ${sqFt || 'Unknown'}
Stories: ${stories || 'Unknown'}

### AGGREGATED AI QUANTITIES ###
${JSON.stringify(aggregatedResult, null, 2)}

Analyze the quantities against the project context. If no anomalies exist, return an empty array.
            `;

            const result = await model.generateContent(payloadText);
            const responseText = result.response.text();
            
            let anomalies = [];
            try {
                anomalies = JSON.parse(responseText);
            } catch (e) {
                logger.warn('Failed to parse anomalies JSON. Output was:', responseText);
            }

            logger.info(`✅ Plausibility Check complete. Found ${anomalies.length} anomalies.`);
            return { anomalies };
        } catch (error: any) {
            logger.error(`❌ Plausibility check failed:`, error);
            // Non-fatal error for the user, just return empty anomalies if it fails
            return { anomalies: [] };
        }
    });
