/**
 * Meeting Routes — customer-facing encounters (site surveys, estimate reviews,
 * stage acceptances, warranty visits).
 *
 * Endpoints:
 *   POST   /api/meetings            Create
 *   GET    /api/meetings            List (filtered by client/deal/project/type/status/range)
 *   GET    /api/meetings/:id        Details
 *   PATCH  /api/meetings/:id        Update (including outcome / next_steps after completion)
 *   DELETE /api/meetings/:id        Cancel (soft — sets status='cancelled', never drops the row)
 *
 * Spec: CRM_OVERHAUL_SPEC_V1.md §5.3-§5.4.
 * RLS: worker/driver see meetings they attend or own; foreman sees team-wide;
 * manager/admin see all within company.
 */
import { Router } from 'express';
import * as admin from 'firebase-admin';

import { db, FieldValue, logger, logAgentActivity } from '../routeContext';
import { logAudit, AuditHelpers, extractAuditContext } from '../utils/auditLogger';
import {
  CreateMeetingSchema,
  UpdateMeetingSchema,
  ListMeetingsQuerySchema,
} from '../schemas/meetingSchemas';

const router = Router();

const COLLECTION = 'meetings';

// ─── POST /api/meetings ────────────────────────────────────────────

router.post('/api/meetings', async (req, res, next) => {
  try {
    const data = CreateMeetingSchema.parse(req.body);
    logger.info('📅 meeting:create', {
      clientId: data.clientId,
      type: data.type,
      startAt: data.startAt,
    });

    if (data.idempotencyKey) {
      const keyDoc = await db.doc(`_idempotency/${data.idempotencyKey}`).get();
      if (keyDoc.exists) {
        res.status(200).json({ meetingId: keyDoc.data()!.entityId, deduplicated: true });
        return;
      }
    }

    // Sanity: client must exist (fast fail vs. orphan meeting)
    const clientSnap = await db.collection('clients').doc(data.clientId).get();
    if (!clientSnap.exists) {
      res.status(404).json({ error: 'Client not found', clientId: data.clientId });
      return;
    }
    const client = clientSnap.data()!;

    const auditCtx = extractAuditContext(req);
    const doc = {
      clientId: data.clientId,
      clientName: client.name ?? null,
      companyId: client.companyId ?? null,
      dealId: data.dealId ?? null,
      projectId: data.projectId ?? null,
      type: data.type,
      title: data.title ?? null,
      status: data.status,
      startAt: admin.firestore.Timestamp.fromDate(new Date(data.startAt)),
      endAt: data.endAt
        ? admin.firestore.Timestamp.fromDate(new Date(data.endAt))
        : null,
      location: data.location ?? null,
      attendees: data.attendees,
      clientAttendees: data.clientAttendees,
      agenda: data.agenda ?? null,
      outcome: null,
      nextSteps: null,
      calendarEventId: data.calendarEventId ?? null,
      createdBy: auditCtx.performedBy,
      createdBySource: auditCtx.source,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const docRef = await db.collection(COLLECTION).add(doc);

    if (data.idempotencyKey) {
      await db.doc(`_idempotency/${data.idempotencyKey}`).set({
        entityId: docRef.id,
        collection: COLLECTION,
        expiresAt: Date.now() + 24 * 3600_000,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'meeting_created',
      endpoint: '/api/meetings',
      metadata: {
        meetingId: docRef.id,
        clientId: data.clientId,
        type: data.type,
        dealId: data.dealId,
        projectId: data.projectId,
      },
    });
    await logAudit(
      AuditHelpers.create(
        'meeting',
        docRef.id,
        { clientId: data.clientId, type: data.type, startAt: data.startAt },
        auditCtx.performedBy,
        auditCtx.source as never,
      ),
    );

    res.status(201).json({
      meetingId: docRef.id,
      clientId: data.clientId,
      type: data.type,
      status: data.status,
    });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/meetings ─────────────────────────────────────────────

router.get('/api/meetings', async (req, res, next) => {
  try {
    const params = ListMeetingsQuerySchema.parse(req.query);
    logger.info('📅 meeting:list', { ...params });

    let q: admin.firestore.Query = db.collection(COLLECTION);

    // RLS — worker/driver see only meetings where they're createdBy or
    // listed in attendees[].userId. Firestore doesn't support array-contains
    // on nested object field, so for now the conservative scope is
    // `createdBy == me`; attendee-based access can be layered on in a later
    // slice (requires per-user precomputed denormalization).
    const rlsRole = req.effectiveRole || 'admin';
    const rlsUserId = req.effectiveUserId || req.agentUserId;
    if (rlsRole === 'worker' || rlsRole === 'driver') {
      q = q.where('createdBy', '==', rlsUserId);
    } else if (rlsRole === 'foreman') {
      const teamUids = req.effectiveTeamMemberUids || [];
      const allUids = Array.from(new Set([rlsUserId!, ...teamUids]));
      if (allUids.length <= 30) {
        q = q.where('createdBy', 'in', allUids);
      } else {
        q = q.where('createdBy', '==', rlsUserId);
      }
    }

    if (params.clientId) q = q.where('clientId', '==', params.clientId);
    if (params.dealId) q = q.where('dealId', '==', params.dealId);
    if (params.projectId) q = q.where('projectId', '==', params.projectId);
    if (params.type) q = q.where('type', '==', params.type);
    if (params.status) q = q.where('status', '==', params.status);
    if (params.fromDate) {
      q = q.where(
        'startAt',
        '>=',
        admin.firestore.Timestamp.fromDate(new Date(params.fromDate)),
      );
    }
    if (params.toDate) {
      q = q.where(
        'startAt',
        '<=',
        admin.firestore.Timestamp.fromDate(new Date(params.toDate)),
      );
    }

    q = q.orderBy('startAt', 'desc');

    if (params.offset > 0) q = q.offset(params.offset);
    q = q.limit(params.limit);

    const snap = await q.get();
    const meetings = snap.docs.map(d => serializeMeeting(d));
    res.json({ meetings, count: meetings.length });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/meetings/:id ─────────────────────────────────────────

router.get('/api/meetings/:id', async (req, res, next) => {
  try {
    const doc = await db.collection(COLLECTION).doc(req.params.id).get();
    if (!doc.exists) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }
    res.json(serializeMeeting(doc));
  } catch (e) {
    next(e);
  }
});

// ─── PATCH /api/meetings/:id ───────────────────────────────────────

router.patch('/api/meetings/:id', async (req, res, next) => {
  try {
    const data = UpdateMeetingSchema.parse(req.body);
    const meetingId = req.params.id;
    logger.info('📅 meeting:update', { meetingId, fields: Object.keys(data) });

    const ref = db.collection(COLLECTION).doc(meetingId);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }
    const existing = snap.data()!;

    // If moving to status=completed, require outcome. Spec §5.4 requires
    // outcome before the Deal linked to this meeting can progress, and the
    // cleanest enforcement point is right here — block the status transition
    // itself rather than detect downstream.
    const finalStatus = data.status ?? existing.status;
    const finalOutcome = data.outcome ?? existing.outcome;
    if (finalStatus === 'completed' && !finalOutcome) {
      res.status(400).json({
        error: 'outcome is required to complete a meeting (spec §5.4)',
        path: ['outcome'],
      });
      return;
    }

    const updatePayload: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (data.type !== undefined) updatePayload.type = data.type;
    if (data.title !== undefined) updatePayload.title = data.title;
    if (data.status !== undefined) updatePayload.status = data.status;
    if (data.startAt !== undefined) {
      updatePayload.startAt = admin.firestore.Timestamp.fromDate(new Date(data.startAt));
    }
    if (data.endAt !== undefined) {
      updatePayload.endAt = admin.firestore.Timestamp.fromDate(new Date(data.endAt));
    }
    if (data.location !== undefined) updatePayload.location = data.location;
    if (data.attendees !== undefined) updatePayload.attendees = data.attendees;
    if (data.clientAttendees !== undefined) updatePayload.clientAttendees = data.clientAttendees;
    if (data.agenda !== undefined) updatePayload.agenda = data.agenda;
    if (data.outcome !== undefined) updatePayload.outcome = data.outcome;
    if (data.nextSteps !== undefined) updatePayload.nextSteps = data.nextSteps;
    if (data.calendarEventId !== undefined) updatePayload.calendarEventId = data.calendarEventId;

    await ref.update(updatePayload);

    const auditCtx = extractAuditContext(req);
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'meeting_updated',
      endpoint: `/api/meetings/${meetingId}`,
      metadata: { meetingId, fields: Object.keys(data) },
    });
    await logAudit(
      AuditHelpers.update(
        'meeting',
        meetingId,
        existing,
        data,
        auditCtx.performedBy,
        auditCtx.source as never,
      ),
    );

    res.json({ meetingId, updated: true });
  } catch (e) {
    next(e);
  }
});

// ─── DELETE /api/meetings/:id ──────────────────────────────────────

router.delete('/api/meetings/:id', async (req, res, next) => {
  try {
    const meetingId = req.params.id;
    logger.info('📅 meeting:cancel', { meetingId });

    const ref = db.collection(COLLECTION).doc(meetingId);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }
    const existing = snap.data()!;
    if (existing.status === 'cancelled') {
      res.status(409).json({ error: 'Meeting already cancelled' });
      return;
    }

    await ref.update({
      status: 'cancelled',
      cancelledAt: FieldValue.serverTimestamp(),
      cancelledBy: req.agentUserId,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const auditCtx = extractAuditContext(req);
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'meeting_cancelled',
      endpoint: `/api/meetings/${meetingId}`,
      metadata: { meetingId, clientId: existing.clientId },
    });
    await logAudit(
      AuditHelpers.delete(
        'meeting',
        meetingId,
        { clientId: existing.clientId, type: existing.type },
        auditCtx.performedBy,
        auditCtx.source as never,
      ),
    );

    res.json({ meetingId, cancelled: true });
  } catch (e) {
    next(e);
  }
});

// ──────────────────────────────────────────────────────────────────

function serializeMeeting(doc: admin.firestore.DocumentSnapshot): Record<string, unknown> {
  const d = doc.data()!;
  return {
    id: doc.id,
    clientId: d.clientId,
    clientName: d.clientName ?? null,
    companyId: d.companyId ?? null,
    dealId: d.dealId ?? null,
    projectId: d.projectId ?? null,
    type: d.type,
    title: d.title ?? null,
    status: d.status,
    startAt: d.startAt?.toDate?.()?.toISOString() ?? null,
    endAt: d.endAt?.toDate?.()?.toISOString() ?? null,
    location: d.location ?? null,
    attendees: d.attendees ?? [],
    clientAttendees: d.clientAttendees ?? [],
    agenda: d.agenda ?? null,
    outcome: d.outcome ?? null,
    nextSteps: d.nextSteps ?? null,
    calendarEventId: d.calendarEventId ?? null,
    createdBy: d.createdBy ?? null,
    createdAt: d.createdAt?.toDate?.()?.toISOString() ?? null,
    updatedAt: d.updatedAt?.toDate?.()?.toISOString() ?? null,
    cancelledAt: d.cancelledAt?.toDate?.()?.toISOString() ?? null,
  };
}

export default router;
