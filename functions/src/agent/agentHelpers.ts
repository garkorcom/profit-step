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
  phone?: string | null;
  email?: string | null;
  status?: string | null;
  type?: string | null;
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
    .where('status', 'in', ['new', 'contacted', 'qualified', 'customer', 'active']).get();

  const clients: ClientItem[] = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      name: data.name || '',
      address: data.address || null,
      phone: data.phone || data.contacts?.[0]?.phone || null,
      email: data.email || data.contacts?.[0]?.email || null,
      status: data.status || null,
      type: data.type || null,
    };
  });

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

// ─── Client Search by Address ───────────────────────────────────────

/**
 * Search for a client by address (exact or fuzzy).
 * First tries exact match, then fuzzy with threshold 0.3.
 * Uses the cached active clients list (5-min TTL) instead of
 * scanning the entire clients collection.
 */
export async function searchClientByAddress(address: string): Promise<ClientItem | null> {
  const normalized = address.trim().toLowerCase();
  if (!normalized) return null;

  // Use cached clients instead of full collection scan
  const allClients = await getCachedClients();

  // 1. Exact address match (case-insensitive)
  const exact = allClients.find(
    (c) => c.address && c.address.trim().toLowerCase() === normalized
  );
  if (exact) {
    logger.info('🔍 client:address exact match', { clientId: exact.id, address });
    return exact;
  }

  // 2. Fuzzy match on address field
  const fuse = new Fuse(allClients.filter((c) => c.address), {
    keys: ['address'],
    threshold: 0.3,
  });
  const results = fuse.search(address, { limit: 1 });
  if (results.length > 0) {
    logger.info('🔍 client:address fuzzy match', {
      clientId: results[0].item.id,
      score: results[0].score,
      address,
    });
    return results[0].item;
  }

  return null;
}

/**
 * Auto-create a client with address as name.
 * Used when estimate/project has address but no existing client.
 * Invalidates client cache after creation.
 */
export async function autoCreateClientByAddress(
  address: string,
  source: string
): Promise<{ id: string; name: string }> {
  const docRef = db.collection('clients').doc();
  const clientName = address.trim();

  await docRef.set({
    name: clientName,
    address: clientName,
    contactPerson: '',
    phone: '',
    email: '',
    notes: `Auto-created from ${source}`,
    status: 'active',
    source: source,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Invalidate cache so next search picks up the new client
  await db.doc(CACHE_DOC_PATH).update({ stale: true }).catch(() => {});

  logger.info('🏠 client:auto-created', { clientId: docRef.id, name: clientName, source });
  return { id: docRef.id, name: clientName };
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
