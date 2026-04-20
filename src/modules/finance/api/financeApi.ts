/**
 * Finance data-layer — all Firestore reads for the Finance & Payroll
 * module live here. Pure async functions, no React, no state. Callers are
 * the `useFinanceLedger` / `useEmployeesWithRates` hooks, which own
 * component-level state + refresh semantics.
 *
 * Extracted from `FinancePage.tsx` as part of the Finance isolation plan
 * (see `docs/finance-module/ISOLATION_PLAN.md`). Queries are behaviour-
 * compatible with the inline versions that preceded them — only
 * structure and testability changed.
 */

import {
    collection,
    getDocs,
    query,
    where,
    orderBy,
    Timestamp,
} from 'firebase/firestore';
import { startOfDay, endOfDay } from 'date-fns';

import { db } from '../../../firebase/firebase';
import { WorkSession } from '../../../types/timeTracking.types';
import {
    IdentityDirectory,
    normalizeSessionIdentities as normalizeSessionIdentitiesPure,
} from '../services/sessionIdentity';

// ─────────────────────────────────────────────────────────────────────
// Types — kept close to the data-layer; the page re-exports them or
// imports from here directly.
// ─────────────────────────────────────────────────────────────────────

export interface Employee {
    id: string;
    name: string;
    hourlyRate?: number;
    photoUrl?: string;
    telegramId?: string | number;
    // Allow additional user-doc fields to flow through without re-declaring.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [extra: string]: any;
}

export interface CostEntry {
    id: string;
    userId: string;
    userName: string;
    clientId: string;
    clientName: string;
    category: string;
    categoryLabel: string;
    amount: number;
    originalAmount: number;
    receiptPhotoUrl: string;
    description?: string;
    createdAt: Timestamp;
    status: string;
}

export interface ClientLite {
    id: string;
    name: string;
}

export interface EmployeeDirectory extends IdentityDirectory {
    employees: Employee[];
}

// ─────────────────────────────────────────────────────────────────────
// Work sessions — raw read for the current date window.
// ─────────────────────────────────────────────────────────────────────

/**
 * Fetch all work_sessions overlapping the given date range by `startTime`.
 *
 * Note: returns EVERYTHING in range, including active / paused shifts and
 * pending-finalization entries. Callers decide what to render via
 * `filterReportableSessions` from the services layer.
 */
export async function fetchWorkSessions(
    start: Date,
    end: Date
): Promise<WorkSession[]> {
    const q = query(
        collection(db, 'work_sessions'),
        where('startTime', '>=', Timestamp.fromDate(startOfDay(start))),
        where('startTime', '<=', Timestamp.fromDate(endOfDay(end))),
        orderBy('startTime', 'desc')
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as WorkSession));
}

// ─────────────────────────────────────────────────────────────────────
// Costs — business expenses ledger (separate from salary balance).
// ─────────────────────────────────────────────────────────────────────

export async function fetchCosts(
    start: Date,
    end: Date
): Promise<CostEntry[]> {
    const q = query(
        collection(db, 'costs'),
        where('createdAt', '>=', Timestamp.fromDate(startOfDay(start))),
        where('createdAt', '<=', Timestamp.fromDate(endOfDay(end))),
        orderBy('createdAt', 'desc')
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as CostEntry));
}

// ─────────────────────────────────────────────────────────────────────
// Employees / rates — UNIFIED users collection (source of truth since
// 2026-01-26). The Telegram bot and the Web UI both read hourlyRate from
// here; FinancePage edits here too.
// ─────────────────────────────────────────────────────────────────────

export async function fetchEmployeeDirectory(): Promise<EmployeeDirectory> {
    const userSnap = await getDocs(collection(db, 'users'));
    const telegramIdToUid = new Map<string, string>();
    const uidToName = new Map<string, string>();

    const employees: Employee[] = userSnap.docs.map(d => {
        const data = d.data();
        const name = data.displayName || data.name || 'Unknown';
        uidToName.set(d.id, name);
        if (data.telegramId) {
            telegramIdToUid.set(String(data.telegramId), d.id);
        }
        return {
            id: d.id,
            name,
            hourlyRate: data.hourlyRate || 0,
            ...data,
        } as Employee;
    });

    return { employees, telegramIdToUid, uidToName };
}

// ─────────────────────────────────────────────────────────────────────
// Clients (lite) — used by the "Project" dropdown in the adjustment
// dialog. Completed clients are filtered out to keep the list short.
// ─────────────────────────────────────────────────────────────────────

export async function fetchActiveClientsLite(): Promise<ClientLite[]> {
    const snap = await getDocs(
        query(collection(db, 'clients'), orderBy('name', 'asc'))
    );
    return snap.docs
        .map(d => ({
            id: d.id,
            name: (d.data().name || '') as string,
            status: (d.data().status || '') as string,
        }))
        .filter(c => c.name && c.status !== 'done')
        .map(({ id, name }) => ({ id, name }));
}

// Session identity normalisation — pure, no Firestore. Re-exported so
// existing callers keep their import paths. Real implementation lives
// in `services/sessionIdentity.ts` (isolated from Firebase SDK so unit
// tests don't need jsdom Firebase init).
export { normalizeSessionIdentitiesPure as normalizeSessionIdentities };
