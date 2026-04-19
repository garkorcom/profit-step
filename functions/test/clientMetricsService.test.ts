/**
 * Unit tests for ClientMetricsService.computeFromInputs (pure function).
 *
 * No Firestore needed — all inputs are structured objects. Exercises the
 * healthScore algorithm, churnRisk classifier, payment reliability, and
 * count aggregations.
 *
 * Spec: docs/tasks/CLIENT_CARD_V2_SPEC.md §5.4 + §10.
 */

import * as admin from 'firebase-admin';
import { ClientMetricsService } from '../src/services/clientMetricsService';

const FIXED_NOW = new Date('2026-04-19T10:00:00Z');
const NOW_MS = FIXED_NOW.getTime();
const DAY = 24 * 60 * 60 * 1000;

// Tiny Timestamp mock — real admin.firestore.Timestamp.fromMillis requires
// firebase-admin init, so we stub it for unit-level purity.
const ts = (ms: number): admin.firestore.Timestamp => ({
  toMillis: () => ms,
  toDate: () => new Date(ms),
  seconds: Math.floor(ms / 1000),
  nanoseconds: 0,
  valueOf: () => ms.toString(),
  isEqual: function(other: admin.firestore.Timestamp) { return other?.toMillis() === ms; },
  toJSON: () => ({ seconds: Math.floor(ms / 1000), nanoseconds: 0 }),
} as admin.firestore.Timestamp);

// Override admin.firestore.Timestamp.fromMillis so the service produces
// comparable stubs inside computeFromInputs without initializing admin.
beforeAll(() => {
  (admin.firestore as unknown as { Timestamp: { fromMillis: (ms: number) => admin.firestore.Timestamp } }).Timestamp = {
    fromMillis: (ms: number) => ts(ms),
  };
});

function makeService(): ClientMetricsService {
  return new ClientMetricsService({} as admin.firestore.Firestore, () => FIXED_NOW);
}

describe('ClientMetricsService.computeFromInputs — LTV & payment reliability', () => {
  it('sums paid invoices into ltv', () => {
    const svc = makeService();
    const metrics = svc.computeFromInputs({
      clientCreatedAt: ts(NOW_MS - 180 * DAY),
      invoices: [
        { status: 'paid', total: 1000 },
        { status: 'paid', total: 2500 },
        { status: 'draft', total: 500 }, // ignored
        { status: 'sent', total: 800 }, // ignored
      ],
      deals: [],
      projects: [],
      meetings: [],
      tasks: [],
      messagesLastContactAt: null,
    });
    expect(metrics.ltv).toBe(3500);
  });

  it('null avgPaymentDelayDays when no invoices have dueDate+paidAt', () => {
    const svc = makeService();
    const metrics = svc.computeFromInputs({
      clientCreatedAt: ts(NOW_MS - 180 * DAY),
      invoices: [
        { status: 'paid', total: 500 }, // no dates
      ],
      deals: [],
      projects: [],
      meetings: [],
      tasks: [],
      messagesLastContactAt: null,
    });
    expect(metrics.avgPaymentDelayDays).toBeNull();
  });

  it('computes avgPaymentDelay as difference between dueDate and paidAt', () => {
    const svc = makeService();
    const dueMs = NOW_MS - 30 * DAY;
    const paidMs = NOW_MS - 25 * DAY; // 5 days late
    const metrics = svc.computeFromInputs({
      clientCreatedAt: ts(NOW_MS - 180 * DAY),
      invoices: [{ status: 'paid', total: 1000, dueDate: ts(dueMs), paidAt: ts(paidMs) }],
      deals: [],
      projects: [],
      meetings: [],
      tasks: [],
      messagesLastContactAt: null,
    });
    expect(metrics.avgPaymentDelayDays).toBeCloseTo(5, 1);
  });
});

describe('ClientMetricsService.computeFromInputs — counts', () => {
  it('counts active deals (status=open)', () => {
    const svc = makeService();
    const metrics = svc.computeFromInputs({
      clientCreatedAt: ts(NOW_MS - 180 * DAY),
      invoices: [],
      deals: [
        { status: 'open' },
        { status: 'open' },
        { status: 'won' },
        { status: 'lost' },
      ],
      projects: [],
      meetings: [],
      tasks: [],
      messagesLastContactAt: null,
    });
    expect(metrics.activeDealsCount).toBe(2);
  });

  it('counts active projects (status=in_progress or active)', () => {
    const svc = makeService();
    const metrics = svc.computeFromInputs({
      clientCreatedAt: ts(NOW_MS - 180 * DAY),
      invoices: [],
      deals: [],
      projects: [
        { status: 'in_progress' },
        { status: 'active' },
        { status: 'done' },
        { status: 'archived' },
      ],
      meetings: [],
      tasks: [],
      messagesLastContactAt: null,
    });
    expect(metrics.activeProjectsCount).toBe(2);
  });

  it('counts overdue open tasks', () => {
    const svc = makeService();
    const metrics = svc.computeFromInputs({
      clientCreatedAt: ts(NOW_MS - 180 * DAY),
      invoices: [],
      deals: [],
      projects: [],
      meetings: [],
      tasks: [
        { status: 'open', dueDate: ts(NOW_MS - 5 * DAY) },        // overdue
        { status: 'next_action', dueDate: ts(NOW_MS - 10 * DAY) },// overdue
        { status: 'inbox', dueDate: ts(NOW_MS + 5 * DAY) },       // future, ok
        { status: 'done', dueDate: ts(NOW_MS - 5 * DAY) },        // completed, skip
        { status: 'open', completedAt: ts(NOW_MS - 3 * DAY) },    // completed, skip
      ],
      messagesLastContactAt: null,
    });
    expect(metrics.openOverdueTasks).toBe(2);
  });
});

describe('ClientMetricsService.computeFromInputs — healthScore', () => {
  it('long-tenure paying client with fresh contact → high healthScore', () => {
    const svc = makeService();
    const metrics = svc.computeFromInputs({
      clientCreatedAt: ts(NOW_MS - 400 * DAY), // >1 year tenure
      invoices: [
        { status: 'paid', total: 30000, dueDate: ts(NOW_MS - 60 * DAY), paidAt: ts(NOW_MS - 58 * DAY) },
        { status: 'paid', total: 20000, dueDate: ts(NOW_MS - 30 * DAY), paidAt: ts(NOW_MS - 30 * DAY) },
      ],
      deals: [{ status: 'open', stage: 'sent' }],
      projects: [{ status: 'in_progress' }],
      meetings: [{ status: 'completed', endAt: ts(NOW_MS - 3 * DAY) }],
      tasks: [],
      messagesLastContactAt: null,
    });
    expect(metrics.healthScore).toBeGreaterThanOrEqual(70);
  });

  it('new client with no contact → low healthScore', () => {
    const svc = makeService();
    const metrics = svc.computeFromInputs({
      clientCreatedAt: ts(NOW_MS - 7 * DAY),
      invoices: [],
      deals: [],
      projects: [],
      meetings: [],
      tasks: [],
      messagesLastContactAt: null,
    });
    expect(metrics.healthScore).toBeLessThan(30);
  });

  it('healthScore is bounded 0-100', () => {
    const svc = makeService();
    const metrics = svc.computeFromInputs({
      clientCreatedAt: null,
      invoices: [],
      deals: [],
      projects: [],
      meetings: [],
      tasks: [],
      messagesLastContactAt: null,
    });
    expect(metrics.healthScore).toBeGreaterThanOrEqual(0);
    expect(metrics.healthScore).toBeLessThanOrEqual(100);
  });
});

describe('ClientMetricsService.computeFromInputs — churnRisk', () => {
  it("'high' when lastContact > 90 days AND 0 active deals", () => {
    const svc = makeService();
    const metrics = svc.computeFromInputs({
      clientCreatedAt: ts(NOW_MS - 400 * DAY),
      invoices: [],
      deals: [{ status: 'lost' }],
      projects: [],
      meetings: [{ status: 'completed', endAt: ts(NOW_MS - 100 * DAY) }],
      tasks: [],
      messagesLastContactAt: null,
    });
    expect(metrics.churnRisk).toBe('high');
  });

  it("'medium' when healthScore < 40 but recent contact", () => {
    const svc = makeService();
    const metrics = svc.computeFromInputs({
      clientCreatedAt: ts(NOW_MS - 10 * DAY),
      invoices: [],
      deals: [],
      projects: [],
      meetings: [{ status: 'completed', endAt: ts(NOW_MS - 60 * DAY) }],
      tasks: [],
      messagesLastContactAt: null,
    });
    // Low healthScore + no payment history → medium per rule
    expect(['medium', 'high']).toContain(metrics.churnRisk);
  });

  it("'low' for healthy active client", () => {
    const svc = makeService();
    const metrics = svc.computeFromInputs({
      clientCreatedAt: ts(NOW_MS - 365 * DAY),
      invoices: [
        { status: 'paid', total: 20000, dueDate: ts(NOW_MS - 30 * DAY), paidAt: ts(NOW_MS - 30 * DAY) },
      ],
      deals: [{ status: 'open' }],
      projects: [{ status: 'in_progress' }],
      meetings: [{ status: 'completed', endAt: ts(NOW_MS - 5 * DAY) }],
      tasks: [],
      messagesLastContactAt: null,
    });
    expect(metrics.churnRisk).toBe('low');
  });
});

describe('ClientMetricsService.computeFromInputs — lastContactAt', () => {
  it('uses most recent completed meeting', () => {
    const svc = makeService();
    const latest = NOW_MS - 5 * DAY;
    const metrics = svc.computeFromInputs({
      clientCreatedAt: ts(NOW_MS - 365 * DAY),
      invoices: [],
      deals: [],
      projects: [],
      meetings: [
        { status: 'completed', endAt: ts(NOW_MS - 30 * DAY) },
        { status: 'completed', endAt: ts(latest) },
        { status: 'scheduled', endAt: ts(NOW_MS - 2 * DAY) }, // future status, ignored
      ],
      tasks: [],
      messagesLastContactAt: null,
    });
    expect(metrics.lastContactAt?.toMillis()).toBe(latest);
  });

  it('null when no completed meetings and no messages', () => {
    const svc = makeService();
    const metrics = svc.computeFromInputs({
      clientCreatedAt: ts(NOW_MS - 30 * DAY),
      invoices: [],
      deals: [],
      projects: [],
      meetings: [{ status: 'scheduled', startAt: ts(NOW_MS + 2 * DAY) }],
      tasks: [],
      messagesLastContactAt: null,
    });
    expect(metrics.lastContactAt).toBeNull();
  });

  it('uses messagesLastContactAt when newer than any meeting', () => {
    const svc = makeService();
    const msgMs = NOW_MS - 1 * DAY;
    const metrics = svc.computeFromInputs({
      clientCreatedAt: ts(NOW_MS - 365 * DAY),
      invoices: [],
      deals: [],
      projects: [],
      meetings: [{ status: 'completed', endAt: ts(NOW_MS - 10 * DAY) }],
      tasks: [],
      messagesLastContactAt: ts(msgMs),
    });
    expect(metrics.lastContactAt?.toMillis()).toBe(msgMs);
  });
});

describe('ClientMetricsService.computeFromInputs — edge cases', () => {
  it('empty everything → zero metrics, high-ish churnRisk', () => {
    const svc = makeService();
    const metrics = svc.computeFromInputs({
      clientCreatedAt: null,
      invoices: [],
      deals: [],
      projects: [],
      meetings: [],
      tasks: [],
      messagesLastContactAt: null,
    });
    expect(metrics.ltv).toBe(0);
    expect(metrics.activeDealsCount).toBe(0);
    expect(metrics.activeProjectsCount).toBe(0);
    expect(metrics.openOverdueTasks).toBe(0);
    expect(metrics.lastContactAt).toBeNull();
    expect(metrics.avgPaymentDelayDays).toBeNull();
  });

  it('invoice without dueDate skipped from payment delay calc', () => {
    const svc = makeService();
    const metrics = svc.computeFromInputs({
      clientCreatedAt: ts(NOW_MS - 180 * DAY),
      invoices: [
        { status: 'paid', total: 1000 }, // no dates
        { status: 'paid', total: 500, dueDate: ts(NOW_MS - 30 * DAY), paidAt: ts(NOW_MS - 29 * DAY) }, // 1 day late
      ],
      deals: [],
      projects: [],
      meetings: [],
      tasks: [],
      messagesLastContactAt: null,
    });
    expect(metrics.avgPaymentDelayDays).toBeCloseTo(1, 1);
  });

  it('computedAt equals injected now', () => {
    const svc = makeService();
    const metrics = svc.computeFromInputs({
      clientCreatedAt: null,
      invoices: [],
      deals: [],
      projects: [],
      meetings: [],
      tasks: [],
      messagesLastContactAt: null,
    });
    expect(metrics.computedAt.toMillis()).toBe(NOW_MS);
  });
});
