/**
 * Timezone boundary tests — verify date math for payroll & summary endpoints.
 * Workers are in Tampa, FL (America/New_York). Cloud Functions run in UTC.
 */
const { toZonedTime, fromZonedTime } = require('date-fns-tz');
const { subDays, startOfDay, endOfDay } = require('date-fns');

const TIME_ZONE = 'America/New_York';

function getPayrollQueryRange(serverNowUtc) {
  const nowInFlorida = toZonedTime(serverNowUtc, TIME_ZONE);
  const yesterdayFlorida = subDays(nowInFlorida, 1);
  const start = fromZonedTime(startOfDay(yesterdayFlorida), TIME_ZONE);
  const end = fromZonedTime(endOfDay(yesterdayFlorida), TIME_ZONE);
  return { start, end };
}

function getSummaryQueryRange(fromStr, toStr) {
  // Match the actual endpoint logic: parse date parts explicitly
  const [fromY, fromM, fromD] = fromStr.split('-').map(Number);
  const [toY, toM, toD] = toStr.split('-').map(Number);
  const fromUtc = fromZonedTime(new Date(fromY, fromM - 1, fromD, 0, 0, 0, 0), TIME_ZONE);
  const toUtc = fromZonedTime(new Date(toY, toM - 1, toD, 23, 59, 59, 999), TIME_ZONE);
  return { fromUtc, toUtc };
}

describe('generateDailyPayroll — timezone boundaries', () => {
  test('EDT (summer) — 4 AM Florida = 8 AM UTC, yesterday = Apr 12 ET', () => {
    const serverNow = new Date('2026-04-13T08:00:00Z');
    const { start, end } = getPayrollQueryRange(serverNow);

    expect(start.toISOString()).toBe('2026-04-12T04:00:00.000Z');
    expect(end.toISOString()).toBe('2026-04-13T03:59:59.999Z');
  });

  test('EST (winter) — 4 AM Florida = 9 AM UTC, yesterday = Jan 14 ET', () => {
    const serverNow = new Date('2026-01-15T09:00:00Z');
    const { start, end } = getPayrollQueryRange(serverNow);

    expect(start.toISOString()).toBe('2026-01-14T05:00:00.000Z');
    expect(end.toISOString()).toBe('2026-01-15T04:59:59.999Z');
  });

  test('DST spring-forward (Mar 8 → 23-hour day)', () => {
    const serverNow = new Date('2026-03-09T08:00:00Z');
    const { start, end } = getPayrollQueryRange(serverNow);

    expect(start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(end.toISOString()).toBe('2026-03-09T03:59:59.999Z');

    const windowHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    expect(windowHours).toBeCloseTo(23, 0);
  });

  test('DST fall-back (Nov 1 → 25-hour day)', () => {
    const serverNow = new Date('2026-11-02T09:00:00Z');
    const { start, end } = getPayrollQueryRange(serverNow);

    expect(start.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-02T04:59:59.999Z');

    const windowHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    expect(windowHours).toBeCloseTo(25, 0);
  });
});

describe('timeTracking summary — timezone boundaries', () => {
  test('single day in EDT — Apr 12', () => {
    const { fromUtc, toUtc } = getSummaryQueryRange('2026-04-12', '2026-04-12');

    expect(fromUtc.toISOString()).toBe('2026-04-12T04:00:00.000Z');
    expect(toUtc.toISOString()).toBe('2026-04-13T03:59:59.999Z');
  });

  test('two days in EST — Jan 13-14', () => {
    const { fromUtc, toUtc } = getSummaryQueryRange('2026-01-13', '2026-01-14');

    expect(fromUtc.toISOString()).toBe('2026-01-13T05:00:00.000Z');
    expect(toUtc.toISOString()).toBe('2026-01-15T04:59:59.999Z');
  });

  test('late-night session at 11 PM ET is included in correct day', () => {
    const sessionStartUtc = new Date('2026-04-13T03:00:00Z');
    const { fromUtc, toUtc } = getSummaryQueryRange('2026-04-12', '2026-04-12');

    expect(sessionStartUtc.getTime()).toBeGreaterThanOrEqual(fromUtc.getTime());
    expect(sessionStartUtc.getTime()).toBeLessThanOrEqual(toUtc.getTime());
  });

  test('midnight session at 12:01 AM ET next day is NOT included', () => {
    const sessionStartUtc = new Date('2026-04-13T04:01:00Z');
    const { fromUtc, toUtc } = getSummaryQueryRange('2026-04-12', '2026-04-12');

    expect(sessionStartUtc.getTime()).toBeGreaterThan(toUtc.getTime());
  });
});
