/**
 * Payroll Schemas — self-service and admin endpoints
 */
import { z } from 'zod';

// ─── Self-service (worker) ─────────────────────────────────────────

export const MyHoursQuerySchema = z.object({
  weekOf: z.string().optional(), // ISO date string, default = current week Monday
}).strict();

export const MyPayQuerySchema = z.object({
  period: z.string().optional(), // "YYYY-MM", default = last closed period
}).strict();

// ─── Admin ─────────────────────────────────────────────────────────

export const OvertimeCheckQuerySchema = z.object({
  weekOf: z.string().optional(), // ISO date string, default = current week
}).strict();

export const PeriodValidateSchema = z.object({
  checks: z.array(z.enum([
    'hours_over_60',
    'session_over_12h',
    'rate_changes',
    'zero_hours',
    'duplicate_sessions',
    'unsigned_sessions',
  ])).optional(), // default = all checks
}).strict();
