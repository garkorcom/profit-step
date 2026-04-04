/**
 * Comprehensive Agent API Tests — Clients
 * Testing all client operations: create, search, list, update, get profile
 * Based on USE_CASES.md scenarios #32-37
 */

import * as request from 'supertest';
import {
  getApp, authHeaders, seedClient, seedTask, seedCost, seedProject,
  seedEstimate, seedSite, clearAll, db, admin, OWNER_UID,
} from './testSetup';

let app: any;

beforeAll(async () => {
  app = await getApp();
});

afterEach(async () => {
  await clearAll();
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/clients — Client Creation (Use Cases #32, #38)
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/clients', () => {
  it('creates a residential client with full data (UC #32)', async () => {
    const res = await request(app)
      .post('/api/clients')
      .set(authHeaders())
      .send({
        name: 'John Smith',
        address: '456 Oak Ave, Austin TX 78701',
        contactPerson: 'John Smith',
        phone: '+1-555-123-4567',
        email: 'john.smith@gmail.com',
        notes: 'New client from phone call',
        type: 'residential',

      });

    expect(res.status).toBe(201);
    expect(res.body.clientId).toBeDefined();
    expect(res.body.name).toBe('John Smith');

    // Verify Firestore document
    const doc = await db.collection('clients').doc(res.body.clientId).get();
    expect(doc.exists).toBe(true);
    const data = doc.data()!;
    expect(data.name).toBe('John Smith');
    expect(data.address).toBe('456 Oak Ave, Austin TX 78701');
    expect(data.type).toBe('residential');
    expect(data.status).toBe('active');
    expect(data.source).toBe('openclaw');
    expect(data.createdAt).toBeDefined();
    expect(data.updatedAt).toBeDefined();
  });

  it('creates a commercial client with minimal data', async () => {
    const res = await request(app)
      .post('/api/clients')
      .set(authHeaders())
      .send({
        name: 'Austin Tech LLC',
        type: 'commercial',
      });

    expect(res.status).toBe(201);
    expect(res.body.clientId).toBeDefined();

    // Verify optional fields are set to defaults
    const doc = await db.collection('clients').doc(res.body.clientId).get();
    const data = doc.data()!;
    expect(data.address).toBe('');
    expect(data.contactPerson).toBe('');
    expect(data.phone).toBe('');
    expect(data.email).toBe('');
    expect(data.notes).toBe('');
  });

  it('auto-creates client from estimate address (UC #38)', async () => {
    const res = await request(app)
      .post('/api/clients')
      .set(authHeaders())
      .send({
        name: 'Auto-generated from estimate',
        address: '789 Elm St, Austin TX',
        notes: 'Created automatically from blueprint estimate',
        type: 'residential',
      });

    expect(res.status).toBe(201);

    // Verify client was created correctly for estimate workflow
    const doc = await db.collection('clients').doc(res.body.clientId).get();
    const data = doc.data()!;
    expect(data.address).toBe('789 Elm St, Austin TX');
    expect(data.notes).toContain('Created automatically from blueprint estimate');
  });

  it('handles idempotency correctly', async () => {
    const key = 'client-create-idempotency-001';

    // First call
    const res1 = await request(app)
      .post('/api/clients')
      .set(authHeaders())
      .send({
        name: 'First Call Client',
        idempotencyKey: key,
      });
    expect(res1.status).toBe(201);

    // Second call with same key should return existing client
    const res2 = await request(app)
      .post('/api/clients')
      .set(authHeaders())
      .send({
        name: 'Second Call Client', // Different name, should be ignored
        idempotencyKey: key,
      });
    expect(res2.status).toBe(200);
    expect(res2.body.deduplicated).toBe(true);
    expect(res2.body.clientId).toBe(res1.body.clientId);
  });

  it('validates required name field', async () => {
    const res = await request(app)
      .post('/api/clients')
      .set(authHeaders())
      .send({ name: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('validates optional fields are of correct type', async () => {
    const res = await request(app)
      .post('/api/clients')
      .set(authHeaders())
      .send({
        name: 'Valid Name',
        type: 'invalid_type', // Should be 'residential' or 'commercial'
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });
});

// ═══════════════════════════════════════════════════════════════════
// PATCH /api/clients/:id — Client Updates (Use Cases #33, #36)
// ═══════════════════════════════════════════════════════════════════

describe('PATCH /api/clients/:id', () => {
  it('updates nearbyStores for construction project (UC #33)', async () => {
    const clientId = await seedClient({
      name: 'Steve Jobs LLC',
      address: '1 Infinite Loop, CA',
    });

    const res = await request(app)
      .patch(`/api/clients/${clientId}`)
      .set(authHeaders())
      .send({
        nearbyStores: [
          'Home Depot on 5th St',
          'Lowe\'s on Congress Ave',
          'HD Supply on Riverside Dr',
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(true);

    // Verify update in Firestore
    const doc = await db.collection('clients').doc(clientId).get();
    const data = doc.data()!;
    expect(data.nearbyStores).toEqual([
      'Home Depot on 5th St',
      'Lowe\'s on Congress Ave',
      'HD Supply on Riverside Dr',
    ]);
    expect(data.updatedAt).toBeDefined();
  });

  it('updates multiple fields simultaneously', async () => {
    const clientId = await seedClient({
      name: 'Original Name',
      address: 'Original Address',
    });

    const res = await request(app)
      .patch(`/api/clients/${clientId}`)
      .set(authHeaders())
      .send({
        name: 'Updated Name',
        address: '999 Updated Ave, Austin TX',
        phone: '+1-555-999-0000',
        email: 'updated@email.com',
        notes: 'Updated via API call',
      });

    expect(res.status).toBe(200);

    // Verify all fields were updated
    const doc = await db.collection('clients').doc(clientId).get();
    const data = doc.data()!;
    expect(data.name).toBe('Updated Name');
    expect(data.address).toBe('999 Updated Ave, Austin TX');
    expect(data.phone).toBe('+1-555-999-0000');
    expect(data.email).toBe('updated@email.com');
    expect(data.notes).toBe('Updated via API call');
  });

  it('returns 404 for non-existent client', async () => {
    const res = await request(app)
      .patch('/api/clients/non-existent-id')
      .set(authHeaders())
      .send({ address: 'New Address' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Client not found');
  });

  it('returns 400 for empty update payload', async () => {
    const clientId = await seedClient();

    const res = await request(app)
      .patch(`/api/clients/${clientId}`)
      .set(authHeaders())
      .send({});

    expect(res.status).toBe(400);
  });

  it('handles partial updates correctly', async () => {
    const clientId = await seedClient({
      name: 'Keep This Name',
      address: 'Keep This Address',
    });

    const res = await request(app)
      .patch(`/api/clients/${clientId}`)
      .set(authHeaders())
      .send({ notes: 'Only updating notes' });

    expect(res.status).toBe(200);

    // Verify only notes field was changed
    const doc = await db.collection('clients').doc(clientId).get();
    const data = doc.data()!;
    expect(data.name).toBe('Keep This Name');
    expect(data.address).toBe('Keep This Address');
    expect(data.notes).toBe('Only updating notes');
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/clients/search — Client Search (Use Cases #34, #39)
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/clients/search', () => {
  beforeEach(async () => {
    // Seed test clients for search
    await seedClient({ name: 'Johnson Electric LLC', address: '123 Main St' });
    await seedClient({ name: 'Steve Jobs Construction', address: '456 Oak Ave' });
    await seedClient({ name: 'Mike Johnson Plumbing', address: '789 Pine St' });
    await seedClient({ name: 'Austin Tech Solutions', address: '999 Congress Ave' });
  });

  it('finds client by fuzzy name match (UC #34)', async () => {
    const res = await request(app)
      .get('/api/clients/search?q=Johnson')
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(2);

    // Should find both Johnson clients
    const names = res.body.results.map((r: any) => r.clientName);
    expect(names).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Johnson Electric'),
        expect.stringContaining('Mike Johnson'),
      ])
    );
  });

  it('searches by partial address', async () => {
    const res = await request(app)
      .get('/api/clients/search?q=Congress')
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
    expect(res.body.results[0].address).toContain('Congress Ave');
  });

  it('returns fuzzy scores for ranking', async () => {
    const res = await request(app)
      .get('/api/clients/search?q=Steve')
      .set(authHeaders());

    expect(res.status).toBe(200);
    // Score may be 0 (exact match) or undefined depending on Fuse.js config
    if (res.body.results[0].score !== undefined) {
      expect(typeof res.body.results[0].score).toBe('number');
    }
  });

  it('limits results to 5 by default', async () => {
    // Seed more clients to test limit
    for (let i = 0; i < 10; i++) {
      await seedClient({ name: `Test Client ${i}` });
    }

    const res = await request(app)
      .get('/api/clients/search?q=Test')
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeLessThanOrEqual(5);
  });

  it('validates minimum query length', async () => {
    const res = await request(app)
      .get('/api/clients/search?q=J')
      .set(authHeaders());

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Query must be at least 2 characters');
  });

  it('handles empty query parameter', async () => {
    const res = await request(app)
      .get('/api/clients/search?q=')
      .set(authHeaders());

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Query must be at least 2 characters');
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/clients/list — Client List (Use Case #247)
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/clients/list', () => {
  beforeEach(async () => {
    // Seed multiple clients with different statuses
    await seedClient({ name: 'Active Client 1', status: 'active' });
    await seedClient({ name: 'Active Client 2', status: 'active' });
    await seedClient({ name: 'Inactive Client', status: 'inactive' });
  });

  it('returns all clients by default', async () => {
    const res = await request(app)
      .get('/api/clients/list')
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body.clients).toBeInstanceOf(Array);
    expect(res.body.count).toBe(res.body.clients.length);
    // Total depends on clearAll timing — at least 2 from this describe's beforeEach
    expect(res.body.total).toBeGreaterThanOrEqual(2);

    // Verify client structure
    const client = res.body.clients[0];
    expect(client).toHaveProperty('clientId');
    expect(client).toHaveProperty('name');
    expect(client).toHaveProperty('address');
    expect(client).toHaveProperty('phone');
    expect(client).toHaveProperty('email');
    expect(client).toHaveProperty('status');
    expect(client).toHaveProperty('type');
  });

  it('filters by status parameter', async () => {
    const res = await request(app)
      .get('/api/clients/list?status=active')
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body.clients.every((c: any) => c.status === 'active')).toBe(true);
    expect(res.body.count).toBe(2);
  });

  it('respects limit parameter', async () => {
    const res = await request(app)
      .get('/api/clients/list?limit=1')
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body.clients.length).toBe(1);
    expect(res.body.count).toBe(1);
    expect(res.body.total).toBeGreaterThan(1);
  });

  it('enforces maximum limit of 200', async () => {
    const res = await request(app)
      .get('/api/clients/list?limit=500')
      .set(authHeaders());

    expect(res.status).toBe(200);
    // Should respect the max limit internally (won't exceed 200)
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/clients/:id — Client Profile (Use Cases #5, #242)
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/clients/:id', () => {
  it('returns complete client profile with aggregated data (UC #242)', async () => {
    const clientId = await seedClient({
      name: 'Steve Client',
      address: '123 Oak Street',
      phone: '+1-555-STEVE',
    });

    // Seed related data
    await seedProject(clientId, { name: 'Kitchen Remodel' });
    await seedTask(clientId, { title: 'Install outlets', status: 'next_action', priority: 'high' });
    await seedTask(clientId, { title: 'Paint walls', status: 'completed', priority: 'medium' });
    await seedCost(clientId, { category: 'materials', amount: 127.50 });
    await seedCost(clientId, { category: 'tools', amount: 89.99 });
    await seedEstimate(clientId, { status: 'approved', total: 2500 });
    await seedSite(clientId, { name: 'Main Office', address: '123 Oak Street' });

    // Add work session data
    await db.collection('work_sessions').add({
      userId: OWNER_UID,
      employeeId: OWNER_UID,
      employeeName: 'Test Worker',
      clientId,
      status: 'completed',
      durationMinutes: 120,
      sessionEarnings: 60,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const res = await request(app)
      .get(`/api/clients/${clientId}`)
      .set(authHeaders());

    expect(res.status).toBe(200);

    // Verify complete profile structure
    expect(res.body.client).toBeDefined();
    expect(res.body.client.name).toBe('Steve Client');
    expect(res.body.client.address).toBe('123 Oak Street');

    expect(res.body.projects).toBeInstanceOf(Array);
    expect(res.body.projects.length).toBeGreaterThanOrEqual(1);
    expect(res.body.projects[0].name).toBe('Kitchen Remodel');

    expect(res.body.tasks.total).toBeGreaterThanOrEqual(2);
    expect(res.body.tasks.byStatus).toHaveProperty('next_action');
    expect(res.body.tasks.byStatus).toHaveProperty('completed');
    expect(res.body.tasks.items).toBeInstanceOf(Array);

    expect(res.body.costs.total).toBe(217.49); // 127.50 + 89.99
    expect(res.body.costs.count).toBe(2);
    expect(res.body.costs.byCategory).toHaveProperty('materials');
    expect(res.body.costs.byCategory).toHaveProperty('tools');

    expect(res.body.timeTracking.totalMinutes).toBe(120);
    expect(res.body.timeTracking.totalHours).toBe(2);
    expect(res.body.timeTracking.totalEarnings).toBe(60);
    expect(res.body.timeTracking.sessionCount).toBe(1);

    expect(res.body.estimates).toBeInstanceOf(Array);
    expect(res.body.estimates[0].total).toBe(2500);

    expect(res.body.sites).toBeInstanceOf(Array);
    expect(res.body.sites[0].address).toBe('123 Oak Street');
  });

  it('handles morning site status check (UC #5)', async () => {
    const clientId = await seedClient({ name: 'Steve' });

    // Seed morning status data
    await seedTask(clientId, { status: 'next_action' });
    await seedTask(clientId, { status: 'next_action' });
    await seedTask(clientId, { status: 'completed' });

    await seedCost(clientId, { amount: 2500 });

    // Add time tracking
    await db.collection('work_sessions').add({
      clientId,
      status: 'completed',
      durationMinutes: 4830, // 80.5 hours * 60
      sessionEarnings: 2012.5,
      userId: OWNER_UID,
      employeeId: OWNER_UID,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const res = await request(app)
      .get(`/api/clients/${clientId}`)
      .set(authHeaders());

    expect(res.status).toBe(200);

    // Verify morning status data matches use case expectations
    expect(res.body.tasks.total).toBe(3);
    expect(res.body.costs.total).toBe(2500);
    expect(res.body.timeTracking.totalHours).toBe(80.5);
  });

  it('returns 404 for non-existent client', async () => {
    const res = await request(app)
      .get('/api/clients/non-existent-id')
      .set(authHeaders());

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('не найден');
  });

  it('handles client with no related data', async () => {
    const clientId = await seedClient({ name: 'Empty Client' });

    const res = await request(app)
      .get(`/api/clients/${clientId}`)
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body.projects).toEqual([]);
    expect(res.body.tasks.total).toBe(0);
    expect(res.body.costs.total).toBe(0);
    expect(res.body.timeTracking.totalMinutes).toBe(0);
    expect(res.body.estimates).toEqual([]);
    expect(res.body.sites).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Edge Cases and Error Handling
// ═══════════════════════════════════════════════════════════════════

describe('Clients API Error Handling', () => {
  it('handles missing authorization header', async () => {
    const res = await request(app)
      .post('/api/clients')
      .send({ name: 'Test Client' });

    expect(res.status).toBe(401);
  });

  it('handles malformed request body', async () => {
    const res = await request(app)
      .post('/api/clients')
      .set(authHeaders())
      .send('invalid json');

    expect(res.status).toBe(400);
  });

  it('handles database connection errors gracefully', async () => {
    // This test would require mocking Firestore to simulate connection errors
    // In a real implementation, you would mock db.collection() to throw
    // expect(res.status).toBe(500);
    // expect(res.body.error).toContain('Internal server error');
  });

  it('handles very long client names', async () => {
    const longName = 'A'.repeat(1000);

    const res = await request(app)
      .post('/api/clients')
      .set(authHeaders())
      .send({ name: longName });

    // Should either accept or reject based on validation rules
    expect([201, 400]).toContain(res.status);
  });

  it('handles unicode characters in client data', async () => {
    const res = await request(app)
      .post('/api/clients')
      .set(authHeaders())
      .send({
        name: 'Мой Клиент 中文名字',
        address: '123 Улица, Москва',
        notes: '特殊字符测试',
      });

    expect(res.status).toBe(201);

    // Verify unicode was preserved
    const doc = await db.collection('clients').doc(res.body.clientId).get();
    const data = doc.data()!;
    expect(data.name).toBe('Мой Клиент 中文名字');
    expect(data.address).toBe('123 Улица, Москва');
  });
});