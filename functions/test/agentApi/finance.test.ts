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

  describe('audit log on auto-approve', () => {
    it('writes a reconciliation_audits doc when a finance_rule auto-approves a tx', async () => {
      const cid = await seedClient();
      const pid = await seedProject(cid);

      // Seed an auto-approve rule
      await db.collection('finance_rules').doc('home depot').set({
        merchantName: 'home depot',
        autoApprove: true,
        defaultPaymentType: 'company',
        defaultCategoryId: 'materials',
        defaultProjectId: pid,
      });

      const res = await request(app).post('/api/finance/transactions/batch').set(authHeaders())
        .send({
          transactions: [{
            id: 'tx-rule-1', date: '2026-03-15', rawDescription: 'HOME DEPOT 123',
            cleanMerchant: 'Home Depot', amount: -75,
            paymentType: 'cash', categoryId: 'other',
            projectId: null, confidence: 'low',
          }],
        });
      expect(res.status).toBe(200);
      expect(res.body.autoApproved).toBe(1);

      const audits = await db.collection('reconciliation_audits').get();
      expect(audits.size).toBe(1);
      const a = audits.docs[0].data();
      expect(a.reason).toBe('rule-match');
      expect(a.ruleId).toBe('home depot');
      expect(a.txId).toBe('tx-rule-1');
      expect(a.amount).toBe(-75);
      expect(a.costId).toBeTruthy();
      expect(a.approvedAt).toBeDefined();
    });

    it('writes a reconciliation_audits doc when Tampa-geo auto-approves a tx', async () => {
      const cid = await seedClient();
      // Project name with "tampa" triggers the geo branch
      await seedProject(cid, { name: 'Tampa Project' });

      const res = await request(app).post('/api/finance/transactions/batch').set(authHeaders())
        .send({
          transactions: [{
            id: 'tx-tampa-1', date: '2026-03-15', rawDescription: 'STARBUCKS TAMPA FL',
            cleanMerchant: 'Starbucks', amount: -8.5,
            paymentType: 'cash', categoryId: 'food',
            projectId: null, confidence: 'low',
          }],
        });
      expect(res.status).toBe(200);
      expect(res.body.tampaAutoApproved).toBe(1);

      const audits = await db.collection('reconciliation_audits').get();
      expect(audits.size).toBe(1);
      const a = audits.docs[0].data();
      expect(a.reason).toBe('tampa-geo');
      expect(a.matchedCity).toBe('tampa');
      expect(a.txId).toBe('tx-tampa-1');
      expect(a.projectName).toBe('Tampa Project');
      expect(a.costId).toBeTruthy();
    });
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

  /**
   * Refund-detection sign convention (locks in current behavior).
   *
   * The route uses `isRefund = amount > 0` to decide the sign of the
   * resulting `costs.amount` field:
   *   - input amount  <  0  →  cost.amount = +|amount|   (expense, adds to spend)
   *   - input amount  >  0  →  cost.amount = -|amount|   (refund, reduces spend)
   * `originalAmount` is always stored as +|amount| (unsigned).
   *
   * This convention is correct ONLY when the upstream parser normalizes
   * statements to "negative = expense / positive = credit" (e.g. Chase
   * style). Bank exports that prefix expenses with `DEBIT:` and store
   * amounts as positive numbers (seen in prod 2026-04-25 sample) end up
   * recorded as refunds — a known quirk that has not been resolved.
   *
   * These tests document current behavior so any future change is a
   * deliberate decision, not a silent regression in payroll-sensitive
   * data.
   */
  describe('refund detection sign convention', () => {
    it('treats negative input amount as expense (cost.amount > 0)', async () => {
      const cid = await seedClient();
      const pid = await seedProject(cid);

      await db.collection('bank_transactions').doc('tx-sign-neg').set({
        status: 'draft', date: '2026-03-15',
      });

      const res = await request(app).post('/api/finance/transactions/approve').set(authHeaders())
        .send({
          transactions: [{
            id: 'tx-sign-neg', date: '2026-03-15', rawDescription: 'WITHDRAWAL: ZELLE TO VENDOR',
            cleanMerchant: 'Vendor', amount: -250,
            paymentType: 'company', categoryId: 'materials',
            projectId: pid, confidence: 'high',
          }],
        });
      expect(res.status).toBe(200);

      const txAfter = await db.collection('bank_transactions').doc('tx-sign-neg').get();
      const costId = txAfter.data()?.costId;
      expect(costId).toBeTruthy();

      const cost = await db.collection('costs').doc(costId).get();
      expect(cost.exists).toBe(true);
      expect(cost.data()?.amount).toBe(250);
      expect(cost.data()?.originalAmount).toBe(250);
    });

    it('treats positive input amount as refund (cost.amount < 0)', async () => {
      const cid = await seedClient();
      const pid = await seedProject(cid);

      await db.collection('bank_transactions').doc('tx-sign-pos').set({
        status: 'draft', date: '2026-03-15',
      });

      const res = await request(app).post('/api/finance/transactions/approve').set(authHeaders())
        .send({
          transactions: [{
            id: 'tx-sign-pos', date: '2026-03-15', rawDescription: 'DEBIT: PARKING REFUND',
            cleanMerchant: 'Parking', amount: 50,
            paymentType: 'company', categoryId: 'parking',
            projectId: pid, confidence: 'high',
          }],
        });
      expect(res.status).toBe(200);

      const txAfter = await db.collection('bank_transactions').doc('tx-sign-pos').get();
      const costId = txAfter.data()?.costId;
      expect(costId).toBeTruthy();

      const cost = await db.collection('costs').doc(costId).get();
      expect(cost.exists).toBe(true);
      expect(cost.data()?.amount).toBe(-50);
      expect(cost.data()?.originalAmount).toBe(50);
    });
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
