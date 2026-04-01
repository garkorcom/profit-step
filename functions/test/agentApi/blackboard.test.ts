/**
 * Agent API Tests — Blackboard
 * POST /api/blackboard · GET /api/blackboard/:projectId
 */

import * as request from 'supertest';
import {
  getApp, authHeaders, seedClient, seedProject, clearAll, db,
} from './testSetup';

let app: any;

beforeAll(async () => { app = await getApp(); });
afterEach(async () => { await clearAll(); });

describe('POST /api/blackboard', () => {
  it('creates a new blackboard', async () => {
    const cid = await seedClient();
    const pid = await seedProject(cid);

    const res = await request(app).post('/api/blackboard').set(authHeaders())
      .send({
        projectId: pid,
        version: 1,
        zones: ['Kitchen', 'Bedroom'],
        extracted_elements: [{ type: 'outlet', count: 12 }],
        rfis: [],
        estimate_summary: { total: 5000 },
        status: 'in_progress',
      });

    expect(res.status).toBe(201);
    expect(res.body.blackboardId).toBeDefined();
  });

  it('updates existing blackboard (same project+version)', async () => {
    const cid = await seedClient();
    const pid = await seedProject(cid);

    // Create first
    await request(app).post('/api/blackboard').set(authHeaders())
      .send({ projectId: pid, version: 1, zones: ['Zone A'], status: 'in_progress' });

    // Update with same version
    const res = await request(app).post('/api/blackboard').set(authHeaders())
      .send({ projectId: pid, version: 1, zones: ['Zone A', 'Zone B'], status: 'completed' });

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(true);
  });
});

describe('GET /api/blackboard/:projectId', () => {
  it('returns latest version', async () => {
    const cid = await seedClient();
    const pid = await seedProject(cid);

    // Seed two versions
    await db.collection('estimate_blackboard').add({
      projectId: pid, version: 1, zones: ['V1'], status: 'completed',
      createdAt: new Date(), updatedAt: new Date(),
    });
    await db.collection('estimate_blackboard').add({
      projectId: pid, version: 2, zones: ['V2'], status: 'in_progress',
      createdAt: new Date(), updatedAt: new Date(),
    });

    const res = await request(app)
      .get(`/api/blackboard/${pid}`)
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(2);
    expect(res.body.zones).toContain('V2');
  });

  it('returns specific version when queried', async () => {
    const cid = await seedClient();
    const pid = await seedProject(cid);

    await db.collection('estimate_blackboard').add({
      projectId: pid, version: 1, zones: ['V1'], status: 'completed',
      createdAt: new Date(), updatedAt: new Date(),
    });
    await db.collection('estimate_blackboard').add({
      projectId: pid, version: 2, zones: ['V2'], status: 'in_progress',
      createdAt: new Date(), updatedAt: new Date(),
    });

    const res = await request(app)
      .get(`/api/blackboard/${pid}?version=1`)
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
  });
});
