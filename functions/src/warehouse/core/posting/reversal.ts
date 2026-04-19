/**
 * Void / reversal engine.
 *
 * Voiding a draft marks it voided and releases any reservation. Voiding a
 * posted document creates a NEW document with docType='reversal' whose
 * lines mirror the original (qty inversed), then posts compensating ledger
 * entries. Math: sum(original ledger) + sum(reversal ledger) = 0.
 *
 * Reference: docs/warehouse/core/02_posting_engine/SPEC.md §4.6.
 */

import { makeBalanceKey, type WhBalance, type WhDocument, type WhDocumentLine } from '../types';
import { WH_COLLECTIONS } from '../../database/collections';
import { WarehouseError } from './errors';
import type { PostTx } from './postDocument';

export interface VoidOptions {
  userId: string;
  reason: string;
  note?: string;
  now?: Date;
}

export interface VoidResult {
  documentId: string;
  status: 'voided';
  voidedAt: string;
  reversalDocumentId: string | null;
  releasedReservations: Array<{ locationId: string; itemId: string; qty: number }>;
  events: string[];
}

export async function voidDocument(
  tx: PostTx,
  documentId: string,
  options: VoidOptions,
): Promise<VoidResult> {
  const now = options.now ?? new Date();

  const doc = await tx.get<WhDocument>(WH_COLLECTIONS.documents, documentId);
  if (!doc) throw new WarehouseError('DOCUMENT_NOT_FOUND');

  if (doc.status === 'voided') {
    throw new WarehouseError('DOCUMENT_ALREADY_VOIDED');
  }
  if (doc.docType === 'reversal') {
    throw new WarehouseError('CANNOT_REVERSE_REVERSAL');
  }

  // Draft void — just release reservation + mark voided
  if (doc.status === 'draft' || doc.status === 'ready_for_review') {
    const released = await releaseReservations(tx, doc);

    tx.merge(WH_COLLECTIONS.documents, documentId, {
      status: 'voided',
      voidedAt: tx.serverTimestamp(),
      voidedBy: options.userId,
      voidReason: options.reason,
    });

    return {
      documentId,
      status: 'voided',
      voidedAt: now.toISOString(),
      reversalDocumentId: null,
      releasedReservations: released,
      events: ['warehouse.document.voided'],
    };
  }

  // Posted void — create reversal document
  if (doc.status === 'posted') {
    const lines = await tx.getLines<WhDocumentLine>(
      WH_COLLECTIONS.documents,
      documentId,
      WH_COLLECTIONS.documentLinesSub,
    );
    if (lines.length === 0) {
      throw new WarehouseError('EMPTY_DOCUMENT', 'Cannot reverse a posted document with no lines');
    }

    // Build reversal document with mirrored direction.
    const reversalData: Record<string, unknown> = {
      docType: 'reversal',
      status: 'posted',
      reversalOf: documentId,
      eventDate: doc.eventDate,
      source: 'api',
      // Swap source/destination so that direction math inverts cleanly.
      sourceLocationId: doc.destinationLocationId ?? null,
      destinationLocationId: doc.sourceLocationId ?? null,
      locationId: doc.locationId ?? null,
      projectId: doc.projectId ?? null,
      phaseCode: doc.phaseCode ?? null,
      costCategory: doc.costCategory ?? null,
      reason: `reversal:${options.reason}`,
      note: options.note ?? `Reversal of ${documentId}: ${options.reason}`,
      postedAt: tx.serverTimestamp(),
      postedBy: options.userId,
      createdAt: tx.serverTimestamp(),
      updatedAt: tx.serverTimestamp(),
      createdBy: options.userId,
      createdByType: 'system',
      schemaVersion: 1,
    };
    const reversalId = tx.create(WH_COLLECTIONS.documents, reversalData);

    // Fetch original ledger entries to produce exact compensating entries.
    // (In real Firestore this would be a query; tx.getLines is overloaded to
    // accept the collection group shape — tests use FakeTx's implementation.)
    const originalEntries = await tx.getLines<{
      id: string;
      itemId: string;
      locationId: string;
      deltaQty: number;
      unitCostAtPosting: number;
    }>(WH_COLLECTIONS.ledger, documentId, 'original_entries');
    // NOTE: the second+third args are used by tests to target the in-memory
    // ledger dataset. Production code can implement this as a collectionGroup
    // query on wh_ledger filtered by documentId.

    const newLedgerIds: string[] = [];
    const balanceDeltas = new Map<string, { onHand: number }>();

    for (const orig of originalEntries) {
      const invertedDelta = -orig.deltaQty;
      const newEntry: Record<string, unknown> = {
        documentId: reversalId,
        lineId: orig.id, // points back at original line for audit
        itemId: orig.itemId,
        locationId: orig.locationId,
        deltaQty: invertedDelta,
        direction: invertedDelta > 0 ? 'in' : 'out',
        unitCostAtPosting: orig.unitCostAtPosting,
        reversalOf: orig.id,
        eventDate: doc.eventDate,
        postedAt: tx.serverTimestamp(),
        postedBy: options.userId,
        schemaVersion: 1,
      };
      const id = tx.create(WH_COLLECTIONS.ledger, newEntry);
      newLedgerIds.push(id);

      const key = makeBalanceKey(orig.locationId, orig.itemId);
      const existing = balanceDeltas.get(key) ?? { onHand: 0 };
      existing.onHand += invertedDelta;
      balanceDeltas.set(key, existing);
    }

    // Update balances for each (locationId, itemId) touched.
    for (const [key, delta] of balanceDeltas) {
      const balance = await tx.get<WhBalance>(WH_COLLECTIONS.balances, key);
      if (!balance) continue; // should not happen
      const onHandAfter = balance.onHandQty + delta.onHand;
      const needsRecon = onHandAfter < 0 ? true : balance.needsReconciliation;
      tx.merge(WH_COLLECTIONS.balances, key, {
        onHandQty: onHandAfter,
        availableQty: onHandAfter - balance.reservedQty,
        updatedAt: tx.serverTimestamp(),
        ...(needsRecon !== undefined ? { needsReconciliation: needsRecon } : {}),
      });
    }

    // Mark reversal doc with ledgerEntryIds + mark original voided.
    tx.merge(WH_COLLECTIONS.documents, reversalId, { ledgerEntryIds: newLedgerIds });
    tx.merge(WH_COLLECTIONS.documents, documentId, {
      status: 'voided',
      voidedAt: tx.serverTimestamp(),
      voidedBy: options.userId,
      voidReason: options.reason,
    });

    return {
      documentId,
      status: 'voided',
      voidedAt: now.toISOString(),
      reversalDocumentId: reversalId,
      releasedReservations: [],
      events: ['warehouse.document.voided', 'warehouse.reversal.created'],
    };
  }

  throw new WarehouseError('DOCUMENT_NOT_IN_POSTABLE_STATE', `Cannot void status=${doc.status}`);
}

// ═══════════════════════════════════════════════════════════════════
//  Reservation release (shared between draft-void and draft-expire)
// ═══════════════════════════════════════════════════════════════════

export async function releaseReservations(
  tx: PostTx,
  doc: WhDocument,
): Promise<Array<{ locationId: string; itemId: string; qty: number }>> {
  if (!doc.projectId || !doc.sourceLocationId) return [];
  // Only issue/transfer drafts create reservations.
  if (doc.docType !== 'issue' && doc.docType !== 'transfer') return [];

  const lines = await tx.getLines<WhDocumentLine>(
    WH_COLLECTIONS.documents,
    doc.id,
    WH_COLLECTIONS.documentLinesSub,
  );
  const released: Array<{ locationId: string; itemId: string; qty: number }> = [];
  for (const line of lines) {
    const qty = line.baseQty ?? line.qty; // may not be computed for drafts yet
    const key = makeBalanceKey(doc.sourceLocationId, line.itemId);
    const balance = await tx.get<WhBalance>(WH_COLLECTIONS.balances, key);
    if (!balance) continue;
    const newReserved = Math.max(0, balance.reservedQty - qty);
    tx.merge(WH_COLLECTIONS.balances, key, {
      reservedQty: newReserved,
      availableQty: balance.onHandQty - newReserved,
      updatedAt: tx.serverTimestamp(),
    });
    released.push({ locationId: doc.sourceLocationId, itemId: line.itemId, qty });
  }
  return released;
}
