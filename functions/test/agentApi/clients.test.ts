/**
 * Agent API Tests — Clients
 * POST /api/clients · PATCH /api/clients/:id · GET /api/clients/search
 */

import * as request from 'supertest';
import {
  getApp, authHeaders, seedClient, clearAll, db,
} from './testSetup';

let app: any;

beforeAll(async () => {
  app = await getApp();
});

afterEach(async () => {
  await clearAll();
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/clients
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/clients', () => {
  it('creates a client with full data', async () => {
    const res = await request(app)
      .post('/api/clients')
      .set(authHeaders())
      .send({
        name: 'Steve Jobs LLC',
        address: '1 Infinite Loop, CA',
        contactPerson: 'Tim Cook',
        phone: '+1-555-000-0000',
        email: 'tim@apple.com',
        notes: 'VIP client',
        type: 'commercial',
      });

    expect(res.status).toBe(201);
    expect(res.body.clientId).toBeDefined();
    expect(res.body.name).toBe('Steve Jobs LLC');

    // Verify Firestore
    const doc = await db.collection('clients').doc(res.body.clientId).get();
    expect(doc.exists).toBe(true);
    expect(doc.data()?.address).toBe('1 Infinite Loop, CA');
    expect(doc.data()?.status).toBe('active');
  });

  it('creates a client with name only', async () => {
    const res = await request(app)
      .post('/api/clients')
      .set(authHeaders())
      .send({ name: 'Minimal Client' });

    expect(res.status).toBe(201);
    expect(res.body.clientId).toBeDefined();
  });

  it('returns 200 with deduplicated on duplicate idempotencyKey', async () => {
    const key = 'test-idempotency-key-001';

    const res1 = await request(app)
      .post('/api/clients')
      .set(authHeaders())
      .send({ name: 'First Call', idempotencyKey: key });
    expect(res1.status).toBe(201);

    const res2 = await request(app)
      .post('/api/clients')
      .set(authHeaders())
      .send({ name: 'Second Call', idempotencyKey: key });
    expect(res2.status).toBe(200);
    expect(res2.body.deduplicated).toBe(true);
    expect(res2.body.clientId).toBe(res1.body.clientId);
  });

  it('returns 400 when name is empty', async () => {
    const res = await request(app)
      .post('/api/clients')
      .set(authHeaders())
      .send({ name: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });
});

// ═══════════════════════════════════════════════════════════════════
// PATCH /api/clients/:id
// ═══════════════════════════════════════════════════════════════════

describe('PATCH /api/clients/:id', () => {
  it('updates nearbyStores and address', async () => {
    const clientId = await seedClient();

    const res = await request(app)
      .patch(`/api/clients/${clientId}`)
      .set(authHeaders())
      .send({
        nearbyStores: ['Home Depot on 5th', 'Lowes on Congress'],
        address: '999 Updated Ave',
      });

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(true);

    // Verify Firestore
    const doc = await db.collection('clients').doc(clientId).get();
    expect(doc.data()?.nearbyStores).toEqual(['Home Depot on 5th', 'Lowes on Congress']);
    expect(doc.data()?.address).toBe('999 Updated Ave');
  });

  it('returns 404 for non-existent client', async () => {
    const res = await request(app)
      .patch('/api/clients/non-existent-id')
      .set(authHeaders())
      .send({ address: 'New Address' });

    expect(res.status).toBe(404);
  });

  it('returns 400 for empty body', async () => {
    const clientId = await seedClient();

    const res = await request(app)
      .patch(`/api/clients/${clientId}`)
      .set(authHeaders())
      .send({});

    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/clients/search
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/clients/search', () => {
  it('finds client by fuzzy name', async () => {
    await seedClient({ name: 'Johnson Electric LLC' });

    const res = await request(app)
      .get('/api/clients/search?q=Johnson')
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
    expect(res.body.results[0].clientName).toContain('Johnson');
  });

  it('returns 400 when q is too short', async () => {
    const res = await request(app)
      .get('/api/clients/search?q=J')
      .set(authHeaders());

    expect(res.status).toBe(400);
  });
});
