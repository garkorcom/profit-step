# Improvement 01 — Sync Finance — Tests

> **Parent:** [`SPEC.md`](./SPEC.md)

---

## 1. Event publishing tests

- ✓ Post receipt → `warehouse.document.posted` event published с правильным payload
- ✓ Post issue с projectId → event с projectId/phaseCode/costCategory
- ✓ Post transfer → event, Finance action = no-op
- ✓ Post adjustment reason=loss_theft → event с loss marker
- ✓ Anomaly detected (task overrun) → `warehouse.anomaly.detected` event

## 2. Contract tests

- ✓ Event payload проходит Zod validation на обеих сторонах
- ✓ Missing required field → error, event не публикуется
- ✓ Extra fields игнорируются (forward-compat)

## 3. Integration tests (emulator)

- ✓ End-to-end: receipt posted → Finance subscriber creates expense → expense shows up via Finance API
- ✓ Project cost sync: 3 issues к proj_X → sum cost in Finance === sum in Warehouse ledger

## 4. API tests

- ✓ GET /cost-summary возвращает правильный aggregation
- ✓ GET /balances?valuation=true возвращает sum(onHand × avgCost)

## 5. Failure modes

- ✓ Finance subscriber down → events в delivery queue, retry successful
- ✓ Finance rejects event (validation) → logged + admin alert

---

## 6. История
- **2026-04-18** — v1.0.
