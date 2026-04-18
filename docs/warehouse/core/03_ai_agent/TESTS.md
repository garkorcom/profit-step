# Core 03 — AI Agent — Test Plan

> **Parent spec:** [`SPEC.md`](./SPEC.md)

---

## 1. Unit tests (mocked Gemini)

### parseOnSiteInventory
- ✓ "тут 3 коробки розеток" → 1 item, qty=3, unit=box
- ✓ "20 розеток и катушка провода 250 футов" → 2 items
- ✓ Empty text → error 'no_items'
- ✓ Gemini returns invalid JSON → fallback error
- ✓ Fuzzy match confidence < 0.85 → needClarification: true

### parseReceipt
- ✓ Mock Gemini возвращает 4 line items → 4 parsed lines
- ✓ Missing total in receipt → warning but proceed
- ✓ Vendor detection: "Home Depot #8502" → matched to wh_vendors
- ✓ Idempotent: same photoHash → deduplicated, returns existing docId

### proposeTaskWriteoff
- ✓ Task templateType matches norm → draft issue с правильными lines
- ✓ Task без norm → returns empty lines + warning
- ✓ Insufficient stock on worker van → returns plan с qty=0 на missing

### fuzzyMatchItem
- ✓ Exact SKU match → confidence 1.0
- ✓ Fuzzy name match > 0.85 → auto-match
- ✓ Ambiguous (3 candidates same score) → returns all for clarification

### semanticSearch
- ✓ "провод для 15A" → LLM extracts filter → Firestore query
- ✓ Empty query → error
- ✓ Query с результатами в 2 locations → returns both

---

## 2. Integration tests (mocked Gemini + real Firestore emulator)

### UC1 end-to-end
- Voice message "3 розетки на Dvorkin" → parseOnSiteInventory → draft transfer created → user confirms → posted

### UC2 end-to-end
- Photo upload → parseReceipt → draft receipt created → confirm → posted + ledger entries

### UC3 end-to-end
- Trigger task.started event → proposeTaskWriteoff → draft issue с projectId → confirm → posted

---

## 3. Prompt regression tests

Набор fixtures (input, expected output):
- `fixtures/on_site_ru.json` — 20 Russian phrases
- `fixtures/on_site_en.json` — 20 English phrases
- `fixtures/receipts/` — 15 real receipts (HEIC + JPEG)
- `fixtures/tasks/` — 10 task templates

На каждом PR, который меняет prompts → прогон fixtures → report accuracy regression.

---

## 4. Cost tests

- ✓ Gemini call logged в wh_audit_log с tokens + cost estimate
- ✓ Metric `warehouse_ai_gemini_cost_usd_total` increments
- ✓ Per-capability cost aggregation works

---

## 5. Error handling

- ✓ Gemini all models fail → `ai_unavailable` returned to caller
- ✓ Gemini returns malformed JSON → fallback error, not crash
- ✓ Rate limit exceeded → retry with backoff

---

## 6. Coverage target

- Unit: 85%+ для `warehouse/ai_agent/capabilities/*`
- Integration: все 4 UC end-to-end
- Prompt fixtures: 70%+ accuracy на baseline

---

## 7. История

- **2026-04-18** — v1.0.
