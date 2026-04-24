# PATH — Architectural Constitution
## Hybrid Gradual Adoption (Post-Google Cloud Next 2026)

> **Статус:** активная конституция проекта. Любое значимое архитектурное решение сверяется с этим документом. Изменения через PR с обоснованием.
>
> **Версия:** 1.0 · 2026-04-21 (post Google Cloud Next 2026 announcements)

---

## 1. Core Philosophy

### 1.1 · Base-first, AI-second (CRITICAL PRINCIPLE)

**Сначала базовая система работает без AI. AI — добавляется incrementally после stabilization.**

Мы избегаем классической ошибки AI-first startup'ов: строить AI до того как базовая бизнес-логика стабильна → и потерять и то, и другое, когда AI галлюцинирует в неотлаженной системе.

**Правило:** каждая AI-фича — это **optional augmentation** поверх работающего manual flow, никогда не единственный путь.

- Receipt OCR fails → user fills form manually (как и раньше)
- Chat NLU не понимает → показываем inline keyboard (как и раньше)
- Auto-approve bot paused → человек approv'ит вручную (как и раньше)
- Agent orchestrator down → manual workflow продолжается

**Consequence:** **система никогда не останавливается из-за AI.** AI только ускоряет то что уже работает.

### 1.2 · Hybrid adoption (AI когда настанет время)

Мы строим **гибридную систему**. Берём у гигантов модели и дистрибуцию (Workspace Marketplace), но оставляем за собой:

- **Оркестрацию** — собственный A2A-compatible orchestrator на Firebase
- **Безопасность данных** — Firestore + наш RLS, не Google Vertex
- **Доменный опыт** — permits, subcontractor rates, construction regulations = наш moat

**Полный lock-in в Google Agent Studio — отклонен** в пользу кастомного контроля на ранних этапах. Agent Studio может быть принят точечно позже, когда созреет.

**Rationale:** Google-стек эволюционирует быстро, ломающие изменения на ранней стадии могут убить нас. Лучше чуть-больше кода сейчас, чем «черный ящик» в критической инфраструктуре.

---

## 2. AI Router & Models Stack (Abstraction Layer)

### Routing rules (hard-coded в AI Router)

| Задача | Model | Обоснование |
|---|---|---|
| Reasoning / chat / negotiations | **Claude Opus 4.7** | MCP, prompt caching, 1M context, известная modal strength |
| Multimodal (vision, voice, audio) | **Gemini 3 Pro** | Native multimodal, 3-5x дешевле на OCR/selfie |
| Cheap classification | **Gemini 3 Flash** | $0.0002/call — массовые operations |
| Image generation | **Nano Banana 2** (Gemini 3 Flash Image) | Brand avatars, onboarding videos, marketing |
| Escalation / disputes / rare edge cases | **Claude Opus 4.7** | Сложный reasoning — не экономим |

### Abstraction pattern (code skeleton)

```typescript
// functions/src/ai/router.ts
interface AITask {
  type: 'reasoning' | 'multimodal' | 'classification' | 'imageGen';
  prompt: string;
  context?: any;
  // cost budget override
  maxCostUsd?: number;
}

async function routeAITask(task: AITask): Promise<AIResponse> {
  const model = pickModel(task.type);
  const provider = providers[model.provider];
  return await provider.call(model.id, task);
}

// Swap provider за одну строку:
const providers = {
  anthropic: AnthropicAdapter,
  google: GoogleAdapter,
  // openai: OpenAIAdapter,  // future
};
```

**Benefit:** любая модель swap'абл за config-change. Нет hardcoded API calls в business logic.

---

## 3. Infrastructure & Orchestration

### Stack

- **База данных:** Firebase Firestore + Cloud Functions
- **Secrets:** `defineSecret()` + Google Secret Manager (паттерн из profit-step)
- **Authentication:** Firebase Auth + multi-tenant RLS
- **Storage (files/photos):** Firebase Storage
- **Messaging bus:** Firebase Pub/Sub для inter-agent communication
- **Observability:** Cloud Logging + наш Mission Control UI (`a2a.html`)

### Оркестратор — custom, совместимый с Google A2A

**Message envelope format** (Google-compatible, наша реализация):

```json
{
  "protocol": "google-a2a/v1",
  "trace_id": "trc-abc123",
  "from": {
    "agent_id": "worker-agent",
    "authority": "L2",
    "tenant": "acme-corp"
  },
  "to": {
    "agent_id": "geo-validator",
    "delegation_type": "request-response"
  },
  "task": {
    "action": "verify_fence",
    "params": { "workerId": "w3", "location": {...} },
    "timeout_ms": 5000
  }
}
```

### Delegation patterns (5 поддерживаемых)

1. **Request-Response** — RPC style, блокирующий ответ
2. **Fire-and-forget** — уведомление без ответа
3. **Streaming** — долгоиграющие задачи (monitor this shift)
4. **Parallel-dispatch** — независимые подзадачи выполняются параллельно
5. **Saga** — multi-step с compensation (откат если шаг fails)

**Portability:** если решим мигрировать на Google ADK через год — message format уже compatible, code stays 80%, replace only dispatch engine.

---

## 4. Authority Levels (строгая иерархия)

| Level | Что может | Применение в EasyTimerCost |
|---|---|---|
| **L0 · Observer** | Только читать данные, никогда не пишет | `kpi-aggregator`, `audit-reporter` |
| **L1 · Suggestor** | Предлагает действие, ВСЕГДА требует human confirm | `worker-agent` (по умолчанию), `sales-agent` |
| **L2 · Bounded actor** | Autonomous в пределах (cost < $X, domain = Y) | `approval-bot` (до $500), `receipt-ocr-agent` |
| **L3 · Full actor** | Autonomous, все actions audited | `session-watcher`, `geo-validator` |
| **L4 · Admin actor** | Может менять других agents | Только `admin` role humans + super-admin agent (ручное approval) |

**Rules:**
- **Worker-facing agents: максимум L1/L2** — никогда не L3+
- **Authority наследуется lower** — L2 делегирует L3 → выполняется в L2
- **Cost budget per level:** L1=$0, L2=$500/action, L3=unlimited with audit, L4=all + audit + approval
- **Circuit breaker:** если agent в L2+ превышает error rate 5% → auto-downgrade на L1 пока human review

---

## 5. Critical Safety Rules

### 🚫 AI никогда НЕ трогает деньги напрямую

Это неотъемлемо (наследство от profit-step CLAUDE.md §2.1 — infinite loop risk = $10k billing bomb).

**Правило:**
- AI **предлагает** финансовое действие (approve pay, bill client, change rate) → **human confirms или rejects**
- AI **не запускает** Cloud Functions которые пишут в `workers.paid`, `clients.invoiced`, `sessions.earnings` напрямую
- Все money-mutating actions идут через **approval queue** с human в loop
- **Idempotency guard обязателен** на любых триггерах (processedEvents collection)
- **Триггеры никогда не пишут в тот же документ который их вызвал** (recursion protection)

**Test:** `functions/test/moneyMutationAuditTest.ts` — проверяет что ни один agent не может напрямую изменить финансовые поля.

### 🔒 PII protection

- Worker SSN / payment details / home addresses — **шифруются at-rest**
- AI never logs full PII in telemetry (маскировка перед отправкой в Claude/Gemini API)
- Audit log сам по себе — append-only с hash chain (immutable)

### 🛡 Tenant isolation (multi-tenant safety)

- Firestore paths `tenants/{tenantId}/...` с RLS
- Agent никогда не cross-читает между tenants
- Background triggers filter by `tenantId` всегда
- Test: `rlsCrossTenant.test.ts` (наследство из profit-step, адаптировать)

---

## 6. Distribution Strategy

### Primary channel: **Google Workspace Marketplace**

- Listing как add-on для construction businesses
- One-click install в их Workspace
- Billing через Google Workspace Billing (20% rev share Google)
- Виральность через Google Docs/Sheets shares

### Secondary: **Direct self-serve**

- Landing page (`landing.html` existing)
- Stripe checkout
- Standalone web-app

### Tertiary: **Agent Marketplace** (когда созреет)

- Публиковать наши 6 domain agents в Google Agent Marketplace
- Secondary revenue stream: $50-200/agent/month

---

## 7. Communication Channels (multi-channel)

Worker сам выбирает при onboarding, система route'ит прозрачно:

| Channel | Target audience | Priority |
|---|---|---|
| **WhatsApp Business API** | US Hispanic labor (60%+) | P0 |
| **Google Chat** | Android + Workspace users | P1 |
| **Telegram bot** | RU-speaking, существующая база | P1 |
| **SMS (Twilio)** | Universal fallback | P2 |
| **Mobile PWA** | Web fallback если нет messenger | P2 |
| **Voice (Google Assistant)** | Hands-free для workers с инструментом | P3 |

**Channel Router (наш code)** абстрагирует agent logic от channel specifics.

---

## 8. Moat — защита от конкурентов

**Наше конкурентное преимущество — не AI-обёртка, а глубокая доменная интеграция:**

1. **Permits Database** 50 штатов США
   - Парсинг gov.data sources
   - Real-time updates при изменении regulations
   - Alert агент flag'ит permit requirements per-project per-site
   - **Непокупаемо у Google** — требует domain expertise + непрерывный parsing

2. **Subcontractor Rate Benchmarks**
   - Aggregated (anonymized) data from customers
   - «You're paying 23% above market for drywall subs in Miami»
   - Value grows with customer base (network effect)

3. **Material Cost Intelligence**
   - Supplier API integrations (Home Depot, Lowe's, Ferguson)
   - Historic pricing trends per SKU per region
   - Buy-now-or-wait recommendations

4. **Labor Law Compliance**
   - Per-state overtime/premium rules (50 штатов, разные правила)
   - Automated payroll calculations compliant с каждой юрисдикцией
   - One prevented misclassification lawsuit = $50k-500k saved

5. **Construction Workflow Intelligence**
   - Accumulated from real projects (anonymized)
   - «Typical Phase 2 drywall takes 4.2 days per 1000 sq ft»
   - Benchmark proposals against reality

**Это то что Google никогда не даст generic.** Это 3-6 месяцев парсинга + непрерывное обновление = экспоненциально растущая defensibility.

---

## 9. Development Phases

### Phase 0 · Foundation · BASE WITHOUT AI (Weeks 1-4) 🔴 **FIRST**

**Цель:** полностью рабочее time tracking без единой AI-фичи. Real workers используют каждый день, manual flow тестирован и stable.

- **Week 1:** Data + Backend (port WorkSession types, TimeTrackingService, CRUD API, scheduled jobs) — copy from profit-step as-is
- **Week 2:** Worker UI (web start/stop shift, Telegram bot keyboard-only, photo/location as files без AI processing)
- **Week 3:** Admin UI (dashboard, sessions table, workers CRUD, clients CRUD, payroll periods)
- **Week 4:** Testing + Deploy (unit + integration + smoke + deploy prod)

**Порт 80% кода из profit-step time tracking** — уже production-grade, протестировано. Не изобретаем велосипед.

**Deliverable:** working time tracking system used by 5+ real workers daily. **Zero AI**.

### Phase 0.5 · Stabilization (Weeks 5-6) ⏸ **MANDATORY**

**Правило:** не переходим к AI пока база не стабильна.

- Collect real user feedback
- Fix bugs
- Iterate UX
- Monitor costs/performance

**Gate criteria to proceed to Phase 1:**
- ✅ 10+ active workers using daily
- ✅ <5 bug reports / week
- ✅ 95%+ shift completion rate
- ✅ Admin comfortable with manual workflow (works without AI)

**If criteria not met:** iterate Phase 0 more, DO NOT add AI to broken foundation.

### Phase 1 · AI Augmentation (Weeks 7-12) 🟠 **incremental**

**Принцип:** каждая AI-фича — optional layer над working manual flow. Никогда не единственный путь.

- **Week 7:** Receipt OCR (Gemini Pro) — fallback to manual entry
- **Week 8:** Telegram chat NLU (Gemini Flash) — fallback to keyboard
- **Week 9:** Auto-approve small expenses (Gemini Flash L2 authority)
- **Week 10:** Selfie face match (Gemini Pro) — fallback to admin review
- **Week 11-12:** Agent orchestration layer (from a2a.html prototype to production)

### Phase 2 · Multi-channel + Market (Months 4-5) 🟡

- **WhatsApp Business API** integration (primary channel US Hispanic labor)
- **Workspace Marketplace listing** (6x CAC improvement via distribution)
- **Nano Banana 2** для marketing + personalized onboarding videos
- **Experimental pilot:** Agent Studio для `ai-policies.html` (low-code rules UI)

### Phase 3 · Depth + Moat (Months 6-8) 💎 **defensibility**

- **Permits database** (10 states → 50 states)
- **Subcontractor rate benchmarking** (at 20+ customers)
- **Labor law RAG** (per-state compliance)
- **Material cost tracking** (supplier API integrations)
- **BigQuery + Agentspace** для «ask your P&L» (после 50+ customers)

### Phase 4 · Scale + Optionality (Months 9-12)

- Agent Studio deeper adoption если созрел
- AI Protection platform (Google managed security)
- Agent Marketplace publish (secondary revenue)
- Enterprise tier (SOC2, HIPAA, larger customers)

---

## 10. Exit Conditions (когда пересматриваем)

Этот PATH — живой документ. Пересмотр обязателен если:

| Триггер | Action |
|---|---|
| Google ADK shipped killer feature которую самим делать > 4 недель | Evaluate selective migration |
| Anthropic pricing +50% / breaking change | Shift reasoning tier на Gemini 3 Pro |
| Gemini 3.1 Pro significantly better на наших benchmarks | Increase Gemini usage tier |
| Firebase hits scaling wall (10k+ concurrent agents) | Consider Cloud Run migration |
| 3+ customers require BAA (HIPAA healthcare construction) | Full Google Cloud migration evaluation |
| Agent Studio становится open standard (competitors use it too) | Adopt to not be outlier |

**Quarterly review:** раз в 3 месяца — проверка что PATH соответствует реальности. Commit `docs(PATH): quarterly review Q1/2026`.

---

## 11. Related Documents

- `MINI_TZ.md` — полный product spec + phase breakdown
- `USE_CASES.md` — 100 validated use cases (source of truth для acceptance tests)
- `NEXT_SESSION.md` — current queue of work (Week 1 implementation plan)
- `starter-kit/README.md` — portable self-docs system для reuse в других проектах
- `prototype/_master_tz.html` — live coverage map всех pages
- `prototype/_tz_lint.html` — 11 consistency checks

---

## Change log

| Date | Version | Change | Author |
|---|---|---|---|
| 2026-04-21 | 1.0 | Initial constitution после Google Cloud Next 2026 announcements | Денис + Claude + external AI review |
