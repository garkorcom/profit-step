/**
 * @fileoverview AI Task Estimation Cloud Function
 * 
 * Uses Gemini AI to estimate:
 * - Work hours based on task description
 * - Cost calculation (hours × rate)
 * - Suggested materials
 * - Suggested tools
 * - Workload conflict detection
 */

import * as functions from 'firebase-functions';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as admin from 'firebase-admin';
import { AIEstimateRequest, AIEstimateResponse } from '../../types/aiEstimate';
import {
    getCachedEstimate,
    incrementHitCount,
    saveToCache,
    cacheToResponse,
} from '../../utils/aiCacheUtils';

const db = admin.firestore();

/**
 * System prompt for construction task estimation
 */
const SYSTEM_PROMPT = `You are an experienced Construction Estimator & Project Manager specializing in residential and commercial construction, electrical, plumbing, and general contracting.

## Your Task
Analyze the incoming task description and the worker's role to provide accurate estimates.

## Instructions

### 1. Estimate Time
- Calculate realistic working hours required
- Be conservative (add 15-20% buffer for preparation, cleanup, and unexpected complications)
- Consider the complexity of the task and typical industry standards
- Round to nearest 0.5 hour

### 2. Calculate Cost
- Multiply Estimated Time by the provided hourly_rate
- Round to nearest whole number

### 3. Materials
- List standard construction materials needed for this specific task
- Keep it brief (3-7 items maximum)
- Use generic names (e.g., "Drywall screws" not "Brand X screws")
- Include quantities when obvious from the task description
- Format in Russian language

### 4. Tools
- List specific power tools or hand tools required
- Include both essential and recommended tools
- Keep it brief (3-7 items maximum)
- Format in Russian language

## Constraints
- Return ONLY valid JSON format
- If the task description is vague, assume standard complexity for residential work
- All text fields should be in Russian language
- If task is unclear or too vague, still provide reasonable estimates based on the role

## Output Format
{
  "estimated_hours": <number>,
  "calculated_cost": <number>,
  "reasoning": "<string explaining your estimate in Russian>",
  "suggested_materials": ["<material1>", "<material2>", ...],
  "suggested_tools": ["<tool1>", "<tool2>", ...]
}`;

/**
 * Call Gemini AI with retry logic across multiple models
 */
async function callGeminiWithRetry(prompt: string): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY || functions.config().gemini?.api_key;

    if (!apiKey) {
        throw new functions.https.HttpsError('failed-precondition',
            'GEMINI_API_KEY not configured. Set via: firebase functions:config:set gemini.api_key="YOUR_KEY"');
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    // Fallback models in order of preference
    const models = ['gemini-2.0-flash', 'gemini-1.5-flash-latest', 'gemini-1.5-pro-latest'];
    const errors: string[] = [];

    for (const modelName of models) {
        console.log(`🤖 Trying ${modelName}...`);
        try {
            const model = genAI.getGenerativeModel({
                model: modelName,
                generationConfig: {
                    responseMimeType: 'application/json',
                    temperature: 0.3, // Lower temperature for more consistent estimates
                }
            });

            const result = await model.generateContent([
                { text: SYSTEM_PROMPT },
                { text: prompt }
            ]);

            const text = result.response.text();
            if (text) {
                console.log(`✅ Success with ${modelName}`);
                return text;
            }
        } catch (error: any) {
            const errMsg = `[${modelName}] Failed: ${error.message}`;
            console.warn(errMsg);
            errors.push(errMsg);
        }
    }

    console.error('❌ All Gemini attempts failed:', errors);
    throw new functions.https.HttpsError('unavailable', `AI service unavailable. Last error: ${errors[errors.length - 1]}`);
}

/**
 * Get employee workload for a specific date
 */
async function getEmployeeWorkload(employeeId: string, targetDate: Date): Promise<number> {
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const startTimestamp = admin.firestore.Timestamp.fromDate(startOfDay);
    const endTimestamp = admin.firestore.Timestamp.fromDate(endOfDay);

    // Query tasks assigned to this employee for the target date
    const tasksSnapshot = await db.collection('gtd_tasks')
        .where('assigneeId', '==', employeeId)
        .where('startDate', '>=', startTimestamp)
        .where('startDate', '<=', endTimestamp)
        .get();

    let totalMinutes = 0;
    tasksSnapshot.docs.forEach(doc => {
        const data = doc.data();
        totalMinutes += data.estimatedDurationMinutes || 0;
    });

    return totalMinutes / 60; // Return in hours
}

/**
 * Main Cloud Function for AI task estimation (v1 callable)
 */
export const estimateTask = functions
    .runWith({
        memory: '256MB',
        timeoutSeconds: 60,
    })
    .https.onCall(async (data: AIEstimateRequest, context) => {
        // Verify authentication
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
        }

        // Validate required fields
        if (!data.task_description || data.task_description.trim().length < 3) {
            throw new functions.https.HttpsError('invalid-argument', 'Task description must be at least 3 characters');
        }
        if (!data.employee_role) {
            throw new functions.https.HttpsError('invalid-argument', 'Employee role is required');
        }
        if (typeof data.employee_hourly_rate !== 'number' || data.employee_hourly_rate < 0) {
            throw new functions.https.HttpsError('invalid-argument', 'Valid hourly rate is required');
        }

        console.log(`🎯 Estimating task: "${data.task_description}" for ${data.employee_role} at $${data.employee_hourly_rate}/hr`);

        // ══════════════════════════════════════════
        // CACHE LOOKUP
        // ══════════════════════════════════════════
        const cacheResult = await getCachedEstimate(data.task_description, data.employee_role);

        if (cacheResult.hit && cacheResult.data) {
            console.log(`⚡ CACHE HIT! Key: ${cacheResult.cacheKey}`);
            await incrementHitCount(cacheResult.cacheKey);

            // Recalculate cost with current rate (might differ from cached)
            const cachedResponse = cacheToResponse(cacheResult.data);
            cachedResponse.calculated_cost = Math.round(
                cachedResponse.estimated_hours * data.employee_hourly_rate
            );

            // Still check for workload conflicts
            if (data.employee_id && data.target_date) {
                const targetDate = new Date(data.target_date);
                const existingHours = await getEmployeeWorkload(data.employee_id, targetDate);
                const newTotalHours = existingHours + cachedResponse.estimated_hours;

                if (newTotalHours > 8) {
                    cachedResponse.has_conflict = true;
                    cachedResponse.total_day_hours = newTotalHours;
                    cachedResponse.conflict_message = `⚠️ Перегрузка: Планируется ${newTotalHours.toFixed(1)} часов работы (лимит 8 часов)`;
                }
            }

            return cachedResponse;
        }

        console.log(`🔍 Cache MISS. Key: ${cacheResult.cacheKey}. Calling Gemini...`);

        // ══════════════════════════════════════════
        // GEMINI AI CALL
        // ══════════════════════════════════════════

        // Build user prompt
        const userPrompt = `
## Task to Estimate
**Description:** ${data.task_description}
**Worker Role:** ${data.employee_role}
**Hourly Rate:** ${data.employee_hourly_rate} ${data.currency || 'USD'}

Please provide your estimate in the specified JSON format.`;

        try {
            // Call Gemini AI
            const responseText = await callGeminiWithRetry(userPrompt);

            // Parse and clean response
            const cleanText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            const aiResponse = JSON.parse(cleanText) as AIEstimateResponse;

            // Validate response structure
            if (typeof aiResponse.estimated_hours !== 'number') {
                throw new Error('Invalid AI response: missing estimated_hours');
            }

            // Recalculate cost to ensure accuracy
            aiResponse.calculated_cost = Math.round(aiResponse.estimated_hours * data.employee_hourly_rate);

            // Check for workload conflicts if employee_id and target_date provided
            if (data.employee_id && data.target_date) {
                const targetDate = new Date(data.target_date);
                const existingHours = await getEmployeeWorkload(data.employee_id, targetDate);
                const newTotalHours = existingHours + aiResponse.estimated_hours;

                if (newTotalHours > 8) {
                    aiResponse.has_conflict = true;
                    aiResponse.total_day_hours = newTotalHours;
                    aiResponse.conflict_message = `Перегрузка: Планируется ${newTotalHours.toFixed(1)} часов работы (лимит 8 часов)`;
                }
            }

            console.log(`✅ Estimate complete: ${aiResponse.estimated_hours}h, $${aiResponse.calculated_cost}`);

            // ══════════════════════════════════════════
            // SAVE TO CACHE
            // ══════════════════════════════════════════
            await saveToCache(
                cacheResult.cacheKey,
                data.task_description,
                data.employee_role,
                data.employee_hourly_rate,
                aiResponse
            );

            return { ...aiResponse, fromCache: false };

        } catch (error: any) {
            console.error('❌ Estimation failed:', error);

            if (error.code) {
                throw error;
            }

            throw new functions.https.HttpsError('internal', `Failed to generate estimate: ${error.message}`);
        }
    });
