# Core 03 — AI Agent

> **Parent:** [`MAIN_SPEC.md`](../../MAIN_SPEC.md)
> **Tests:** [`TESTS.md`](./TESTS.md)
> **Scope:** warehouse AI capabilities, prompts, Gemini integration, session state. **Без** posting logic (это в 02) и external API (это в 04).

---

## 1. Role

AI-agent = тонкий слой между пользователем (Telegram, Web) и core posting engine.

**Может:**
- Parse text/voice/photo
- Создать `draft` document (но не post — это делает human через confirm)
- Отвечать на read-only queries (stock, cost, history)

**Не может:**
- Напрямую менять balances (все writes через draft→confirm pattern)
- Обходить business rules (negative stock, UOM validation)
- Выполнять admin-only операции (reversal, recalculate)

---

## 2. Capabilities (14 штук)

| # | Capability | Trigger | Primary UC |
|---|---|---|---|
| 1 | `parseOnSiteInventory` | Voice/text "тут есть X" | UC1 |
| 2 | `parseReceipt` | Photo of receipt | UC2 |
| 3 | `proposeTaskWriteoff` | Task start event | UC3 |
| 4 | `buildProcurementPlan` | estimate.published | UC4 |
| 5 | `webSearchItem` | Sub-step of UC4 | UC4 |
| 6 | `sendVendorRFQ` | Sub-step of UC4 | UC4 |
| 7 | `proposeTransfer` | Auto-transfer agent | UC (auto_transfers) |
| 8 | `detectAnomaly` | Daily cron | UC5 |
| 9 | `suggestReorder` | Weekly cron | UC6 |
| 10 | `runCycleCountSession` | Manager trigger | UC7 |
| 11 | `findDeadStock` | Monthly cron | UC8 |
| 12 | `fuzzyMatchItem` | Internal helper | All |
| 13 | `resolveClient` | Internal helper | All |
| 14 | `semanticSearch` | "где провод для 15A" | Query |

Каждый capability — отдельная функция в `warehouse/ai_agent/capabilities/`.

---

## 3. Gemini integration

### 3.1. Models

| Task | Model | Fallback |
|---|---|---|
| Text intent parsing (UC1, UC3) | Gemini 2.0 Flash (JSON mode) | Gemini 1.5 Flash |
| Receipt vision (UC2) | Gemini 2.0 Flash (multimodal) | Gemini 1.5 Pro |
| Voice transcription | Gemini 2.0 Flash (audio input) | Google Speech-to-Text |
| Complex reasoning (UC4 procurement) | Gemini 2.0 Flash | Claude 4.7 Sonnet (future) |
| Fuzzy match helper | No LLM (Fuse.js + heuristics) | — |

### 3.2. Wrapper

`warehouse/ai_agent/gemini/callGemini.ts`:
```typescript
async function callGemini(opts: {
  systemPrompt: string;
  userContent: Array<{ type: 'text' | 'image' | 'audio'; data: string }>;
  responseFormat: 'json' | 'text';
  models?: string[];  // override fallback chain
}): Promise<{ text: string; modelUsed: string } | null>
```

Fallback chain: если первая модель fails — пробуем следующую. Если все fail — `null` (caller обрабатывает).

### 3.3. Cost tracking

Каждый call логируется:
```
wh_audit_log:
  actionType: 'ai.gemini.call'
  actor: {...}
  target: { capability: 'parseReceipt', sessionId: 'wh-ai-XYZ' }
  metadata: {
    model: 'gemini-2.0-flash',
    inputTokens, outputTokens,
    estimatedCostUsd: 0.00002,
    durationMs: 1234,
    success: true,
  }
```

Метрика `warehouse_ai_gemini_cost_usd_total` → dashboard.

---

## 4. Prompt design principles

1. **JSON mode always** — responseMimeType: 'application/json'
2. **Structured output schema** — в prompt явное описание JSON schema + 2-3 examples
3. **Error path** — prompt описывает {"error": "reason_code"} для failure cases
4. **Defensive parsing** — после Gemini response → Zod validate → если invalid, retry или fail gracefully
5. **No hallucinated items** — prompt запрещает inventing items без evidence в input

Prompts хранятся в `warehouse/ai_agent/prompts/*.ts` — версионируются в git.

---

## 5. Session state

### 5.1. Collection `warehouse_ai_sessions`

Per user. Хранит state активных диалогов:

```typescript
interface WarehouseAISession {
  id: string;                       // userId
  activeTrip?: TripPlan;            // UC1/UC3 context
  activeReceiptScan?: ReceiptScanState;  // UC2 intermediate
  activeProcurementPlan?: ProcurementPlanState; // UC4
  lastGPS?: { lat, lng, at };       // для auto-location detection
  recentLocationHints?: string[];   // "Dvorkin", "Sarah" для disambiguation
  updatedAt: Timestamp;
}
```

### 5.2. TTL

Session entities держатся forever (userId-scoped). Sub-states (activeTrip etc.) имеют `expiresAt` 48h после createdAt.

### 5.3. Events log

`warehouse_ai_events` (см. data model §12.1) — каждое AI действие логируется для debug/analytics.

---

## 6. Capability contracts

### 6.1. `parseOnSiteInventory` (UC1)

```typescript
async function parseOnSiteInventory(input: {
  userId: string;
  text: string;                     // free-form или voice transcription
  gpsLocation?: { lat, lng };
  voiceAudio?: Buffer;              // если voice input
}): Promise<ParseOnSiteResult>

type ParseOnSiteResult =
  | { ok: true; 
      parsedItems: Array<{ catalogItemId?: string; name: string; qty: number; unit: string; confidence: number; needClarification?: boolean }>;
      detectedSite?: { locationId?: string; clientHint?: string; addressHint?: string };
      draftDocumentId: string;       // уже создан transfer van→site
    }
  | { ok: false; reason: 'parse_failed' | 'no_items' | 'ai_unavailable' }
```

Внутри:
1. Если voice audio — транскрибировать через Gemini
2. Parse text через Gemini JSON prompt
3. Fuzzy match каждого item к catalog
4. Resolve site location (создать если нужно)
5. Create draft transfer van → site
6. Return для confirm step

### 6.2. `parseReceipt` (UC2)

```typescript
async function parseReceipt(input: {
  userId: string;
  photoUrl: string;                 // Firebase Storage URL
  photoHash?: string;                // для idempotency
  currentLocationId?: string;
  activeTripId?: string;
}): Promise<ParseReceiptResult>
```

Внутри:
1. Preprocessing: HEIC→JPEG, rotation, crop
2. Gemini Vision → structured extract (vendor, total, items)
3. Fuzzy match к catalog
4. Idempotency check по photoHash
5. Create draft receipt (или deduplicate)

### 6.3. `proposeTaskWriteoff` (UC3)

```typescript
async function proposeTaskWriteoff(input: {
  taskId: string;
  workerId: string;
  locationId: string;
  templateType: string;             // "install_outlet"
  qty: number;
}): Promise<ProposeWriteoffResult>
```

Внутри:
1. Lookup norm по templateType
2. Check stock на locationId (van)
3. Create draft issue с projectId (attached to task)
4. Return для confirm

### 6.4. `buildProcurementPlan` (UC4)

Большой capability — см. [`../../improvements/08_estimate_procurement/SPEC.md`](../../improvements/08_estimate_procurement/SPEC.md).

### 6.5. `proposeTransfer` (auto-transfer agent)

См. [`../../improvements/04_auto_transfers/SPEC.md`](../../improvements/04_auto_transfers/SPEC.md).

### 6.6. `fuzzyMatchItem` (helper)

```typescript
function fuzzyMatchItem(
  input: { name: string; unit?: string; categoryHint?: string },
  catalog: WhItem[]
): Array<{ itemId: string; confidence: number }>
```

Использует Fuse.js с weights на name > sku > aliases. Confidence > 0.85 → auto, иначе возвращает top-3 для clarification.

### 6.7. `semanticSearch`

```typescript
async function semanticSearch(
  query: string,                    // "где провод для 15А розетки"
): Promise<Array<{ itemId: string; locationId: string; availableQty: number; score: number }>>
```

LLM парсит intent, extracts filters (category, specs), выполняет Firestore queries.

---

## 7. Draft → Confirm pattern

**Любой capability, который меняет state:**

1. Parse input
2. **Create draft document** (не posted)
3. Return preview (в UI/bot) для human confirm
4. User `[✅ Confirm]` → вызывает `POST /api/warehouse/documents/:id/post`
5. Only THEN balance меняется (через core posting)

**Никогда** AI напрямую не posts documents — только через explicit human action (или через auto-post policy if enabled — и даже тогда это отдельный flag, не default).

---

## 8. Scope & non-goals

### In scope

- All 14 capabilities
- Gemini integration (wrapper, fallback, cost tracking)
- Session state management
- Prompt design principles
- Draft → confirm pattern

### NOT in scope

- Core posting algorithm → [`02_posting_engine/SPEC.md`](../02_posting_engine/SPEC.md)
- REST endpoints → [`04_external_api/SPEC.md`](../04_external_api/SPEC.md)
- Telegram bot handler code → `onWorkerBotMessage` в main repo
- Detailed per-UC flows → `improvements/*/SPEC.md` (per capability)

---

## 9. Open questions

1. **Claude vs Gemini for UC4** — Procurement planning требует complex reasoning (много items, multi-vendor grouping). Gemini 2.0 Flash достаточно или Claude 4.7 лучше?
2. **Voice transcription** — Gemini Audio vs Google Speech-to-Text API? Тесты нужны.
3. **Prompt versioning** — store в git достаточно или нужен отдельный prompt registry с A/B testing?

---

## 10. Связанные документы

- Parent: [`../../MAIN_SPEC.md`](../../MAIN_SPEC.md)
- Prev: [`../02_posting_engine/SPEC.md`](../02_posting_engine/SPEC.md)
- Per-UC details: [`../../improvements/`](../../improvements/)
- Tests: [`./TESTS.md`](./TESTS.md)

---

## 11. История

- **2026-04-18** — v1.0. 14 capabilities, Gemini integration, draft→confirm pattern.
