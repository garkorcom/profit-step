import { Timestamp } from 'firebase/firestore';
import { WorkSession } from '../../types/timeTracking.types';
import {
    buildEmployeeDropdown,
    defaultFinanceStartDate,
    filterReportableSessions,
    isReportableSession,
    normalizeEmployeeName,
} from '../financeFilters';

function sess(overrides: Partial<WorkSession>): WorkSession {
    return {
        id: 'id',
        employeeId: '1',
        employeeName: 'anton',
        clientId: 'c1',
        clientName: 'Tampa',
        startTime: Timestamp.fromDate(new Date('2026-04-17T10:00:00Z')),
        status: 'completed',
        ...overrides,
    } as WorkSession;
}

describe('isReportableSession', () => {
    test('completed regular session is reportable regardless of finalizationStatus', () => {
        expect(isReportableSession(sess({ status: 'completed', finalizationStatus: 'pending' }))).toBe(true);
        expect(isReportableSession(sess({ status: 'completed', finalizationStatus: 'finalized' }))).toBe(true);
        expect(isReportableSession(sess({ status: 'completed', finalizationStatus: undefined }))).toBe(true);
    });

    test('auto-closed session is reportable', () => {
        expect(isReportableSession(sess({ status: 'auto_closed' }))).toBe(true);
    });

    test('active or paused session is not reportable', () => {
        expect(isReportableSession(sess({ status: 'active' }))).toBe(false);
        expect(isReportableSession(sess({ status: 'paused' }))).toBe(false);
    });

    test('correction / manual_adjustment / payment entries are always reportable', () => {
        expect(isReportableSession(sess({ type: 'correction', status: 'active' }))).toBe(true);
        expect(isReportableSession(sess({ type: 'manual_adjustment', status: 'active' }))).toBe(true);
        expect(isReportableSession(sess({ type: 'payment', status: 'active' }))).toBe(true);
    });

    test('yesterday session with pending finalization is reportable (regression: the 2-day hide)', () => {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const s = sess({
            status: 'completed',
            finalizationStatus: 'pending',
            startTime: Timestamp.fromDate(yesterday),
        });
        expect(isReportableSession(s)).toBe(true);
    });
});

describe('filterReportableSessions', () => {
    test('returns only reportable sessions, preserves input order', () => {
        const a = sess({ id: 'a', status: 'active' });
        const b = sess({ id: 'b', status: 'completed' });
        const c = sess({ id: 'c', type: 'correction', status: 'active' });
        const d = sess({ id: 'd', status: 'paused' });
        const out = filterReportableSessions([a, b, c, d]);
        expect(out.map(s => s.id)).toEqual(['b', 'c']);
    });
});

describe('defaultFinanceStartDate', () => {
    test('returns Jan 1 of the given year at 00:00:00', () => {
        const d = defaultFinanceStartDate(new Date('2026-04-19T15:30:00'));
        expect(d.getFullYear()).toBe(2026);
        expect(d.getMonth()).toBe(0);
        expect(d.getDate()).toBe(1);
        expect(d.getHours()).toBe(0);
        expect(d.getMinutes()).toBe(0);
    });
});

describe('normalizeEmployeeName', () => {
    test('strips zero-width and Hangul filler, trims whitespace', () => {
        // Zero-width space, Hangul filler (\u3164), regular space
        expect(normalizeEmployeeName('  \u200Banton\u3164  ')).toBe('anton');
    });

    test('collapses whitespace', () => {
        expect(normalizeEmployeeName('Valerry   Shulghin')).toBe('Valerry Shulghin');
    });
});

describe('buildEmployeeDropdown', () => {
    const entries = [
        { employeeId: 'uid-anton', employeeName: 'anton' },
        { employeeId: '12345', employeeName: 'legacy-tg-only' },
    ] as Pick<WorkSession, 'employeeId' | 'employeeName'>[];

    test('includes active-only users from the users collection who have no sessions in range (Valerry Shulghin case)', () => {
        const employees = [
            { id: 'uid-anton', name: 'anton' },
            { id: 'uid-valerry', name: 'Valerry Shulghin' }, // no entries but active user
        ];
        const dropdown = buildEmployeeDropdown(entries, employees);
        const names = dropdown.map(e => e.name);
        expect(names).toContain('Valerry Shulghin');
        expect(names).toContain('anton');
    });

    test('merges legacy telegram-only session identities that are not in users collection', () => {
        const employees = [{ id: 'uid-anton', name: 'anton' }];
        const dropdown = buildEmployeeDropdown(entries, employees);
        expect(dropdown.find(e => e.name === 'legacy-tg-only')).toBeDefined();
    });

    test('canonical user id wins on name collision with session entry', () => {
        // Same normalized name in both sources; canonical (users) should be preferred.
        const employees = [{ id: 'uid-canonical', name: 'anton' }];
        const dropdown = buildEmployeeDropdown(entries, employees);
        const anton = dropdown.find(e => e.name === 'anton');
        expect(anton?.id).toBe('uid-canonical');
    });

    test('results are sorted alphabetically by display name', () => {
        const employees = [
            { id: 'z', name: 'Zack' },
            { id: 'a', name: 'Alex' },
            { id: 'b', name: 'Bob' },
        ];
        const dropdown = buildEmployeeDropdown([], employees);
        expect(dropdown.map(e => e.name)).toEqual(['Alex', 'Bob', 'Zack']);
    });

    test('gracefully ignores entries with empty name or missing id', () => {
        const sparseEntries = [
            { employeeId: '', employeeName: 'Anon' },
            { employeeId: '7', employeeName: '' },
            { employeeId: '8', employeeName: 'Real' },
        ] as Pick<WorkSession, 'employeeId' | 'employeeName'>[];
        const dropdown = buildEmployeeDropdown(sparseEntries, []);
        expect(dropdown.map(e => e.name)).toEqual(['Real']);
    });
});
