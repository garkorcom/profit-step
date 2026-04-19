/**
 * Firestore adapter for the core posting engine.
 *
 * The core postDocument() / voidDocument() functions operate against an
 * abstract PostTx interface (see warehouse/core/posting/postDocument.ts).
 * This file wires that interface to the real Firebase Admin SDK, wrapping
 * everything in an atomic runTransaction.
 *
 * IMPORTANT: all reads in a transaction must happen before any writes.
 * The PostTx contract mirrors this — tests (FakeTx) buffer writes until
 * commit; the adapter below relies on core code following the same order.
 */

import * as admin from 'firebase-admin';
import {
  postDocument as corePostDocument,
  voidDocument as coreVoidDocument,
  type PostDocumentOptions,
  type PostDocumentResult,
  type PostTx,
  type VoidOptions,
  type VoidResult,
} from '../core/posting';
import { WH_COLLECTIONS } from '../database/collections';

// ═══════════════════════════════════════════════════════════════════
//  FirestoreTx — PostTx implementation using admin transactions
// ═══════════════════════════════════════════════════════════════════

class FirestoreTx implements PostTx {
  private writeBuffer: Array<(tx: admin.firestore.Transaction) => void> = [];

  constructor(
    private readonly db: admin.firestore.Firestore,
    private readonly tx: admin.firestore.Transaction,
  ) {}

  async get<T = any>(collection: string, id: string): Promise<T | undefined> {
    const ref = this.db.collection(collection).doc(id);
    const snap = await this.tx.get(ref);
    return snap.exists ? ({ id: snap.id, ...snap.data() } as T) : undefined;
  }

  async getLines<T = any>(
    parentCollection: string,
    parentId: string,
    linesSub: string,
  ): Promise<T[]> {
    // Special case: reversal lookup asks for "original_entries" from wh_ledger
    // — that's a collectionGroup-style query, but to keep this in-transaction
    // we require that the caller pre-indexes via wh_ledger where documentId == parentId.
    // Admin SDK transactions cannot do queries (outside of .get on collectionGroup before writes),
    // so we must use a query read here.
    if (parentCollection === WH_COLLECTIONS.ledger) {
      const q = this.db
        .collection(WH_COLLECTIONS.ledger)
        .where('documentId', '==', parentId);
      const snap = await this.tx.get(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as T));
    }

    const subRef = this.db
      .collection(parentCollection)
      .doc(parentId)
      .collection(linesSub);
    const snap = await this.tx.get(subRef);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as T));
  }

  set(collection: string, id: string, data: Record<string, unknown>): void {
    this.writeBuffer.push((tx) => {
      tx.set(this.db.collection(collection).doc(id), data);
    });
  }

  merge(collection: string, id: string, data: Record<string, unknown>): void {
    this.writeBuffer.push((tx) => {
      tx.set(this.db.collection(collection).doc(id), data, { merge: true });
    });
  }

  create(collection: string, data: Record<string, unknown>): string {
    const ref = this.db.collection(collection).doc();
    const id = ref.id;
    this.writeBuffer.push((tx) => {
      tx.set(ref, { id, ...data });
    });
    return id;
  }

  serverTimestamp(): unknown {
    return admin.firestore.FieldValue.serverTimestamp();
  }

  /** Called by the adapter after core logic completes to flush all buffered writes. */
  commitBuffered(): void {
    for (const op of this.writeBuffer) op(this.tx);
    this.writeBuffer = [];
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Public adapters
// ═══════════════════════════════════════════════════════════════════

/**
 * Run postDocument() inside a real Firestore transaction.
 *
 * This is the primary entry point called by the HTTP route handlers.
 * Wraps core/posting/postDocument so the API layer has no direct
 * knowledge of the posting algorithm's internals.
 */
export async function runPostDocument(
  db: admin.firestore.Firestore,
  documentId: string,
  options: PostDocumentOptions,
): Promise<PostDocumentResult> {
  return db.runTransaction(async (tx) => {
    const adapter = new FirestoreTx(db, tx);
    const result = await corePostDocument(adapter, documentId, options);
    adapter.commitBuffered();
    return result;
  });
}

export async function runVoidDocument(
  db: admin.firestore.Firestore,
  documentId: string,
  options: VoidOptions,
): Promise<VoidResult> {
  return db.runTransaction(async (tx) => {
    const adapter = new FirestoreTx(db, tx);
    const result = await coreVoidDocument(adapter, documentId, options);
    adapter.commitBuffered();
    return result;
  });
}

// ═══════════════════════════════════════════════════════════════════
//  Document-number generator (separate short transaction)
// ═══════════════════════════════════════════════════════════════════

/**
 * Atomic sequence for human-readable doc numbers (e.g. RCP-2026-00123).
 *
 * Stored in wh_counters/{docType}. Uses a dedicated transaction to avoid
 * hot-spotting the main posting transaction.
 */
export async function nextDocNumber(
  db: admin.firestore.Firestore,
  docType: string,
  year = new Date().getFullYear(),
): Promise<string> {
  const counterId = `${docType}_${year}`;
  const ref = db.collection(WH_COLLECTIONS.counters).doc(counterId);

  const next = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? (snap.data()?.value ?? 0) : 0;
    const updated = current + 1;
    tx.set(ref, { docType, year, value: updated }, { merge: true });
    return updated;
  });

  const prefix: Record<string, string> = {
    receipt: 'RCP',
    issue: 'ISS',
    transfer: 'TRF',
    count: 'CNT',
    adjustment: 'ADJ',
    reversal: 'REV',
  };
  const p = prefix[docType] ?? docType.toUpperCase().slice(0, 3);
  return `${p}-${year}-${String(next).padStart(5, '0')}`;
}
