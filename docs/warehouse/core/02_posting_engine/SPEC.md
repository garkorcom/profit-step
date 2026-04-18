# Core 02 — Posting Engine

> **Parent:** [`MAIN_SPEC.md`](../../MAIN_SPEC.md)
> **Tests:** [`TESTS.md`](./TESTS.md)
> **Sibling:** [`01_data_model/SPEC.md`](../01_data_model/SPEC.md) — schemas
> **Scope:** `postDocument()` algorithm, UOM conversion, reservations, negative stock policy, reversal, idempotency. **Сердце системы.**

---

## 1. Principle

**Single write path:** любое изменение balance происходит ТОЛЬКО через `postDocument(docId, options?)`. Прямые мутации `balance.onHandQty` запрещены на уровне security rules.

```
Draft document → validate → postDocument() → ledger entries → balance updates → events
```

---

## 2. Document lifecycle

```
         create (API/AI/UI)
               ▼
           [draft]
         /    │    \
   edit/  void  post (idempotent)
    │     │      │
    ▼     ▼      ▼
  [draft][voided][posted]
          │        │
          │        void
          │        │
          │        ▼
          │    reversal doc
          │    created (new,
          │    docType='reversal',
          │    status='posted')
          │
          └───> [expired]  (AI drafts TTL)
```

---

## 3. `postDocument()` algorithm

### 3.1. Signature

```typescript
interface PostOptions {
  idempotencyKey?: string;         // header / client-supplied
  skipReservationRelease?: boolean;  // admin override
}

interface PostResult {
  success: boolean;
  alreadyPosted: boolean;
  ledgerEntryIds: string[];
  postedAt: Timestamp;
  balanceDelta: Array<{
    locationId: string;
    itemId: string;
    onHandBefore: number;
    onHandAfter: number;
    reservedBefore: number;
    reservedAfter: number;
    alert?: 'negative_stock' | 'low_stock' | 'critical_stock';
  }>;
}

async function postDocument(
  docId: string,
  userId: string,
  options?: PostOptions
): Promise<PostResult>
```

### 3.2. Pseudocode

```typescript
return await db.runTransaction(async (tx) => {
  // 1. Idempotency check
  if (options?.idempotencyKey) {
    const existing = await tx.get(idempotencyKeyRef(options.idempotencyKey));
    if (existing.exists) {
      return existing.data().result;  // cached response
    }
  }
  
  // 2. Load document
  const docRef = db.collection('wh_documents').doc(docId);
  const docSnap = await tx.get(docRef);
  if (!docSnap.exists) throw new Error('DOCUMENT_NOT_FOUND');
  const doc = docSnap.data();
  
  // 3. Idempotent post check
  if (doc.status === 'posted') {
    return {
      success: true,
      alreadyPosted: true,
      ledgerEntryIds: doc.ledgerEntryIds,
      postedAt: doc.postedAt,
    };
  }
  
  // 4. State check
  if (!['draft', 'ready_for_review'].includes(doc.status)) {
    throw new Error(`DOCUMENT_NOT_IN_POSTABLE_STATE: ${doc.status}`);
  }
  
  // 5. Load lines (subcollection)
  const linesSnap = await tx.get(docRef.collection('lines'));
  if (linesSnap.empty) throw new Error('EMPTY_DOCUMENT');
  
  // 6. UOM conversion → baseQty per line
  for (const line of linesSnap.docs) {
    line.baseQty = convertToBase(line.uom, line.qty, items[line.itemId]);
    if (line.unitCost) {
      line.baseUnitCost = line.unitCost * line.qty / line.baseQty;
    }
  }
  
  // 7. Gather all (itemId, locationId) pairs needing balance update
  const balancePairs = extractBalancePairs(doc, lines);
  
  // 8. Load current balances
  const balances = new Map();
  for (const { itemId, locationId } of balancePairs) {
    const key = `${locationId}__${itemId}`;
    const snap = await tx.get(db.collection('wh_balances').doc(key));
    balances.set(key, snap.exists ? snap.data() : createEmptyBalance(locationId, itemId));
  }
  
  // 9. Validate negative stock + business rules
  for (const pair of balancePairs) {
    const action = computeAction(doc.docType, pair);  // 'in' | 'out'
    const balance = balances.get(`${pair.locationId}__${pair.itemId}`);
    
    if (action === 'out') {
      const newOnHand = balance.onHandQty - pair.baseQty;
      
      // Reservation release (если draft был с projectId)
      const newReserved = balance.reservedQty - (doc.projectId ? pair.baseQty : 0);
      
      if (newOnHand < 0) {
        const policy = getNegativeStockPolicy(pair.locationId, pair.itemId);
        if (policy === 'blocked') {
          throw new Error(`INSUFFICIENT_STOCK at ${pair.locationId}`);
        }
        if (policy === 'allowed_with_alert') {
          pair.alert = 'negative_stock';  // flag for post-transaction event
        }
      }
    }
  }
  
  // 10. Create ledger entries
  const ledgerEntryIds = [];
  for (const pair of balancePairs) {
    const entryRef = db.collection('wh_ledger').doc();
    const entry = {
      id: entryRef.id,
      documentId: docId,
      lineId: pair.lineId,
      itemId: pair.itemId,
      locationId: pair.locationId,
      deltaQty: pair.signedDeltaQty,          // signed!
      direction: pair.signedDeltaQty > 0 ? 'in' : 'out',
      unitCostAtPosting: pair.unitCostAtPosting,
      projectId: doc.projectId,
      phaseCode: doc.phaseCode,
      costCategory: doc.costCategory,
      eventDate: doc.eventDate,
      postedAt: FieldValue.serverTimestamp(),
      postedBy: userId,
      schemaVersion: 1,
    };
    tx.set(entryRef, entry);
    ledgerEntryIds.push(entryRef.id);
  }
  
  // 11. Update balances
  for (const [key, balance] of balances) {
    const newBalance = applyBalanceUpdate(balance, /* deltas for this key */);
    tx.set(db.collection('wh_balances').doc(key), newBalance, { merge: true });
  }
  
  // 12. Update item cost (для receipt)
  if (doc.docType === 'receipt') {
    for (const line of lines) {
      updateItemCost(tx, line.itemId, line.baseUnitCost, line.baseQty);
    }
  }
  
  // 13. Mark document posted
  tx.update(docRef, {
    status: 'posted',
    postedAt: FieldValue.serverTimestamp(),
    postedBy: userId,
    ledgerEntryIds,
  });
  
  // 14. Save idempotency key
  if (options?.idempotencyKey) {
    tx.set(idempotencyKeyRef(options.idempotencyKey), {
      key: options.idempotencyKey,
      result: buildResult(...),
      expiresAt: Date.now() + 24 * 3600_000,
    });
  }
  
  // 15. Return result
  return buildResult(...);
});
// AFTER transaction commits — publish events (выход из transaction)
await publishEvents([
  'warehouse.document.posted',
  // + conditional 'warehouse.negative_stock' if alerts
  // + conditional 'warehouse.low_stock' if onHand < minStock
]);
```

### 3.3. Правило: events ПОСЛЕ transaction

- Transaction не должна включать webhook/email/external calls (может ретраиться)
- События накапливаются в array → публикуются после commit
- Если публикация fails — повторная через queue, не теряется

---

## 4. Per-docType posting logic

### 4.1. Receipt (приход)

**Input validation:**
- `destinationLocationId` обязателен
- Все lines имеют `unitCost` (для cost snapshot)
- `uom` каждой line ∈ item.purchaseUOMs

**Side effects:**
- Ledger: `+baseQty` @ `unitCostAtPosting` на destination
- Balance: `onHandQty += baseQty`
- Item update: `lastPurchasePrice = baseUnitCost`, rolling average cost

**Average cost формула:**
```
newAvg = (oldAvg × oldQty + baseQty × baseUnitCost) / (oldQty + baseQty)
```

где `oldQty` = total onHand across all locations до receipt.

**Events:** `warehouse.document.posted`, `warehouse.receipt.parsed` (если source=ai)

### 4.2. Issue (списание)

**Input validation:**
- `sourceLocationId` обязателен
- `reason` обязателен
- Если `reason` ∈ project_*, `projectId` обязателен (иначе `PROJECT_ID_REQUIRED`)

**Side effects:**
- Ledger: `-baseQty` @ current `averageCost` или `lastPurchasePrice` на source
- Balance: `onHandQty -= baseQty`; если draft был с projectId → `reservedQty -= baseQty`
- Negative stock check по locationType policy

**Events:** `warehouse.document.posted`, возможно `warehouse.negative_stock` / `warehouse.low_stock`

### 4.3. Transfer (перемещение)

**MVP: single-phase atomic**

**Input validation:**
- `sourceLocationId` + `destinationLocationId` обязательны, разные
- Lines как у issue

**Side effects (атомарно):**
- Ledger: `-baseQty` на source + `+baseQty` на destination (same transactionGroupId)
- Balance source: `onHandQty -= baseQty`, `reservedQty -= baseQty` (если projectId)
- Balance destination: `onHandQty += baseQty`
- unitCostAtPosting переносится как есть (cost preservation)

**Events:** `warehouse.document.posted`, `warehouse.transfer.completed`

**Future two-phase** (Phase 8+): поле `transferStatus: 'shipped' | 'received'` + `in_transit_<locationId>` virtual location.

### 4.4. Count (инвентаризация) — двухшаговая

**Шаг 1 (не posting):** Create `wh_count_sessions` document со строками `{itemId, systemQty, countedQty, variance}`. Статус `counting` → `review`.

**Шаг 2 (post):** При confirm:
- Генерируются **adjustment documents** (adjustment_in для variance > 0, adjustment_out для variance < 0)
- Каждый adjustment posts отдельно через postDocument
- Count session статус `posted`, сохраняет `generatedAdjustmentDocIds`

**Events:** `warehouse.count.completed`, каждый adjustment `warehouse.document.posted`

### 4.5. Adjustment (корректировка)

**Input validation:**
- `locationId` обязателен
- `reason` обязателен (count_variance / manual_fix / regrading)
- `direction` (in/out) обязателен

**Side effects:**
- Ledger: `±baseQty`
- Balance: `onHandQty ±= baseQty`

**Events:** `warehouse.document.posted`, `warehouse.adjustment.made`

### 4.6. Reversal (отмена proceesed)

**Как создаётся:** через `voidDocument(originalDocId, reason)`:

```typescript
async function voidDocument(docId, userId, reason) {
  return await db.runTransaction(async tx => {
    const doc = await tx.get(db.collection('wh_documents').doc(docId));
    
    if (doc.status === 'draft') {
      // Simple: just mark voided + release reservations
      tx.update(doc.ref, { status: 'voided', voidedAt: ..., voidReason: reason });
      // Release reservations from balances
      return { status: 'voided', reversalDocumentId: null };
    }
    
    if (doc.status === 'posted') {
      if (doc.docType === 'reversal') throw new Error('CANNOT_REVERSE_REVERSAL');
      
      // 1. Mark original voided
      tx.update(doc.ref, { status: 'voided', voidedAt: ..., voidedBy: userId, voidReason: reason });
      
      // 2. Create reversal document
      const reversalRef = db.collection('wh_documents').doc();
      tx.set(reversalRef, {
        docType: 'reversal',
        status: 'posted',                 // сразу posted
        reversalOf: docId,
        sourceLocationId: doc.destinationLocationId,  // зеркально!
        destinationLocationId: doc.sourceLocationId,
        lines: mirrorLines(doc.lines),    // qty с обратным знаком
        ...
      });
      
      // 3. Create reversal ledger entries (мirror)
      for (const originalEntry of originalLedgerEntries) {
        tx.set(db.collection('wh_ledger').doc(), {
          ...originalEntry,
          id: newId,
          documentId: reversalRef.id,
          deltaQty: -originalEntry.deltaQty,  // инверсия
          direction: originalEntry.direction === 'in' ? 'out' : 'in',
          reversalOf: originalEntry.id,
        });
      }
      
      // 4. Update balances
      // ...
      
      return { status: 'voided', reversalDocumentId: reversalRef.id };
    }
  });
}
```

**Нельзя:**
- Reverse у docType `reversal` (нельзя отменить отмену)
- Void уже-voided документ
- Менять lines voided/posted документа

---

## 5. UOM Conversion

### 5.1. Algorithm

```typescript
function convertToBase(sourceUOM: string, qty: number, item: WhItem): number {
  // Base UOM — qty без изменений
  if (sourceUOM === item.baseUOM) return qty;
  
  // Lookup в purchaseUOMs
  const purchase = item.purchaseUOMs.find(p => p.uom === sourceUOM);
  if (!purchase) throw new Error(`INVALID_UOM: ${sourceUOM} not in purchaseUOMs for item ${item.id}`);
  
  return qty * purchase.factor;
}

function convertUnitCostToBase(sourceUOM: string, unitCost: number, item: WhItem): number {
  if (sourceUOM === item.baseUOM) return unitCost;
  
  const purchase = item.purchaseUOMs.find(p => p.uom === sourceUOM);
  if (!purchase) throw new Error(`INVALID_UOM`);
  
  // Price per base unit
  return unitCost / purchase.factor;
}
```

### 5.2. Rounding

- `baseQty` хранится с 4 знаками после запятой
- `baseUnitCost` хранится с 6 знаками (для точности в rolling average)
- Rounding mode: half-up

### 5.3. Issue restrictions

При issue `uom` должен быть в `item.allowedIssueUOMs`. Обычно только `baseUOM`, иногда fractional (например `100ft_segment` для удобства worker'а, но всё равно конвертится в `ft`).

### 5.4. baseUOM immutability

После первого ledger entry (non-reversal), `item.baseUOM` становится immutable. Попытка update → error `BASE_UOM_LOCKED`.

---

## 6. Reservations

### 6.1. Когда создаются

Draft документ типа `issue` или `transfer` с `projectId` → для каждой строки:
- `balance.reservedQty += baseQty` (source location)
- `balance.availableQty = onHand - reserved` пересчитывается

### 6.2. TTL

**AI drafts** (`source: 'ai'`): `reservationExpiresAt = createdAt + 48h`
**Human drafts**: без TTL

### 6.3. Expiration (cron)

Scheduled function `expireStaleDrafts` (каждый час):
```typescript
const expired = await db.collection('wh_documents')
  .where('status', '==', 'draft')
  .where('reservationExpiresAt', '<', now)
  .get();

for (const doc of expired) {
  await runTransaction(async tx => {
    // Release reservations
    for (const line of doc.lines) {
      const balanceRef = db.collection('wh_balances').doc(`${doc.sourceLocationId}__${line.itemId}`);
      tx.update(balanceRef, {
        reservedQty: FieldValue.increment(-line.baseQty),
      });
    }
    // Mark expired
    tx.update(doc.ref, { status: 'expired' });
  });
  publishEvent('warehouse.reservation.expired', { docId: doc.id });
}
```

### 6.4. При cancel draft

```typescript
async function cancelDraft(docId, userId) {
  return runTransaction(async tx => {
    const doc = ...;
    if (doc.status !== 'draft') throw 'NOT_DRAFT';
    
    // Release reservations
    for (const line of doc.lines) {
      tx.update(balanceRef, { reservedQty: FieldValue.increment(-line.baseQty) });
    }
    
    tx.update(doc.ref, { status: 'voided', voidedAt: ..., voidReason: 'user_cancel' });
  });
}
```

### 6.5. При post

- `reservedQty -= baseQty` (если документ был с projectId)
- `onHandQty -= baseQty`
- Net effect: `availableQty` не меняется второй раз (было уже уменьшено при draft create)

---

## 7. Negative Stock Policy

```typescript
function getNegativeStockPolicy(locationId: string, itemId: string): Policy {
  const location = locations.get(locationId);
  const item = items.get(itemId);
  
  // Per-item override
  if (item.allowNegativeStock === true) return 'allowed';
  if (item.allowNegativeStock === false) return 'blocked';
  
  // Per-location override
  if (location.negativeStockOverride) return location.negativeStockOverride;
  
  // Default by locationType
  return {
    'warehouse': 'blocked',
    'van': 'allowed_with_alert',
    'site': 'allowed',
    'quarantine': 'blocked',
  }[location.locationType];
}
```

**При `allowed_with_alert`:**
1. Post проходит
2. Создаётся audit entry в `wh_audit_log` с action `negative_stock_event`
3. `location.needsReconciliation = true` (flag)
4. Telegram alert в `#warehouse-alerts` канал
5. Event `warehouse.negative_stock` публикуется

---

## 8. Idempotency

### 8.1. Где применяется

- `POST /api/warehouse/documents/:id/post` — header `Idempotency-Key`
- `POST /api/warehouse/documents` (create) — header `Idempotency-Key` через hash payload

### 8.2. Storage

`wh_idempotency_keys/{hashedKey}`:
```typescript
{
  key: clientSuppliedKey,
  payloadHash: sha256(body),
  endpoint: '/api/warehouse/documents/xyz/post',
  userId,
  result: { statusCode, body },
  createdAt: serverTimestamp(),
  expiresAt: now + 24h,
}
```

### 8.3. Conflict detection

Если тот же `Idempotency-Key` но другой `payloadHash` → `409 IDEMPOTENCY_KEY_CONFLICT`.

### 8.4. TTL

24 hours. Firestore TTL policy автоматически удаляет.

---

## 9. Error handling

Все errors — typed с кодом:

```typescript
class WarehouseError extends Error {
  constructor(
    public code: string,      // 'INSUFFICIENT_STOCK', 'PROJECT_ID_REQUIRED', etc.
    public details?: object,
    message?: string,
  ) { super(message || code); }
}
```

Error codes — single source of truth в [`04_external_api/SPEC.md`](../04_external_api/SPEC.md) §12.5.

Route handler конвертирует в HTTP response:
```typescript
app.use((err, req, res, next) => {
  if (err instanceof WarehouseError) {
    const status = httpStatusFor(err.code);  // 400 / 409 / 422 / ...
    res.status(status).json({ error: { code: err.code, message: err.message, details: err.details } });
  } else {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', requestId: req.id } });
  }
});
```

---

## 10. Data integrity checks

### 10.1. Background job (daily 2am)

```typescript
async function verifyWarehouseIntegrity() {
  // I1: sum(ledger) == balance.onHand для random 100 пар
  const pairs = await sampleRandomBalancePairs(100);
  for (const { locationId, itemId } of pairs) {
    const ledgerSum = await aggregateLedger(locationId, itemId);
    const balance = await getBalance(locationId, itemId);
    
    if (Math.abs(ledgerSum - balance.onHandQty) > 0.0001) {
      publishEvent('warehouse.integrity.drift_detected', {
        locationId, itemId, ledgerSum, balanceOnHand: balance.onHandQty,
      });
      telegramAlert(`DRIFT: ${locationId}/${itemId} — ledger ${ledgerSum} vs balance ${balance.onHandQty}`);
    }
  }
  
  // I2: availableQty consistency для ВСЕХ balances
  const allBalances = await db.collection('wh_balances').get();
  for (const b of allBalances.docs) {
    const d = b.data();
    if (Math.abs(d.availableQty - (d.onHandQty - d.reservedQty)) > 0.0001) {
      // fix or alert
    }
  }
}
```

### 10.2. Admin recalculate

`POST /api/warehouse/recalculate-balances` — full rebuild balance из ledger:

```typescript
async function recalculateBalances(options: { locationId?, itemId?, dryRun: boolean }) {
  const filter = buildFilter(options);
  const ledgerEntries = await db.collection('wh_ledger').where(filter).get();
  
  const computed = new Map<string, number>();
  for (const entry of ledgerEntries.docs) {
    const key = `${entry.locationId}__${entry.itemId}`;
    computed.set(key, (computed.get(key) || 0) + entry.deltaQty);
  }
  
  // Compare with current balances
  const drifts = [];
  for (const [key, ledgerSum] of computed) {
    const balance = await db.collection('wh_balances').doc(key).get();
    if (!balance.exists || balance.data().onHandQty !== ledgerSum) {
      drifts.push({ key, ledgerSum, balanceOnHand: balance.data()?.onHandQty });
    }
  }
  
  if (!options.dryRun) {
    // Apply corrections atomically
    for (const { key, ledgerSum } of drifts) {
      await db.collection('wh_balances').doc(key).update({ onHandQty: ledgerSum });
    }
  }
  
  return { drifts, applied: !options.dryRun };
}
```

Admin-scope only. Логируется в audit log.

---

## 11. Concurrency

### 11.1. Firestore transaction гарантии

- Optimistic concurrency control: если `balance` document изменился во время transaction — retry automatic (до 5 раз)
- 2 параллельных `postDocument` на тот же balance → один commits, второй retries, после retry снова валидирует stock (может получить `INSUFFICIENT_STOCK`)

### 11.2. Deadlock prevention

- В одной transaction — documents/balances читаются в deterministic order (sorted by ID)
- Не держать transaction > 10 seconds

### 11.3. Hotspot mitigation

- Популярные items (wire_12_2_nmb у 5 van'ов одновременно) → нет hotspot на balance doc, так как ID разные: `loc_van_denis__item_wire_12_2_nmb` vs `loc_van_gena__item_wire_12_2_nmb`
- Hotspot возможен на `wh_counters/receipt` (docNumber sequence) — mitigate через sharded counter (10 shards, sum на read)

---

## 12. Performance targets

- `postDocument()` P50 < 500ms, P99 < 2s
- `postDocument()` с 50 lines P99 < 5s
- Transaction не превышает 400 writes (see `01_data_model §17`)
- Concurrent `postDocument` calls: 100 parallel → все complete без ledger дубликатов

---

## 13. Scope & non-goals

### In scope

- Posting algorithm для всех 6 docTypes
- UOM conversion
- Reservations lifecycle
- Negative stock policy
- Idempotency
- Reversal
- Integrity checks
- Concurrency handling

### NOT in scope

- AI logic (capabilities) → [`03_ai_agent/SPEC.md`](../03_ai_agent/SPEC.md)
- HTTP routes → [`04_external_api/SPEC.md`](../04_external_api/SPEC.md)
- Batch/serial tracking (Phase 8+)
- FIFO/LIFO costing (Phase 8+)
- Two-phase transfer flow (Phase 8+)

---

## 14. Open questions

1. **Сross-location reservations** — если draft transfer от WH-A → Van-B, резервируем на обеих сторонах или только source?
2. **Rolling average cost — глобальный или per-location?** Current plan: глобальный (total onHand × avg). Альтернатива: per-location (WH с одной ценой, Van с другой).
3. **Negative available с positive onHand** — van имеет 10шт но reserved 15 (две draft поездки). Post 3-й issue → onHand становится 7, но available = -8. Разрешаем?

---

## 15. Связанные документы

- Parent: [`../../MAIN_SPEC.md`](../../MAIN_SPEC.md)
- Prev: [`../01_data_model/SPEC.md`](../01_data_model/SPEC.md) — schemas
- Next: [`../03_ai_agent/SPEC.md`](../03_ai_agent/SPEC.md) — как AI создаёт drafts
- Tests: [`./TESTS.md`](./TESTS.md)

---

## 16. История

- **2026-04-18** — v1.0. Алгоритм postDocument() + все 6 docTypes + UOM + reservations + idempotency + negative stock + reversal + integrity.
