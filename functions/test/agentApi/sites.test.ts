/**
 * Agent API Tests — Sites
 * POST /api/sites · GET /api/sites · PATCH /api/sites/:id
 */

import * as request from 'supertest';
import {
  getApp, authHeaders, seedClient, seedSite, clearAll, db,
} from './testSetup';

let app: any;

beforeAll(async () => { app = await getApp(); });
afterEach(async () => { await clearAll(); });

describe('POST /api/sites', () => {
  it('creates a site', async () => {
    const cid = await seedClient();
    const res = await request(app).post('/api/sites').set(authHeaders())
      .send({
        clientId: cid,
        name: 'Main Office',
        address: '789 Broadway, NY',
        city: 'New York',
        state: 'NY',
        zip: '10001',
        type: 'commercial',
        permitNumber: 'PRM-2026-001',
      });

    expect(res.status).toBe(201);
    expect(res.body.siteId).toBeDefined();
    expect(res.body.name).toBe('Main Office');
  });
});

describe('GET /api/sites', () => {
  it('lists sites by clientId', async () => {
    const cid = await seedClient();
    await seedSite(cid, { name: 'Site A' });
    await seedSite(cid, { name: 'Site B' });

    const res = await request(app)
      .get(`/api/sites?clientId=${cid}`)
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(2);
  });

  it('returns 400 without clientId', async () => {
    const res = await request(app).get('/api/sites').set(authHeaders());
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/sites/:id', () => {
  it('updates site fields', async () => {
    const cid = await seedClient();
    const sid = await seedSite(cid);

    const res = await request(app).patch(`/api/sites/${sid}`).set(authHeaders())
      .send({ name: 'Updated Site', status: 'completed', sqft: 3000 });

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(true);

    const doc = await db.collection('sites').doc(sid).get();
    expect(doc.data()?.name).toBe('Updated Site');
    expect(doc.data()?.status).toBe('completed');
    expect(doc.data()?.sqft).toBe(3000);
  });

  it('returns 404 for non-existent site', async () => {
    const res = await request(app).patch('/api/sites/fake-site').set(authHeaders())
      .send({ name: 'Nope' });
    expect(res.status).toBe(404);
  });
});
