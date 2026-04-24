# EasyTimerCost · Mini-TZ для утверждения

> Документ для Дениса. После approve — Claude идёт строить.
> Дата: 2026-04-20. Автор: Claude Opus 4.7.

---

## 0. TL;DR

**EasyTimerCost** = AI-first ERP для construction/field-services SMB (5–150 человек). Мы не "заменяем QuickBooks + TSheets" — мы **заменяем диспетчера, бухгалтера и секретаря** дешёвым AI-слоем, пока люди занимаются делом.

**Ключевая фишка:** у каждого (работник, прораб, клиент, проект) — свой персональный AI-агент. Они общаются между собой по A2A, а человек только апрувит / вмешивается.

**Прототип готов** (16 HTML-страниц). **Production** на Firebase + Claude Agent SDK — ~8 недель до beta, ~16 недель до GA.

**Бизнес-модель:** $49/user/mo SaaS · добавочно $29/agent/mo за активных AI-агентов сверх базы.

---

## 1. Что уже сделано (prototype state)

В `easytimercost/prototype/` на порту 5175 живёт кликабельный прототип:

### Admin side (классический enterprise UI, но AI-aware)
- [`index.html`](prototype/index.html) — Dashboard с KPI и exception queue
- [`sessions.html`](prototype/sessions.html) — Live shifts table
- [`session-detail.html`](prototype/session-detail.html) — Детали сессии + AI decisions card (geo 100% / face 98.4% / policy pass) + audit trail с AI-акторами
- [`expenses.html`](prototype/expenses.html) — Receipts + expense batches
- [`expense-detail.html`](prototype/expense-detail.html) — OCR card с per-field confidence + "why auto-approved"
- [`payouts.html`](prototype/payouts.html) — Payout runs
- [`workers.html`](prototype/workers.html) — Worker list
- [`worker-profile.html`](prototype/worker-profile.html) — 5 tabs включая `?tab=ai` с activity/permissions/ROI
- [`audit.html`](prototype/audit.html) — Immutable log с human/agent/ai-assisted разделением

### Worker side (chat-first)
- [`my-time.html`](prototype/my-time.html) — Чат с личным AI + active session card + AI timeline
- [`my-expenses.html`](prototype/my-expenses.html) — AI push receipts from email + quick submit

### Sales intelligence (3-page call flow)
- [`call-brief.html`](prototype/call-brief.html) — PRE-call (LTV, stakeholders, Q&A, earn strategy, persuasion playbook, action plan)
- [`call-live.html`](prototype/call-live.html) — Live transcript + AI predicted next question + commitments tracker + quick actions
- [`call-summary.html`](prototype/call-summary.html) — POST-call sentiment, commitments → auto-tasks, record updates, revenue impact, cadence

### Infrastructure (дизайн-уровень)
- AI design tokens (purple `--ai` / ai-card / agent-avatar / confidence bar)
- Chat components
- MOCK.agents (16 агентов) + MOCK.clientIntel (полный brief для Acme)
- Helpers: `agentById`, `getClientIntel`, `fmt$`, `workerById`

### Ещё не нарисовано (pending)
- [ ] `admin-agents.html` — список агентов + их метрики
- [ ] `a2a.html` — визуализация межагентного оркестра (network graph + live feed)
- [ ] `ai-policies.html` — автоматизационные правила (toggles)

---

## 2. Что нужно доработать в дизайне (до MVP)

### 2.1. Критичное (MVP blockers)
- [ ] **Trust layer** — явный UI для "почему AI сделал то что сделал" — confidence threshold sliders, explain-this-decision модалки
- [ ] **Human override** — на каждом AI-действии кнопка "undo/edit/escalate" с audit trail
- [ ] **Agent identity** — каждый агент должен иметь паспорт: model, prompt version, permissions, error rate, cost
- [ ] **Cost meter** — AI дорогой; везде где LLM работает — показывать затраты токенов/$
- [ ] **Onboarding flow** — первый заход: подключи Gmail → AI scan → готовый brief за 60 сек. Щас нет.
- [ ] **Mobile-first worker view** — щас desktop-layout. Работники на стройке с телефона.

### 2.2. Важное (до GA)
- [ ] **Notifications center** — push + email + SMS + telegram дайджест
- [ ] **Proposal generator** — полноценный screen, не stub
- [ ] **Contract signer** — DocuSign / own e-sign flow
- [ ] **Calendar integration** — Google/iCloud/Outlook
- [ ] **Inventory module** — parts tracking, PO flow
- [ ] **Client portal v2** — белый лейбл на клиента
- [ ] **Multi-org** — несколько компаний в одном аккаунте (франшиза)

### 2.3. Nice-to-have
- [ ] Voice interface (звонки через Twilio + whisper + TTS)
- [ ] AR site-visit (iPhone LiDAR → measurement)
- [ ] Drone integration для roofing
- [ ] Predictive маржа (ML на historical data)

---

## 3. Агентная архитектура — какой SDK?

### 3.1. Опция A: Claude Agent SDK (**рекомендую**)

**Что это:** TypeScript/Python SDK от Anthropic (то же самое, на чём Claude Code работает). Это _не_ просто API wrapper — это framework для построения долгоживущих агентов с tools, MCP, memory, subagents.

**Плюсы:**
- ✅ Самая умная модель в мире (Claude Opus 4.7) под капотом
- ✅ Встроенная поддержка MCP (Model Context Protocol) — стандарт для tools
- ✅ Subagents и agent-to-agent уже первым классом
- ✅ Prompt caching — экономия 90% на токенах при повторных контекстах
- ✅ Мы уже в Claude-экосистеме (этот прототип через Claude Code написан) — меньше переключения
- ✅ Anthropic — Denis-friendly (нет антимонопольных рисков)

**Минусы:**
- ❌ Дороже чем GPT на single call ($15/M input vs $5/M), но prompt caching выравнивает
- ❌ Меньше integration'ов чем у Google ADK в enterprise

**Вердикт:** **Да**, для MVP и GA.

### 3.2. Опция B: Google ADK (Agent Development Kit)

**Что это:** Google's agent framework, выпущен 2024, focus на production-grade мультиагентные системы. Работает с Gemini, но может и с Claude/GPT.

**Плюсы:**
- ✅ Первоклассная A2A поддержка (это их маркетинговая фишка)
- ✅ Built-in в GCP/Vertex — если бы мы на Google Cloud жили
- ✅ Отличный observability (Cloud Trace + Cloud Logging)

**Минусы:**
- ❌ Мы на Firebase (тоже Google, но Firebase SDK ≠ ADK — разные DX)
- ❌ Gemini на coding/reasoning слабее Opus на 2026 год
- ❌ Lock-in в Google ecosystem
- ❌ Python-first, TS support молодой

**Вердикт:** Нет для MVP. Посмотреть к GA если нужны гугловские tools (Calendar/Drive/Maps).

### 3.3. Опция C: OpenAI Agents SDK

**Что это:** `openai-agents-python` / `openai-agents-js`, late-2025 release, аналог Claude SDK.

**Плюсы:**
- ✅ Дешевле на токенах (GPT-5 mini ~$0.25/M input)
- ✅ Больше tool-integrations на маркете
- ✅ Voice (Realtime API) встроен

**Минусы:**
- ❌ GPT-5 стабильно проигрывает Claude 4.7 на agentic tasks (см. SWE-bench, HLE, τ-bench)
- ❌ Memory/long-context слабее
- ❌ Моделлинг прав и ошибок в OpenAI — хуже (не наш кейс, но market perception)

**Вердикт:** Нет для основного brain. Да — для дешёвых rutинных задач (OCR, транскрипция, batch classification).

### 3.4. Опция D: LangGraph / custom

**Плюсы:** Полный контроль, модель-агностика.
**Минусы:** Нужно писать orchestration/memory/tools самому, а это 3 месяца чистой инфры.

**Вердикт:** Нет. Не bike-shed на MVP.

### 3.5. Итог: гибридный стек

```
┌─────────────────────────────────────────────────────┐
│  Claude Agent SDK (Opus 4.7 · Sonnet 4.6)          │
│  — основной brain для high-stakes decisions         │
│  — все user-facing агенты (worker bot, sales AI)    │
│  — A2A orchestrator                                 │
└─────────────────────────────────────────────────────┘
          │
          ├─→ OpenAI (GPT-5 mini) для cheap routines:
          │     - OCR extraction
          │     - Phone call transcription (Realtime API)
          │     - Batch classification
          │
          ├─→ Gemini 2.5 Flash для dirt-cheap bulk:
          │     - Email triage (1000+/day)
          │     - Schedule conflict detection
          │
          └─→ MCP servers для tools:
                - Firestore MCP (already building)
                - Gmail MCP (official)
                - Calendar MCP
                - Twilio MCP (phone)
                - QuickBooks/Xero MCP
```

**Cost economics:**
- MVP: ~$3–8 per active user per month в LLM costs (с caching)
- Scale (1000 users): ~$2–5 per user (volume discounts + better caching hit rate)

---

## 4. Архитектура production

### 4.1. Слои

```
┌──────────────────────────────────────────────────────────┐
│  CLIENT (React 19 + Vite + MUI v7)                       │
│  — re-use profit-step component library                  │
│  — NEW: chat-first shell, ai-card primitives, agent UI   │
│  — NEW: mobile-first worker PWA                          │
└──────────────────────────────────────────────────────────┘
                         ↕ /api/**
┌──────────────────────────────────────────────────────────┐
│  API LAYER (Firebase Functions · Express)                │
│  — /api/agent/* — user-facing agent endpoints            │
│  — /api/a2a/* — inter-agent comms                        │
│  — /api/webhooks/* — Gmail/Telegram/Twilio push          │
└──────────────────────────────────────────────────────────┘
                         ↕
┌──────────────────────────────────────────────────────────┐
│  AGENT RUNTIME                                           │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐ │
│  │ Worker      │  │ Foreman     │  │ Sales Intel      │ │
│  │ Agent       │  │ Agent       │  │ Agent            │ │
│  │ (per user)  │  │ (per user)  │  │ (per tenant)     │ │
│  └──────┬──────┘  └──────┬──────┘  └────────┬─────────┘ │
│         │                │                  │           │
│  ┌──────▼────────────────▼──────────────────▼─────────┐ │
│  │   A2A BUS (event-driven · Pub/Sub)                 │ │
│  └──────┬─────────────────────────────────────────────┘ │
│         │                                                │
│  ┌──────▼─────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ System     │  │ Approval     │  │ Compliance     │  │
│  │ OCR/NLP    │  │ Gatekeeper   │  │ Watchdog       │  │
│  └────────────┘  └──────────────┘  └────────────────┘  │
└──────────────────────────────────────────────────────────┘
                         ↕
┌──────────────────────────────────────────────────────────┐
│  DATA (Firestore + Storage + BigQuery for analytics)     │
│  — reuse profit-step collections                         │
│  — NEW: agents/, agentActivity/, a2aMessages/, policies/ │
│  — NEW: clientIntel/ (cached brief per client)           │
└──────────────────────────────────────────────────────────┘
```

### 4.2. Переиспользуем из profit-step

- ✅ Auth (Firebase Auth · уже есть tenant isolation)
- ✅ Firestore schema для workers/sessions/expenses/payouts/clients
- ✅ Telegram bot pipeline (расширим, не ломаем)
- ✅ Gmail ingestion (уже есть для receipts)
- ✅ `agentApi` Express infra

### 4.3. Что принципиально новое

- **Agent registry** — документы в `agents/{id}` с prompt version, model, tools, permissions, owner
- **A2A message log** — `a2aMessages/{id}` — append-only, cross-tenant ACL
- **Policy engine** — `policies/{id}` с условиями автоапрува, пороговыми значениями
- **Knowledge base** — каждый агент имеет свою `knowledge/{agentId}/` collection (RAG-ready)
- **Cost ledger** — `llmUsage/{day}/{agentId}` — tokens/cost per call
- **Consent flags** — GDPR/CCPA: пользователь может отключить AI любого типа

---

## 5. A2A protocol

### 5.1. Message envelope
```ts
type A2AMessage = {
  id: string;
  at: Timestamp;
  from: AgentId;          // 'a-w3' (worker Andrey's agent)
  to: AgentId | 'broadcast';
  type: 'propose' | 'request' | 'confirm' | 'decline' | 'inform';
  subject: string;         // 'session-start-proposal'
  payload: unknown;        // typed per subject
  correlationId?: string;  // thread id
  requiresHuman?: boolean; // true → goes to human approval queue
  costEstimateUSD?: number;
};
```

### 5.2. Authority levels
- L0 · **Read-only** — может читать, не писать (e.g. compliance watchdog)
- L1 · **Propose** — пишет drafts, но человек апрувит (default)
- L2 · **Auto-execute ≤ threshold** — автоапрув до лимита (e.g. expense ≤ $500)
- L3 · **Auto-execute always** — опасно, редко (OCR, внутренние системные)

Каждый агент в `agents/{id}` имеет `authority: 'L0'|'L1'|'L2'|'L3'`.

### 5.3. Conflict resolution
- Два агента предлагают противоречивые действия → escalate в `conflictQueue/` → человек решает.
- Все конфликты логируются для fine-tuning policies.

---

## 6. MVP scope (8 недель)

**Цель:** 3 платящих клиента (SMB construction), $0 → $2,000 MRR.

### Week 1–2 · Инфра
- [ ] Claude Agent SDK setup в `functions/src/agents/`
- [ ] Firestore schema миграция (agents, a2aMessages, policies)
- [ ] React shell: ai-card / agent-avatar / chat components в `@easytimercost/ui`
- [ ] Auth: роли `worker` / `foreman` / `admin` / `client`

### Week 3–4 · Worker Agent (shift tracking)
- [ ] Geo inference (последние 20 мин location → propose start)
- [ ] Chat UI в mobile PWA
- [ ] A2A: worker agent ↔ admin approval bot
- [ ] Fallback: manual start button (если AI не уверен)

### Week 5–6 · Expense Agent + OCR
- [ ] Gmail → receipt detection → OCR extract (GPT-5 mini)
- [ ] Vendor/amount/category confidence scoring
- [ ] Auto-approve ≤ $500 threshold
- [ ] Admin: approval queue UI с AI reasoning

### Week 7 · Sales Intelligence
- [ ] Client brief generator (on-demand + nightly refresh)
- [ ] Call brief page (prod version of prototype)
- [ ] Twilio integration: incoming call → pop brief
- [ ] Predicted Q&A из email history (RAG)

### Week 8 · Polish + beta launch
- [ ] Cost meter (tokens/call, $/user/day)
- [ ] Audit log UI (prod version)
- [ ] Onboarding wizard
- [ ] 3 design partners onboarded

**Out of scope для MVP:**
- Call-live real-time transcription (сложно, дорого, к GA)
- Multi-org
- Client portal upgrade
- Payroll run automation
- Inventory

---

## 7. Full roadmap (16 недель до GA)

| Week | Milestone |
|---|---|
| 1–8 | MVP (см. §6) |
| 9 | Call-live: Twilio Realtime + Whisper + GPT-5 Realtime |
| 10 | Call-summary automation (commitments → tasks) |
| 11 | Foreman Agent: crew scheduling, conflict detection |
| 12 | Proposal Generator (AI draft + template engine) |
| 13 | Payroll Agent: period close, variance check |
| 14 | Policies UI + policy versioning |
| 15 | Multi-tenant billing · Stripe · plan tiers |
| 16 | GA launch: landing + docs + 10 paying customers target |

---

## 8. Landing page strategy

**Audience:** construction SMB owners (5–150 workers), field services (HVAC, roofing, landscaping).
**Positioning:** "Fire your dispatcher. Your AI does it for $3/day."
**CTA:** Book 20-min demo.

**Sections:**
1. Hero — bold claim + 30sec demo video
2. Problem — "You're losing $40k/yr in unbilled hours, lost receipts, dropped leads"
3. Solution — agents visualization (worker/foreman/sales AI)
4. Features — 6 cards (time tracking, expenses, payroll, sales brief, crew scheduling, audit)
5. ROI calculator — "80 hours/мес saved · $6,400/мес value"
6. How it works — 3-step (connect → AI learns → execute)
7. Pricing — 3 tiers ($49/$89/$179 per user)
8. Social proof — testimonials (будем собирать с design partners)
9. FAQ (security, data, GDPR, cancel anytime)
10. Footer CTA

**Файл:** [`landing.html`](prototype/landing.html) — я создам в этой же сессии.

---

## 9. Pricing

| Tier | Price | Includes |
|---|---|---|
| **Starter** | $49/user/mo | Worker agent, expense OCR, basic audit, 5 workers max |
| **Pro** | $89/user/mo | + Sales AI, call brief, A2A, unlimited workers, priority support |
| **Scale** | $179/user/mo | + Custom agents, white-label portal, API access, dedicated CSM |

Add-on: **$29/agent/mo** за каждого active AI-агента сверх базы (custom domain agents).

### Unit economics (Pro tier, $89/user/mo)

- Revenue per user: $89
- LLM cost: ~$5 (with caching)
- Firebase/infra: ~$3
- Support: ~$8
- **Gross margin: ~82%**

Breakeven per customer (10 users Pro = $890 MRR): ~4 месяца на acquisition payback при CAC $200/user.

---

## 10. Риски · что может пойти не так

| Риск | Митигация |
|---|---|
| **LLM hallucinations на money flows** | L2 authority cap $500, all money actions go to human approve, audit log |
| **Cost blow-up** | Cost meter per agent, daily caps, alert if >$20/user/day |
| **Trust barrier (AI делает что-то за юзера)** | Onboarding: "AI proposes, you approve" · toggle off anytime · explain-this-decision UI |
| **Firebase vendor lock-in** | Abstract Firestore behind repo layer, possible Postgres migration к Series A |
| **Anthropic price hike / API change** | Multi-model dispatch: fallback на GPT / Gemini ready day 1 |
| **GDPR/CCPA** | EU data residency option (Firebase regions), DPA template, right to delete implemented |
| **Competitor (BuildStar, Procore, ServiceTitan ≥1B valuations)** | Not competing on features — competing on "AI does it for you" positioning · SMB segment (они enterprise) |

---

## 11. Стоимость разработки

**Команда (рекомендую):**
- 1 Denis (product / sales / design partner relations)
- 1 fullstack (React + Functions) — contractor $8k/mo или Claude Code 24/7
- 1 agent engineer (prompts, A2A, eval) — контрактор $10k/mo or AI agents-style work
- 1 designer (½ time) — $4k/mo

**16-week budget:**
- Salaries: $88k
- Infra (Firebase Blaze, Anthropic, Twilio, etc): $4k
- Tools/SaaS: $2k
- Marketing (landing, domain, ads pre-seed): $6k
- **Total: ~$100k**

**Альтернатива (Claude Code-led dev):**
- Denis $0 (dogfood own time)
- Claude Opus/Sonnet as main engineer: ~$3k/mo в API costs
- Designer part-time: $4k/mo
- Marketing: $6k
- **Total: ~$30k** за 16 недель

---

## 12. Что утвердить у Дениса

### Блок A — Стратегия
- [ ] **A1.** Positioning: "AI fires your dispatcher" SMB construction — ок?
- [ ] **A2.** MVP scope (§6) — можно вырезать/добавить?
- [ ] **A3.** Pricing ($49/$89/$179) — ок? Или иначе?
- [ ] **A4.** Dev mode: hired team $100k OR Claude Code-led $30k?

### Блок B — Техника
- [ ] **B1.** Claude Agent SDK как primary brain — ок?
- [ ] **B2.** Firebase stay OR migrate к Vercel + Postgres через год?
- [ ] **B3.** MCP servers (Gmail/Calendar/Twilio/QB) — начать с каких 2?
- [ ] **B4.** Mobile-first PWA vs native iOS?

### Блок C — Продукт
- [ ] **C1.** Voice / Realtime (Twilio) в MVP или к GA?
- [ ] **C2.** Client portal rev — сейчас или после MVP?
- [ ] **C3.** Integration в profit-step (same codebase) OR fresh repo?
- [ ] **C4.** Branding: "EasyTimerCost" keep OR rebrand?

### Блок D — Следующие шаги этой ночью (что я могу сделать сейчас)
- [ ] **D1.** Дорисовать admin-agents.html + a2a.html + ai-policies.html
- [ ] **D2.** Сделать полноценный landing.html
- [ ] **D3.** Написать onboarding.html (первый заход)
- [ ] **D4.** Написать mobile-worker-pwa.html (мобильный layout работника)
- [ ] **D5.** Скриншоты + README

---

## 13. Приложения

- Prototype demo: http://127.0.0.1:5175 (если dev server запущен)
- Claude Agent SDK docs: https://docs.claude.com/en/api/agent-sdk
- Google ADK docs: https://google.github.io/adk-docs/
- A2A protocol draft: TBD (пропишем сами после утверждения §5)

---

*Статус документа: ожидает approve от Дениса. Следующий ход — мой после ответов на §12.*

---

# 📌 UPDATE · 2026-04-21 · Post Google Cloud Next 2026

**Ключевое архитектурное решение принято.** Полная версия — в [`PATH.md`](PATH.md) (architectural constitution).

## 14. Выбор оркестратора: Custom (Hybrid) vs Google ADK

Принято решение строить **кастомный оркестратор** на базе Firebase + Cloud Functions с гибридным роутингом моделей. Мы используем конверт сообщений `google-a2a/v1` для совместимости на будущее, но логика передачи (RPC, Saga, Fire-and-forget, Streaming, Parallel-dispatch) реализуется нами.

### Почему НЕ полный Google Agent Studio migration

1. **Agent Studio — black box на день 1 после анонса** — не знаем что работает vs vaporware. Early adopter risk высок.
2. **Vendor lock-in долгосрочный** — раз переехал на Google ADK, обратно невозможно без переписи. Google может менять правила/цены/authority model.
3. **Self-hosted orchestration уже доказан концептуально** — наш `a2a.html` prototype показывает что мы знаем чего хотим. Реализация на Claude Agent SDK + Firebase = 2-3 недели. Agent Studio integration — 1 неделя setup + unknown maintenance.

### Что взято из Google (selective adoption)

| Компонент | Решение |
|---|---|
| **AI models** | Gemini 3 Pro (multimodal), Gemini 3 Flash (cheap classification), Nano Banana 2 (image gen) + Claude Opus 4.7 (reasoning) — **hybrid routing** |
| **Distribution** | Workspace Marketplace как primary growth channel (6x CAC improvement) |
| **Message format** | `google-a2a/v1` envelope — для portability в будущем |
| **Authority model** | L0-L4 иерархия (copied from Google) |
| **Image generation** | Nano Banana 2 для brand avatars + marketing videos |
| **Security patterns** | Вдохновляемся Google AI Protection, реализуем в Firestore Security Rules + own audit |

### Что осталось custom

| Компонент | Решение |
|---|---|
| **Orchestration runtime** | Firebase Cloud Functions + Pub/Sub |
| **Data store** | Firestore (не Vertex AI Data Store) |
| **Agent registry** | Наш `admin-agents.html` |
| **Mission Control** | Наш `a2a.html` |
| **Secrets** | Firebase Secret Manager (defineSecret pattern из profit-step) |
| **Orchestrator dispatch** | Наш TypeScript code с 5 delegation patterns |

### Критичное правило безопасности

**AI никогда не трогает деньги напрямую.**
- AI **предлагает** (Suggestor pattern L1) → human confirms
- База строго считает через Firestore transactions
- Idempotency guard на всех триггерах (processedEvents collection)
- Protection against recursive writes (триггер не пишет в документ, который его вызвал)

Это неотъемлемое наследие из profit-step CLAUDE.md §2.1 — infinite loop = $10k billing bomb.

### Phases (обновлённые после Next 2026)

- **Phase 1 MVP (weeks 1-6):** кастомный стек, hybrid AI, multi-channel chat
- **Phase 2 (months 2-3):** Workspace Marketplace listing + pilot Agent Studio для одной страницы (`ai-policies.html`)
- **Phase 3 (months 4-6):** domain moat depth (permits, sub rates, labor law RAG)
- **Phase 4 (months 7-12):** selective deeper Google adoption если готово

### Abstraction layer (code skeleton)

```typescript
// functions/src/ai/router.ts
async function routeAITask(task: AITask): Promise<AIResponse> {
  const model = pickModel(task.type);       // routing rules в PATH.md §2
  const provider = providers[model.provider];
  return await provider.call(model.id, task);
}

// Swap provider одной config-строкой — никакого hardcoded vendor lock-in в business logic
```

### Exit conditions — когда пересматриваем

- Google ADK ships killer feature, самим делать >4 недель → evaluate selective migration
- Anthropic pricing +50% / breaking change → shift reasoning tier на Gemini 3 Pro
- 3+ customers require BAA (healthcare construction) → full Google Cloud migration
- Agent Studio становится open standard (конкуренты использ) → adopt to not be outlier

### Quarterly review

Раз в 3 месяца — проверка PATH.md соответствия реальности. Commit `docs(PATH): quarterly review Q1/2026`.

---

## 15. Related architecture docs

- **[PATH.md](PATH.md)** — full architectural constitution (11 разделов)
- **[NEXT_SESSION.md](NEXT_SESSION.md)** — current implementation queue
- **[starter-kit/](starter-kit/)** — portable self-docs для любого нового проекта
- **[USE_CASES.md](USE_CASES.md)** — 100 validated use cases

---

*Update автор: Denis + Claude + внешний AI review (2026-04-21 morning post-Next 2026).*
