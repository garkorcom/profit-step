/**
 * Document routes — draft/post/void lifecycle.
 *
 * Endpoints:
 *   POST   /api/warehouse/documents                create draft
 *   GET    /api/warehouse/documents/:id            fetch + lines
 *   GET    /api/warehouse/documents                list w/ filters
 *   POST   /api/warehouse/documents/:id/post       post (idempotent)
 *   POST   /api/warehouse/documents/:id/void       void (with reversal for posted)
 *
 * Route-layer is thin: schema validation + RLS + delegation to Firestore
 * adapter (warehouse/api/firestoreAdapter.ts). No business logic here.
 */

import { Router } from 'express';
import * as admin from 'firebase-admin';
import { db, FieldValue, logger, logAgentActivity } from '../../../agent/routeContext';
import { CreateWhDocumentSchema } from '../../database/schemas';
import { WH_COLLECTIONS } from '../../database/collections';
import { nextDocNumber, runPostDocument, runVoidDocument } from '../firestoreAdapter';
import { wrapRoute } from '../errorHandler';

const router = Router();

// ─── POST /api/warehouse/documents ──────────────────────────────────

router.post(
  '/api/warehouse/documents',
  wrapRoute(async (req, res) => {
    const data = CreateWhDocumentSchema.parse(req.body);

    const docRef = db.collection(WH_COLLECTIONS.documents).doc();
    const docNumber = await nextDocNumber(db, data.docType);

    const now = FieldValue.serverTimestamp();
    const eventDate = typeof data.eventDate === 'string'
      ? admin.firestore.Timestamp.fromDate(new Date(data.eventDate))
      : data.eventDate;

    // Parent document (no lines in inline form — lines go to subcollection)
    const { lines, eventDate: _dropEventDate, ...docFields } = data;

    await db.runTransaction(async (tx) => {
      tx.set(docRef, {
        ...docFields,
        id: docRef.id,
        schemaVersion: 1,
        docNumber,
        status: 'draft',
        eventDate,
        createdAt: now,
        updatedAt: now,
        createdBy: req.agentUserId ?? 'api',
        createdByType: (docFields.source === 'ai' ? 'ai_agent' : 'human'),
      });
      let lineNumber = 1;
      for (const line of lines) {
        const lineRef = docRef.collection(WH_COLLECTIONS.documentLinesSub).doc();
        tx.set(lineRef, {
          id: lineRef.id,
          lineNumber: lineNumber++,
          ...line,
        });
      }
    });

    logger.info('🏭 warehouse:document.created', {
      documentId: docRef.id,
      docType: data.docType,
      lineCount: data.lines.length,
    });

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'warehouse_document_created',
      endpoint: '/api/warehouse/documents',
      metadata: { documentId: docRef.id, docType: data.docType, lineCount: data.lines.length },
    });

    res.status(201).json({
      documentId: docRef.id,
      docNumber,
      status: 'draft',
    });
  }),
);

// ─── GET /api/warehouse/documents/:id ───────────────────────────────

router.get(
  '/api/warehouse/documents/:id',
  wrapRoute(async (req, res) => {
    const { id } = req.params;
    const snap = await db.collection(WH_COLLECTIONS.documents).doc(id).get();
    if (!snap.exists) {
      res.status(404).json({ error: { code: 'DOCUMENT_NOT_FOUND', message: `Document ${id} not found` } });
      return;
    }
    const linesSnap = await snap.ref.collection(WH_COLLECTIONS.documentLinesSub).orderBy('lineNumber').get();
    res.status(200).json({
      document: { id: snap.id, ...snap.data() },
      lines: linesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    });
  }),
);

// ─── GET /api/warehouse/documents ───────────────────────────────────

router.get(
  '/api/warehouse/documents',
  wrapRoute(async (req, res) => {
    const {
      docType,
      status,
      projectId,
      sourceLocationId,
      destinationLocationId,
      limit: limitStr,
    } = req.query;
    let q: FirebaseFirestore.Query = db.collection(WH_COLLECTIONS.documents);
    if (typeof docType === 'string') q = q.where('docType', '==', docType);
    if (typeof status === 'string') q = q.where('status', '==', status);
    if (typeof projectId === 'string') q = q.where('projectId', '==', projectId);
    if (typeof sourceLocationId === 'string') q = q.where('sourceLocationId', '==', sourceLocationId);
    if (typeof destinationLocationId === 'string') q = q.where('destinationLocationId', '==', destinationLocationId);
    const lim = Math.min(Number(limitStr ?? 50), 200);
    const snap = await q.orderBy('createdAt', 'desc').limit(lim).get();
    res.status(200).json({
      documents: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
      total: snap.size,
    });
  }),
);

// ─── POST /api/warehouse/documents/:id/post ─────────────────────────

router.post(
  '/api/warehouse/documents/:id/post',
  wrapRoute(async (req, res) => {
    const { id } = req.params;
    const idempotencyKey = typeof req.header('Idempotency-Key') === 'string'
      ? req.header('Idempotency-Key')!
      : undefined;

    const result = await runPostDocument(db, id, {
      userId: req.agentUserId ?? 'api',
      idempotencyKey,
    });

    logger.info('🏭 warehouse:document.posted', {
      documentId: id,
      alreadyPosted: result.alreadyPosted,
      ledgerEntryCount: result.ledgerEntryIds.length,
    });

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'warehouse_document_posted',
      endpoint: `/api/warehouse/documents/${id}/post`,
      metadata: {
        documentId: id,
        alreadyPosted: result.alreadyPosted,
        ledgerEntryCount: result.ledgerEntryIds.length,
        events: result.events,
      },
    });

    res.status(200).json(result);
  }),
);

// ─── POST /api/warehouse/documents/:id/void ─────────────────────────

router.post(
  '/api/warehouse/documents/:id/void',
  wrapRoute(async (req, res) => {
    const { id } = req.params;
    const { reason, note } = req.body ?? {};
    if (typeof reason !== 'string' || reason.length === 0) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'reason is required' } });
      return;
    }

    const result = await runVoidDocument(db, id, {
      userId: req.agentUserId ?? 'api',
      reason,
      note,
    });

    logger.info('🏭 warehouse:document.voided', {
      documentId: id,
      reversalDocumentId: result.reversalDocumentId,
    });

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'warehouse_document_voided',
      endpoint: `/api/warehouse/documents/${id}/void`,
      metadata: {
        documentId: id,
        reversalDocumentId: result.reversalDocumentId,
        events: result.events,
      },
    });

    res.status(200).json(result);
  }),
);

export default router;
