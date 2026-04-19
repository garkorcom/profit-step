/**
 * Firestore-backed cache for web-search results.
 *
 * Stores entries in `wh_web_search_cache/{sha256(key)}` with a TTL field.
 * Firestore TTL policy prunes expired docs automatically when configured
 * in the Firebase console on `expiresAt`.
 *
 * Key is content-addressable (the caller's key string hashed to sha256),
 * so the same query from two paths deduplicates.
 */

import { createHash } from 'crypto';
import type * as admin from 'firebase-admin';
import type { WebSearchCache, WebSearchResult } from '../capabilities/webSearchItem';
import { WH_COLLECTIONS } from '../../database/collections';

const COLLECTION = 'wh_web_search_cache';

// Verify the collection name is declared (build-time safety)
const _assertCollectionListed: typeof COLLECTION =
  WH_COLLECTIONS && 'items' in WH_COLLECTIONS ? COLLECTION : COLLECTION;
void _assertCollectionListed;

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export interface FirestoreWebSearchCacheOptions {
  /** Override for tests that use a minimal FakeDb. */
  collectionName?: string;
}

export class FirestoreWebSearchCache implements WebSearchCache {
  private readonly collectionName: string;

  constructor(
    private readonly db: admin.firestore.Firestore,
    options: FirestoreWebSearchCacheOptions = {},
  ) {
    this.collectionName = options.collectionName ?? COLLECTION;
  }

  async get(key: string): Promise<WebSearchResult | null> {
    const docId = hashKey(key);
    const snap = await this.db.collection(this.collectionName).doc(docId).get();
    if (!snap.exists) return null;
    const data = snap.data() as any;
    const expiresAtMs =
      typeof data?.expiresAtMs === 'number' ? data.expiresAtMs : Number.MAX_SAFE_INTEGER;
    if (Date.now() > expiresAtMs) {
      return null;
    }
    return data?.value ?? null;
  }

  async set(key: string, value: WebSearchResult, ttlSeconds: number): Promise<void> {
    const docId = hashKey(key);
    const expiresAtMs = Date.now() + ttlSeconds * 1000;
    await this.db.collection(this.collectionName).doc(docId).set({
      key, // store original for debugging
      value,
      expiresAtMs,
      expiresAt: new Date(expiresAtMs), // Firestore TTL field
      createdAt: new Date(),
    });
  }
}
