/**
 * Files API — Unified file management for CRM entities
 *
 * Endpoints:
 *   POST   /api/files/upload          — Upload file (base64)
 *   POST   /api/files/upload-from-url — Upload file from URL
 *   GET    /api/files/search          — Search/list files
 *   GET    /api/files/stats           — File statistics
 *   GET    /api/clients/:id/files     — All files linked to a client
 *   GET    /api/gtd-tasks/:id/files   — Files linked to a task
 *   GET    /api/costs/:id/receipt     — Receipt file + OCR data
 *   PATCH  /api/files/:id             — Update metadata/tags
 *   DELETE /api/files/:id             — Delete file
 */

import { Router, Request, Response, NextFunction } from 'express';
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import axios from 'axios';
import {
  UploadFileBodySchema,
  UploadFromUrlBodySchema,
  FileSearchQuerySchema,
  FileStatsQuerySchema,
  UpdateFileSchema,
} from '../schemas/fileSchemas';
import { logAgentActivity } from '../agentHelpers';

const router = Router();
const logger = functions.logger;
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const FILES_COLLECTION = 'files';

// ─── Allowed types ────────────────────────────────────────────────

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
  'image/svg+xml', 'image/tiff',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.ms-excel', // xls
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/msword', // doc
  'text/csv', 'text/plain', 'application/json', 'application/zip',
]);

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

// ═══════════════════════════════════════════════════════════════════
// POST /api/files/upload — Universal file upload (base64)
// ═══════════════════════════════════════════════════════════════════

router.post('/api/files/upload', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = UploadFileBodySchema.parse(req.body);
    logger.info('📁 files:upload', { fileName: data.fileName, category: data.category });

    // Validate MIME
    if (!ALLOWED_MIME_TYPES.has(data.contentType)) {
      res.status(400).json({
        error: `File type "${data.contentType}" is not allowed`,
        allowedTypes: Array.from(ALLOWED_MIME_TYPES),
      });
      return;
    }

    // Decode base64
    const buffer = Buffer.from(data.base64Data, 'base64');
    if (buffer.length > MAX_FILE_SIZE) {
      res.status(400).json({ error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)` });
      return;
    }

    // Build storage path: files/{clientId|general}/{timestamp}_{filename}
    const folder = data.clientId || 'general';
    const ts = Date.now();
    const safeName = data.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `files/${folder}/${ts}_${safeName}`;

    // Upload to Storage
    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);
    await file.save(buffer, {
      metadata: {
        contentType: data.contentType,
        metadata: {
          uploadedBy: req.effectiveUserId || req.agentUserId || 'agent',
          category: data.category,
          originalName: data.fileName,
        },
      },
    });

    // Generate signed URL (30-day expiry)
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });

    // Generate thumbnail URL for images
    let thumbnailUrl: string | null = null;
    if (data.contentType.startsWith('image/')) {
      thumbnailUrl = signedUrl; // For now, same URL (TODO: generate actual thumbnail)
    }

    // Save metadata to Firestore
    const fileDoc: Record<string, unknown> = {
      name: data.fileName,
      storagePath,
      url: signedUrl,
      thumbnailUrl,
      size: buffer.length,
      contentType: data.contentType,
      category: data.category,
      description: data.description || '',
      tags: data.tags || [],
      linkedTo: {
        clientId: data.clientId || null,
        projectId: data.projectId || null,
        taskId: data.taskId || null,
        costId: data.costId || null,
        estimateId: data.estimateId || null,
      },
      uploadedBy: req.effectiveUserId || req.agentUserId || 'agent',
      uploadedByName: req.agentUserName || 'Agent',
      uploadedAt: FieldValue.serverTimestamp(),
    };

    const docRef = await db.collection(FILES_COLLECTION).add(fileDoc);

    logger.info('📁 files:uploaded', { fileId: docRef.id, size: buffer.length, category: data.category });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'file_uploaded',
      endpoint: '/api/files/upload',
      metadata: { fileId: docRef.id, fileName: data.fileName, category: data.category, size: buffer.length },
    });

    // Build warnings
    const warnings: string[] = [];
    if (!data.clientId && !data.projectId && !data.taskId && !data.costId) {
      warnings.push('File is not linked to any entity (client, project, task, or cost)');
    }

    res.status(201).json({
      fileId: docRef.id,
      name: data.fileName,
      url: signedUrl,
      thumbnailUrl,
      size: buffer.length,
      category: data.category,
      storagePath,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  } catch (e) {
    next(e);
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/files/upload-from-url — Download from URL and store
// ═══════════════════════════════════════════════════════════════════

router.post('/api/files/upload-from-url', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = UploadFromUrlBodySchema.parse(req.body);
    logger.info('📁 files:upload-from-url', { sourceUrl: data.sourceUrl.substring(0, 80) });

    // Download file
    const response = await axios.get(data.sourceUrl, {
      responseType: 'arraybuffer',
      maxContentLength: MAX_FILE_SIZE,
      timeout: 30000,
    });

    const buffer = Buffer.from(response.data);
    if (buffer.length > MAX_FILE_SIZE) {
      res.status(400).json({ error: `Downloaded file too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)` });
      return;
    }

    // Detect content type from response headers or provided value
    const headerCt = response.headers['content-type'];
    const contentType = data.contentType
      || (typeof headerCt === 'string' ? headerCt.split(';')[0] : undefined)
      || 'application/octet-stream';

    // Detect filename
    const fileName = data.fileName || extractFileNameFromUrl(data.sourceUrl) || `download_${Date.now()}`;

    // Storage path
    const folder = data.clientId || 'general';
    const ts = Date.now();
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `files/${folder}/${ts}_${safeName}`;

    // Upload to Storage
    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);
    await file.save(buffer, {
      metadata: {
        contentType,
        metadata: {
          uploadedBy: req.effectiveUserId || req.agentUserId || 'agent',
          category: data.category,
          originalName: fileName,
          sourceUrl: data.sourceUrl,
        },
      },
    });

    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });

    const thumbnailUrl = contentType.startsWith('image/') ? signedUrl : null;

    // Save metadata
    const fileDoc: Record<string, unknown> = {
      name: fileName,
      storagePath,
      url: signedUrl,
      thumbnailUrl,
      size: buffer.length,
      contentType,
      category: data.category,
      description: data.description || '',
      tags: data.tags || [],
      linkedTo: {
        clientId: data.clientId || null,
        projectId: data.projectId || null,
        taskId: data.taskId || null,
        costId: data.costId || null,
        estimateId: null,
      },
      sourceUrl: data.sourceUrl,
      uploadedBy: req.effectiveUserId || req.agentUserId || 'agent',
      uploadedByName: req.agentUserName || 'Agent',
      uploadedAt: FieldValue.serverTimestamp(),
    };

    const docRef = await db.collection(FILES_COLLECTION).add(fileDoc);

    logger.info('📁 files:uploaded-from-url', { fileId: docRef.id, size: buffer.length });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'file_uploaded_from_url',
      endpoint: '/api/files/upload-from-url',
      metadata: { fileId: docRef.id, fileName, size: buffer.length, sourceUrl: data.sourceUrl.substring(0, 100) },
    });

    res.status(201).json({
      fileId: docRef.id,
      name: fileName,
      url: signedUrl,
      thumbnailUrl,
      size: buffer.length,
      category: data.category,
    });
  } catch (e) {
    next(e);
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/files/search — Search/list files with filters
// ═══════════════════════════════════════════════════════════════════

router.get('/api/files/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = FileSearchQuerySchema.parse(req.query);
    logger.info('📁 files:search', params);

    let q: FirebaseFirestore.Query = db.collection(FILES_COLLECTION);

    // ── RLS: worker/driver see only own uploads ──
    const rlsRole = req.effectiveRole || 'admin';
    if (rlsRole === 'worker' || rlsRole === 'driver') {
      q = q.where('uploadedBy', '==', req.effectiveUserId || req.agentUserId);
    }

    // Apply filters via Firestore where clauses
    if (params.clientId) q = q.where('linkedTo.clientId', '==', params.clientId);
    if (params.projectId) q = q.where('linkedTo.projectId', '==', params.projectId);
    if (params.taskId) q = q.where('linkedTo.taskId', '==', params.taskId);
    if (params.costId) q = q.where('linkedTo.costId', '==', params.costId);
    if (params.category) q = q.where('category', '==', params.category);

    // Date filters
    if (params.dateFrom) {
      const from = admin.firestore.Timestamp.fromDate(new Date(params.dateFrom));
      q = q.where('uploadedAt', '>=', from);
    }
    if (params.dateTo) {
      const to = admin.firestore.Timestamp.fromDate(new Date(params.dateTo + 'T23:59:59Z'));
      q = q.where('uploadedAt', '<=', to);
    }

    q = q.orderBy('uploadedAt', 'desc');

    // Pagination: fetch offset + limit, then skip
    const snap = await q.limit(params.offset + params.limit).get();
    const allDocs = snap.docs.slice(params.offset);

    const files = allDocs.map(d => formatFileDoc(d));

    // Tag filter (client-side — Firestore can't query array contains + inequality)
    const filtered = params.tag
      ? files.filter(f => (f.tags as string[]).includes(params.tag!))
      : files;

    res.json({ files: filtered, total: filtered.length, offset: params.offset, limit: params.limit });
  } catch (e) {
    next(e);
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/files/stats — File statistics
// ═══════════════════════════════════════════════════════════════════

router.get('/api/files/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = FileStatsQuerySchema.parse(req.query);
    logger.info('📁 files:stats', params);

    let q: FirebaseFirestore.Query = db.collection(FILES_COLLECTION);
    if (params.clientId) q = q.where('linkedTo.clientId', '==', params.clientId);
    if (params.projectId) q = q.where('linkedTo.projectId', '==', params.projectId);

    const snap = await q.get();

    let totalSize = 0;
    const byCategory: Record<string, number> = {};
    let lastUpload: string | null = null;
    let lastUploadTs = 0;

    snap.docs.forEach(d => {
      const data = d.data();
      totalSize += data.size || 0;

      const cat = data.category || 'other';
      byCategory[cat] = (byCategory[cat] || 0) + 1;

      const ts = data.uploadedAt?.toMillis?.() || 0;
      if (ts > lastUploadTs) {
        lastUploadTs = ts;
        lastUpload = data.uploadedAt?.toDate?.()?.toISOString() || null;
      }
    });

    // Check costs without receipts (if clientId provided)
    let noReceiptCosts = 0;
    if (params.clientId) {
      try {
        const costsSnap = await db.collection('costs')
          .where('clientId', '==', params.clientId)
          .get();

        const costIdsWithReceipts = new Set<string>();
        snap.docs.forEach(d => {
          const costId = d.data().linkedTo?.costId;
          if (costId) costIdsWithReceipts.add(costId);
        });

        noReceiptCosts = costsSnap.docs.filter(d => !costIdsWithReceipts.has(d.id)).length;
      } catch { /* non-blocking */ }
    }

    res.json({
      totalFiles: snap.size,
      totalSizeBytes: totalSize,
      totalSizeMB: Math.round(totalSize / 1024 / 1024 * 100) / 100,
      byCategory,
      lastUpload,
      noReceiptCosts,
    });
  } catch (e) {
    next(e);
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/clients/:id/files — All files linked to a client
// ═══════════════════════════════════════════════════════════════════

router.get('/api/clients/:id/files', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clientId = req.params.id;
    logger.info('📁 files:client', { clientId });

    // 1. Files from unified `files` collection
    const filesSnap = await db.collection(FILES_COLLECTION)
      .where('linkedTo.clientId', '==', clientId)
      .orderBy('uploadedAt', 'desc')
      .get();

    const files = filesSnap.docs.map(d => formatFileDoc(d));

    // 2. Also check project subcollection files (legacy)
    const projectsSnap = await db.collection('projects')
      .where('clientId', '==', clientId)
      .get();

    const legacyFiles: ReturnType<typeof formatFileDoc>[] = [];
    for (const proj of projectsSnap.docs) {
      const pfSnap = await proj.ref.collection('files').orderBy('uploadedAt', 'desc').get();
      pfSnap.docs.forEach(d => {
        const data = d.data();
        legacyFiles.push({
          id: d.id,
          name: data.name || 'unknown',
          url: data.url || '',
          thumbnailUrl: null,
          size: data.size || 0,
          contentType: data.contentType || 'application/octet-stream',
          category: 'blueprint' as const,
          description: data.description || '',
          tags: [],
          linkedTo: {
            clientId,
            projectId: proj.id,
            taskId: null,
            costId: null,
            estimateId: null,
          },
          uploadedBy: data.uploadedBy || 'unknown',
          uploadedAt: data.uploadedAt?.toDate?.()?.toISOString() || null,
          source: 'project_subcollection' as const,
        });
      });
    }

    const allFiles = [...files, ...legacyFiles];

    // Category summary
    const byCategory: Record<string, number> = {};
    allFiles.forEach(f => {
      const cat = String(f.category || 'other');
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    });

    res.json({
      files: allFiles,
      total: allFiles.length,
      byCategory,
    });
  } catch (e) {
    next(e);
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/gtd-tasks/:id/files — Files linked to a task
// ═══════════════════════════════════════════════════════════════════

router.get('/api/gtd-tasks/:id/files', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const taskId = req.params.id;
    logger.info('📁 files:task', { taskId });

    // Verify task exists
    const taskDoc = await db.collection('gtd_tasks').doc(taskId).get();
    if (!taskDoc.exists) {
      res.status(404).json({ error: `Task "${taskId}" not found` });
      return;
    }

    const filesSnap = await db.collection(FILES_COLLECTION)
      .where('linkedTo.taskId', '==', taskId)
      .orderBy('uploadedAt', 'desc')
      .get();

    const files = filesSnap.docs.map(d => formatFileDoc(d));

    res.json({ files, total: files.length });
  } catch (e) {
    next(e);
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/costs/:id/receipt — Receipt file + OCR data for a cost
// ═══════════════════════════════════════════════════════════════════

router.get('/api/costs/:id/receipt', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const costId = req.params.id;
    logger.info('📁 files:receipt', { costId });

    // Verify cost exists
    const costDoc = await db.collection('costs').doc(costId).get();
    if (!costDoc.exists) {
      res.status(404).json({ error: `Cost "${costId}" not found` });
      return;
    }

    const costData = costDoc.data()!;

    // 1. Check unified files collection
    const filesSnap = await db.collection(FILES_COLLECTION)
      .where('linkedTo.costId', '==', costId)
      .where('category', '==', 'receipt')
      .limit(5)
      .get();

    // 2. Also check if cost has inline photoUrl (from Telegram bot)
    const receipts: Record<string, unknown>[] = filesSnap.docs.map(d => {
      const data = d.data();
      return {
        fileId: d.id,
        receiptUrl: data.url,
        thumbnailUrl: data.thumbnailUrl,
        name: data.name,
        size: data.size,
        uploadedAt: data.uploadedAt?.toDate?.()?.toISOString() || null,
        ocr: data.ocr || null,
      };
    });

    // Legacy: inline photoUrl from Telegram costs bot
    if (costData.photoUrl && receipts.length === 0) {
      receipts.push({
        fileId: null,
        receiptUrl: costData.photoUrl,
        thumbnailUrl: costData.photoUrl,
        name: 'receipt_telegram.jpg',
        size: null,
        uploadedAt: costData.createdAt?.toDate?.()?.toISOString() || null,
        ocr: costData.ocrResult || null,
        source: 'legacy_inline',
      });
    }

    res.json({
      costId,
      amount: costData.amount || null,
      category: costData.category || null,
      description: costData.description || '',
      receipts,
      hasReceipt: receipts.length > 0,
    });
  } catch (e) {
    next(e);
  }
});

// ═══════════════════════════════════════════════════════════════════
// PATCH /api/files/:id — Update file metadata
// ═══════════════════════════════════════════════════════════════════

router.patch('/api/files/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fileId = req.params.id;
    const data = UpdateFileSchema.parse(req.body);
    logger.info('📁 files:update', { fileId, fields: Object.keys(data) });

    const docRef = db.collection(FILES_COLLECTION).doc(fileId);
    const doc = await docRef.get();
    if (!doc.exists) {
      res.status(404).json({ error: `File "${fileId}" not found` });
      return;
    }

    // Build update object
    const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };

    if (data.description !== undefined) update.description = data.description;
    if (data.category !== undefined) update.category = data.category;
    if (data.tags !== undefined) update.tags = data.tags;

    // Update linkedTo fields
    if (data.clientId !== undefined) update['linkedTo.clientId'] = data.clientId;
    if (data.projectId !== undefined) update['linkedTo.projectId'] = data.projectId;
    if (data.taskId !== undefined) update['linkedTo.taskId'] = data.taskId;
    if (data.costId !== undefined) update['linkedTo.costId'] = data.costId;

    await docRef.update(update);

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'file_updated',
      endpoint: `/api/files/${fileId}`,
      metadata: { fileId, updatedFields: Object.keys(data) },
    });

    res.json({ ok: true, fileId, updated: Object.keys(data) });
  } catch (e) {
    next(e);
  }
});

// ═══════════════════════════════════════════════════════════════════
// DELETE /api/files/:id — Delete file (storage + Firestore)
// ═══════════════════════════════════════════════════════════════════

router.delete('/api/files/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fileId = req.params.id;
    logger.info('📁 files:delete', { fileId });

    const docRef = db.collection(FILES_COLLECTION).doc(fileId);
    const doc = await docRef.get();
    if (!doc.exists) {
      res.status(404).json({ error: `File "${fileId}" not found` });
      return;
    }

    const data = doc.data()!;

    // Delete from Storage
    if (data.storagePath) {
      try {
        const bucket = admin.storage().bucket();
        await bucket.file(data.storagePath).delete();
        logger.info('📁 files:storage-deleted', { storagePath: data.storagePath });
      } catch (storageErr: any) {
        // File might already be gone — log but don't fail
        logger.warn('📁 files:storage-delete-failed', { storagePath: data.storagePath, error: storageErr.message });
      }
    }

    // Delete Firestore doc
    await docRef.delete();

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'file_deleted',
      endpoint: `/api/files/${fileId}`,
      metadata: { fileId, fileName: data.name, storagePath: data.storagePath },
    });

    res.json({ ok: true, deleted: fileId });
  } catch (e) {
    next(e);
  }
});

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function formatFileDoc(d: FirebaseFirestore.QueryDocumentSnapshot): Record<string, unknown> {
  const data = d.data();
  return {
    id: d.id,
    name: data.name || 'unknown',
    url: data.url || '',
    thumbnailUrl: data.thumbnailUrl || null,
    size: data.size || 0,
    contentType: data.contentType || 'application/octet-stream',
    category: data.category || 'other',
    description: data.description || '',
    tags: data.tags || [],
    linkedTo: data.linkedTo || {},
    uploadedBy: data.uploadedBy || 'unknown',
    uploadedByName: data.uploadedByName || null,
    uploadedAt: data.uploadedAt?.toDate?.()?.toISOString() || null,
    source: data.sourceUrl ? 'url' : 'upload',
    ...(data.ocr ? { ocr: data.ocr } : {}),
  };
}

function extractFileNameFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    if (last && last.includes('.')) return decodeURIComponent(last);
    return null;
  } catch {
    return null;
  }
}

export default router;
