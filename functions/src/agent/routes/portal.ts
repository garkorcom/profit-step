/**
 * Portal Routes — PUBLIC (no bearer auth required).
 *
 * These routes are mounted BEFORE authMiddleware in agentApi.ts so that
 * the client can access the portal via URL + token without being a
 * logged-in agent or employee.
 *
 * Security model:
 * 1. Every request MUST carry a valid token (query param `?token=`)
 * 2. Token is looked up in `client_portal_tokens` by (slug, token)
 *    composite key
 * 3. Token must be non-revoked, non-expired
 * 4. On success: data is loaded from Firestore, filtered through
 *    portalFilter.ts (the security boundary), and returned
 * 5. Every view is logged to `portal_views` collection
 *
 * Endpoints:
 *   GET  /api/portal/:slug?token=...                   — main data
 *   POST /api/portal/:slug/approve                     — approve estimate section
 *   POST /api/portal/:slug/comment                     — ask question
 *
 * See src/pages/dashbord-for-client/SPEC.md §3 for architecture.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { db, FieldValue, logger } from '../routeContext';

// ─── Telegram admin notification (fire-and-forget) ──────────────────

const WORKER_BOT_TOKEN = process.env.WORKER_BOT_TOKEN || '';
const ADMIN_GROUP_ID = process.env.ADMIN_GROUP_ID || '';

async function notifyAdmin(text: string): Promise<void> {
  if (!WORKER_BOT_TOKEN || !ADMIN_GROUP_ID) return;
  try {
    const url = `https://api.telegram.org/bot${WORKER_BOT_TOKEN}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: Number(ADMIN_GROUP_ID),
        text,
        parse_mode: 'Markdown',
      }),
    });
  } catch (err) {
    logger.error('portal:telegram-notify-failed', { err: String(err) });
  }
}
import {
  buildPortalResponse,
  type InternalDashboardData,
  type InternalEstimate,
  type InternalProject,
  type InternalTask,
  type InternalLedgerEntry,
  type InternalPhoto,
} from '../utils/portalFilter';

const router = Router();

// ─── Helper: validate token + resolve clientId ───────────────────────

interface TokenDoc {
  id: string;
  clientId: string;
  slug: string;
  token: string;
  createdBy: string;
  createdAt: FirebaseFirestore.Timestamp;
  expiresAt: FirebaseFirestore.Timestamp;
  revokedAt: FirebaseFirestore.Timestamp | null;
  lastUsedAt: FirebaseFirestore.Timestamp | null;
  useCount: number;
}

async function validateToken(slug: string, token: string | undefined): Promise<TokenDoc | null> {
  if (!token || typeof token !== 'string') return null;

  const snap = await db
    .collection('client_portal_tokens')
    .where('slug', '==', slug)
    .where('token', '==', token)
    .limit(1)
    .get();

  if (snap.empty) return null;

  const doc = snap.docs[0];
  const data = doc.data() as Omit<TokenDoc, 'id'>;

  if (data.revokedAt) return null;
  if (data.expiresAt && data.expiresAt.toMillis() < Date.now()) return null;

  return { id: doc.id, ...data } as TokenDoc;
}

// ─── GET /api/portal/:slug ───────────────────────────────────────────

router.get('/api/portal/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = req.params;
    const token = req.query.token as string | undefined;

    logger.info('🌐 portal:get', { slug, hasToken: !!token });

    // Token validation with anti-timing-attack jitter
    const tokenDoc = await validateToken(slug, token);
    if (!tokenDoc) {
      // Small deterministic delay to make timing attacks harder
      await new Promise(r => setTimeout(r, 120 + Math.random() * 80));
      res.status(401).json({ error: 'Invalid or expired link' });
      return;
    }

    const clientId = tokenDoc.clientId;

    // Load client
    const clientDoc = await db.collection('clients').doc(clientId).get();
    if (!clientDoc.exists) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }
    const client = { id: clientDoc.id, ...clientDoc.data() } as { id: string; [key: string]: unknown };

    // Load related collections in parallel
    const [projectsSnap, estimatesSnap, tasksSnap, ledgerSnap] = await Promise.all([
      db.collection('projects').where('clientId', '==', clientId).get(),
      db.collection('estimates').where('clientId', '==', clientId).limit(50).get(),
      db.collection('gtd_tasks').where('clientId', '==', clientId).limit(100).get(),
      db.collection('project_ledger').where('clientId', '==', clientId).limit(100).get(),
    ]);

    const projects: InternalProject[] = projectsSnap.docs.map(d => ({
      id: d.id,
      ...(d.data() as Record<string, unknown>),
    }));
    const estimates: InternalEstimate[] = estimatesSnap.docs.map(d => ({
      id: d.id,
      ...(d.data() as Record<string, unknown>),
    }));
    const tasks: InternalTask[] = tasksSnap.docs.map(d => ({
      id: d.id,
      ...(d.data() as Record<string, unknown>),
    }));
    const ledger: InternalLedgerEntry[] = ledgerSnap.docs.map(d => ({
      id: d.id,
      ...(d.data() as Record<string, unknown>),
    }));

    // Photos — return empty array for now. Client still reads directly
    // from Storage via getDownloadURL, using client.id as the path.
    // Future: backend can generate signed URLs here.
    const photos: InternalPhoto[] = [];

    const internal: InternalDashboardData = {
      client: client as InternalDashboardData['client'],
      projects,
      estimates,
      tasks,
      ledger,
      photos,
    };

    // Filter through security boundary
    const portalData = buildPortalResponse(internal);

    // Fire-and-forget: log the view + update token usage + notify admin
    const clientName = (client.name as string) || slug;
    Promise.all([
      db.collection('portal_views').add({
        clientId,
        tokenId: tokenDoc.id,
        slug,
        ip: (req.ip || req.headers['x-forwarded-for'] || null) as unknown,
        userAgent: req.headers['user-agent'] || null,
        at: FieldValue.serverTimestamp(),
      }),
      db.collection('client_portal_tokens').doc(tokenDoc.id).update({
        lastUsedAt: FieldValue.serverTimestamp(),
        useCount: FieldValue.increment(1),
      }),
      notifyAdmin(`👁 *${clientName}* opened the portal`),
    ]).catch(err => {
      logger.error('portal:logging-failed', { err: String(err), tokenId: tokenDoc.id });
    });

    res.json({
      ...portalData,
      // Approval state is populated from estimate_approvals collection
      // in a future iteration. For now, return empty object.
      approvalState: {},
    });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/portal/:slug/approve ──────────────────────────────────

router.post('/api/portal/:slug/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = req.params;
    const { token, estimateId, sectionId, decision, comment } = req.body as {
      token?: string;
      estimateId?: string;
      sectionId?: string;
      decision?: 'approved' | 'questioned';
      comment?: string;
    };

    logger.info('🌐 portal:approve', { slug, estimateId, sectionId, decision });

    const tokenDoc = await validateToken(slug, token);
    if (!tokenDoc) {
      res.status(401).json({ error: 'Invalid or expired link' });
      return;
    }

    if (!estimateId || !sectionId) {
      res.status(400).json({ error: 'estimateId and sectionId are required' });
      return;
    }
    if (decision !== 'approved' && decision !== 'questioned') {
      res.status(400).json({ error: 'decision must be "approved" or "questioned"' });
      return;
    }

    // Write to estimate_approvals collection (audit trail)
    const approvalRef = await db.collection('estimate_approvals').add({
      clientId: tokenDoc.clientId,
      estimateId,
      sectionId,
      status: decision,
      comment: typeof comment === 'string' ? comment : null,
      by: 'client',
      tokenId: tokenDoc.id,
      slug,
      ip: (req.ip || req.headers['x-forwarded-for'] || null) as unknown,
      userAgent: req.headers['user-agent'] || null,
      at: FieldValue.serverTimestamp(),
    });

    logger.info('🌐 portal:approve:recorded', { approvalId: approvalRef.id });

    // Notify team via Telegram
    const clientDoc = await db.collection('clients').doc(tokenDoc.clientId).get();
    const cName = (clientDoc.data()?.name as string) || slug;
    const emoji = decision === 'approved' ? '✅' : '❓';
    const commentText = comment ? `\n💬 ${comment}` : '';
    notifyAdmin(`${emoji} *${cName}* ${decision} section \`${sectionId}\`${commentText}`).catch(() => {});

    res.status(201).json({
      ok: true,
      approvalId: approvalRef.id,
      status: decision,
    });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/portal/:slug/comment ──────────────────────────────────

router.post('/api/portal/:slug/comment', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = req.params;
    const { token, estimateId, text } = req.body as {
      token?: string;
      estimateId?: string;
      text?: string;
    };

    logger.info('🌐 portal:comment', { slug, estimateId });

    const tokenDoc = await validateToken(slug, token);
    if (!tokenDoc) {
      res.status(401).json({ error: 'Invalid or expired link' });
      return;
    }

    if (!estimateId || typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: 'estimateId and non-empty text are required' });
      return;
    }

    // Rate limit: simple check — no more than 5 comments per token per 5 minutes
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recentSnap = await db
      .collection('client_portal_comments')
      .where('tokenId', '==', tokenDoc.id)
      .where('at', '>=', fiveMinAgo)
      .get();
    if (recentSnap.size >= 5) {
      res.status(429).json({ error: 'Too many comments, please wait' });
      return;
    }

    const commentRef = await db.collection('client_portal_comments').add({
      clientId: tokenDoc.clientId,
      estimateId,
      text: text.trim().slice(0, 2000),
      by: 'client',
      tokenId: tokenDoc.id,
      slug,
      ip: (req.ip || req.headers['x-forwarded-for'] || null) as unknown,
      userAgent: req.headers['user-agent'] || null,
      at: FieldValue.serverTimestamp(),
      readByTeam: false,
    });

    logger.info('🌐 portal:comment:recorded', { commentId: commentRef.id });

    res.status(201).json({ ok: true, commentId: commentRef.id });
  } catch (e) {
    next(e);
  }
});

export default router;
