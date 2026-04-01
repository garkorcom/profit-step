/**
 * Agent API Tests — Estimates
 * POST /api/estimates · GET /api/estimates/list · PATCH /api/estimates/:id · POST /api/estimates/:id/convert-to-tasks
 */

import * as request from 'supertest';
import {
  getApp, authHeaders, seedClient, seedEstimate, clearAll, db,
} from './testSetup';

let app: any;

beforeAll(async () => { app = await getApp(); });
afterEach(async () => { await clearAll(); });

describe('POST /api/estimates', () => {
  it('creates estimate with items and taxRate', async () => {
    const cid = await seedClient();
    const res = await request(app).post('/api/estimates').set(authHeaders())
      .send({
        clientId: cid,
        items: [
          { id: 'i1', description: 'Outlet', quantity: 10, unitPrice: 15, total: 150, type: 'material' },
          { id: 'i2', description: 'Labor', quantity: 4, unitPrice: 50, total: 200, type: 'labor' },
        ],
        taxRate: 8.25,
      });

    expect(res.status).toBe(201);
    expect(res.body.estimateId).toBeDefined();
    expect(res.body.number).toMatch(/^EST-/);
    // subtotal 350 + 8.25% tax = 378.88
    expect(res.body.total).toBeCloseTo(378.88, 1);
  });

  it('auto-creates client by address when no clientId', async () => {
    const res = await request(app).post('/api/estimates').set(authHeaders())
      .send({
        address: '999 Auto-Created Ave',
        items: [{ id: 'i1', description: 'Test', quantity: 1, unitPrice: 100, total: 100, type: 'material' }],
      });

    expect(res.status).toBe(201);
    // Check client was created
    const snap = await db.collection('clients')
      .where('address', '==', '999 Auto-Created Ave').get();
    expect(snap.empty).toBe(false);
  });

  it('deduplicates via idempotencyKey', async () => {
    const cid = await seedClient();
    const payload = {
      clientId: cid,
      items: [{ id: 'i1', description: 'X', quantity: 1, unitPrice: 10, total: 10, type: 'material' }],
      idempotencyKey: 'est-dup-1',
    };
    const r1 = await request(app).post('/api/estimates').set(authHeaders()).send(payload);
    expect(r1.status).toBe(201);

    const r2 = await request(app).post('/api/estimates').set(authHeaders()).send(payload);
    expect(r2.status).toBe(200);
    expect(r2.body.deduplicated).toBe(true);
  });

  it('returns 400 without items', async () => {
    const cid = await seedClient();
    const res = await request(app).post('/api/estimates').set(authHeaders())
      .send({ clientId: cid, items: [] });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/estimates/list', () => {
  it('lists estimates filtered by status', async () => {
    const cid = await seedClient();
    await seedEstimate(cid, { status: 'draft' });
    await seedEstimate(cid, { status: 'sent' });

    const res = await request(app)
      .get(`/api/estimates/list?clientId=${cid}&status=draft`)
      .set(authHeaders());
    expect(res.status).toBe(200);
    res.body.estimates.forEach((e: any) => expect(e.status).toBe('draft'));
  });
});

describe('PATCH /api/estimates/:id', () => {
  it('recalculates total when items are updated', async () => {
    const cid = await seedClient();
    const eid = await seedEstimate(cid, { taxRate: 10 });

    const res = await request(app).patch(`/api/estimates/${eid}`).set(authHeaders())
      .send({
        items: [
          { id: 'new-1', description: 'Big Job', quantity: 1, unitPrice: 1000, total: 1000, type: 'labor' },
        ],
      });

    expect(res.status).toBe(200);
    const doc = await db.collection('estimates').doc(eid).get();
    expect(doc.data()?.subtotal).toBe(1000);
    expect(doc.data()?.total).toBe(1100); // 1000 + 10%
  });

  it('updates status to approved', async () => {
    const cid = await seedClient();
    const eid = await seedEstimate(cid);

    const res = await request(app).patch(`/api/estimates/${eid}`).set(authHeaders())
      .send({ status: 'approved' });
    expect(res.status).toBe(200);
    const doc = await db.collection('estimates').doc(eid).get();
    expect(doc.data()?.status).toBe('approved');
  });
});

describe('POST /api/estimates/:id/convert-to-tasks', () => {
  it('creates parent + child tasks', async () => {
    const cid = await seedClient();
    const eid = await seedEstimate(cid);

    const res = await request(app)
      .post(`/api/estimates/${eid}/convert-to-tasks`)
      .set(authHeaders());
    expect(res.status).toBe(201);
    expect(res.body.parentTaskId).toBeDefined();
    expect(res.body.taskCount).toBeGreaterThanOrEqual(2); // parent + at least 1 child

    // Estimate should now be 'converted'
    const doc = await db.collection('estimates').doc(eid).get();
    expect(doc.data()?.status).toBe('converted');
  });

  it('returns 409 for already converted', async () => {
    const cid = await seedClient();
    const eid = await seedEstimate(cid, { status: 'converted', convertedToTaskId: 'old' });

    const res = await request(app)
      .post(`/api/estimates/${eid}/convert-to-tasks`)
      .set(authHeaders());
    expect(res.status).toBe(409);
  });
});
