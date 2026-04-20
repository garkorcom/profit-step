/**
 * Tests for the pure helper exposed by the Finance data-layer.
 * Firestore reads themselves aren't unit-tested here (they're thin
 * wrappers around SDK calls; covered by integration / manual QA on the
 * preview channel). `normalizeSessionIdentities` is where the business
 * logic lives — it's where Telegram chat ids get mapped onto canonical
 * user UIDs so the Breakdown tables group correctly.
 */

import { Timestamp } from 'firebase/firestore';
import { WorkSession } from '../../../../types/timeTracking.types';
import { normalizeSessionIdentities } from '../sessionIdentity';

function sess(overrides: Partial<WorkSession>): WorkSession {
    return {
        id: 'id',
        employeeId: '1',
        employeeName: 'raw',
        clientId: 'c1',
        clientName: 'Tampa',
        startTime: Timestamp.fromDate(new Date('2026-04-17T10:00:00Z')),
        status: 'completed',
        ...overrides,
    } as WorkSession;
}

describe('normalizeSessionIdentities', () => {
    test('maps Telegram chat id to canonical UID + canonical name', () => {
        const input = [sess({ employeeId: '123456', employeeName: 'tg-raw' })];
        const out = normalizeSessionIdentities(input, {
            telegramIdToUid: new Map([['123456', 'uid-abc']]),
            uidToName: new Map([['uid-abc', 'Ivan Ivanov']]),
        });
        expect(out[0].employeeId).toBe('uid-abc');
        expect(out[0].employeeName).toBe('Ivan Ivanov');
    });

    test('refreshes name when employeeId is already a UID but name is stale', () => {
        const input = [sess({ employeeId: 'uid-abc', employeeName: 'old name' })];
        const out = normalizeSessionIdentities(input, {
            telegramIdToUid: new Map(),
            uidToName: new Map([['uid-abc', 'New Name']]),
        });
        expect(out[0].employeeId).toBe('uid-abc');
        expect(out[0].employeeName).toBe('New Name');
    });

    test('passes through unknown employeeId unchanged (legacy Telegram-only worker)', () => {
        const input = [sess({ employeeId: 'unknown-tg', employeeName: 'tg-only' })];
        const out = normalizeSessionIdentities(input, {
            telegramIdToUid: new Map(),
            uidToName: new Map(),
        });
        expect(out[0].employeeId).toBe('unknown-tg');
        expect(out[0].employeeName).toBe('tg-only');
    });

    test('does not drop unrelated fields (spread fidelity)', () => {
        const input = [
            sess({
                employeeId: '123',
                sessionEarnings: 42.5,
                hourlyRate: 15,
                durationMinutes: 170,
            }),
        ];
        const out = normalizeSessionIdentities(input, {
            telegramIdToUid: new Map([['123', 'uid']]),
            uidToName: new Map([['uid', 'Worker']]),
        });
        expect(out[0].sessionEarnings).toBe(42.5);
        expect(out[0].hourlyRate).toBe(15);
        expect(out[0].durationMinutes).toBe(170);
    });

    test('retains name when uidToName lookup returns undefined (empty directory case)', () => {
        const input = [sess({ employeeId: 'unmapped', employeeName: 'fallback' })];
        const out = normalizeSessionIdentities(input, {
            telegramIdToUid: new Map(),
            uidToName: new Map(),
        });
        expect(out[0].employeeName).toBe('fallback');
    });
});
