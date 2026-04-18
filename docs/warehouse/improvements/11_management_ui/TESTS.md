# Warehouse Management UI — Tests

> **Parent spec:** [`SPEC.md`](./SPEC.md)

## 1. Unit tests (component-level)

Для каждого dialog / form:
- Validation: обязательные поля, формат (SKU uppercase, UOM list constraints)
- Submit happy path → calls correct API with correct payload
- Error handling: 409 uniqueness, 400 validation surfaced in fields
- Keyboard: Enter submits, Esc closes, Tab-order

## 2. Integration tests (MSW mocked backend)

- Create item → appears in list without full reload (optimistic update)
- Create document (issue) with project_installation + no projectId → 400 in UI
- Post draft → status transitions to posted + balance delta shows
- Void posted → reversal document linked in detail

## 3. E2E (Cypress)

- `warehouse-admin-flow.cy.ts` — full journey:
  1. Login as admin
  2. Create new item via dialog
  3. Create new van location
  4. Create receipt document 10 outlets into van
  5. Post it
  6. Verify balance on locations detail page
  7. Create issue 3 outlets → post
  8. Balance decreases correctly
  9. Void the issue → reversal appears → balance restored
  10. Export ledger CSV

## 4. Role-based access tests

- Worker: cannot see create-item button
- Foreman: can post draft, cannot void posted
- Manager: full CRUD, cannot call /recalculate-balances
- Admin: everything

## 5. CSV import

- Valid file (100 items) → all imported, no errors
- File with 3 invalid rows → 97 imported, 3 surfaced with line numbers
- Duplicate SKU within file → highlighted, row rejected

## 6. Performance

- Items list with 1000 entries renders < 500ms (virtualize if needed)
- Document list pagination: next page load < 300ms (cursor-based)

## 7. История

- **2026-04-18** — v1.0.
