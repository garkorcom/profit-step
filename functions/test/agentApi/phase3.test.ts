/**
 * Agent API Tests — Phase 3: Client Profile, Dashboard, Batch Update
 */

import * as request from 'supertest';
import {
  getApp, authHeaders, seedClient, seedTask, seedCost, seedProject, clearAll,
} from './testSetup';

let app: any;

beforeAll(async () => { app = await getApp(); });
afterEach(async () => { await clearAll(); });

// ═══════════════════════════════════════════════════════════════════
// GET /api/clients/:id
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/clients/:id', () => {
  it('returns full client profile with aggregation', async () => {
    const cid = await seedClient({ name: 'Profile Test Client' });
    await seedTask(cid, { title: 'Task A' });
    await seedTask(cid, { title: 'Task B', status: 'next_action' });
    await seedCost(cid, { amount: 150, category: 'materials' });
    await seedProject(cid, { name: 'Project Alpha' });

    const res = await request(app)
      .get(`/api/clients/${cid}`)
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body.client.id).toBe(cid);
    expect(res.body.client.name).toBe('Profile Test Client');
    expect(res.body.projects).toHaveLength(1);
    expect(res.body.tasks.total).toBe(2);
    expect(res.body.costs.total).toBe(150);
    expect(res.body.costs.count).toBe(1);
    expect(res.body.timeTracking.totalMinutes).toBeDefined();
    expect(res.body.sites).toBeInstanceOf(Array);
    expect(res.body.estimates).toBeInstanceOf(Array);
  });

  it('returns 404 for non-existent client', async () => {
    const res = await request(app)
      .get('/api/clients/non-existent-id')
      .set(authHeaders());
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/dashboard
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/dashboard', () => {
  it('returns dashboard summary', async () => {
    const res = await request(app)
      .get('/api/dashboard')
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body.activeSessions).toBeInstanceOf(Array);
    expect(res.body.activeSessionCount).toBeDefined();
    expect(res.body.tasksDueToday).toBeInstanceOf(Array);
    expect(res.body.recentCosts).toBeInstanceOf(Array);
    expect(res.body.openEstimates).toBeDefined();
    expect(res.body.totalClients).toBeDefined();
    expect(res.body.generatedAt).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/gtd-tasks/batch-update
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/gtd-tasks/batch-update', () => {
  it('updates multiple tasks at once', async () => {
    const cid = await seedClient();
    const t1 = await seedTask(cid, { title: 'Batch 1', status: 'inbox' });
    const t2 = await seedTask(cid, { title: 'Batch 2', status: 'inbox' });
    const t3 = await seedTask(cid, { title: 'Batch 3', status: 'inbox' });

    const res = await request(app)
      .post('/api/gtd-tasks/batch-update')
      .set(authHeaders())
      .send({
        taskIds: [t1, t2, t3],
        update: { status: 'completed', priority: 'high' },
      });

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(3);
    expect(res.body.notFound).toBeUndefined();
  });

  it('reports not-found IDs', async () => {
    const cid = await seedClient();
    const t1 = await seedTask(cid, { title: 'Exists' });

    const res = await request(app)
      .post('/api/gtd-tasks/batch-update')
      .set(authHeaders())
      .send({
        taskIds: [t1, 'fake-id-1', 'fake-id-2'],
        update: { status: 'completed' },
      });

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
    expect(res.body.notFound).toEqual(['fake-id-1', 'fake-id-2']);
  });

  it('rejects empty update', async () => {
    const res = await request(app)
      .post('/api/gtd-tasks/batch-update')
      .set(authHeaders())
      .send({ taskIds: ['t1'], update: {} });

    expect(res.status).toBe(400);
  });
});
