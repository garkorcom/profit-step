# Core 02 — Posting Engine — Test Plan

> **Parent spec:** [`SPEC.md`](./SPEC.md)

---

## 1. Unit tests (pure functions)

### UOM conversion
- ✓ baseUOM same → qty unchanged
- ✓ roll_500ft → 500 ft
- ✓ box_100 → 100 each
- ✓ unitCost conversion: $180/roll → $0.36/ft
- ✗ unknown UOM → INVALID_UOM error
- ✗ factor ≤ 0 → error at schema validation time

### Average cost rolling
- ✓ First receipt: 100 ft @ $0.40 → avg = $0.40
- ✓ Second receipt: +500 ft @ $0.36 → avg = (100×0.40 + 500×0.36) / 600 = $0.367
- ✓ Sell 300 → avg unchanged (только receipts meняют avg)

### Negative stock policy
- ✓ warehouse: onHand=10, deltaOut=15 → BLOCKED
- ✓ van: onHand=10, deltaOut=15 → allowed with alert
- ✓ site: onHand=0, deltaOut=5 → allowed silently
- ✓ quarantine: onHand=0, deltaOut=1 → BLOCKED
- ✓ per-item override: allowNegativeStock=true → overrides locationType

### Balance math
- ✓ availableQty = onHand - reserved (always)
- ✓ draft create → reservedQty += qty
- ✓ draft post → reservedQty -= qty, onHandQty -= qty
- ✓ draft cancel → reservedQty -= qty, onHandQty unchanged
- ✓ draft expire (TTL) → reservedQty -= qty

---

## 2. Integration tests (Firestore emulator)

### Receipt end-to-end
- Post receipt с 3 lines → 3 ledger entries создаются, 3 balances обновляются, item.lastPurchasePrice updated, event published
- UOM conversion actually persists baseQty + baseUnitCost
- Event `warehouse.document.posted` в `wh_events`

### Issue end-to-end
- Draft issue с projectId → reservation создана
- Post → reservation released, onHand reduced, ledger has projectId+phaseCode
- Event fired

### Transfer atomicity
- Transfer 10 wire: WH → Van
- В middle transaction убиваем процесс → transaction retries → final state: либо оба ledger entries, либо ни одного (atomic)
- После commit: sum(WH.ledger) = -10, sum(Van.ledger) = +10

### Count → Adjustment
- Create count session для van (3 items)
- Counted: wire variance -2, outlet variance +1, box variance 0
- Post session → 2 adjustments created (не 3, т.к. variance=0 skip)
- Both adjustments posted, balances corrected

### Reversal
- Post issue → save ledgerEntryIds [le1, le2]
- Void posted → reversal document created (docType=reversal)
- 2 new ledger entries (le3, le4) с reversalOf link
- Sum: le1+le2+le3+le4 = 0 (математика сошлась)
- Попытка reverse у reversal → CANNOT_REVERSE_REVERSAL

### Idempotency
- Post doc_X с Idempotency-Key: abc → result A
- Post doc_X с same key → cached result A, no new ledger
- Post doc_Y с same key but different payload → IDEMPOTENCY_KEY_CONFLICT

---

## 3. Concurrency tests

### Parallel post same balance
- 2 processes одновременно post-ят issue на одну и ту же balance
- Один commits, второй retries с новым read → либо commits (если осталось), либо INSUFFICIENT_STOCK

### Race: post + draft create
- Balance 10 wire, draft с qty=3 создаётся параллельно с post issue qty=8
- Outcome 1: draft first → reserved=3, available=7; post then fails (need 8, available=7) — INSUFFICIENT_AVAILABLE_STOCK
- Outcome 2: post first → onHand=2, reserved=0, available=2; draft then fails — INSUFFICIENT_AVAILABLE_STOCK

### 100 parallel posts
- 100 concurrent `postDocument` calls на разные documents, same balance pool
- All complete без ledger дубликатов
- Balance correctness: sum(ledger) == onHand

---

## 4. TTL / Scheduled function tests

### Expire stale drafts
- Create draft с reservationExpiresAt = now - 1h
- Trigger `expireStaleDrafts` cron manually
- Draft status → 'expired'
- reservedQty decremented
- Event `warehouse.reservation.expired` published

### Idempotency key expiry
- Create idempotency key с expiresAt in past
- Verify Firestore TTL removes it (tested via wait or emulator)

---

## 5. Integrity check tests

### Drift detection
- Manually corrupt: insert random ledger entry WITHOUT updating balance
- Run `verifyWarehouseIntegrity` → drift detected, event fired

### Recalculate
- With drifts present, call `recalculateBalances(dryRun=true)` → returns drifts, not applied
- Call with dryRun=false → balances corrected to match ledger sum

---

## 6. Error path tests

Each error code in §9 of SPEC должен иметь test:
- INSUFFICIENT_STOCK (warehouse)
- INSUFFICIENT_AVAILABLE_STOCK (draft creation)
- PROJECT_ID_REQUIRED
- INVALID_UOM
- DOCUMENT_NOT_IN_POSTABLE_STATE
- CANNOT_REVERSE_REVERSAL
- DOCUMENT_ALREADY_POSTED → returns idempotent result (not error)
- NEGATIVE_STOCK_BLOCKED
- IDEMPOTENCY_KEY_CONFLICT
- EMPTY_DOCUMENT

---

## 7. Coverage target

- Unit: 90%+ для `warehouse/core/posting/*`
- Integration: все 6 docTypes happy path + negative path
- Concurrency: 5 scenarios минимум

---

## 8. История

- **2026-04-18** — v1.0.
