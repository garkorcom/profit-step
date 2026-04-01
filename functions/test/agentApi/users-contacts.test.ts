/**
 * Agent API Tests — Users + Contacts
 * GET /api/users/search · POST /api/users/create-from-bot
 * POST /api/contacts · GET /api/contacts/search
 */

import * as request from 'supertest';
import {
  getApp, authHeaders, seedUser, clearAll, db,
} from './testSetup';

let app: any;

beforeAll(async () => { app = await getApp(); });
afterEach(async () => { await clearAll(); });

// ═══════════════════════════════════════════════════════════════════
// Users
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/users/search', () => {
  it('finds user by fuzzy name', async () => {
    await seedUser({ displayName: 'Ivan Petrov', email: 'ivan@test.com' });

    const res = await request(app)
      .get('/api/users/search?q=Ivan')
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
    expect(res.body.results[0].displayName).toContain('Ivan');
  });

  it('returns 400 when q is empty', async () => {
    const res = await request(app)
      .get('/api/users/search?q=')
      .set(authHeaders());
    expect(res.status).toBe(400);
  });
});

describe('POST /api/users/create-from-bot', () => {
  it('creates new user', async () => {
    const res = await request(app).post('/api/users/create-from-bot').set(authHeaders())
      .send({ telegramId: 999888777, displayName: 'Oleg Bot', hourlyRate: 25, role: 'worker' });

    expect(res.status).toBe(201);
    expect(res.body.created).toBe(true);
    expect(res.body.userId).toBeDefined();
  });

  it('updates hourlyRate for existing telegramId', async () => {
    // Create first
    await request(app).post('/api/users/create-from-bot').set(authHeaders())
      .send({ telegramId: 111222333, displayName: 'Sergey', hourlyRate: 20, role: 'worker' });

    // Update
    const res = await request(app).post('/api/users/create-from-bot').set(authHeaders())
      .send({ telegramId: 111222333, displayName: 'Sergey', hourlyRate: 35, role: 'worker' });

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Contacts
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/contacts', () => {
  it('creates a contact with full data', async () => {
    const res = await request(app).post('/api/contacts').set(authHeaders())
      .send({
        name: 'Mike the Plumber',
        phones: [{ number: '+1-555-111', label: 'cell' }],
        roles: ['plumber'],
        linkedProjects: ['proj-1'],
        notes: 'Works weekends',
        emails: ['mike@plumber.com'],
        messengers: { whatsapp: '+1-555-111' },
        defaultCity: 'Austin',
      });

    expect(res.status).toBe(201);
    expect(res.body.contactId).toBeDefined();
    expect(res.body.name).toBe('Mike the Plumber');
  });
});

describe('GET /api/contacts/search', () => {
  it('finds contact by name', async () => {
    // Seed contact
    await db.collection('contacts').add({
      name: 'Elena Electrician',
      phones: [],
      roles: ['electrician'],
      linkedProjects: ['proj-1'],
      notes: '',
      emails: [],
      messengers: {},
    });

    const res = await request(app)
      .get('/api/contacts/search?q=Elena')
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
  });

  it('filters by role', async () => {
    await db.collection('contacts').add({
      name: 'John Plumber',
      roles: ['plumber'],
      phones: [], linkedProjects: [], emails: [], messengers: {},
    });
    await db.collection('contacts').add({
      name: 'Jane Electrician',
      roles: ['electrician'],
      phones: [], linkedProjects: [], emails: [], messengers: {},
    });

    const res = await request(app)
      .get('/api/contacts/search?q=J&role=plumber')
      .set(authHeaders());
    expect(res.status).toBe(200);
    res.body.results.forEach((c: any) => {
      expect(c.roles).toContain('plumber');
    });
  });

  it('filters by projectId', async () => {
    await db.collection('contacts').add({
      name: 'Project Guy',
      roles: [],
      linkedProjects: ['proj-specific'],
      phones: [], emails: [], messengers: {},
    });

    const res = await request(app)
      .get('/api/contacts/search?q=Guy&projectId=proj-specific')
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
  });
});
