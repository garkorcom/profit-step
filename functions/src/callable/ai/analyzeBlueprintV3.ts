import * as functions from 'firebase-functions';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { safeConfig } from '../../utils/safeConfig';
import { BlueprintAgentV3Result } from '../../types/blueprint.types';

if (admin.apps.length === 0) admin.initializeApp();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || safeConfig().gemini?.api_key;

const TAKEOFF_PROMPT_V3 = `You are a professional Master Electrician and Estimator acting as a 2D Object Detection AI.
Your task is to locate and output the exact bounding box coordinates of electrical devices on the provided blueprint.

STRATEGY:
1. Scan the floor plan carefully.
2. For every electrical device found, return its bounding box as [ymin, xmin, ymax, xmax] using normalized coordinates (0 to 1000).
3. Assign a confidence score from 0 to 100 for each detection indicating how sure you are that the item matches the given category.

RETURN FORMAT:
Return a JSON object where the keys are the device names, and the values are arrays of objects containing the bounding box and confidence score.
Example:
{
  "recessed_ic": [
    { "box": [120, 340, 140, 360], "confidence": 95 },
    { "box": [200, 340, 220, 360], "confidence": 80 }
  ],
  "duplex": [
    { "box": [150, 10, 160, 20], "confidence": 99 }
  ]
}

Valid Keys (DO NOT USE ANY OTHER KEYS):
LIGHTING: recessed_ic, recessed_nc, surface, exterior, ceiling_fan, chandelier, pendant, under_cabinet
RECEPTACLES: duplex, gfi, dedicated_20a, outlet_240_30, outlet_240_50, floor_outlet
SWITCHES: single_pole, 3way, 4way, dimmer, smart_switch, occupancy
LOW_VOLTAGE: smoke, smoke_co, doorbell, doorbell_cam, cat6, coax, speaker_wire, central_vac
VENTILATION: bath_exhaust, exhaust_fan
PANELS: panel_200, panel_400, subpanel_100, subpanel_125, subpanel_200, meter_200, meter_320, meter_400
APPLIANCES: range, cooktop, wall_oven, microwave, dishwasher, disposal, dryer, washer, refrigerator, freezer, water_heater, tankless_wh, ev_charger
HVAC: ac_30a, ac_40a, ac_disc, mini_split, air_handler, thermostat
POOL: pool_pump, pool_light, pool_heater, spa_pump, pool_automation

Output ONLY the raw JSON object, without \`\`\`json markdown blocks.`;

const TEMPLE_PROMPTS: Record<string, string> = {
    standard_residential: 'Find all standard electrical receptacles, switches, lights, panels, and appliances.',
    strict_power_only: 'Find only 120V/240V devices. STRICTLY IGNORE all data, coax, TV, telephone, and smoke detectors.',
    lighting_only: 'Find only light fixtures (recessed, surface, pendants) and switches. Ignore receptacles and appliances.'
};

function parseJsonResponse(text: string): any {
    let cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    try {
        return JSON.parse(cleaned);
    } catch {
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
        throw new Error('No valid JSON found in response');
    }
}

/**
 * Callable function: Analyze a single blueprint image (PNG/JPEG) directly from Base64.
 * Used by V3 Stepper pipeline for parallel client-side orchestrated analysis.
 * 
 * Input: { imageBase64: string, templateId: string, customInstructions?: string }
 * Output: { quantities: BlueprintAgentV3Result }
 */
export const analyzeBlueprintV3Callable = functions
    .region('us-central1')
    .runWith({ timeoutSeconds: 60, memory: '256MB' })
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Auth required');
        }

        const { imageBase64, templateId, customInstructions } = data;
        if (!imageBase64) {
            throw new functions.https.HttpsError('invalid-argument', 'imageBase64 required');
        }
        
        if (!GEMINI_API_KEY) {
            throw new functions.https.HttpsError('internal', 'GEMINI_API_KEY missing');
        }

        logger.info(`⚡ V3 Pipeline analyzing page. Template: ${templateId}`);

        try {
            const templateText = TEMPLE_PROMPTS[templateId] || TEMPLE_PROMPTS['standard_residential'];
            let finalCustomPrompt = `${TAKEOFF_PROMPT_V3}\n\n=== USER TEMPLATE OVERRIDE ===\n${templateText}`;
            if (customInstructions?.trim()) {
                finalCustomPrompt += `\n\n=== ADDITIONAL CUSTOM INSTRUCTIONS ===\n${customInstructions}`;
            }

            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

            const result = await model.generateContent({
                contents: [{
                    role: 'user',
                    parts: [
                        { text: finalCustomPrompt },
                        { inlineData: { mimeType: 'image/png', data: imageBase64 } }
                    ]
                }]
            });

            const text = result.response.text().trim();
            const rawJson = parseJsonResponse(text);
            
            // Validate and sanitize the bounding boxes and confidence scores
            const sanitizedResult: BlueprintAgentV3Result = {};
            for (const [key, value] of Object.entries(rawJson)) {
                if (Array.isArray(value)) {
                    const validItems = value.filter(item => 
                        item !== null && typeof item === 'object' &&
                        Array.isArray(item.box) && item.box.length === 4 && item.box.every((n: any) => typeof n === 'number') &&
                        typeof item.confidence === 'number'
                    ) as { box: [number, number, number, number], confidence: number }[];
                    
                    if (validItems.length > 0) {
                        sanitizedResult[key] = validItems;
                    }
                }
            }

            logger.info(`✅ V3 Page Analysis complete: ${Object.keys(sanitizedResult).length} item categories found.`);

            return { quantities: sanitizedResult };

        } catch (error: any) {
            logger.error(`❌ V3 Analysis failed:`, error);
            throw new functions.https.HttpsError('internal', error.message || 'Analysis failed');
        }
    });
