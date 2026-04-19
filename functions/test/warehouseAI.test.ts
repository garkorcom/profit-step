/**
 * Unit tests for Warehouse AI service.
 *
 * Strategy:
 *   - Pure helpers (normalizeIntent, qtyAtLocation, buildProposedItems,
 *     sumEstimatedTotal) — tested without mocks.
 *   - Firestore-dependent functions (matchNorms, resolveStock,
 *     resolveClient, persistSession, confirmTrip, cancelTrip, planTrip,
 *     buildPlanFromIntent) — tested against a minimal in-memory FakeDb
 *     that implements only the surface our service touches. Avoids the
 *     Firestore emulator dependency for true unit-level speed.
 *   - Gemini-calling parseIntent — tested with jest.mock on the
 *     @google/generative-ai module so no real network call is made.
 *
 * Coverage target: >= 20 tests across 5 logical groups (pure, norms,
 * stock, orchestration, sessions).
 */

import {
  normalizeIntent,
  qtyAtLocation,
  buildProposedItems,
  sumEstimatedTotal,
  matchNorms,
  resolveStock,
  resolveClient,
  persistSession,
  confirmTrip,
  cancelTrip,
  buildPlanFromIntent,
} from '../src/services/warehouseAI';
import type {
  CatalogItemSnapshot,
  NormRecord,
  ParsedIntent,
  TripPlan,
} from '../src/services/warehouseAI/types';

// ═══════════════════════════════════════════════════════════════════
//  FakeDb — minimal Firestore surface
// ═══════════════════════════════════════════════════════════════════

type DocData = Record<string, any>;

class FakeDocRef {
  constructor(private collection: FakeCollection, private id: string) {}
  async get() {
    const data = this.collection.docs.get(this.id);
    return {
      exists: data !== undefined,
      id: this.id,
      data: () => data,
    };
  }
  async set(data: DocData, options?: { merge?: boolean }) {
    const prev = options?.merge ? this.collection.docs.get(this.id) || {} : {};
    // Strip sentinel-ish markers — our fake doesn't resolve serverTimestamp,
    // arrayUnion; we just capture the call shape in a side channel.
    const sanitized = sanitizeForWrite(data);
    this.collection.docs.set(this.id, { ...prev, ...sanitized });
    this.collection.writeLog.push({ id: this.id, data });
  }
  async update(data: DocData) {
    const prev = this.collection.docs.get(this.id) || {};
    this.collection.docs.set(this.id, { ...prev, ...sanitizeForWrite(data) });
  }
}

class FakeQuery {
  constructor(private collection: FakeCollection, private filters: Array<{ field: string; op: string; value: any }>, private limitN?: number) {}

  where(field: string, op: string, value: any): FakeQuery {
    return new FakeQuery(this.collection, [...this.filters, { field, op, value }], this.limitN);
  }

  limit(n: number): FakeQuery {
    return new FakeQuery(this.collection, this.filters, n);
  }

  async get() {
    let docs = Array.from(this.collection.docs.entries()).map(([id, data]) => ({ id, data }));
    for (const f of this.filters) {
      docs = docs.filter((d) => {
        const fieldVal = (d.data as any)?.[f.field];
        if (f.op === '==') return fieldVal === f.value;
        if (f.op === 'in') return Array.isArray(f.value) && f.value.includes(fieldVal);
        return true;
      });
    }
    if (this.limitN !== undefined) docs = docs.slice(0, this.limitN);
    return {
      docs: docs.map(({ id, data }) => ({ id, data: () => data })),
    };
  }
}

class FakeCollection {
  docs = new Map<string, DocData>();
  writeLog: Array<{ id: string; data: DocData }> = [];
  doc(id: string) {
    return new FakeDocRef(this, id);
  }
  where(field: string, op: string, value: any): FakeQuery {
    return new FakeQuery(this, [{ field, op, value }]);
  }
  limit(n: number): FakeQuery {
    return new FakeQuery(this, [], n);
  }
}

class FakeDb {
  private collections = new Map<string, FakeCollection>();
  collection(name: string): FakeCollection {
    if (!this.collections.has(name)) this.collections.set(name, new FakeCollection());
    return this.collections.get(name)!;
  }
  seed(name: string, id: string, data: DocData) {
    this.collection(name).docs.set(id, data);
  }
  listCollection(name: string) {
    return this.collection(name);
  }
}

function sanitizeForWrite(data: DocData): DocData {
  // FieldValue.serverTimestamp() and FieldValue.arrayUnion(x) are not real
  // values in this fake; we strip them. Nested objects are preserved.
  const out: DocData = {};
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && 'constructor' in v) {
      const cn = v.constructor?.name || '';
      if (cn === 'ServerTimestampTransform' || cn === 'ArrayUnionTransform' || cn === 'NumericIncrementTransform') {
        // skip sentinel — keeps write path deterministic
        continue;
      }
    }
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
//  GROUP 1 — Pure helpers
// ═══════════════════════════════════════════════════════════════════

describe('normalizeIntent', () => {
  it('accepts a valid minimal intent', () => {
    const out = normalizeIntent({
      destination: { clientHint: 'Jim', addressHint: null },
      plannedDate: 'tomorrow',
      tasks: [{ type: 'install_outlet', qty: 3, description: 'три розетки' }],
    });
    expect(out).not.toBeNull();
    expect(out!.tasks).toHaveLength(1);
    expect(out!.tasks[0].type).toBe('install_outlet');
    expect(out!.tasks[0].qty).toBe(3);
  });

  it('defaults qty to 1 when missing/invalid', () => {
    const out = normalizeIntent({
      destination: {},
      plannedDate: null,
      tasks: [{ type: 'replace_switch', description: 'выключатель' }],
    });
    expect(out!.tasks[0].qty).toBe(1);
  });

  it('returns null when tasks is empty or not an array', () => {
    expect(normalizeIntent({ destination: {}, plannedDate: null, tasks: [] })).toBeNull();
    expect(normalizeIntent({ destination: {}, plannedDate: null })).toBeNull();
    expect(normalizeIntent(null)).toBeNull();
  });

  it('rejects bad plannedDate but keeps rest', () => {
    const out = normalizeIntent({
      destination: {},
      plannedDate: 'nextweek',
      tasks: [{ type: 'install_fan', qty: 1, description: 'fan' }],
    });
    expect(out!.plannedDate).toBeNull();
  });

  it('accepts ISO date', () => {
    const out = normalizeIntent({
      destination: {},
      plannedDate: '2026-05-01',
      tasks: [{ type: 'install_fan', qty: 1, description: 'fan' }],
    });
    expect(out!.plannedDate).toBe('2026-05-01');
  });

  it('filters out malformed task entries', () => {
    const out = normalizeIntent({
      destination: {},
      plannedDate: null,
      tasks: [
        { type: 'install_outlet', qty: 2, description: 'ok' },
        { type: '', qty: 1 },
        null,
        { qty: 5 },
      ],
    });
    expect(out!.tasks).toHaveLength(1);
    expect(out!.tasks[0].type).toBe('install_outlet');
  });
});

describe('qtyAtLocation', () => {
  const item: CatalogItemSnapshot = {
    id: 'wire12',
    name: 'Wire 12 AWG',
    unit: 'м',
    avgPrice: 0.8,
    stockByLocation: { 'van-denis': 20, 'warehouse-miami': 200 },
    totalStock: 220,
  };

  it('returns location qty when provided', () => {
    expect(qtyAtLocation(item, 'van-denis')).toBe(20);
  });

  it('returns 0 for unknown location', () => {
    expect(qtyAtLocation(item, 'unknown-loc')).toBe(0);
  });

  it('returns totalStock when no location specified', () => {
    expect(qtyAtLocation(item)).toBe(220);
  });
});

describe('buildProposedItems', () => {
  const outletNorm: NormRecord = {
    id: 'norm1',
    taskType: 'install_outlet',
    items: [
      { catalogItemId: 'outlet', qtyPerUnit: 1 },
      { catalogItemId: 'wire12', qtyPerUnit: 5 },
    ],
  };

  const catalog = new Map<string, CatalogItemSnapshot>([
    [
      'outlet',
      { id: 'outlet', name: 'Outlet 15A', unit: 'шт', avgPrice: 3, stockByLocation: { 'van-denis': 0 }, totalStock: 0 },
    ],
    [
      'wire12',
      { id: 'wire12', name: 'Wire 12 AWG', unit: 'м', avgPrice: 0.8, stockByLocation: { 'van-denis': 20 }, totalStock: 20 },
    ],
  ]);

  it('computes delta for a single task', () => {
    const tasks = [{ type: 'install_outlet', qty: 3, description: 'три розетки' }];
    const norms = new Map([['install_outlet', outletNorm]]);
    const { proposed, warnings } = buildProposedItems(tasks, norms, catalog, 'van-denis');

    const outlet = proposed.find((p) => p.catalogItemId === 'outlet')!;
    const wire = proposed.find((p) => p.catalogItemId === 'wire12')!;

    expect(outlet.qtyNeeded).toBe(3);
    expect(outlet.qtyOnHand).toBe(0);
    expect(outlet.qtyToBuy).toBe(3);
    expect(outlet.estimatedPrice).toBe(9); // 3 × $3

    expect(wire.qtyNeeded).toBe(15); // 3 × 5m per outlet
    expect(wire.qtyOnHand).toBe(20);
    expect(wire.qtyToBuy).toBe(0); // already enough
    expect(wire.estimatedPrice).toBeUndefined();

    expect(warnings).toHaveLength(0);
  });

  it('merges qty across multiple tasks for same item', () => {
    const tasks = [
      { type: 'install_outlet', qty: 2, description: 'a' },
      { type: 'install_outlet', qty: 1, description: 'b' },
    ];
    const norms = new Map([['install_outlet', outletNorm]]);
    const { proposed } = buildProposedItems(tasks, norms, catalog);
    const outlet = proposed.find((p) => p.catalogItemId === 'outlet')!;
    expect(outlet.qtyNeeded).toBe(3);
  });

  it('adds warning when no norm found for task type', () => {
    const tasks = [{ type: 'replace_switch', qty: 1, description: 'свитч' }];
    const norms = new Map<string, NormRecord>();
    const { proposed, warnings } = buildProposedItems(tasks, norms, catalog);
    expect(proposed).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('replace_switch');
  });

  it('marks item as unknown if catalog missing', () => {
    const normWithGhost: NormRecord = {
      id: 'g',
      taskType: 'install_fan',
      items: [{ catalogItemId: 'ghost-item', qtyPerUnit: 1 }],
    };
    const tasks = [{ type: 'install_fan', qty: 1, description: 'fan' }];
    const norms = new Map([['install_fan', normWithGhost]]);
    const { proposed, warnings } = buildProposedItems(tasks, norms, catalog);
    expect(proposed).toHaveLength(1);
    expect(proposed[0].warning).toBeDefined();
    expect(warnings.some((w) => w.includes('ghost-item'))).toBe(true);
  });
});

describe('sumEstimatedTotal', () => {
  it('sums only items with estimatedPrice', () => {
    const items = [
      { name: 'a', unit: 'шт', qtyNeeded: 1, qtyOnHand: 0, qtyToBuy: 1, estimatedPrice: 5, source: 'norm' as const },
      { name: 'b', unit: 'шт', qtyNeeded: 1, qtyOnHand: 1, qtyToBuy: 0, source: 'norm' as const },
      { name: 'c', unit: 'шт', qtyNeeded: 2, qtyOnHand: 0, qtyToBuy: 2, estimatedPrice: 3.3, source: 'norm' as const },
    ];
    expect(sumEstimatedTotal(items)).toBe(8.3);
  });

  it('returns 0 for empty', () => {
    expect(sumEstimatedTotal([])).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  GROUP 2 — Firestore interactions
// ═══════════════════════════════════════════════════════════════════

describe('matchNorms', () => {
  it('returns records keyed by taskType', async () => {
    const db = new FakeDb();
    db.seed('inventory_norms', 'n1', {
      taskType: 'install_outlet',
      items: [{ catalogItemId: 'outlet', qtyPerUnit: 1 }],
    });
    db.seed('inventory_norms', 'n2', {
      taskType: 'install_fan',
      items: [{ catalogItemId: 'fan', qtyPerUnit: 1 }],
    });

    const result = await matchNorms(db as any, ['install_outlet', 'install_fan', 'unknown_task']);
    expect(result.size).toBe(2);
    expect(result.get('install_outlet')?.id).toBe('n1');
    expect(result.get('install_fan')?.id).toBe('n2');
    expect(result.has('unknown_task')).toBe(false);
  });

  it('returns empty map for empty input', async () => {
    const db = new FakeDb();
    const result = await matchNorms(db as any, []);
    expect(result.size).toBe(0);
  });

  it('skips norms with invalid items payload', async () => {
    const db = new FakeDb();
    db.seed('inventory_norms', 'bad', { taskType: 'install_outlet', items: 'oops' });
    const result = await matchNorms(db as any, ['install_outlet']);
    expect(result.size).toBe(0);
  });
});

describe('resolveStock', () => {
  it('returns snapshots for existing ids', async () => {
    const db = new FakeDb();
    db.seed('inventory_catalog', 'outlet', {
      name: 'Outlet 15A',
      unit: 'шт',
      avgPrice: 3,
      stockByLocation: { 'van-denis': 2 },
      totalStock: 2,
    });
    const result = await resolveStock(db as any, ['outlet', 'missing']);
    expect(result.size).toBe(1);
    expect(result.get('outlet')?.name).toBe('Outlet 15A');
    expect(result.get('outlet')?.totalStock).toBe(2);
  });

  it('falls back to summing stockByLocation if totalStock missing', async () => {
    const db = new FakeDb();
    db.seed('inventory_catalog', 'wire', {
      name: 'Wire',
      unit: 'м',
      stockByLocation: { 'a': 5, 'b': 10 },
    });
    const result = await resolveStock(db as any, ['wire']);
    expect(result.get('wire')?.totalStock).toBe(15);
  });

  it('returns empty map for empty input', async () => {
    const db = new FakeDb();
    const result = await resolveStock(db as any, []);
    expect(result.size).toBe(0);
  });
});

describe('resolveClient', () => {
  it('resolves unique name match', async () => {
    const db = new FakeDb();
    db.seed('clients', 'c1', { name: 'Jim Dvorkin' });
    db.seed('clients', 'c2', { name: 'Sarah Connors' });
    const out = await resolveClient(db as any, 'Dvorkin');
    expect(out.clientId).toBe('c1');
    expect(out.clientName).toBe('Jim Dvorkin');
  });

  it('returns hint when ambiguous', async () => {
    const db = new FakeDb();
    db.seed('clients', 'c1', { name: 'Jim Dvorkin' });
    db.seed('clients', 'c2', { name: 'Jim Smith' });
    const out = await resolveClient(db as any, 'Jim');
    expect(out.clientId).toBeUndefined();
    expect(out.clientName).toBe('Jim');
  });

  it('returns empty for null hint', async () => {
    const db = new FakeDb();
    const out = await resolveClient(db as any, null);
    expect(out).toEqual({});
  });
});

// ═══════════════════════════════════════════════════════════════════
//  GROUP 3 — Sessions + plan orchestration
// ═══════════════════════════════════════════════════════════════════

function seedNorms(db: FakeDb) {
  db.seed('inventory_norms', 'n_outlet', {
    taskType: 'install_outlet',
    items: [
      { catalogItemId: 'outlet', qtyPerUnit: 1 },
      { catalogItemId: 'wire12', qtyPerUnit: 5 },
    ],
  });
  db.seed('inventory_norms', 'n_switch', {
    taskType: 'replace_switch',
    items: [{ catalogItemId: 'switch', qtyPerUnit: 1 }],
  });
}

function seedCatalog(db: FakeDb) {
  db.seed('inventory_catalog', 'outlet', {
    name: 'Outlet 15A',
    unit: 'шт',
    avgPrice: 3,
    stockByLocation: { 'van-denis': 0 },
    totalStock: 0,
  });
  db.seed('inventory_catalog', 'wire12', {
    name: 'Wire 12 AWG',
    unit: 'м',
    avgPrice: 0.8,
    stockByLocation: { 'van-denis': 20 },
    totalStock: 20,
  });
  db.seed('inventory_catalog', 'switch', {
    name: 'Switch SPST',
    unit: 'шт',
    avgPrice: 2,
    stockByLocation: { 'van-denis': 5 },
    totalStock: 5,
  });
}

describe('buildPlanFromIntent — orchestration', () => {
  const baseIntent: ParsedIntent = {
    destination: { clientHint: 'Dvorkin', addressHint: null },
    plannedDate: 'tomorrow',
    tasks: [
      { type: 'install_outlet', qty: 3, description: 'три розетки' },
      { type: 'replace_switch', qty: 1, description: 'выключатель' },
    ],
  };

  it('produces a valid plan with matched norms + stock', async () => {
    const db = new FakeDb();
    db.seed('clients', 'c1', { name: 'Dvorkin Jim' });
    seedNorms(db);
    seedCatalog(db);

    const plan = await buildPlanFromIntent(
      db as any,
      { userId: 'denis', text: 'test', currentLocationId: 'van-denis' },
      baseIntent,
      'test input'
    );

    expect(plan.tripId).toMatch(/^trip_/);
    expect(plan.destination.clientId).toBe('c1');
    expect(plan.destination.clientName).toBe('Dvorkin Jim');
    expect(plan.plannedDate).toBe('tomorrow');
    expect(plan.parsedTasks).toHaveLength(2);

    // 3 outlets + 15m wire (0 needed, 20 in van) + 1 switch (5 in van)
    const outlet = plan.proposedItems.find((p) => p.catalogItemId === 'outlet')!;
    const wire = plan.proposedItems.find((p) => p.catalogItemId === 'wire12')!;
    const sw = plan.proposedItems.find((p) => p.catalogItemId === 'switch')!;
    expect(outlet.qtyToBuy).toBe(3);
    expect(wire.qtyToBuy).toBe(0);
    expect(sw.qtyToBuy).toBe(0);

    expect(plan.estimatedTotal).toBeDefined();
    expect(plan.estimatedTotal).toBeGreaterThan(0);
    expect(plan.status).toBe('draft');
  });

  it('emits warnings and no items if no norms', async () => {
    const db = new FakeDb();
    seedCatalog(db);
    const plan = await buildPlanFromIntent(
      db as any,
      { userId: 'denis', text: 'test' },
      baseIntent,
      'test'
    );
    expect(plan.proposedItems).toHaveLength(0);
    expect(plan.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it('persists session with activeTrip set to plan', async () => {
    const db = new FakeDb();
    seedNorms(db);
    seedCatalog(db);
    const plan = await buildPlanFromIntent(
      db as any,
      { userId: 'user42', text: 'test', currentLocationId: 'van-denis' },
      baseIntent,
      'test'
    );

    const sessionDoc = await db.collection('warehouse_ai_sessions').doc('user42').get();
    expect(sessionDoc.exists).toBe(true);
    const saved: any = sessionDoc.data();
    expect(saved.activeTrip?.tripId).toBe(plan.tripId);
    expect(saved.activeTrip?.status).toBe('draft');
  });

  it('writes at least one event to warehouse_ai_events', async () => {
    const db = new FakeDb();
    seedNorms(db);
    seedCatalog(db);
    await buildPlanFromIntent(db as any, { userId: 'u1', text: 't' }, baseIntent, 't');
    const evDocs = Array.from(db.listCollection('warehouse_ai_events').docs.values());
    expect(evDocs.length).toBeGreaterThanOrEqual(1);
    expect((evDocs[0] as any).type).toBeDefined();
  });
});

describe('persistSession / confirmTrip / cancelTrip', () => {
  const sample: TripPlan = {
    tripId: 'trip_x',
    originalText: 'sample',
    destination: {},
    plannedDate: null,
    parsedTasks: [],
    proposedItems: [],
    status: 'draft',
    warnings: [],
    createdAtMs: Date.now(),
  };

  it('persistSession writes to user doc', async () => {
    const db = new FakeDb();
    await persistSession(db as any, 'u1', sample);
    const snap = await db.collection('warehouse_ai_sessions').doc('u1').get();
    expect(snap.exists).toBe(true);
    expect((snap.data() as any).activeTrip.tripId).toBe('trip_x');
  });

  it('confirmTrip flips status when tripId matches', async () => {
    const db = new FakeDb();
    await persistSession(db as any, 'u1', sample);
    const r = await confirmTrip(db as any, 'u1', 'trip_x');
    expect(r.status).toBe('confirmed');
    const saved = (await db.collection('warehouse_ai_sessions').doc('u1').get()).data() as any;
    expect(saved.activeTrip.status).toBe('confirmed');
  });

  it('confirmTrip returns not_found when tripId mismatch', async () => {
    const db = new FakeDb();
    await persistSession(db as any, 'u1', sample);
    const r = await confirmTrip(db as any, 'u1', 'other-trip');
    expect(r.status).toBe('not_found');
  });

  it('cancelTrip flips status to cancelled', async () => {
    const db = new FakeDb();
    await persistSession(db as any, 'u1', sample);
    const r = await cancelTrip(db as any, 'u1', 'trip_x');
    expect(r.status).toBe('cancelled');
  });

  it('cancelTrip returns not_found for unknown user', async () => {
    const db = new FakeDb();
    const r = await cancelTrip(db as any, 'unknown-user', 'trip_x');
    expect(r.status).toBe('not_found');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  GROUP 4 — Gemini parseIntent (mocked SDK)
// ═══════════════════════════════════════════════════════════════════

describe('parseIntent (via mocked Gemini)', () => {
  const genContentMock = jest.fn();

  beforeAll(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    jest.mock('@google/generative-ai', () => ({
      GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
        getGenerativeModel: () => ({
          generateContent: genContentMock,
        }),
      })),
    }));
  });

  beforeEach(() => {
    genContentMock.mockReset();
    jest.resetModules();
  });

  function mockGenContentOnce(responseText: string) {
    genContentMock.mockResolvedValueOnce({
      response: { text: () => responseText },
    });
  }

  it('returns ok with intent for valid JSON', async () => {
    mockGenContentOnce(
      JSON.stringify({
        destination: { clientHint: 'Jim', addressHint: null },
        plannedDate: 'tomorrow',
        tasks: [{ type: 'install_outlet', qty: 3, description: 'три розетки' }],
      })
    );
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { parseIntent } = require('../src/services/warehouseAI');
    const r = await parseIntent('завтра к Jim 3 розетки');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.intent.tasks[0].type).toBe('install_outlet');
    }
  });

  it('returns not_a_trip when Gemini flags it', async () => {
    mockGenContentOnce(JSON.stringify({ error: 'not_a_trip' }));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { parseIntent } = require('../src/services/warehouseAI');
    const r = await parseIntent('привет');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_a_trip');
  });

  it('returns too_vague when Gemini flags it', async () => {
    mockGenContentOnce(JSON.stringify({ error: 'too_vague' }));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { parseIntent } = require('../src/services/warehouseAI');
    const r = await parseIntent('надо что-то сделать');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('too_vague');
  });

  it('returns parse_error on invalid JSON', async () => {
    mockGenContentOnce('not-json-at-all');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { parseIntent } = require('../src/services/warehouseAI');
    const r = await parseIntent('test');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('parse_error');
  });

  it('returns too_vague for empty input without calling Gemini', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { parseIntent } = require('../src/services/warehouseAI');
    const r = await parseIntent('   ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('too_vague');
    expect(genContentMock).not.toHaveBeenCalled();
  });
});
