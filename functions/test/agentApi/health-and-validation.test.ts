/**
 * Agent API Tests — Health Check + File Validation
 * GET /api/health (public, no auth)
 * POST /api/projects/:id/files (MIME + extension validation)
 */

import * as request from 'supertest';
import * as admin from 'firebase-admin';
import {
  getApp, authHeaders, seedClient, seedProject, clearAll,
} from './testSetup';

let app: any;

beforeAll(async () => {
  app = await getApp();
  jest.spyOn(admin, 'storage').mockReturnValue({
    bucket: () => ({
      file: () => ({
        save: jest.fn().mockResolvedValue(undefined),
        getSignedUrl: jest.fn().mockResolvedValue(['https://mock-url.com']),
        exists: jest.fn().mockResolvedValue([true]),
      }),
    }),
  } as any);
});

afterEach(async () => { await clearAll(); });
afterAll(() => { jest.restoreAllMocks(); });

// ═══════════════════════════════════════════════════════════════════
// Health Check
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/health', () => {
  it('returns status ok without auth', async () => {
    const res = await request(app).get('/api/health');
    // No auth header — should still work
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.version).toBeDefined();
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
    expect(res.body.timestamp).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// File MIME/Extension Validation
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/projects/:id/files — validation', () => {
  it('rejects disallowed MIME type', async () => {
    const cid = await seedClient();
    const pid = await seedProject(cid);

    const res = await request(app)
      .post(`/api/projects/${pid}/files`)
      .set(authHeaders())
      .send({
        fileName: 'malware.exe',
        contentType: 'application/x-msdownload',
        base64Data: Buffer.from('fake').toString('base64'),
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('не разрешён');
    expect(res.body.allowedTypes).toBeInstanceOf(Array);
  });

  it('rejects disallowed file extension', async () => {
    const cid = await seedClient();
    const pid = await seedProject(cid);

    const res = await request(app)
      .post(`/api/projects/${pid}/files`)
      .set(authHeaders())
      .send({
        fileName: 'script.sh',
        contentType: 'application/pdf', // MIME ok, but extension bad
        base64Data: Buffer.from('fake').toString('base64'),
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('не разрешено');
  });

  it('accepts valid PDF upload', async () => {
    const cid = await seedClient();
    const pid = await seedProject(cid);

    const res = await request(app)
      .post(`/api/projects/${pid}/files`)
      .set(authHeaders())
      .send({
        fileName: 'blueprint.pdf',
        contentType: 'application/pdf',
        base64Data: Buffer.from('fake-pdf').toString('base64'),
      });

    expect(res.status).toBe(201);
    expect(res.body.fileId).toBeDefined();
  });

  it('accepts valid image upload', async () => {
    const cid = await seedClient();
    const pid = await seedProject(cid);

    const res = await request(app)
      .post(`/api/projects/${pid}/files`)
      .set(authHeaders())
      .send({
        fileName: 'photo.jpg',
        contentType: 'image/jpeg',
        base64Data: Buffer.from('fake-jpg').toString('base64'),
      });

    expect(res.status).toBe(201);
  });
});
