/**
 * @fileoverview Types for AI Task Estimation (Frontend)
 */

export interface AIEstimateRequest {
    /** Task description from user input */
    task_description: string;
    /** Employee role (e.g., "Electrician", "Plumber") */
    employee_role: string;
    /** Employee hourly rate in the specified currency */
    employee_hourly_rate: number;
    /** Currency code (e.g., "USD", "RUB") */
    currency: string;
    /** Optional: Employee ID for workload check */
    employee_id?: string;
    /** Optional: Target date for conflict detection (ISO string) */
    target_date?: string;
}

export interface AIEstimateResponse {
    /** Estimated hours to complete the task */
    estimated_hours: number;
    /** Calculated cost (hours × rate) */
    calculated_cost: number;
    /** AI reasoning for the estimate */
    reasoning: string;
    /** Suggested materials needed */
    suggested_materials: string[];
    /** Suggested tools needed */
    suggested_tools: string[];
    /** Whether there's a workload conflict */
    has_conflict?: boolean;
    /** Conflict details if any */
    conflict_message?: string;
    /** Total planned hours for the day including this task */
    total_day_hours?: number;
}
