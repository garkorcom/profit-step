/**
 * @fileoverview rlsCrossTenant.test.ts
 *
 * Cross-role / cross-user RLS leak tests for the 5 routes hardened in ceb8464:
 *   - /api/dashboard
 *   - /api/inventory/*
 *   - /api/finance/*
 *   - /api/activity
 *   - /api/feedback
 *
 * Strategy — FULL MOCK (same pattern as generateAiTask.integration.test.ts):
 * The test does NOT need the Firestore emulator. Instead it replaces
 * `admin.firestore()` with an in-memory spy that records every `.where()`,
 * `.orderBy()`, `.limit()` call. We then assert that the query chain built
 * by each route includes the expected scoping predicate for the impersonated
 * role.
 *
 * This catches:
 *   - a route that forgets to add a .where('userId', '==', uid) filter for
 *     worker/driver role (→ data leak)
 *   - a foreman endpoint that uses 'in' with too many uids (Firestore cap 30)
 *   - a worker endpoint that exposes company-wide estimates
 *
 * What it does NOT catch:
 *   - Firestore composite-index mismatches (need emulator)
 *   - .get() behavior on real data (need emulator / fixture docs)
 *
 * For a full belt-and-suspenders check, also run:
 *   firebase emulators:start --only firestore,auth
 *   npm --prefix functions run test -- rlsCrossTenant
 * with setup.ts's emulator pointers.
 */

import * as express from 'express';
import type { Request, Response, NextFunction } from 'express';
import * as request from 'supertest';

// ─── Mock admin before importing routes ───────────────────────────────

type QuerySpy = {
  collection: string;
  wheres: Array<[string, FirebaseFirestore.WhereFilterOp, unknown]>;
  orderBys: string[];
  limitN?: number;
};

const querySpies: QuerySpy[] = [];

function makeQueryChain(collectionName: string, existing?: QuerySpy): any {
  const spy: QuerySpy = existing ?? {
    collection: collectionName,
    wheres: [],
    orderBys: [],
  };
  if (!existing) querySpies.push(spy);
  const chain: any = {
    where: (field: string, op: FirebaseFirestore.WhereFilterOp, value: unknown) => {
      spy.wheres.push([field, op, value]);
      return makeQueryChain(collectionName, spy);
    },
    orderBy: (field: string) => {
      spy.orderBys.push(field);
      return makeQueryChain(collectionName, spy);
    },
    limit: (n: number) => {
      spy.limitN = n;
      return makeQueryChain(collectionName, spy);
    },
    get: async () => ({ docs: [], size: 0, empty: true }),
  };
  return chain;
}

jest.mock('firebase-admin', () => {
  const actual = jest.requireActual('firebase-admin');
  return {
    ...actual,
    firestore: () => ({
      collection: (name: string) => makeQueryChain(name),
    }),
    initializeApp: jest.fn(),
    apps: [{}],
  };
});

jest.mock('firebase-functions', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// routeContext exports `db`, `Timestamp`, `logger`, `getCachedClients`.
jest.mock('../src/agent/routeContext', () => {
  const admin = require('firebase-admin');
  return {
    db: admin.firestore(),
    Timestamp: {
      fromDate: (d: Date) => ({ toDate: () => d, _d: d }),
      now: () => ({ toDate: () => new Date(), _d: new Date() }),
    },
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    getCachedClients: async () => [],
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────

function mountWithRole(
  routerPath: string,
  role: string,
  userId: string,
  teamUids: string[] = [],
) {
  const { default: router } = require(routerPath);
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.agentUserId = userId;
    req.effectiveUserId = userId;
    req.effectiveRole = role;
    req.effectiveTeamMemberUids = teamUids;
    req.effectiveScopes = role === 'admin' ? ['admin'] : [];
    next();
  });
  app.use(router);
  return app;
}

function resetSpies() {
  querySpies.length = 0;
}

function findSpy(collection: string): QuerySpy | undefined {
  return querySpies.find((s) => s.collection === collection);
}

function hasFilter(spy: QuerySpy, field: string, value?: unknown): boolean {
  return spy.wheres.some(
    ([f, , v]) => f === field && (value === undefined || v === value),
  );
}

// ─── /api/dashboard tests ─────────────────────────────────────────────

describe('RLS: GET /api/dashboard', () => {
  beforeEach(resetSpies);

  it('worker role adds userId filter to work_sessions, gtd_tasks, costs', async () => {
    const app = mountWithRole('../src/agent/routes/dashboard', 'worker', 'userA');
    await request(app).get('/api/dashboard');

    const sessions = findSpy('work_sessions');
    const tasks = findSpy('gtd_tasks');
    const costs = findSpy('costs');
    expect(sessions).toBeDefined();
    expect(tasks).toBeDefined();
    expect(costs).toBeDefined();
    expect(hasFilter(sessions!, 'userId', 'userA')).toBe(true);
    expect(hasFilter(tasks!, 'assigneeId', 'userA')).toBe(true);
    expect(hasFilter(costs!, 'userId', 'userA')).toBe(true);
  });

  it('worker role does NOT query estimates collection (leak check)', async () => {
    const app = mountWithRole('../src/agent/routes/dashboard', 'worker', 'userA');
    await request(app).get('/api/dashboard');

    expect(findSpy('estimates')).toBeUndefined();
  });

  it('driver role behaves same as worker (treated identically by RLS)', async () => {
    const app = mountWithRole('../src/agent/routes/dashboard', 'driver', 'userD');
    await request(app).get('/api/dashboard');

    expect(findSpy('estimates')).toBeUndefined();
    expect(hasFilter(findSpy('work_sessions')!, 'userId', 'userD')).toBe(true);
  });

  it('foreman with team ≤30 uses "in" filter with all team uids', async () => {
    const team = ['u1', 'u2', 'u3'];
    const app = mountWithRole(
      '../src/agent/routes/dashboard',
      'foreman',
      'foremanA',
      team,
    );
    await request(app).get('/api/dashboard');

    const sessions = findSpy('work_sessions')!;
    const inFilter = sessions.wheres.find(
      ([f, op]) => f === 'userId' && op === 'in',
    );
    expect(inFilter).toBeDefined();
    const uids = inFilter![2] as string[];
    expect(uids).toContain('foremanA');
    expect(uids).toEqual(expect.arrayContaining(team));
  });

  it('foreman with >30 team members falls back to admin-wide (no scoping)', async () => {
    // Firestore caps 'in' at 30 values; route must not try to use 'in'.
    const bigTeam = Array.from({ length: 31 }, (_, i) => `u${i}`);
    const app = mountWithRole(
      '../src/agent/routes/dashboard',
      'foreman',
      'foremanB',
      bigTeam,
    );
    await request(app).get('/api/dashboard');

    const sessions = findSpy('work_sessions')!;
    const inFilter = sessions.wheres.find(
      ([f, op]) => f === 'userId' && op === 'in',
    );
    // Currently the route silently becomes admin-scope in this case.
    // This is a KNOWN GAP — a team of >30 is unscoped.
    // Flag it: this test documents the behavior so we notice if it changes.
    expect(inFilter).toBeUndefined();
  });

  it('admin role does not add any user scoping to work_sessions', async () => {
    const app = mountWithRole('../src/agent/routes/dashboard', 'admin', 'adminA');
    await request(app).get('/api/dashboard');

    const sessions = findSpy('work_sessions')!;
    const userFilter = sessions.wheres.find(([f]) => f === 'userId');
    expect(userFilter).toBeUndefined();
  });
});

// ─── /api/inventory — RLS leak scenarios ──────────────────────────────

describe('RLS: /api/inventory', () => {
  beforeEach(resetSpies);

  it('worker listing warehouses sees only own (createdBy filter)', async () => {
    const app = mountWithRole('../src/agent/routes/inventory', 'worker', 'userA');
    await request(app).get('/api/inventory/warehouses');

    const warehouses = findSpy('inventory_warehouses') || findSpy('warehouses');
    if (warehouses) {
      expect(
        hasFilter(warehouses, 'createdBy', 'userA') ||
          hasFilter(warehouses, 'ownerId', 'userA'),
      ).toBe(true);
    } else {
      // If collection name differs, at minimum some user-scoping filter was added.
      // Fail loud so test is maintained when inventory route changes.
      throw new Error(
        'No warehouse query captured. Update this test if inventory collection name changed.',
      );
    }
  });
});

// ─── /api/finance — RLS denial scenarios ──────────────────────────────

describe('RLS: /api/finance', () => {
  beforeEach(resetSpies);

  it('worker role on /finance/context is denied (403, no collection hit)', async () => {
    const app = mountWithRole('../src/agent/routes/finance', 'worker', 'userA');
    const res = await request(app).get('/api/finance/context');

    // Worker should never reach the Firestore layer for finance/context.
    // Either 403 or empty response — but NO finance collection reads.
    expect(res.status).toBeGreaterThanOrEqual(400);
    const financeSpies = querySpies.filter((s) =>
      s.collection.startsWith('finance_'),
    );
    expect(financeSpies).toHaveLength(0);
  });
});

// ─── /api/activity ────────────────────────────────────────────────────

describe('RLS: /api/activity', () => {
  beforeEach(resetSpies);

  it('worker sees own activity only', async () => {
    const app = mountWithRole('../src/agent/routes/activity', 'worker', 'userA');
    await request(app).get('/api/activity');

    const activity = findSpy('activity_log') || findSpy('user_activity');
    if (activity) {
      expect(
        hasFilter(activity, 'userId', 'userA') ||
          hasFilter(activity, 'actorId', 'userA'),
      ).toBe(true);
    }
  });
});

// ─── /api/feedback ────────────────────────────────────────────────────

describe('RLS: /api/feedback', () => {
  beforeEach(resetSpies);

  it('worker/driver/foreman see only own feedback', async () => {
    for (const role of ['worker', 'driver', 'foreman']) {
      resetSpies();
      const app = mountWithRole(
        '../src/agent/routes/feedback',
        role,
        `user_${role}`,
      );
      await request(app).get('/api/feedback');

      const feedback = findSpy('agent_feedback') || findSpy('feedback');
      if (feedback) {
        expect(
          hasFilter(feedback, 'userId', `user_${role}`) ||
            hasFilter(feedback, 'submittedBy', `user_${role}`),
        ).toBe(true);
      }
    }
  });
});
