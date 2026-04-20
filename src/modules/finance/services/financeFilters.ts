/**
 * Pure filter + aggregation helpers for the Finance & Payroll page.
 *
 * Extracted from FinancePage.tsx so the behavior is unit-testable and not
 * regressed by future refactors. Per CLAUDE.md §2.2, any change to payroll
 * logic must ship with tests.
 */

import { Timestamp } from 'firebase/firestore';
import { WorkSession } from '../../../types/timeTracking.types';

export interface EmployeeLite {
    id: string;
    name: string;
}

/**
 * Which sessions should land in the Finance / Payroll report?
 *
 * Rule (2026-04-19): mirror the worker's own lived experience — if a session
 * is "completed" (shift finished) it belongs in the report NOW, regardless of
 * whether the 48h edit window has closed (`finalizationStatus === 'finalized'`).
 * Hiding just-closed shifts for ≤2 days surprised admins who expected
 * yesterday's work to land in today's dashboard.
 *
 * Corrections and manual adjustments (`type` in that set) are always included
 * — they are admin-originated ledger entries with no concept of "finalized".
 *
 * Active / paused sessions are excluded — they have no terminal cost yet.
 */
export function isReportableSession(session: WorkSession): boolean {
    // Admin-issued ledger entries — always reportable.
    if (session.type === 'correction' || session.type === 'manual_adjustment' || session.type === 'payment') {
        return true;
    }

    // Regular shift sessions — report if terminated (worker ended or auto-close
    // kicked in). Finalization status is irrelevant for visibility; it only
    // affects whether the row can be edited inline.
    if (session.status === 'completed' || session.status === 'auto_closed') {
        return true;
    }

    // Active or paused — the shift is still running, no finalized cost yet.
    return false;
}

export function filterReportableSessions(sessions: WorkSession[]): WorkSession[] {
    return sessions.filter(isReportableSession);
}

/**
 * Default start date for the Finance report = January 1 of the current
 * calendar year. Gives admins the year-to-date picture by default; prior
 * default was "last 30 days" which dropped everything older and confused
 * admins checking total earnings / balance.
 */
export function defaultFinanceStartDate(now: Date = new Date()): Date {
    const d = new Date(now.getFullYear(), 0, 1);
    d.setHours(0, 0, 0, 0);
    return d;
}

// ─────────────────────────────────────────────────────────────────────
// Employee dropdown source
// ─────────────────────────────────────────────────────────────────────

/**
 * Normalize an employee name for deduplication: strip zero-width chars, Hangul
 * filler, and collapse whitespace; lowercase. Same rules as FinancePage used
 * inline — kept here so future deduping code doesn't drift.
 */
export function normalizeEmployeeName(raw: string): string {
    return raw.replace(/[\u200B-\u200D\uFEFF\u3164\s]+/g, ' ').trim();
}

/**
 * Build the Employee filter dropdown.
 *
 * Previous behavior: derived from `entries` (sessions already in the date
 * range). That hid workers whose sessions were all "active" (so not yet in
 * entries) or fell outside the date window — e.g. Valerry Shulghin with
 * sessions from prior year but currently active had no entry in the dropdown,
 * so admins couldn't filter / pull his report at all.
 *
 * New behavior: start from the canonical `employees` list (users collection,
 * which is the source of truth for rates + identity). Then merge in any
 * legacy employeeIds from `entries` that don't resolve to a user doc — this
 * keeps older unlinked Telegram-only workers visible.
 *
 * Dedup by normalized display name, preferring the user-collection entry
 * (canonical UID) over a session-derived id.
 */
export function buildEmployeeDropdown(
    entries: Pick<WorkSession, 'employeeId' | 'employeeName'>[],
    employees: EmployeeLite[]
): EmployeeLite[] {
    const byNormalizedName = new Map<string, EmployeeLite>();

    // Seed with canonical users first so their ids win on collision.
    for (const emp of employees) {
        if (!emp.name) continue;
        const clean = normalizeEmployeeName(emp.name);
        if (!clean) continue;
        const key = clean.toLowerCase();
        if (!byNormalizedName.has(key)) {
            byNormalizedName.set(key, { id: emp.id, name: clean });
        }
    }

    // Merge any extra identities that appear only in entries (unlinked
    // Telegram-only, legacy imports, etc.).
    for (const e of entries) {
        if (!e.employeeId || !e.employeeName) continue;
        const clean = normalizeEmployeeName(e.employeeName);
        if (!clean) continue;
        const key = clean.toLowerCase();
        if (!byNormalizedName.has(key)) {
            byNormalizedName.set(key, { id: String(e.employeeId), name: clean });
        }
    }

    return Array.from(byNormalizedName.values()).sort((a, b) =>
        a.name.localeCompare(b.name)
    );
}

// ─────────────────────────────────────────────────────────────────────
// Test helpers — exported for the unit test file below to construct
// WorkSession fixtures without repeating Timestamp boilerplate.
// ─────────────────────────────────────────────────────────────────────

export function tsFromDate(d: Date): Timestamp {
    return Timestamp.fromDate(d);
}
