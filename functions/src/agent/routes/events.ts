/**
 * Agent Event Queue Routes
 *
 * Polling-based event stream for external agents.
 * Agents call GET /api/events?since=<ISO timestamp> to get new events.
 *
 * Events are published by Firestore triggers and API mutations into
 * the agent_events collection. Each event has a type, entityId, and
 * summary — enough for an agent to decide whether to fetch details.
 *
 * Collection: agent_events
 * Document schema:
 *   - type: string (task | session | cost | estimate | project | inventory | payroll | alert)
 *   - action: string (created | updated | deleted | assigned | completed | started | stopped)
 *   - entityId: string
 *   - entityType: string (gtd_task | work_session | cost | estimate | project | ...)
 *   - summary: string (human-readable one-liner)
 *   - data: object (key fields for quick processing without extra API call)
 *   - employeeId: string | null (who is affected / should see this)
 *   - companyId: string | null
 *   - createdAt: Timestamp
 *   - source: string (api | bot | trigger | scheduled)
 */
import { Router } from 'express';

import { db, Timestamp } from '../routeContext';
import { requireScope } from '../agentMiddleware';
import { EventsQuerySchema } from '../schemas/agentTokenSchemas';

const router = Router();

// ─── GET /api/events — Poll for new events ────────────────────────────

router.get('/api/events', requireScope('events:read', 'admin'), async (req, res, next) => {
  try {
    const params = EventsQuerySchema.parse(req.query);

    const sinceDate = new Date(params.since);
    if (isNaN(sinceDate.getTime())) {
      res.status(400).json({ error: 'Invalid "since" date — use ISO 8601 format' });
      return;
    }
    const sinceTimestamp = Timestamp.fromDate(sinceDate);

    let query: FirebaseFirestore.Query = db.collection('agent_events')
      .where('createdAt', '>', sinceTimestamp)
      .orderBy('createdAt', 'asc')
      .limit(params.limit);

    // If not admin — filter to events for this employee only
    const isAdmin = (req.agentScopes || []).includes('admin');
    if (!isAdmin && req.agentUserId) {
      // Employee sees: events targeted at them OR global events (employeeId == null)
      // Firestore doesn't support OR on different fields, so we do two queries
      const [personalSnap, globalSnap] = await Promise.all([
        db.collection('agent_events')
          .where('employeeId', '==', req.agentUserId)
          .where('createdAt', '>', sinceTimestamp)
          .orderBy('createdAt', 'asc')
          .limit(params.limit)
          .get(),
        db.collection('agent_events')
          .where('employeeId', '==', null)
          .where('createdAt', '>', sinceTimestamp)
          .orderBy('createdAt', 'asc')
          .limit(params.limit)
          .get(),
      ]);

      const allDocs = [...personalSnap.docs, ...globalSnap.docs]
        .sort((a, b) => {
          const aTime = a.data().createdAt?.toMillis?.() || 0;
          const bTime = b.data().createdAt?.toMillis?.() || 0;
          return aTime - bTime;
        })
        .slice(0, params.limit);

      // Filter by type if specified
      let events = allDocs.map(d => formatEvent(d));
      if (params.types) {
        const typeFilter = params.types.split(',').map((t: string) => t.trim());
        events = events.filter(e => typeFilter.includes(e.type));
      }

      res.json({ events, count: events.length });
      return;
    }

    // Admin: single query, all events
    const snap = await query.get();
    let events = snap.docs.map(d => formatEvent(d));

    if (params.types) {
      const typeFilter = params.types.split(',').map((t: string) => t.trim());
      events = events.filter(e => typeFilter.includes(e.type));
    }

    res.json({ events, count: events.length });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/events/types — List available event types ────────────────

router.get('/api/events/types', requireScope('events:read', 'admin'), (_req, res) => {
  res.json({
    types: [
      { type: 'task', actions: ['created', 'updated', 'assigned', 'completed', 'blocked'] },
      { type: 'session', actions: ['started', 'stopped', 'paused', 'auto_closed'] },
      { type: 'cost', actions: ['created', 'voided'] },
      { type: 'estimate', actions: ['created', 'sent', 'approved', 'rejected'] },
      { type: 'project', actions: ['created', 'updated', 'completed'] },
      { type: 'inventory', actions: ['transaction', 'low_stock'] },
      { type: 'payroll', actions: ['period_closed', 'period_locked', 'period_paid'] },
      { type: 'alert', actions: ['budget_warning', 'deadline', 'safety', 'idle_session'] },
    ],
  });
});

function formatEvent(doc: FirebaseFirestore.QueryDocumentSnapshot) {
  const data = doc.data();
  return {
    eventId: doc.id,
    type: data.type,
    action: data.action,
    entityId: data.entityId,
    entityType: data.entityType,
    summary: data.summary,
    data: data.data || {},
    employeeId: data.employeeId || null,
    source: data.source || 'system',
    createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
  };
}

export default router;
