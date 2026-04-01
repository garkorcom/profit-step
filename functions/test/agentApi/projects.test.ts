/**
 * Agent API Tests — Projects + Files
 * POST /api/projects · GET /api/projects/list · GET /api/projects/status
 * POST /api/projects/:id/files · GET /api/projects/:id/files
 */

import * as request from 'supertest';
import * as admin from 'firebase-admin';
import {
  getApp, authHeaders, seedClient, seedProject, seedTask, seedCost, clearAll, db,
} from './testSetup';

let app: any;

beforeAll(async () => {
  app = await getApp();
  // Mock admin.storage() for file upload tests
  jest.spyOn(admin, 'storage').mockReturnValue({
    bucket: () => ({
      file: () => ({
        save: jest.fn().mockResolvedValue(undefined),
        getSignedUrl: jest.fn().mockResolvedValue(['https://mock-signed-url.com/file']),
        exists: jest.fn().mockResolvedValue([true]),
        download: jest.fn().mockResolvedValue([Buffer.from('fake-pdf')]),
      }),
    }),
  } as any);
});

afterEach(async () => { await clearAll(); });
afterAll(() => { jest.restoreAllMocks(); });

describe('POST /api/projects', () => {
  it('creates a project', async () => {
    const cid = await seedClient();
    const res = await request(app).post('/api/projects').set(authHeaders())
      .send({ clientId: cid, name: 'Kitchen Remodel', type: 'work' });

    expect(res.status).toBe(201);
    expect(res.body.projectId).toBeDefined();
    expect(res.body.name).toBe('Kitchen Remodel');
  });

  it('auto-creates client by address', async () => {
    const res = await request(app).post('/api/projects').set(authHeaders())
      .send({ address: '888 New Project St', name: 'New Project' });

    expect(res.status).toBe(201);
    const snap = await db.collection('clients')
      .where('address', '==', '888 New Project St').get();
    expect(snap.empty).toBe(false);
  });
});

describe('GET /api/projects/list', () => {
  it('lists projects', async () => {
    const cid = await seedClient();
    await seedProject(cid, { name: 'Project A' });
    await seedProject(cid, { name: 'Project B' });

    const res = await request(app)
      .get(`/api/projects/list?clientId=${cid}`)
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.projects.length).toBeGreaterThanOrEqual(2);
  });
});

describe('GET /api/projects/status', () => {
  it('returns aggregated stats for client', async () => {
    const cid = await seedClient();
    await seedTask(cid, { status: 'inbox' });
    await seedTask(cid, { status: 'completed' });
    await seedCost(cid, { amount: 100 });

    const res = await request(app)
      .get(`/api/projects/status?clientId=${cid}`)
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.tasks.total).toBeGreaterThanOrEqual(2);
    expect(res.body.costs.total).toBeGreaterThan(0);
  });
});

describe('POST /api/projects/:id/files', () => {
  it('uploads a file (base64)', async () => {
    const cid = await seedClient();
    const pid = await seedProject(cid);

    const res = await request(app)
      .post(`/api/projects/${pid}/files`)
      .set(authHeaders())
      .send({
        fileName: 'test-blueprint.pdf',
        contentType: 'application/pdf',
        base64Data: Buffer.from('fake-pdf-content').toString('base64'),
        description: 'Test file',
      });

    expect(res.status).toBe(201);
    expect(res.body.fileId).toBeDefined();
    expect(res.body.version).toBe(1);
  });
});

describe('GET /api/projects/:id/files', () => {
  it('lists project files', async () => {
    const cid = await seedClient();
    const pid = await seedProject(cid);

    // Seed a file document directly
    await db.collection('projects').doc(pid).collection('files').add({
      name: 'plan.pdf',
      path: 'projects/test/plan.pdf',
      url: 'https://mock.url',
      size: 1000,
      version: 1,
      uploadedBy: 'test',
      uploadedAt: new Date(),
    });

    const res = await request(app)
      .get(`/api/projects/${pid}/files`)
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
    expect(res.body.grouped).toBeDefined();
  });
});
