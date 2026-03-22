/**
 * Agent API Helpers
 * - Client cache: Firestore-based with TTL and stale flag
 * - Activity audit logger: writes to activityLog collection
 * - Cost category labels mapping
 */

import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Fuse = require('fuse.js');

const logger = functions.logger;
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

// ─── Types ──────────────────────────────────────────────────────────

export interface ClientItem {
  id: string;
  name: string;
  address: string | null;
}

// ─── Cost Categories ────────────────────────────────────────────────

export const COST_CATEGORY_LABELS: Record<string, string> = {
  materials: 'Материалы',
  tools: 'Инструменты',
  reimbursement: 'Возмещение',
  fuel: 'Топливо',
  housing: 'Жильё',
  food: 'Питание',
  permit: 'Разрешения',
  other: 'Прочее',
};

// ─── Client Cache ───────────────────────────────────────────────────

const CACHE_DOC_PATH = '_cache/active_clients';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get cached clients from Firestore cache document.
 * Returns fresh data if cache is expired or marked stale.
 */
export async function getCachedClients(): Promise<ClientItem[]> {
  const cacheDoc = await db.doc(CACHE_DOC_PATH).get();

  if (cacheDoc.exists) {
    const data = cacheDoc.data()!;
    if (!data.stale && data.expiresAt > Date.now()) {
      logger.info('🔍 clients:cache HIT', { count: data.clients.length });
      return data.clients as ClientItem[];
    }
  }

  return refreshClientCache();
}

/**
 * Refresh client cache from Firestore.
 * Uses set with merge for anti-stampede.
 */
async function refreshClientCache(): Promise<ClientItem[]> {
  logger.info('🔍 clients:cache MISS — refreshing');
  const snap = await db.collection('clients')
    .where('status', '==', 'active').get();

  const clients: ClientItem[] = snap.docs.map((d) => ({
    id: d.id,
    name: d.data().name || '',
    address: d.data().address || null,
  }));

  await db.doc(CACHE_DOC_PATH).set({
    clients,
    expiresAt: Date.now() + CACHE_TTL_MS,
    stale: false,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true }); // merge = anti-stampede

  logger.info('🔍 clients:cache refreshed', { count: clients.length });
  return clients;
}

/**
 * Fuzzy search a single client by name.
 * Returns the best match or null.
 */
export async function fuzzySearchClient(name: string): Promise<ClientItem | null> {
  const clients = await getCachedClients();
  const fuse = new Fuse(clients, { keys: ['name', 'address'], threshold: 0.4 });
  const results = fuse.search(name, { limit: 1 });
  return results.length > 0 ? results[0].item : null;
}

// ─── Company ID Resolution ──────────────────────────────────────────

let cachedCompanyId: string | null = null;

/**
 * Resolve the owner's companyId.
 * Priority: env OWNER_COMPANY_ID → cached → Firestore user profile lookup.
 */
export async function resolveOwnerCompanyId(): Promise<string> {
  // 1. Check env
  const envCompanyId = process.env.OWNER_COMPANY_ID;
  if (envCompanyId) return envCompanyId;

  // 2. Check cache
  if (cachedCompanyId) return cachedCompanyId;

  // 3. Lookup from Firestore user profile
  const ownerUid = process.env.OWNER_UID;
  if (!ownerUid) throw new Error('OWNER_UID not configured');

  const userDoc = await db.collection('users').doc(ownerUid).get();
  if (!userDoc.exists) throw new Error(`Owner user ${ownerUid} not found in Firestore`);

  const companyId = userDoc.data()?.companyId as string;
  if (!companyId) throw new Error(`Owner user ${ownerUid} has no companyId`);

  cachedCompanyId = companyId;
  logger.info('🏢 Resolved owner companyId', { companyId });
  return companyId;
}

// ─── Activity Logger ────────────────────────────────────────────────

/**
 * Log agent activity to the activityLog collection (for audit trail).
 * Only call on mutations (POST), not reads (GET).
 * Silently handles Firestore quota errors.
 */
export async function logAgentActivity(params: {
  userId: string;
  action: string;
  endpoint: string;
  metadata?: Record<string, any>;
}): Promise<void> {
  try {
    await db.collection('activityLog').add({
      ...params,
      source: 'openclaw_agent',
      timestamp: FieldValue.serverTimestamp(),
    });
    logger.info(`📝 Agent activity: ${params.action}`, params.metadata);
  } catch (e: any) {
    logger.error('⚠️ Audit log write failed (quota?)', {
      error: e.message,
      code: e.code,
      action: params.action,
    });
  }
}
