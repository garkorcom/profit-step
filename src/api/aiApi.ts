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

// Smart Input types
interface SmartInputRequest {
    description: string;
    existingTasks?: string[];
    clientNames?: string[];
}

interface SmartInputResponse {
    suggestedType?: string;
    typeConfidence: number;
    suggestedDate?: string;
    suggestedTime?: string;
    datePhrase?: string;
    suggestedClientName?: string;
    suggestedPriority?: 'low' | 'medium' | 'high';
    priorityPhrase?: string;
    possibleDuplicates?: Array<{
        taskTitle: string;
        similarity: number;
    }>;
}

/**
 * Parse task description with AI to extract type, date, client, priority, and duplicates
 * 
 * @param description - Task description from user input
 * @param existingTasks - Optional list of existing task titles for duplicate detection
 * @param clientNames - Optional list of client names for matching
 * @returns AI-parsed results with suggestions
 */
export async function parseSmartInput(
    description: string,
    existingTasks?: string[],
    clientNames?: string[]
): Promise<SmartInputResponse> {
    const callable = httpsCallable<SmartInputRequest, SmartInputResponse>(functions, 'parseSmartInput');
    const result = await callable({ description, existingTasks, clientNames });
    return result.data;
}
