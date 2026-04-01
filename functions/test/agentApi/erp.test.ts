/**
 * Agent API Tests — ERP (Change Orders, Purchase Orders, Plan vs Fact)
 */

import * as request from 'supertest';
import {
  getApp, authHeaders, seedClient, seedProject, seedEstimate, clearAll, db, admin,
} from './testSetup';

let app: any;

beforeAll(async () => { app = await getApp(); });
afterEach(async () => { await clearAll(); });

// Seed owner user for companyId resolution
async function seedOwnerProfile() {
  await db.collection('users').doc('test-owner-uid').set({
    displayName: 'Owner', role: 'owner', companyId: 'test-company-id',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

describe('POST /api/change-orders', () => {
  it('creates a change order with auto-numbered CO', async () => {
    await seedOwnerProfile();
    const cid = await seedClient();
    const pid = await seedProject(cid);
    const eid = await seedEstimate(cid);

    const res = await request(app).post('/api/change-orders').set(authHeaders())
      .send({
        projectId: pid, projectName: 'Test Project',
        clientId: cid, clientName: 'Test Client',
        parentEstimateId: eid,
        title: 'Add outlets in kitchen',
        items: [{
          id: 'co-item-1', description: 'GFCI Outlet', type: 'material',
          quantity: 5, unit: 'pcs',
          unitCostPrice: 12, totalCost: 60,
          unitClientPrice: 18, totalClientPrice: 90, markupPercent: 50,
        }],
        defaultMarkupPercent: 20,
      });

    expect(res.status).toBe(201);
    expect(res.body.changeOrderId).toBeDefined();
    expect(res.body.number).toMatch(/^CO-/);
  });
});

describe('GET /api/change-orders', () => {
  it('lists change orders', async () => {
    await seedOwnerProfile();
    const cid = await seedClient();
    const pid = await seedProject(cid);

    // Seed a CO directly
    await db.collection(`companies/test-company-id/change_orders`).add({
      companyId: 'test-company-id', projectId: pid, clientId: cid,
      clientName: 'Test', projectName: 'Test', title: 'CO Test',
      number: 'CO-001', status: 'draft', items: [],
      internalTotal: 0, clientTotal: 0, markupTotal: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const res = await request(app)
      .get(`/api/change-orders?clientId=${cid}`)
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.changeOrders.length).toBeGreaterThanOrEqual(1);
  });
});

describe('PATCH /api/change-orders/:id', () => {
  it('approves CO and sets approvedAt', async () => {
    await seedOwnerProfile();
    const ref = await db.collection('companies/test-company-id/change_orders').add({
      companyId: 'test-company-id', status: 'draft', title: 'Test CO',
      items: [], internalTotal: 0, clientTotal: 0, markupTotal: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const res = await request(app)
      .patch(`/api/change-orders/${ref.id}`)
      .set(authHeaders())
      .send({ status: 'approved' });

    expect(res.status).toBe(200);
    const doc = await ref.get();
    expect(doc.data()?.status).toBe('approved');
    expect(doc.data()?.approvedAt).toBeDefined();
  });
});

describe('POST /api/purchase-orders', () => {
  it('creates PO with variance calculation', async () => {
    await seedOwnerProfile();
    const cid = await seedClient();
    const pid = await seedProject(cid);

    const res = await request(app).post('/api/purchase-orders').set(authHeaders())
      .send({
        projectId: pid, projectName: 'Test', clientId: cid, clientName: 'Test',
        vendor: 'Home Depot', category: 'materials', status: 'received',
        items: [{
          id: 'po-1', description: 'Wire 12AWG', quantity: 100, unit: 'ft',
          unitPrice: 1.50, total: 150, plannedUnitPrice: 1.20,
        }],
        plannedTotal: 120,
      });

    expect(res.status).toBe(201);
    expect(res.body.purchaseOrderId).toBeDefined();
    expect(res.body.total).toBe(150);
  });
});

describe('GET /api/purchase-orders', () => {
  it('lists POs with sum', async () => {
    await seedOwnerProfile();
    const cid = await seedClient();
    const pid = await seedProject(cid);

    await db.collection('companies/test-company-id/purchase_orders').add({
      companyId: 'test-company-id', projectId: pid, clientId: cid,
      clientName: 'Test', projectName: 'Test', vendor: 'Lowes',
      category: 'materials', subtotal: 100, total: 108, items: [],
      status: 'received',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const res = await request(app)
      .get(`/api/purchase-orders?clientId=${cid}`)
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.purchaseOrders.length).toBeGreaterThanOrEqual(1);
    expect(res.body.sum).toBeDefined();
  });
});

describe('GET /api/plan-vs-fact', () => {
  it('returns planned/actual/variance breakdown', async () => {
    const cid = await seedClient();

    // Seed an approved estimate (planned)
    await seedEstimate(cid, { status: 'approved', subtotal: 1000, total: 1000, companyId: 'test-company-id' });

    // Seed a cost (actual)
    await db.collection('costs').add({
      clientId: cid, amount: 500, category: 'materials', status: 'confirmed',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const res = await request(app)
      .get(`/api/plan-vs-fact?clientId=${cid}`)
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.planned).toBeDefined();
    expect(res.body.actual).toBeDefined();
    expect(res.body.variance).toBeDefined();
    expect(res.body.margin).toBeDefined();
  });

  it('includes alerts when over budget', async () => {
    const cid = await seedClient();
    await seedEstimate(cid, { status: 'approved', subtotal: 100, total: 100, companyId: 'test-company-id' });

    // Seed large actual cost (over budget)
    await db.collection('costs').add({
      clientId: cid, amount: 500, category: 'materials', status: 'confirmed',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const res = await request(app)
      .get(`/api/plan-vs-fact?clientId=${cid}`)
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.alerts.length).toBeGreaterThan(0);
  });
});
