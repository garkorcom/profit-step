# Core 01 — Data Model — Test Plan

> **Parent spec:** [`SPEC.md`](./SPEC.md)
> **Scope:** валидация schemas, indexes, invariants (без posting logic — это в `02_posting_engine/TESTS.md`)

---

## 1. Zod schema tests

Для каждой collection — schema validation tests:

### `wh_items`
- ✓ Minimal valid item (sku + name + baseUOM + category)
- ✓ Full item с purchaseUOMs + pricing + flags
- ✗ Missing required field (sku / name / baseUOM) → error
- ✗ Invalid UOM в purchaseUOMs (factor ≤ 0) → error
- ✗ Multiple `isDefault: true` в purchaseUOMs → error
- ✗ `baseUOM` не присутствует в `allowedIssueUOMs` → warning
- ✓ Soft delete: `isActive: false` + `archivedAt` + `archiveReason`

### `wh_locations`
- ✓ warehouse без ownerEmployeeId
- ✓ van с ownerEmployeeId + licensePlate
- ✓ site с relatedClientId
- ✓ quarantine
- ✗ van без ownerEmployeeId → error (enforced at create)
- ✗ Invalid locationType → error

### `wh_documents`
- ✓ Minimal receipt
- ✓ Issue с projectId + phaseCode
- ✓ Transfer с source + destination
- ✓ Count с locationId
- ✓ Adjustment с reason
- ✓ Reversal с reversalOf
- ✗ Missing sourceLocationId для issue → error
- ✗ Missing destinationLocationId для receipt → error
- ✗ Same source и destination для transfer → error
- ✗ Invalid status transitions (posted → draft) → error
- ✗ reversalOf указывает на не-posted документ → error

### `wh_document_lines`
- ✓ Minimal line (itemId + uom + qty)
- ✓ Line с unitCost (для receipt)
- ✓ Count line с systemQty + countedQty + variance
- ✗ Negative qty без reversal context → error
- ✗ qty = 0 → error

### `wh_ledger`
- ✓ Valid entry (deltaQty + direction aligned)
- ✗ deltaQty < 0 но direction = 'in' → error
- ✗ Missing itemId / locationId → error
- ✗ Missing unitCostAtPosting на receipt → error

### `wh_balances`
- ✓ Valid balance (onHand + reserved + available)
- ✗ availableQty ≠ onHandQty - reservedQty → error
- ✗ Missing compound key → error

---

## 2. Invariant tests (static, без Firestore)

### I2: availableQty consistency
```typescript
describe('balance invariants', () => {
  it('availableQty = onHandQty - reservedQty', () => {
    const balance = { onHandQty: 100, reservedQty: 30, availableQty: 70 };
    expect(validateBalance(balance)).toBe(true);
  });
  it('rejects inconsistent availableQty', () => {
    const bad = { onHandQty: 100, reservedQty: 30, availableQty: 50 };
    expect(() => validateBalance(bad)).toThrow();
  });
});
```

### I5: direction coherence
```typescript
describe('ledger entry invariants', () => {
  it('direction in → deltaQty > 0', () => {
    expect(validateLedger({ deltaQty: 10, direction: 'in' })).toBe(true);
    expect(() => validateLedger({ deltaQty: -5, direction: 'in' })).toThrow();
  });
});
```

---

## 3. Firestore rules tests (emulator)

### Read permissions
- ✓ `warehouse:read` scope → доступ к `wh_items`, `wh_balances`, `wh_ledger`, `wh_documents`
- ✗ No scope → denied
- ✗ `warehouse:read` но пользователь не match RLS (чужой van) → denied

### Write permissions
- ✗ Any user → write to `wh_ledger` denied (admin SDK only)
- ✗ Any user → write to `wh_balances` denied
- ✓ `warehouse:write` → create draft в `wh_documents`
- ✗ `warehouse:write` → update posted document denied
- ✗ `warehouse:write` → delete любой документ denied (только void через reversal)

### Lines subcollection
- ✓ `warehouse:write` + canEditDraft → edit lines
- ✗ `warehouse:write` + parent document posted → edit lines denied

---

## 4. Index coverage tests

Для каждого defined index в `SPEC.md` §3-§11 — написать query, который его использует:

```typescript
describe('wh_documents indexes', () => {
  it('docType + status + eventDate queries run fast', async () => {
    const start = Date.now();
    await db.collection('wh_documents')
      .where('docType', '==', 'issue')
      .where('status', '==', 'posted')
      .orderBy('eventDate', 'desc')
      .limit(50)
      .get();
    expect(Date.now() - start).toBeLessThan(500);
  });
  
  it('project + phase + eventDate queries', async () => { /* ... */ });
});
```

При отсутствии index — Firestore бросит error with index hint → тест ловит это.

---

## 5. Compound key tests

```typescript
describe('wh_balances compound key', () => {
  it('correct format locationId__itemId', () => {
    expect(makeBalanceKey('loc_van_denis', 'item_wire_12_2_nmb'))
      .toBe('loc_van_denis__item_wire_12_2_nmb');
  });
  
  it('O(1) lookup', async () => {
    const key = 'loc_van_denis__item_wire_12_2_nmb';
    await db.collection('wh_balances').doc(key).set({ onHandQty: 100, ... });
    
    const doc = await db.collection('wh_balances').doc(key).get();
    expect(doc.data().onHandQty).toBe(100);
  });
});
```

---

## 6. TTL tests (idempotency keys, AI drafts)

- ✓ Expired idempotency key → удалён Firestore TTL automation в течение часа
- ✓ AI draft с reservationExpiresAt < now → scheduled function помечает expired + снимает reservation

---

## 7. Seed data tests

- ✓ Seed script создаёт ровно заявленное кол-во: 1 warehouse + 3 van + 1 quarantine + 8-10 categories + 50 items + 20 norms
- ✓ Все items имеют unique SKU
- ✓ Все norms привязаны к существующим items
- ✓ Seed идемпотентен: повторный запуск не дублирует

---

## 8. Migration tests

- ✓ schemaVersion 1 → 2 migration script (placeholder, проверка framework)
- ✓ Reset script в dryRun возвращает отчёт, не пишет
- ✓ Reset не trогает не-wh_* коллекции

---

## 9. Smoke test checklist

После Phase 0 deploy:
- [ ] `db.collection('wh_items').limit(50).get()` возвращает 50 items
- [ ] `db.collection('wh_locations').get()` возвращает 5 (1 wh + 3 van + 1 quarantine)
- [ ] `db.collection('wh_norms').get()` возвращает 20 norms
- [ ] `db.collection('wh_ledger').get()` возвращает 0 (никаких движений до Phase 1)
- [ ] `db.collection('wh_balances').get()` возвращает 0

---

## 10. История

- **2026-04-18** — v1.0 test plan для data model.
