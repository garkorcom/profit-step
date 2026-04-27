/**
 * Shared Firestore adapter helpers.
 *
 * Conventions enforced by these helpers (see
 * spec/04-storage/adapter-mapping.md §"Convention notes"):
 *
 *   - Time conversion at the boundary: domain holds `EpochMs = number`, but
 *     Firestore stores `Timestamp`. `toEpochMs` / `toTimestamp` keep the
 *     domain layer pure.
 *   - `null` (not `undefined`) for not-found.
 *   - `chunk(items, n)` works around Firestore's 30-id `in` / `getAll`
 *     limit + 500-write batch limit.
 */

import { Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';

/** Firestore Timestamp (re-exported for convenience). */
export { Timestamp, FieldValue } from 'firebase-admin/firestore';
export type { Firestore } from 'firebase-admin/firestore';

/** Optional structured logger (per CLAUDE.md §monitoring → structured logs). */
export interface AdapterLogger {
  debug?: (msg: string, meta?: Record<string, unknown>) => void;
  info?: (msg: string, meta?: Record<string, unknown>) => void;
  warn?: (msg: string, meta?: Record<string, unknown>) => void;
  error?: (msg: string, meta?: Record<string, unknown>) => void;
}

export const noopLogger: AdapterLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

// ─── Time conversion ───────────────────────────────────────────────────

/**
 * Convert Firestore Timestamp (or anything Timestamp-like) to epoch ms.
 * Returns null for null/undefined/invalid input.
 */
export function toEpochMs(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (value instanceof Timestamp) return value.toMillis();
  // Tolerant — admin Timestamp from a different SDK version
  const v = value as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') {
    return v.seconds * 1000 + Math.floor((v.nanoseconds ?? 0) / 1e6);
  }
  if (value instanceof Date) return value.getTime();
  return null;
}

/** Convert epoch ms (or null) to Firestore Timestamp (or null). */
export function toTimestamp(epochMs: number | null | undefined): Timestamp | null {
  if (epochMs == null) return null;
  return Timestamp.fromMillis(epochMs);
}

/**
 * Walk an object converting all `EpochMs` (number) leaves named like
 * `*At` / `*StartAt` to Firestore Timestamp at write time. Used by Task
 * write path. Adapters that need stricter control should write fields
 * field-by-field instead.
 */
export function epochsToTimestamps<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v == null) {
      out[k] = v;
      continue;
    }
    if (typeof v === 'number' && /At$|^createdAt$|^updatedAt$|^dueAt$|^expiresAt$/.test(k)) {
      out[k] = Timestamp.fromMillis(v);
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? epochsToTimestamps(item as Record<string, unknown>)
          : item,
      );
    } else if (typeof v === 'object' && !(v instanceof Timestamp)) {
      out[k] = epochsToTimestamps(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

/**
 * Walk an object converting Firestore Timestamps to epoch ms. Mirror of
 * `epochsToTimestamps`. Used on read path.
 */
export function timestampsToEpochs<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v == null) {
      out[k] = v;
      continue;
    }
    if (v instanceof Timestamp) {
      out[k] = v.toMillis();
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? timestampsToEpochs(item as Record<string, unknown>)
          : item instanceof Timestamp
            ? item.toMillis()
            : item,
      );
    } else if (typeof v === 'object') {
      // detect Timestamp-shaped objects from cross-SDK serialization
      const ts = v as { toMillis?: () => number };
      if (typeof ts.toMillis === 'function') {
        out[k] = ts.toMillis();
      } else {
        out[k] = timestampsToEpochs(v as Record<string, unknown>);
      }
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

// ─── Batch / chunking ──────────────────────────────────────────────────

/** Chunk an array into pieces of size n. Used for `in` queries (max 30). */
export function chunk<T>(items: readonly T[], n: number): T[][] {
  if (n <= 0) throw new Error('chunk size must be > 0');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) {
    out.push(items.slice(i, i + n));
  }
  return out;
}

/** Firestore `in`/`array-contains-any` value-list maximum. */
export const FIRESTORE_IN_LIMIT = 30;

/** Firestore WriteBatch operation maximum. */
export const FIRESTORE_BATCH_LIMIT = 500;

// ─── Pagination cursor ─────────────────────────────────────────────────

export interface CursorPayload {
  /** Last doc id from previous page. */
  lastDocId: string;
  /** Sort key value used by adapter to call `startAfter`. */
  lastSortValue: unknown;
}

/**
 * Encode a pagination cursor. Adapter uses `startAfter(lastSortValue, lastDocId)`
 * shape on next call. Base64 keeps the payload opaque to API consumers.
 */
export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const raw = Buffer.from(cursor, 'base64').toString('utf8');
    const parsed = JSON.parse(raw) as CursorPayload;
    if (typeof parsed?.lastDocId !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

// ─── DocumentReference helpers ─────────────────────────────────────────

/**
 * Multi-document fetch using `getAll`. Chunks the input ids to stay within
 * Firestore limits. Returns an array preserving input order; missing docs
 * are skipped (caller can dedupe by id).
 */
export async function getAllChunked<T>(
  db: Firestore,
  collection: string,
  ids: readonly string[],
  mapper: (data: FirebaseFirestore.DocumentData, id: string) => T,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const chunks = chunk(ids, FIRESTORE_IN_LIMIT);
  const results: T[] = [];
  for (const ch of chunks) {
    const refs = ch.map((id) => db.collection(collection).doc(id));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (snap.exists) {
        const data = snap.data();
        if (data) results.push(mapper(data, snap.id));
      }
    }
  }
  return results;
}

/** Cleanly strip undefined values before write — Firestore rejects them. */
export function stripUndefined<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}
