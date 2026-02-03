/**
 * @fileoverview Types for AI Smart Input Feature (Frontend)
 */

import { TaskType } from './gtd.types';

export interface SmartInputRequest {
    /** Task description from user input */
    description: string;
    /** List of existing task titles for duplicate detection */
    existingTasks?: string[];
}

export interface SmartInputResponse {
    /** Detected task type */
    suggestedType?: TaskType;
    /** Confidence score 0-1 */
    typeConfidence: number;

    /** Extracted date (ISO format YYYY-MM-DD) */
    suggestedDate?: string;
    /** Extracted time (HH:MM format) */
    suggestedTime?: string;
    /** Original date/time phrase found in text */
    datePhrase?: string;

    /** Similar existing tasks */
    possibleDuplicates?: Array<{
        taskTitle: string;
        similarity: number;
    }>;
}
