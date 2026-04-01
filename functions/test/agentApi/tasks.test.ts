/**
 * Agent API Tests — GTD Tasks
 * POST /api/gtd-tasks · GET /api/gtd-tasks/list · PATCH /api/gtd-tasks/:id · DELETE /api/gtd-tasks/:id
 */

import * as request from 'supertest';
import {
  getApp, authHeaders, seedClient, seedTask, clearAll, db,
} from './testSetup';

let app: any;

beforeAll(async () => { app = await getApp(); });
afterEach(async () => { await clearAll(); });

// ═══════════════════════════════════════════════════════════════════
// POST /api/gtd-tasks
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/gtd-tasks', () => {
  it('creates task with title only', async () => {
    const res = await request(app)
      .post('/api/gtd-tasks')
      .set(authHeaders())
      .send({ title: 'Buy wire' });

    expect(res.status).toBe(201);
    expect(res.body.taskId).toBeDefined();
  });

  it('creates task with full payload including projectId', async () => {
    const clientId = await seedClient();
    const res = await request(app)
      .post('/api/gtd-tasks')
      .set(authHeaders())
      .send({
        title: 'Install outlets',
        clientId,
        clientName: 'Test Client',
        priority: 'high',
        status: 'next_action',
        dueDate: '2026-04-10T00:00:00.000Z',
        estimatedDurationMinutes: 120,
        projectId: 'proj-test-123',
      });

    expect(res.status).toBe(201);
    const doc = await db.collection('gtd_tasks').doc(res.body.taskId).get();
    expect(doc.data()?.projectId).toBe('proj-test-123');
    expect(doc.data()?.priority).toBe('high');
  });

  it('deduplicates via idempotencyKey', async () => {
    const key = 'task-dedup-001';
    const r1 = await request(app).post('/api/gtd-tasks').set(authHeaders())
      .send({ title: 'First', idempotencyKey: key });
    expect(r1.status).toBe(201);

    const r2 = await request(app).post('/api/gtd-tasks').set(authHeaders())
      .send({ title: 'Second', idempotencyKey: key });
    expect(r2.status).toBe(200);
    expect(r2.body.deduplicated).toBe(true);
  });

  it('returns 400 without title', async () => {
    const res = await request(app).post('/api/gtd-tasks').set(authHeaders()).send({});
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/gtd-tasks/list
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/gtd-tasks/list', () => {
  it('returns seeded tasks', async () => {
    const cid = await seedClient();
    await seedTask(cid, { status: 'inbox' });
    await seedTask(cid, { status: 'next_action' });

    const res = await request(app).get('/api/gtd-tasks/list').set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.tasks.length).toBeGreaterThanOrEqual(2);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
  });

  it('filters by comma-separated status', async () => {
    const cid = await seedClient();
    await seedTask(cid, { status: 'inbox' });
    await seedTask(cid, { status: 'next_action' });
    await seedTask(cid, { status: 'completed' });

    const res = await request(app)
      .get('/api/gtd-tasks/list?status=inbox,next_action')
      .set(authHeaders());
    expect(res.status).toBe(200);
    res.body.tasks.forEach((t: any) => {
      expect(['inbox', 'next_action']).toContain(t.status);
    });
  });

  it('paginates with offset/limit', async () => {
    const cid = await seedClient();
    for (let i = 0; i < 5; i++) await seedTask(cid, { title: `Task ${i}` });

    const res = await request(app)
      .get('/api/gtd-tasks/list?limit=2&offset=1')
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.tasks.length).toBe(2);
    expect(res.body.hasMore).toBe(true);
  });

  it('filters by dueBefore', async () => {
    const cid = await seedClient();
    await seedTask(cid, {
      dueDate: new Date('2026-03-01'),
      title: 'Past due',
    });

    const res = await request(app)
      .get('/api/gtd-tasks/list?dueBefore=2026-03-15T00:00:00.000Z')
      .set(authHeaders());
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PATCH /api/gtd-tasks/:id
// ═══════════════════════════════════════════════════════════════════

describe('PATCH /api/gtd-tasks/:id', () => {
  it('updates status and priority', async () => {
    const cid = await seedClient();
    const tid = await seedTask(cid);

    const res = await request(app)
      .patch(`/api/gtd-tasks/${tid}`)
      .set(authHeaders())
      .send({ status: 'completed', priority: 'high' });

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(true);
    const doc = await db.collection('gtd_tasks').doc(tid).get();
    expect(doc.data()?.status).toBe('completed');
  });

  it('updates budget fields', async () => {
    const cid = await seedClient();
    const tid = await seedTask(cid);

    const res = await request(app)
      .patch(`/api/gtd-tasks/${tid}`)
      .set(authHeaders())
      .send({ budgetAmount: 5000, progressPercentage: 75 });

    expect(res.status).toBe(200);
    const doc = await db.collection('gtd_tasks').doc(tid).get();
    expect(doc.data()?.budgetAmount).toBe(5000);
    expect(doc.data()?.progressPercentage).toBe(75);
  });

  it('returns 404 for non-existent task', async () => {
    const res = await request(app)
      .patch('/api/gtd-tasks/fake-id')
      .set(authHeaders())
      .send({ status: 'completed' });
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════
// DELETE /api/gtd-tasks/:id
// ═══════════════════════════════════════════════════════════════════

describe('DELETE /api/gtd-tasks/:id', () => {
  it('archives the task', async () => {
    const cid = await seedClient();
    const tid = await seedTask(cid);

    const res = await request(app).delete(`/api/gtd-tasks/${tid}`).set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.archived).toBe(true);

    const doc = await db.collection('gtd_tasks').doc(tid).get();
    expect(doc.data()?.status).toBe('archived');
  });

  it('returns 400 for already archived', async () => {
    const cid = await seedClient();
    const tid = await seedTask(cid, { status: 'archived' });

    const res = await request(app).delete(`/api/gtd-tasks/${tid}`).set(authHeaders());
    expect(res.status).toBe(400);
  });
});
