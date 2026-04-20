/**
 * @fileoverview Face Verification Service
 * 
 * Uses Google Gemini 2.0 Flash to verify if the face in the start photo
 * matches the reference photo of the employee to prevent fraud.
 */

import { logger } from 'firebase-functions';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import { GEMINI_API_KEY } from '../config';
const MODEL_NAME = 'gemini-2.0-flash';

export interface FaceVerificationResult {
    match: boolean;
    confidence: number;
    reason: string;
}

const SYSTEM_PROMPT = `You are an AI security guard. I am providing you with two images:
1. The first image is the reference photo of the employee.
2. The second image is a selfie taken by the employee just now to start their work shift.

Compare the faces in these two photographs. Is it the same person?
Ignore lighting, background, or minor clothing changes. Focus strictly on facial features.

Output ONLY a valid JSON object, no markdown, no explanation:
{ "match": true|false, "confidence": number (1-100), "reason": "Short explanation if mismatch or not clear" }`;

/**
 * Initialize Gemini client
 */
function getGeminiClient() {
    const apiKey = GEMINI_API_KEY.value();
    if (!apiKey) {
        logger.error('GEMINI_API_KEY not configured');
        throw new Error('GEMINI_API_KEY not configured');
    }
    return new GoogleGenerativeAI(apiKey);
}

/**
 * Download image from URL and return base64
 */
async function downloadImageAsBase64(url: string): Promise<string> {
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        return Buffer.from(response.data).toString('base64');
    } catch (error: any) {
        logger.error(`Error downloading image from ${url}`, { error: error.message });
        throw error;
    }
}

/**
 * Verify employee face against reference photo using Gemini
 * 
 * @param referencePhotoUrl Reference photo URL from UserProfile
 * @param newPhotoUrl The URL of the fresh selfie
 */
export async function verifyEmployeeFace(referencePhotoUrl: string, newPhotoUrl: string): Promise<FaceVerificationResult> {
    try {
        logger.info(`Starting Face Verification. Ref: ${referencePhotoUrl.substring(0, 30)}..., New: ${newPhotoUrl.substring(0, 30)}...`);

        const [refBase64, newBase64] = await Promise.all([
            downloadImageAsBase64(referencePhotoUrl),
            downloadImageAsBase64(newPhotoUrl)
        ]);

        const genAI = getGeminiClient();
        const model = genAI.getGenerativeModel({
            model: MODEL_NAME,
            generationConfig: { responseMimeType: 'application/json' }
        });

        const result = await model.generateContent({
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: SYSTEM_PROMPT },
                        { inlineData: { mimeType: 'image/jpeg', data: refBase64 } },
                        { inlineData: { mimeType: 'image/jpeg', data: newBase64 } }
                    ]
                }
            ]
        });

        const textResponse = await result.response.text();
        const cleaned = textResponse.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();

        const parsed = JSON.parse(cleaned);

        return {
            match: Boolean(parsed.match),
            confidence: Number(parsed.confidence) || 0,
            reason: String(parsed.reason || '')
        };

    } catch (error: any) {
        logger.error('Face Verification Error:', error.message);

        // Return a safe fallback so we don't block the session if AI fails
        return {
            match: true, // Assume true on API failure to prevent unfair blocking
            confidence: 0,
            reason: `AI API error: ${error.message}`
        };
    }
}
