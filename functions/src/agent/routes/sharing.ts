/**
 * Sharing Routes — AUTHENTICATED (requires bearer token via authMiddleware).
 *
 * Token lifecycle management for client portal:
 *   POST   /api/clients/:id/share-tokens       — create new share token
 *   GET    /api/clients/:id/share-tokens       — list active tokens
 *   DELETE /api/clients/:id/share-tokens/:tid  — revoke token
 *
 * These routes are mounted AFTER authMiddleware, so every request must
 * carry a valid agent Bearer token (employee-side auth).
 *
 * See src/pages/dashbord-for-client/SPEC.md §3.5 and §5 for architecture.
 */

import { Router, Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import { db, FieldValue, Timestamp, logger } from '../routeContext';

const router = Router();

// ─── helpers ──────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

async function ensureUniqueSlug(baseSlug: string, clientId: string): Promise<string> {
  // Check if any OTHER client already has a token with this slug
  const snap = await db
    .collection('client_portal_tokens')
    .where('slug', '==', baseSlug)
    .limit(5)
    .get();

  const conflicting = snap.docs.some(d => d.data().clientId !== clientId);
  if (!conflicting) return baseSlug;

  // Add numeric suffix until unique
  for (let n = 2; n < 20; n++) {
    const candidate = `${baseSlug}-${n}`;
    const s = await db
      .collection('client_portal_tokens')
      .where('slug', '==', candidate)
      .limit(1)
      .get();
    if (s.empty) return candidate;
  }
  // Fallback — use short random suffix
  return `${baseSlug}-${crypto.randomBytes(2).toString('hex')}`;
}

function generateToken(): string {
  // 20 bytes = 40 hex chars = 160 bits entropy — overkill but future-proof
  return crypto.randomBytes(20).toString('hex');
}

// ─── POST /api/clients/:id/share-tokens ──────────────────────────────

router.post('/api/clients/:id/share-tokens', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clientId = req.params.id;
    const { expiresInDays } = req.body as { expiresInDays?: number };

    logger.info('🔑 sharing:create', { clientId, expiresInDays });

    // Verify client exists
    const clientDoc = await db.collection('clients').doc(clientId).get();
    if (!clientDoc.exists) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }
    const clientData = clientDoc.data()!;
    const clientName = (clientData.name as string) || 'client';

    // Generate or reuse slug
    // If the client already has a portalSlug field, use it; otherwise
    // generate from name and ensure uniqueness
    let slug: string;
    if (typeof clientData.portalSlug === 'string' && clientData.portalSlug.length > 0) {
      slug = clientData.portalSlug;
    } else {
      const baseSlug = slugify(clientName);
      slug = await ensureUniqueSlug(baseSlug, clientId);
      // Persist the slug on the client doc for future tokens
      await clientDoc.ref.update({ portalSlug: slug });
    }

    // Generate token
    const token = generateToken();

    // Default expiry: 30 days, but capped at 365
    const days = Math.min(Math.max(expiresInDays || 30, 1), 365);
    const expiresAt = Timestamp.fromMillis(Date.now() + days * 24 * 60 * 60 * 1000);

    // createdBy comes from authMiddleware's agentUserId — assert with
    // optional chaining for safety
    const createdBy = (req as unknown as { agentUserId?: string }).agentUserId || 'unknown';

    const tokenDocRef = await db.collection('client_portal_tokens').add({
      clientId,
      slug,
      token,
      createdBy,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt,
      revokedAt: null,
      lastUsedAt: null,
      useCount: 0,
    });

    logger.info('🔑 sharing:created', { clientId, slug, tokenId: tokenDocRef.id });

    res.status(201).json({
      tokenId: tokenDocRef.id,
      slug,
      token,
      url: `/portal/${slug}?token=${token}`,
      expiresAt: expiresAt.toDate().toISOString(),
      expiresInDays: days,
    });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/clients/:id/share-tokens ───────────────────────────────

router.get('/api/clients/:id/share-tokens', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clientId = req.params.id;
    logger.info('🔑 sharing:list', { clientId });

    const snap = await db
      .collection('client_portal_tokens')
      .where('clientId', '==', clientId)
      .get();

    const tokens = snap.docs
      .map(d => {
        const data = d.data();
        return {
          id: d.id,
          slug: data.slug,
          createdBy: data.createdBy,
          createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
          expiresAt: data.expiresAt?.toDate?.()?.toISOString() || null,
          revokedAt: data.revokedAt?.toDate?.()?.toISOString() || null,
          lastUsedAt: data.lastUsedAt?.toDate?.()?.toISOString() || null,
          useCount: data.useCount || 0,
          // NEVER return the raw token here — only in the POST response
          // when it was just created. After that, it's write-only.
          tokenPreview: `${(data.token as string).slice(0, 6)}…`,
          active:
            !data.revokedAt &&
            data.expiresAt &&
            (data.expiresAt as FirebaseFirestore.Timestamp).toMillis() > Date.now(),
        };
      })
      .sort((a, b) => {
        const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bt - at;
      });

    res.json({ tokens, count: tokens.length });
  } catch (e) {
    next(e);
  }
});

// ─── DELETE /api/clients/:id/share-tokens/:tokenId ───────────────────

router.delete('/api/clients/:id/share-tokens/:tokenId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id: clientId, tokenId } = req.params;
    logger.info('🔑 sharing:revoke', { clientId, tokenId });

    const ref = db.collection('client_portal_tokens').doc(tokenId);
    const doc = await ref.get();
    if (!doc.exists) {
      res.status(404).json({ error: 'Token not found' });
      return;
    }
    // Verify token belongs to the requested client (prevent cross-client revoke)
    const data = doc.data()!;
    if (data.clientId !== clientId) {
      res.status(403).json({ error: 'Token does not belong to this client' });
      return;
    }
    if (data.revokedAt) {
      res.status(200).json({ ok: true, alreadyRevoked: true });
      return;
    }

    await ref.update({
      revokedAt: FieldValue.serverTimestamp(),
      revokedBy: (req as unknown as { agentUserId?: string }).agentUserId || 'unknown',
    });

    res.json({ ok: true, tokenId });
  } catch (e) {
    next(e);
  }
});

export default router;
