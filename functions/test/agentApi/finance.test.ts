/**
 * Agent API Tests — Finance
 * GET /api/finance/context · POST /api/finance/transactions/batch
 * POST /api/finance/transactions/approve · POST /api/finance/transactions/undo
 */

import * as request from 'supertest';
import {
  getApp, authHeaders, seedClient, seedProject, clearAll, db,
} from './testSetup';

let app: any;

beforeAll(async () => { app = await getApp(); });
afterEach(async () => { await clearAll(); });

describe('GET /api/finance/context', () => {
  it('returns projects, categories, and rules', async () => {
    const cid = await seedClient();
    await seedProject(cid, { status: 'active' });

    const res = await request(app).get('/api/finance/context').set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.categories).toBeInstanceOf(Array);
    expect(res.body.categories.length).toBeGreaterThan(0);
    expect(res.body.projects).toBeInstanceOf(Array);
  });
});

describe('POST /api/finance/transactions/batch', () => {
  it('creates draft transactions', async () => {
    const res = await request(app).post('/api/finance/transactions/batch').set(authHeaders())
      .send({
        transactions: [
          {
            id: 'tx-001', date: '2026-03-15', rawDescription: 'HOME DEPOT',
            cleanMerchant: 'Home Depot', amount: -125.99,
            paymentType: 'company', categoryId: 'materials',
            projectId: null, confidence: 'high',
          },
          {
            id: 'tx-002', date: '2026-03-16', rawDescription: 'SHELL GAS',
            cleanMerchant: 'Shell', amount: -65.00,
            paymentType: 'company', categoryId: 'fuel',
            projectId: null, confidence: 'low',
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(2);

    // Verify in Firestore
    const doc = await db.collection('bank_transactions').doc('tx-001').get();
    expect(doc.exists).toBe(true);
    expect(doc.data()?.status).toBe('draft');
  });

  it('skips already approved transactions', async () => {
    // Pre-seed an approved transaction
    await db.collection('bank_transactions').doc('tx-approved').set({
      status: 'approved',
      date: '2026-03-15',
    });

    const res = await request(app).post('/api/finance/transactions/batch').set(authHeaders())
      .send({
        transactions: [
          {
            id: 'tx-approved', date: '2026-03-15', rawDescription: 'OLD',
            cleanMerchant: 'Old', amount: -10,
            paymentType: 'company', categoryId: 'other', confidence: 'high',
          },
        ],
      });

    expect(res.status).toBe(200);
    // count should be 0 since it was skipped
    expect(res.body.count).toBe(0);
  });
});

describe('POST /api/finance/transactions/approve', () => {
  it('creates costs and finance rules on approval', async () => {
    const cid = await seedClient();
    const pid = await seedProject(cid);

    // First batch a draft
    await db.collection('bank_transactions').doc('tx-approve-1').set({
      status: 'draft', date: '2026-03-15',
    });

    const res = await request(app).post('/api/finance/transactions/approve').set(authHeaders())
      .send({
        transactions: [{
          id: 'tx-approve-1', date: '2026-03-15', rawDescription: 'LOWES',
          cleanMerchant: 'Lowes', amount: -200,
          paymentType: 'company', categoryId: 'materials',
          projectId: pid, confidence: 'high',
        }],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify bank_transaction status
    const tx = await db.collection('bank_transactions').doc('tx-approve-1').get();
    expect(tx.data()?.status).toBe('approved');

    // Verify finance_rule created
    const rule = await db.collection('finance_rules').doc('lowes').get();
    expect(rule.exists).toBe(true);
    expect(rule.data()?.defaultCategoryId).toBe('materials');
  });
});

describe('POST /api/finance/transactions/undo', () => {
  it('reverts approved transactions to draft and deletes costs', async () => {
    // Seed approved tx with costId
    const costRef = db.collection('costs').doc();
    await costRef.set({ amount: 100, status: 'confirmed' });

    await db.collection('bank_transactions').doc('tx-undo-1').set({
      status: 'approved',
      costId: costRef.id,
    });

    const res = await request(app).post('/api/finance/transactions/undo').set(authHeaders())
      .send({ transactionIds: ['tx-undo-1'] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Check tx reverted to draft
    const tx = await db.collection('bank_transactions').doc('tx-undo-1').get();
    expect(tx.data()?.status).toBe('draft');

    // Check cost deleted
    const cost = await costRef.get();
    expect(cost.exists).toBe(false);
  });
});
