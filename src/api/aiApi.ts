/**
 * @fileoverview API wrapper for AI Task Estimation
 */

import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/firebase';
import { AIEstimateRequest, AIEstimateResponse } from '../types/aiEstimate.types';

/**
 * Call the AI estimation Cloud Function
 * 
 * @param request - Task description, employee info, and optional date
 * @returns AI-generated estimate with hours, cost, materials, and tools
 * 
 * @example
 * const estimate = await estimateTask({
 *     task_description: "Установить 5 розеток на кухне",
 *     employee_role: "Electrician",
 *     employee_hourly_rate: 50,
 *     currency: "USD",
 *     employee_id: "user123",
 *     target_date: "2024-01-20"
 * });
 */
export async function estimateTask(request: AIEstimateRequest): Promise<AIEstimateResponse> {
    const callable = httpsCallable<AIEstimateRequest, AIEstimateResponse>(functions, 'estimateTask');
    const result = await callable(request);
    return result.data;
}
