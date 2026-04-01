/**
 * Agent API Tests — Time Tracking
 * POST /api/time-tracking · GET /api/time-tracking/active-all · GET /api/time-tracking/summary · POST /api/time-tracking/admin-stop
 *
 * NOTE: Some tests are marked with .skip due to Firestore Emulator limitation:
 * "Firestore transactions require all reads to be executed before all writes."
 * The auto-close logic uses complex transactions that work in production but
 * hit ordering constraints in the emulator.
 */

import * as request from 'supertest';
import {
  getApp, authHeaders, seedClient, clearAll, db, admin, OWNER_UID,
} from './testSetup';

let app: any;

beforeAll(async () => { app = await getApp(); });
afterEach(async () => { await clearAll(); });

// Helper: seed owner user so hourlyRate can be resolved
async function seedOwnerUser(rate = 30) {
  await db.collection('users').doc(OWNER_UID).set({
    displayName: 'Test Owner',
    hourlyRate: rate,
    role: 'owner',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

// Helper: seed a work session directly for admin-stop tests
async function seedActiveSession(taskTitle = 'Test Task') {
  const ref = db.collection('work_sessions').doc();
  const now = admin.firestore.Timestamp.now();
  await ref.set({
    userId: OWNER_UID,
    employeeId: OWNER_UID,
    employeeName: 'Test Owner',
    task: taskTitle,
    status: 'active',
    startTime: now,
    clientId: null,
    clientName: null,
    hourlyRate: 30,
    createdAt: now,
  });
  return ref.id;
}

describe('POST /api/time-tracking — start', () => {
  it('starts a session', async () => {
    await seedOwnerUser();
    const cid = await seedClient();

    const res = await request(app).post('/api/time-tracking').set(authHeaders())
      .send({ action: 'start', taskTitle: 'Install outlets', clientId: cid, clientName: 'Test' });

    expect(res.status).toBe(201);
    expect(res.body.sessionId).toBeDefined();
    expect(res.body.message).toContain('Таймер запущен');
  });

  it('starts with manual startTime', async () => {
    await seedOwnerUser();
    const past = new Date(Date.now() - 3600_000).toISOString();

    const res = await request(app).post('/api/time-tracking').set(authHeaders())
      .send({ action: 'start', taskTitle: 'Retro', startTime: past });

    expect(res.status).toBe(201);
  });

  // Transaction refactored: reads-before-writes → now works in emulator
  it('auto-closes previous session on new start', async () => {
    await seedOwnerUser();
    const r1 = await request(app).post('/api/time-tracking').set(authHeaders())
      .send({ action: 'start', taskTitle: 'Session 1' });
    expect(r1.status).toBe(201);

    const r2 = await request(app).post('/api/time-tracking').set(authHeaders())
      .send({ action: 'start', taskTitle: 'Session 2' });
    expect(r2.status).toBe(201);
    expect(r2.body.closedCount).toBeGreaterThanOrEqual(1);
  });

  it('rejects startTime in the future', async () => {
    await seedOwnerUser();
    const future = new Date(Date.now() + 3600_000).toISOString();

    const res = await request(app).post('/api/time-tracking').set(authHeaders())
      .send({ action: 'start', taskTitle: 'Future', startTime: future });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/time-tracking — stop', () => {
  it('stops active session and returns earnings', async () => {
    await seedOwnerUser(30);
    await request(app).post('/api/time-tracking').set(authHeaders())
      .send({ action: 'start', taskTitle: 'Work' });

    const res = await request(app).post('/api/time-tracking').set(authHeaders())
      .send({ action: 'stop' });
    expect(res.status).toBe(200);
    expect(res.body.durationMinutes).toBeDefined();
    expect(res.body.earnings).toBeDefined();
  });

  it('returns 404 when no active session', async () => {
    await seedOwnerUser();
    const res = await request(app).post('/api/time-tracking').set(authHeaders())
      .send({ action: 'stop' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/time-tracking — status', () => {
  it('returns active=true when session exists', async () => {
    await seedOwnerUser();
    await request(app).post('/api/time-tracking').set(authHeaders())
      .send({ action: 'start', taskTitle: 'Check' });

    const res = await request(app).post('/api/time-tracking').set(authHeaders())
      .send({ action: 'status' });
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(true);
    expect(res.body.sessionId).toBeDefined();
  });

  it('returns active=false when no session', async () => {
    await seedOwnerUser();
    const res = await request(app).post('/api/time-tracking').set(authHeaders())
      .send({ action: 'status' });
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);
  });
});

describe('GET /api/time-tracking/active-all', () => {
  it('returns active sessions', async () => {
    await seedOwnerUser();
    await request(app).post('/api/time-tracking').set(authHeaders())
      .send({ action: 'start', taskTitle: 'Active task' });

    const res = await request(app).get('/api/time-tracking/active-all').set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
  });
});

describe('GET /api/time-tracking/summary', () => {
  it('returns summary for date range', async () => {
    const res = await request(app)
      .get('/api/time-tracking/summary?from=2026-03-01&to=2026-03-31')
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.totalHours).toBeDefined();
    expect(res.body.employees).toBeInstanceOf(Array);
  });
});

describe('POST /api/time-tracking/admin-stop', () => {
  // Transaction refactored: reads-before-writes → now works in emulator
  it('stops a directly-seeded session as OWNER', async () => {
    await seedOwnerUser();
    const sessionId = await seedActiveSession('Admin stop test');

    const res = await request(app).post('/api/time-tracking/admin-stop').set(authHeaders())
      .send({ sessionId });
    expect(res.status).toBe(200);
    expect(res.body.durationMinutes).toBeDefined();
    expect(res.body.employeeName).toBe('Test Owner');
  });

  it('returns 404 for non-existent session', async () => {
    const res = await request(app).post('/api/time-tracking/admin-stop').set(authHeaders())
      .send({ sessionId: 'non-existent-session-id' });
    expect(res.status).toBe(404);
  });

  // RBAC 403 test is not feasible with static API key auth:
  // authMiddleware always sets req.agentUserId = process.env.OWNER_UID
  // so changing OWNER_UID at request time means both sides match.
  // This check is verified by code review: line 1812 in agentApi.ts.
  it.skip('verifies RBAC: req.agentUserId must match OWNER_UID (requires JWT auth)', () => {
    // Would need a non-OWNER Firebase JWT to properly test this
  });
});
