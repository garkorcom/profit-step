/**
 * Regression guard for the worker-bot end-of-shift balance bug fixed
 * 2026-04-28. Prior code used `[...new Set(idVariants.map(String))]` which
 * collapsed `userId` (number) and `String(userId)` (string) into a single
 * string entry. Firestore equality is type-strict, so the resulting query
 * `where('employeeId', '==', '123')` failed to match documents written by the
 * bot itself with `employeeId: 123` (number) — the entire year-to-date salary
 * history disappeared from the bot's balance message.
 *
 * If this test ever fails, the bot is silently zeroing out bot-created
 * sessions in workers' end-of-shift balance again.
 */

import { dedupeEmployeeIdVariants } from '../src/triggers/telegram/telegramUtils';

describe('dedupeEmployeeIdVariants', () => {
    test('keeps numeric and string variants of the same value distinct', () => {
        const out = dedupeEmployeeIdVariants([123456789, '123456789']);
        expect(out).toHaveLength(2);
        expect(out).toEqual([123456789, '123456789']);
    });

    test('keeps Telegram id (number), its string form, and the platform UID', () => {
        const out = dedupeEmployeeIdVariants([123, '123', 'firebase-uid-abc']);
        expect(out).toHaveLength(3);
        expect(out).toEqual([123, '123', 'firebase-uid-abc']);
    });

    test('drops genuine duplicates of the same type+value', () => {
        const out = dedupeEmployeeIdVariants([123, 123, '123', '123']);
        expect(out).toEqual([123, '123']);
    });

    test('different platform UIDs (string) coexist', () => {
        const out = dedupeEmployeeIdVariants(['uid-a', 'uid-b']);
        expect(out).toEqual(['uid-a', 'uid-b']);
    });

    test('preserves input order — first occurrence wins', () => {
        const out = dedupeEmployeeIdVariants(['z', 1, 'a', '1', 1]);
        expect(out).toEqual(['z', 1, 'a', '1']);
    });

    test('empty input returns empty array', () => {
        expect(dedupeEmployeeIdVariants([])).toEqual([]);
    });
});
