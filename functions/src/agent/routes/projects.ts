/**
 * Project Routes — POST, GET list, files, blueprint, blackboard (8 endpoints)
 */
import { Router } from 'express';
import * as admin from 'firebase-admin';
import { PDFDocument } from 'pdf-lib';

import {
  db, FieldValue, logger, logAgentActivity,
  fuzzySearchClient, searchClientByAddress,
  autoCreateClientByAddress, resolveOwnerCompanyId,
} from '../routeContext';
import {
  CreateProjectSchema,
  ListProjectsQuerySchema,
  UploadFileSchema,
  BlueprintSplitSchema,
  CreateBlackboardSchema,
} from '../schemas';

const router = Router();

// ─── POST /api/projects ─────────────────────────────────────────────

router.post('/api/projects', async (req, res, next) => {
  try {
    const data = CreateProjectSchema.parse(req.body);
    logger.info('🏗️ projects:create', { clientId: data.clientId, address: data.address, name: data.name });

    // Resolve client: by clientId, or auto-find/create by address
    let clientId = data.clientId;
    let clientName = data.clientName;

    if (!clientId && data.address) {
      const found = await searchClientByAddress(data.address);
      if (found) {
        clientId = found.id;
        clientName = clientName || found.name;
        logger.info('🏗️ projects:client found by address', { clientId, address: data.address });
      } else {
        const created = await autoCreateClientByAddress(data.address, 'project');
        clientId = created.id;
        clientName = clientName || created.name;
        logger.info('🏗️ projects:client auto-created', { clientId, address: data.address });
      }
    }

    if (!clientId) {
      res.status(400).json({ error: 'Необходим clientId или address для создания проекта' });
      return;
    }

    const companyId = await resolveOwnerCompanyId();

    const docRef = db.collection('projects').doc();
    await docRef.set({
      id: docRef.id,
      companyId,
      clientId,
      clientName: clientName || '',
      name: data.name,
      description: data.description || '',
      status: 'active',
      type: data.type,
      address: data.address || null,
      areaSqft: data.areaSqft || null,
      projectType: data.projectType || null,
      facilityUse: data.facilityUse || null,
      files: [],
      totalDebit: 0,
      totalCredit: 0,
      balance: 0,
      createdBy: req.agentUserId,
      source: 'openclaw_estimator',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    logger.info('🏗️ projects:created', { projectId: docRef.id });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'project_created',
      endpoint: '/api/projects',
      metadata: { projectId: docRef.id, name: data.name, clientId },
    });

    res.status(201).json({ projectId: docRef.id, name: data.name });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/projects/list ─────────────────────────────────────────

router.get('/api/projects/list', async (req, res, next) => {
  try {
    const params = ListProjectsQuerySchema.parse(req.query);
    let clientId = params.clientId;

    if (!clientId && params.clientName) {
      const match = await fuzzySearchClient(params.clientName);
      if (!match) {
        res.status(404).json({ error: 'Клиент не найден' });
        return;
      }
      clientId = match.id;
    }

    const companyId = await resolveOwnerCompanyId();
    logger.info('🏗️ projects:list', { companyId, clientId, status: params.status });

    let q: admin.firestore.Query = db.collection('projects')
      .where('companyId', '==', companyId);

    if (clientId) {
      q = q.where('clientId', '==', clientId);
    }

    if (params.status) {
      q = q.where('status', '==', params.status);
    }

    if (params.type) {
      q = q.where('type', '==', params.type);
    }

    q = q.orderBy('updatedAt', 'desc').limit(params.limit);

    const snap = await q.get();
    const projects = snap.docs.map(d => {
      const p = d.data();
      return {
        id: d.id,
        name: p.name,
        clientId: p.clientId,
        clientName: p.clientName,
        status: p.status,
        type: p.type || 'other',
        address: p.address || null,
        totalDebit: p.totalDebit || 0,
        totalCredit: p.totalCredit || 0,
        balance: p.balance || 0,
        fileCount: p.files?.length || 0,
        createdAt: p.createdAt?.toDate?.()?.toISOString() || null,
        updatedAt: p.updatedAt?.toDate?.()?.toISOString() || null,
      };
    });

    res.json({ projects, count: projects.length });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/projects/:id/dashboard ───────────────────────────────

router.get('/api/projects/:id/dashboard', async (req, res, next) => {
  try {
    const projectId = req.params.id;
    logger.info('📊 projects:dashboard', { projectId });

    const companyId = await resolveOwnerCompanyId();

    // Parallel queries: project info + tasks + recent sessions + costs total + files count
    const [projectDoc, tasksSnap, sessionsSnap, costsSnap, filesSnap] = await Promise.all([
      db.collection('projects').doc(projectId).get(),
      db.collection('gtd_tasks').where('projectId', '==', projectId).limit(50).get(),
      db.collection('work_sessions').where('projectId', '==', projectId).limit(20).get(),
      db.collection('costs').where('projectId', '==', projectId).get(),
      db.collection('projects').doc(projectId).collection('files').get(),
    ]);

    // Check if project exists
    if (!projectDoc.exists) {
      res.status(404).json({ error: `Проект "${projectId}" не найден` });
      return;
    }

    const projectData = projectDoc.data()!;

    // Verify project belongs to the company
    if (projectData.companyId !== companyId) {
      res.status(403).json({ error: 'Доступ запрещен' });
      return;
    }

    // Process project info
    const project = {
      id: projectDoc.id,
      name: projectData.name,
      clientId: projectData.clientId,
      clientName: projectData.clientName,
      status: projectData.status,
      type: projectData.type || 'other',
      address: projectData.address || null,
      totalDebit: projectData.totalDebit || 0,
      totalCredit: projectData.totalCredit || 0,
      balance: projectData.balance || 0,
      createdAt: projectData.createdAt?.toDate?.()?.toISOString() || null,
      updatedAt: projectData.updatedAt?.toDate?.()?.toISOString() || null,
    };

    // Process tasks
    const tasks = tasksSnap.docs.map(d => {
      const t = d.data();
      return {
        id: d.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        estimatedDurationMinutes: t.estimatedDurationMinutes,
        createdAt: t.createdAt?.toDate?.()?.toISOString() || null,
      };
    });

    // Process recent sessions
    const sessions = sessionsSnap.docs.map(d => {
      const s = d.data();
      const startTime = s.startTime?.toDate?.() || new Date(s.startTime);
      const endTime = s.endTime?.toDate?.() || new Date(s.endTime);
      const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / (1000 * 60));

      return {
        id: d.id,
        employeeName: s.employeeName || `Employee ${s.employeeId}`,
        durationMinutes,
        sessionEarnings: s.sessionEarnings || 0,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
      };
    });

    // Calculate costs total
    const costsTotal = costsSnap.docs.reduce((sum, d) => sum + (d.data().amount || 0), 0);

    // Files count
    const filesCount = filesSnap.size;

    res.json({
      project,
      tasks: { items: tasks, count: tasks.length },
      sessions: { items: sessions, count: sessions.length },
      costs: { total: Math.round(costsTotal * 100) / 100, count: costsSnap.size },
      files: { count: filesCount },
    });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/projects/:id/files ──────────────────────────────────

// Allowed MIME types for file upload security
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
  'image/gif', 'image/svg+xml', 'image/tiff',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc
  'text/csv', 'text/plain',
  'application/json',
  'application/zip',
]);

const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.gif', '.svg', '.tiff',
  '.xlsx', '.xls', '.docx', '.doc', '.csv', '.txt', '.json', '.zip',
]);

router.post('/api/projects/:id/files', async (req, res, next) => {
  try {
    const projectId = req.params.id;
    const data = UploadFileSchema.parse(req.body);
    logger.info('📁 files:upload', { projectId, fileName: data.fileName });

    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.has(data.contentType)) {
      res.status(400).json({
        error: `Тип файла "${data.contentType}" не разрешён`,
        allowedTypes: Array.from(ALLOWED_MIME_TYPES),
      });
      return;
    }

    // Validate file extension
    const ext = data.fileName.substring(data.fileName.lastIndexOf('.')).toLowerCase();
    if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
      res.status(400).json({
        error: `Расширение файла "${ext}" не разрешено`,
        allowedExtensions: Array.from(ALLOWED_EXTENSIONS),
      });
      return;
    }

    // Validate project exists
    const projectDoc = await db.collection('projects').doc(projectId).get();
    if (!projectDoc.exists) {
      res.status(404).json({ error: `Проект "${projectId}" не найден` });
      return;
    }

    // Decode base64
    const buffer = Buffer.from(data.base64Data, 'base64');
    const fileSizeBytes = buffer.length;

    // Max 50MB
    if (fileSizeBytes > 50 * 1024 * 1024) {
      res.status(400).json({ error: 'Файл слишком большой (максимум 50MB)' });
      return;
    }

    // Determine version number — count existing files with same name
    const existingFilesSnap = await db.collection('projects').doc(projectId)
      .collection('files')
      .where('name', '==', data.fileName)
      .orderBy('version', 'desc')
      .limit(1)
      .get();

    const version = existingFilesSnap.empty ? 1 : (existingFilesSnap.docs[0].data().version || 0) + 1;

    // Storage path with version: /projects/{projectId}/blueprints/{version}_{filename}
    const storagePath = `projects/${projectId}/blueprints/v${version}_${data.fileName}`;
    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);

    await file.save(buffer, {
      metadata: {
        contentType: data.contentType,
        metadata: {
          projectId,
          version: String(version),
          originalName: data.fileName,
          uploadedBy: req.agentUserId || 'agent',
        },
      },
    });

    // Generate signed URL (30-day expiry)
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });

    // Save metadata to Firestore subcollection
    const fileDocRef = await db.collection('projects').doc(projectId)
      .collection('files').add({
        name: data.fileName,
        path: storagePath,
        url: signedUrl,
        size: fileSizeBytes,
        contentType: data.contentType,
        description: data.description || '',
        version,
        uploadedBy: req.agentUserId || 'agent',
        uploadedAt: FieldValue.serverTimestamp(),
      });

    logger.info('📁 files:uploaded', { projectId, fileId: fileDocRef.id, version, size: fileSizeBytes });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'file_uploaded',
      endpoint: `/api/projects/${projectId}/files`,
      metadata: { projectId, fileId: fileDocRef.id, fileName: data.fileName, version, size: fileSizeBytes },
    });

    res.status(201).json({
      fileId: fileDocRef.id,
      name: data.fileName,
      version,
      url: signedUrl,
      size: fileSizeBytes,
      path: storagePath,
    });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/projects/:id/files ───────────────────────────────────

router.get('/api/projects/:id/files', async (req, res, next) => {
  try {
    const projectId = req.params.id;
    logger.info('📁 files:list', { projectId });

    // Validate project exists
    const projectDoc = await db.collection('projects').doc(projectId).get();
    if (!projectDoc.exists) {
      res.status(404).json({ error: `Проект "${projectId}" не найден` });
      return;
    }

    const filesSnap = await db.collection('projects').doc(projectId)
      .collection('files')
      .orderBy('uploadedAt', 'desc')
      .get();

    const files = filesSnap.docs.map((d) => {
      const f = d.data();
      return {
        id: d.id,
        name: f.name,
        path: f.path,
        url: f.url,
        size: f.size,
        contentType: f.contentType || 'application/octet-stream',
        description: f.description || '',
        version: f.version || 1,
        uploadedBy: f.uploadedBy || 'unknown',
        uploadedAt: f.uploadedAt?.toDate?.()?.toISOString() || null,
      };
    });

    // Group by filename for version view
    const grouped: Record<string, typeof files> = {};
    for (const file of files) {
      if (!grouped[file.name]) grouped[file.name] = [];
      grouped[file.name].push(file);
    }

    res.json({ files, grouped, count: files.length });
  } catch (e) {
    next(e);
  }
});

// ═══════════════════════════════════════════════════════════════════
// BLUEPRINT SPLIT — Estimator V3 Phase 2
// ═══════════════════════════════════════════════════════════════════

router.post('/api/blueprint/split', async (req, res, next) => {
  try {
    const data = BlueprintSplitSchema.parse(req.body);
    logger.info('📄 blueprint:split', { projectId: data.projectId, fileId: data.fileId });

    // 1. Validate project exists
    const projectDoc = await db.collection('projects').doc(data.projectId).get();
    if (!projectDoc.exists) {
      res.status(404).json({ error: `Проект "${data.projectId}" не найден` });
      return;
    }

    // 2. Get file metadata from Firestore
    const fileDoc = await db.collection('projects').doc(data.projectId)
      .collection('files').doc(data.fileId).get();
    if (!fileDoc.exists) {
      res.status(404).json({ error: `Файл "${data.fileId}" не найден` });
      return;
    }

    const fileMeta = fileDoc.data()!;
    if (!fileMeta.contentType?.includes('pdf')) {
      res.status(400).json({ error: 'Только PDF файлы можно разбить на страницы' });
      return;
    }

    // 3. Download PDF from Storage
    const bucket = admin.storage().bucket();
    const sourceFile = bucket.file(fileMeta.path);
    const [exists] = await sourceFile.exists();
    if (!exists) {
      res.status(404).json({ error: 'Файл не найден в Storage' });
      return;
    }

    const [pdfBuffer] = await sourceFile.download();
    logger.info('📄 blueprint:split — downloaded PDF', { size: pdfBuffer.length });

    // 4. Parse PDF and split into individual pages
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const pageCount = pdfDoc.getPageCount();
    logger.info('📄 blueprint:split — pages', { pageCount });

    if (pageCount === 0) {
      res.status(400).json({ error: 'PDF не содержит страниц' });
      return;
    }

    // 5. Split each page into a separate PDF and save to Storage
    const pages: Array<{
      pageNumber: number;
      path: string;
      url: string;
      size: number;
      width: number;
      height: number;
    }> = [];

    const basePath = `projects/${data.projectId}/rasterized`;

    for (let i = 0; i < pageCount; i++) {
      const singlePageDoc = await PDFDocument.create();
      const [copiedPage] = await singlePageDoc.copyPages(pdfDoc, [i]);
      singlePageDoc.addPage(copiedPage);

      const pageBytes = await singlePageDoc.save();
      const pageBuffer = Buffer.from(pageBytes);

      const pagePath = `${basePath}/page-${i + 1}.pdf`;
      const pageFile = bucket.file(pagePath);

      await pageFile.save(pageBuffer, {
        metadata: {
          contentType: 'application/pdf',
          metadata: {
            projectId: data.projectId,
            sourceFileId: data.fileId,
            pageNumber: String(i + 1),
            totalPages: String(pageCount),
          },
        },
      });

      // Generate signed URL (30-day expiry)
      const [signedUrl] = await pageFile.getSignedUrl({
        action: 'read',
        expires: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });

      // Get page dimensions
      const pageObj = pdfDoc.getPage(i);
      const { width, height } = pageObj.getSize();

      pages.push({
        pageNumber: i + 1,
        path: pagePath,
        url: signedUrl,
        size: pageBuffer.length,
        width: Math.round(width),
        height: Math.round(height),
      });
    }

    // 6. Save split metadata to Firestore
    await db.collection('projects').doc(data.projectId)
      .collection('blueprint_pages').doc(data.fileId).set({
        sourceFileId: data.fileId,
        sourceFileName: fileMeta.name,
        totalPages: pageCount,
        pages,
        splitAt: FieldValue.serverTimestamp(),
        splitBy: req.agentUserId || 'agent',
      });

    logger.info('📄 blueprint:split — complete', { projectId: data.projectId, pageCount });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'blueprint_split',
      endpoint: '/api/blueprint/split',
      metadata: { projectId: data.projectId, fileId: data.fileId, pageCount },
    });

    res.status(200).json({
      projectId: data.projectId,
      fileId: data.fileId,
      totalPages: pageCount,
      pages,
      message: `PDF разбит на ${pageCount} страниц`,
    });
  } catch (e) {
    next(e);
  }
});

// ═══════════════════════════════════════════════════════════════════
// BLACKBOARD — Estimator V3 Phase 3
// ═══════════════════════════════════════════════════════════════════

router.post('/api/blackboard', async (req, res, next) => {
  try {
    const data = CreateBlackboardSchema.parse(req.body);
    logger.info('📋 blackboard:create', { projectId: data.projectId, version: data.version });

    // Validate project exists
    const projectDoc = await db.collection('projects').doc(data.projectId).get();
    if (!projectDoc.exists) {
      res.status(404).json({ error: `Проект "${data.projectId}" не найден` });
      return;
    }

    // Check if blackboard already exists for this project+version
    const existingSnap = await db.collection('estimate_blackboard')
      .where('projectId', '==', data.projectId)
      .where('version', '==', data.version)
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      // Update existing
      const existingDoc = existingSnap.docs[0];
      await existingDoc.ref.update({
        zones: data.zones,
        extracted_elements: data.extracted_elements,
        rfis: data.rfis,
        estimate_summary: data.estimate_summary,
        status: data.status,
        updatedAt: FieldValue.serverTimestamp(),
      });

      logger.info('📋 blackboard:updated', { blackboardId: existingDoc.id });
      res.json({
        blackboardId: existingDoc.id,
        updated: true,
        message: `Blackboard v${data.version} обновлён`,
      });
      return;
    }

    // Create new blackboard
    const docRef = await db.collection('estimate_blackboard').add({
      projectId: data.projectId,
      version: data.version,
      zones: data.zones,
      extracted_elements: data.extracted_elements,
      rfis: data.rfis,
      estimate_summary: data.estimate_summary,
      status: data.status,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: req.agentUserId || 'agent',
    });

    logger.info('📋 blackboard:created', { blackboardId: docRef.id });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'blackboard_created',
      endpoint: '/api/blackboard',
      metadata: { blackboardId: docRef.id, projectId: data.projectId, version: data.version },
    });

    res.status(201).json({
      blackboardId: docRef.id,
      message: `Blackboard v${data.version} создан`,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/api/blackboard/:projectId', async (req, res, next) => {
  try {
    const projectId = req.params.projectId;
    const version = req.query.version ? Number(req.query.version) : undefined;
    logger.info('📋 blackboard:get', { projectId, version });

    let q: admin.firestore.Query = db.collection('estimate_blackboard')
      .where('projectId', '==', projectId);

    if (version) {
      q = q.where('version', '==', version);
    }

    q = q.orderBy('version', 'desc').limit(1);
    const snap = await q.get();

    if (snap.empty) {
      res.status(404).json({ error: 'Blackboard не найден для проекта' });
      return;
    }

    const doc = snap.docs[0];
    const data = doc.data();

    res.json({
      blackboardId: doc.id,
      projectId: data.projectId,
      version: data.version,
      zones: data.zones || [],
      extracted_elements: data.extracted_elements || [],
      rfis: data.rfis || [],
      estimate_summary: data.estimate_summary || {},
      status: data.status,
      createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      updatedAt: data.updatedAt?.toDate?.()?.toISOString() || null,
    });
  } catch (e) {
    next(e);
  }
});


export default router;
