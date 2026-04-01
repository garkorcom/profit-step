/**
 * Agent API Tests — Costs
 * POST /api/costs · GET /api/costs/list · DELETE /api/costs/:id
 */

import * as request from 'supertest';
import {
  getApp, authHeaders, seedClient, seedCost, clearAll, db,
} from './testSetup';

let app: any;

beforeAll(async () => { app = await getApp(); });
afterEach(async () => { await clearAll(); });

describe('POST /api/costs', () => {
  it('creates a materials cost', async () => {
    const cid = await seedClient();
    const res = await request(app).post('/api/costs').set(authHeaders())
      .send({ clientId: cid, clientName: 'Test', category: 'materials', amount: 127.50, description: 'Wire 12AWG' });

    expect(res.status).toBe(201);
    expect(res.body.costId).toBeDefined();
  });

  it('stores reimbursement as negative amount', async () => {
    const cid = await seedClient();
    const res = await request(app).post('/api/costs').set(authHeaders())
      .send({ clientId: cid, clientName: 'Test', category: 'reimbursement', amount: 50 });

    expect(res.status).toBe(201);
    const doc = await db.collection('costs').doc(res.body.costId).get();
    expect(doc.data()?.amount).toBeLessThan(0);
  });

  it('deduplicates via idempotencyKey', async () => {
    const cid = await seedClient();
    const payload = { clientId: cid, clientName: 'Test', category: 'fuel', amount: 65, idempotencyKey: 'cost-dup-1' };
    const r1 = await request(app).post('/api/costs').set(authHeaders()).send(payload);
    expect(r1.status).toBe(201);

    const r2 = await request(app).post('/api/costs').set(authHeaders()).send(payload);
    expect(r2.status).toBe(200);
    expect(r2.body.deduplicated).toBe(true);
  });

  it('rejects missing required fields', async () => {
    const res = await request(app).post('/api/costs').set(authHeaders())
      .send({ category: 'materials' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/costs/list', () => {
  it('filters by category', async () => {
    const cid = await seedClient();
    await seedCost(cid, { category: 'materials', amount: 100 });
    await seedCost(cid, { category: 'fuel', amount: 50 });

    const res = await request(app).get(`/api/costs/list?clientId=${cid}&category=materials`).set(authHeaders());
    expect(res.status).toBe(200);
    res.body.costs.forEach((c: any) => expect(c.category).toBe('materials'));
  });

  it('returns correct sum.byCategory', async () => {
    const cid = await seedClient();
    await seedCost(cid, { category: 'materials', amount: 100 });
    await seedCost(cid, { category: 'materials', amount: 200 });
    await seedCost(cid, { category: 'fuel', amount: 50 });

    const res = await request(app).get(`/api/costs/list?clientId=${cid}`).set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.sum.byCategory.materials).toBe(300);
    expect(res.body.sum.byCategory.fuel).toBe(50);
  });

  it('filters by date range', async () => {
    const cid = await seedClient();
    await seedCost(cid);
    const res = await request(app)
      .get(`/api/costs/list?clientId=${cid}&from=2026-01-01&to=2026-12-31`)
      .set(authHeaders());
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/costs/:id', () => {
  it('voids the cost (soft delete)', async () => {
    const cid = await seedClient();
    const costId = await seedCost(cid);

    const res = await request(app).delete(`/api/costs/${costId}`).set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.voided).toBe(true);

    const doc = await db.collection('costs').doc(costId).get();
    expect(doc.data()?.status).toBe('voided');
  });

  it('returns 400 for already voided', async () => {
    const cid = await seedClient();
    const costId = await seedCost(cid, { status: 'voided' });

    const res = await request(app).delete(`/api/costs/${costId}`).set(authHeaders());
    expect(res.status).toBe(400);
  });
});
