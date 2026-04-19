# ТЗ: Карточка клиента v2 — расширенная реализация

> **Статус:** ACTIVE SPEC (executable roadmap)
> **Дата:** 2026-04-19
> **Родительская спека:** [`CRM_OVERHAUL_SPEC_V1.md`](./CRM_OVERHAUL_SPEC_V1.md) §4 — «Модуль 1. Карточка клиента v2»
> **Автор:** Claude Code Opus 4.7 (1M context), по запросу Дениса
> **Приоритет:** P1 — высокая видимая ценность, фундамент для §2 (Deals), §5 (Meetings), §7 (Финансы)
> **Эффорт:** 40-60ч суммарно, разбит на 4 PR-фазы

---

## 0. TL;DR

Превратить карточку клиента из **справочника контактов** (текущее состояние) в **сквозную панель управления отношениями** с KPI, lifecycle-стадиями, AI-подсказками и 10 вкладками. Параллельно ввести поля `lifecycle_stage`, `segment`, `health_score`, `churn_risk`, `ltv`, `total_margin` в Client — они станут основой сегментации и Next Best Action.

**Что НЕ в рамках этого ТЗ** — см. §3.2 Non-goals. В первую очередь: Deals / Meetings / Production модули из соседних спек — Client Card только их *агрегирует*, не переписывает.

---

## 1. Business Context

### 1.1. Зачем

Из `CRM_OVERHAUL_SPEC_V1.md §1.1`:
- 79% клиентов (19 из 24) в статусе «забытые» — нет системы касаний
- Карточка показывает контакты, не сквозную картину
- Менеджер не видит: историю сделок, встреч, маржу, риск оттока

**Бизнес-эффект (целевые метрики из §1.2):**
- Доля «забытых» клиентов: **79% → ≤25%** за 6 мес
- NPS: **— → ≥55**
- LTV клиента: **+20-30%**
- Repeat business rate: **— → ≥30%**

### 1.2. Ключевая гипотеза

Менеджер заходит в карточку, и **за 10 секунд** понимает: активный ли клиент, сколько заработал с него, когда последний контакт, что делать следующим ходом. Сейчас — 3-5 кликов и вычитывание хронологии.

### 1.3. Мой аудит текущего состояния (2026-04-19)

- Файл: `src/pages/crm/ClientDetailsPage.tsx` (549 строк, 6 вкладок после PR #31)
- Данные: 24 клиента на проде (по `/api/clients/list`)
- Поля Client (`src/types/crm.types.ts` / `Client` interface):
  ```typescript
  // Есть: id, companyId, type, name, contacts[], services[], email, phone,
  //       website, address, industry, source, sourceType, status,
  //       workLocation, totalRevenue (LTV), tags[], assignedTo, aliases[]
  //
  // Чего нет: lifecycle_stage, segment, health_score, churn_risk,
  //           billing_info, tax_info, preferred_channel, decision_makers,
  //           nps_score, avg_payment_delay_days
  ```
- UI: плоский layout без sticky header, без KPI, без sidebar

**Готовность модуля по оценке из разбора 2026-04-19: ~20%.**

---

## 2. Архитектура

### 2.1. Слои

```
                    ┌─────────────────────────────────┐
                    │    ClientDetailsPage (React)    │
                    │  ┌──────────────────────────┐   │
                    │  │  <ClientHeaderV2 />      │   │ sticky
                    │  │  (logo + badges + KPI)   │   │
                    │  └──────────────────────────┘   │
                    │  ┌──────────┬───────────────┐   │
                    │  │  Tabs    │  <Sidebar />  │   │
                    │  │  (10)    │  (sticky NBA) │   │
                    │  └──────────┴───────────────┘   │
                    └──────────┬──────────────────────┘
                               │
                    ┌──────────▼──────────────────────┐
                    │    ClientKPI API (aggregator)   │
                    │    GET /api/clients/:id/kpi     │
                    │    GET /api/clients/:id/insights│
                    └──────────┬──────────────────────┘
                               │
            ┌──────────────────┼───────────────────────┐
            │                  │                       │
            ▼                  ▼                       ▼
     Firestore reads       Compute layer         AI (Gemini)
     (cached collections)  (scores + NBA)        (insights + summary)
```

### 2.2. Источник правды vs материализация

- **Client document** — источник правды для профиля и ручных полей (`segment`, `lifecycle_stage`, `tags`, `nps_score`)
- **Materialized fields** на Client (кэшируемые, обновляются cron'ом или on-write):
  - `ltv` = sum(invoices.paid where clientId)
  - `totalMargin` = sum(estimates.internalMargin)
  - `healthScore` (0-100) — computed
  - `churnRisk` ('low' | 'medium' | 'high') — computed
  - `avgPaymentDelayDays` — computed
  - `lastContactAt` — max(meetings.endAt, messages.createdAt) last 6 months
  - `activeDealsCount` / `activeProjectsCount` / `openOverdueTasks`
- Эти поля материализуются в `Client` — **НЕ считаются на лету** каждый раз при открытии карточки. Stale-at-most-24h допустимо.

### 2.3. Когда обновлять материализованные поля

| Триггер | Когда |
|---|---|
| Scheduled cron `recomputeClientMetrics` | Ежедневно в 4am UTC |
| Firestore trigger `onInvoicePaid` | Immediate → пересчитать ltv + avgPaymentDelay |
| Firestore trigger `onMeetingCompleted` | Immediate → пересчитать lastContactAt |
| Firestore trigger `onDealStatusChange` | Immediate → activeDealsCount |
| Firestore trigger `onProjectCreated` / complete | Immediate → activeProjectsCount |
| Admin UI «Recompute metrics» button | On-demand rebuild одного клиента |

---

## 3. Goals & Non-Goals

### 3.1. Goals

- **G1.** Расширить Client entity с 9 новыми полями (§4)
- **G2.** Добавить 4 отсутствующие вкладки из спеки §4.2 (Обзор, Сделки, Сметы, Коммуникации). Оставшиеся 2 (Производство, AI) — отложены до Phase 2
- **G3.** Sticky header с 8 KPI + 4 бейджа (lifecycle/segment/health/churn) + ⭐ избранное
- **G4.** Right sidebar с Next Best Action, ближайшая встреча, просроченные задачи
- **G5.** Backend API `/api/clients/:id/kpi` и `/api/clients/:id/insights` (AI-powered)
- **G6.** Scheduled cron `recomputeClientMetrics` + 3 Firestore триггера
- **G7.** Миграция 24 существующих клиентов: mapping `status` → `lifecycle_stage`

### 3.2. Non-Goals

- **N1.** Переделывать Deals UI — он уже работает на `/crm/deals`, вкладка «Сделки» на карточке клиента просто фильтрует его же
- **N2.** Переделывать Projects / Meetings / Estimates UI — вкладки только агрегируют существующие страницы
- **N3.** Telegram unified inbox (спека §11) — во вкладке «Коммуникации» только MVP: список сообщений + email + заметки
- **N4.** Полноценный «Производство» Gantt — откладывается до Module 5 spec
- **N5.** AI-assistant чат (вкладка 10) — откладывается до Phase 2, пока виден как "coming soon"
- **N6.** Auto-segmentation rules engine — segment ставится вручную или через simple cron, без ML
- **N7.** Real-time обновление через onSnapshot — используем традиционный fetch, обновление раз в 5 минут достаточно

---

## 4. Data Model Changes

### 4.1. Расширение Client interface

**Файл:** `src/types/crm.types.ts`

```typescript
// ─── Existing (don't remove) ─────────────────────────────────────────
interface Client {
  id: string;
  companyId: string;
  type: 'residential' | 'commercial' | 'industrial';
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  // ...other existing fields
}

// ─── New fields (additive) ───────────────────────────────────────────
interface ClientV2Extension {
  // Segmentation
  lifecycleStage?: 'lead' | 'prospect' | 'active' | 'repeat' | 'churned' | 'vip';
  segment?: 'A' | 'B' | 'C' | 'VIP';  // manual grading by manager

  // Referrals (UTM-like tracking)
  referralByClientId?: string | null;
  preferredChannel?: 'phone' | 'email' | 'telegram' | 'whatsapp';
  preferredLanguage?: 'ru' | 'en';
  timezone?: string;  // IANA, e.g. 'America/New_York'

  // Finance profile
  taxInfo?: {
    ein?: string;
    taxExempt?: boolean;
    taxRate?: number;  // override default tax rate
  };
  billingInfo?: {
    billingName?: string;
    billingAddress?: string;
    bankAccount?: string;
    routingNumber?: string;
    paymentTerms?: string;  // 'net-30' / 'net-15' / 'on-receipt'
  };
  currency?: string;  // default 'USD'

  // Decision makers
  decisionMakers?: Array<{
    name: string;
    role?: string;
    phone?: string;
    email?: string;
    isPrimary?: boolean;
  }>;

  // Computed metrics (materialized, see §2.3)
  healthScore?: number;        // 0-100, computed
  churnRisk?: 'low' | 'medium' | 'high';  // computed
  ltv?: number;                // cached sum of paid invoices
  totalMargin?: number;        // cached sum of internal margin
  avgPaymentDelayDays?: number;
  lastContactAt?: Timestamp | null;
  activeDealsCount?: number;
  activeProjectsCount?: number;
  openOverdueTasks?: number;
  npsScore?: number | null;    // 0-10, manually set after NPS survey

  // Meta
  computedAt?: Timestamp;      // when materialized fields last ran
  isFavorite?: boolean;        // user-level flag (per-user bookmark collection actually)
}

export type Client = ExistingClient & ClientV2Extension;
```

### 4.2. Mapping legacy `status` → `lifecycleStage`

Сейчас `status` enum: `'active' | 'new' | 'contacted' | 'qualified' | 'customer' | 'done' | 'churned'`.

Маппинг при миграции (см. §10):

| Legacy status | → lifecycleStage |
|---|---|
| `new` / `contacted` | `lead` |
| `qualified` | `prospect` |
| `active` / `customer` | `active` |
| `done` | `repeat` (если есть ≥2 проектов) ИЛИ `churned` |
| `churned` | `churned` |
| Любой + `tags: ['vip']` | `vip` |

После миграции `status` **оставляем** для обратной совместимости (не удаляем поле). UI начинает использовать `lifecycleStage`; `status` deprecated но не deleted.

### 4.3. Новые Firestore коллекции

```
client_favorites/                                              # NEW
  {userId}_{clientId}  {                                       # composite key
    userId: string,
    clientId: string,
    addedAt: Timestamp,
  }

client_next_best_actions/                                      # NEW
  {clientId}  {                                                # 1-to-1 with client
    clientId: string,
    suggestion: string,          # AI-generated, e.g. "Call to follow up on estimate v2 sent 14d ago"
    reasoning: string,           # short explanation for UI tooltip
    priority: 'low'|'medium'|'high',
    computedAt: Timestamp,
    confidence: number,          # 0-1 from Gemini
  }
```

Индексы (add to `firestore.indexes.json`):
- `clients (lifecycleStage, healthScore DESC)` — для admin dashboard «Clients at risk»
- `clients (segment, ltv DESC)` — для VIP leaderboard
- `client_favorites (userId, addedAt DESC)` — для «Мои избранные»

---

## 5. API Design

### 5.1. New endpoints

```
GET    /api/clients/:id/kpi                # Aggregated KPI plashki data
GET    /api/clients/:id/insights           # AI-generated Next Best Action
POST   /api/clients/:id/recompute-metrics  # Admin on-demand rebuild
POST   /api/clients/:id/favorite           # Add to current user's favorites
DELETE /api/clients/:id/favorite           # Remove from favorites
POST   /api/clients/:id/quick-note         # Shortcut — append note to client
```

### 5.2. `GET /api/clients/:id/kpi` response shape

```json
{
  "clientId": "abc",
  "kpi": {
    "balance":             { "value": 3450.00, "trend": -200, "trendPct": -5.5 },
    "ltv":                 { "value": 48700.00, "trend": 3200 },
    "marginUsd":           { "value": 12450.00, "pct": 25.6 },
    "activeDeals":         { "count": 2, "totalValue": 18000 },
    "activeProjects":      { "count": 1 },
    "openOverdueTasks":    { "count": 3, "overdueDays": 7 },
    "nextMeeting":         { "id": "mtg_1", "type": "site_survey", "startAt": "...", "daysUntil": 2 },
    "lastContactDaysAgo":  { "days": 14, "channel": "telegram" }
  },
  "healthScore":        { "score": 72, "trend": +3, "band": "good" },
  "churnRisk":          { "level": "low", "reasons": [] },
  "computedAt":         "2026-04-19T10:00:00Z",
  "stale":              false                        // true if computedAt > 25h ago
}
```

### 5.3. `GET /api/clients/:id/insights` response shape

```json
{
  "clientId": "abc",
  "nextBestAction": {
    "suggestion": "Позвонить по КП v2 — отправлено 14 дней назад, нет ответа",
    "priority": "high",
    "reasoning": "Estimate v2 отправлен 2026-04-05, просмотрен клиентом 2026-04-07, без действий. LTV $48k — клиент выскокомаржинальный (margin 25.6%). Похожие сделки в прошлом закрывались после второго звонка.",
    "confidence": 0.82,
    "computedAt": "2026-04-19T04:00:00Z"
  },
  "relatedClients": [
    { "id": "ref_1", "name": "Jim Dvorkin", "relation": "referred_by", "ltv": 12000 }
  ],
  "aiSummary": "Активный клиент, доверяет, предпочитает Telegram. Большая сделка в процессе. Важно не дать остыть."
}
```

### 5.4. Compute algorithm для `healthScore`

Документировано как компонент каждой переменной:

```
healthScore = clamp(0, 100,
  30 * contactFreshness  +     // 0..1 — log decay of daysSinceLastContact
  25 * dealHealthScore   +     // 0..1 — ratio active/stuck deals
  20 * paymentReliability +    // 0..1 — avg payment delay vs terms
  15 * ltvWeight         +     // 0..1 — normalized LTV percentile in cohort
  10 * tenureWeight            // 0..1 — how long as active client
)

churnRisk:
  if (daysSinceLastContact > 90 && activeDealsCount === 0) → 'high'
  elif (paymentReliability < 0.5 || healthScore < 40) → 'medium'
  else → 'low'
```

**Файл реализации:** `functions/src/services/clientMetricsService.ts` (новый).

### 5.5. RLS на новых эндпоинтах

- `GET /kpi`, `GET /insights`: worker/driver — 403 (чисто админская ценность).
  Foreman/manager/admin — 200 для клиентов своей company.
- `POST /favorite`: любой role может бронировать себе.
- `POST /recompute-metrics`: admin only.
- `POST /quick-note`: manager+admin.

---

## 6. UI Design

### 6.1. `<ClientHeaderV2 />` компонент (sticky)

**Файл:** `src/components/crm/client-card-v2/ClientHeaderV2.tsx` (NEW)

Структура:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ [🏢]  Acme Corp.   [🟢 Active] [B] [Health: 72]  [⚠ Medium Churn]  [⭐]     │
│                                                                              │
│  ┌──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┐                │
│  │ Bal  │ LTV  │ Marg │ Deals│ Proj │ Task │ Next │ Last │                │
│  │$3,450│$48.7k│25.6% │  2   │  1   │3 over│in 2d │14d   │                │
│  └──────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┘                │
│                                                                              │
│  [📞 Call] [💬 TG] [✉ Email] [📅 Meeting] [💼 Deal] [📄 Estimate] [📁 Proj]│
└─────────────────────────────────────────────────────────────────────────────┘
```

- Sticky `top: 0` с `z-index: 1100` (над тусклым scroll)
- На мобиле коллапсируется: имя + 4 самых важных KPI (Balance, LTV, Active Deals, Next Meeting), остальное за `...`
- Hover на KPI → tooltip с trend и источником расчёта

### 6.2. `<ClientRightSidebar />` (sticky)

**Файл:** `src/components/crm/client-card-v2/ClientRightSidebar.tsx` (NEW)

Ширина: 320px на desktop, sticky `top: <header-height>`, hides on mobile (visible через drawer).

Содержит:
- **Next Best Action card** (AI-powered, из `/api/clients/:id/insights`)
- **Ближайшая встреча** (из `meetings`, scoped)
- **Просроченные задачи** (из `gtd_tasks` с clientId filter)
- **Ответственные** (assignedTo + co-assignees)
- **Быстрая заметка** (textarea, Enter → append в Client.notes с timestamp)
- **Related clients** (referer + referred-by-this)

### 6.3. Tab structure — 10 вкладок (§4.2 спеки)

| # | Tab | Component file | Status |
|---|---|---|---|
| 1 | Обзор | `ClientOverviewTab.tsx` | 🆕 NEW |
| 2 | Сделки | `ClientDealsTab.tsx` | 🆕 NEW (агрегат /crm/deals filter) |
| 3 | Сметы | `ClientEstimatesTab.tsx` | 🆕 NEW (агрегат /crm/estimates filter) |
| 4 | Проекты | `ProjectFinanceTab.tsx` (exists) + rename | ✅ MAP to existing |
| 5 | Встречи | `ClientMeetingsTab.tsx` (PR #31) | ✅ EXISTS |
| 6 | Производство | `ClientProductionTab.tsx` | 🔴 DEFERRED to Phase 2 |
| 7 | Финансы | `ClientExpensesTab.tsx` (exists) + rename | ✅ MAP |
| 8 | Коммуникации | `ClientCommsTab.tsx` | 🆕 NEW (Telegram + email + notes timeline) |
| 9 | Файлы | `ClientFilesTab.tsx` | 🆕 NEW (tree view) |
| 10 | AI-ассистент | `ClientAIChatTab.tsx` | 🔴 DEFERRED to Phase 2 |

**Phase 1 (этот TZ):** tabs 1-5, 7-9 (8 вкладок живых, 2 "coming soon"). Tabs 6 и 10 — отдельные спеки.

### 6.4. Полная рекомпозиция `ClientDetailsPage.tsx`

Текущий файл 549 строк — слишком много для одного component. Разбиваем:

```
src/pages/crm/ClientDetailsPage.tsx                  # orchestrator only
src/components/crm/client-card-v2/
  ├─ ClientHeaderV2.tsx                              # sticky header
  ├─ ClientRightSidebar.tsx                          # sticky sidebar
  ├─ ClientKPIBar.tsx                                # 8 plashki row
  ├─ ClientBadges.tsx                                # lifecycle/segment/health/churn
  ├─ ClientQuickActions.tsx                          # 10 action buttons
  ├─ tabs/
  │   ├─ ClientOverviewTab.tsx
  │   ├─ ClientDealsTab.tsx
  │   ├─ ClientEstimatesTab.tsx
  │   ├─ ClientCommsTab.tsx
  │   └─ ClientFilesTab.tsx
  ├─ hooks/
  │   ├─ useClientKPI.ts                             # /api/clients/:id/kpi
  │   ├─ useClientInsights.ts                        # /api/clients/:id/insights
  │   └─ useClientFavorite.ts                        # /api/clients/:id/favorite
  └─ types.ts                                        # ClientKPIResponse, etc.
```

Orchestrator `ClientDetailsPage.tsx` становится ~120 строк: layout + tabs router + data plumbing.

---

## 7. Backend Services

### 7.1. `clientMetricsService.ts` (new)

**Файл:** `functions/src/services/clientMetricsService.ts`

```typescript
export class ClientMetricsService {
  constructor(private db: Firestore) {}

  async recomputeClientMetrics(clientId: string): Promise<ClientMetrics> {
    const [invoices, deals, projects, meetings, tasks] = await Promise.all([
      this.fetchInvoices(clientId),
      this.fetchDeals(clientId),
      this.fetchProjects(clientId),
      this.fetchMeetings(clientId),
      this.fetchTasks(clientId),
    ]);

    const ltv = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.total, 0);
    const avgPaymentDelayDays = this.calcAvgPaymentDelay(invoices);
    const lastContactAt = this.calcLastContactAt(meetings, tasks);
    const activeDealsCount = deals.filter(d => d.status === 'open').length;
    const activeProjectsCount = projects.filter(p => p.status === 'in_progress').length;
    const openOverdueTasks = tasks.filter(t => /*...*/).length;

    const healthScore = this.computeHealthScore({
      daysSinceLastContact: daysBetween(lastContactAt, new Date()),
      activeDealsCount,
      paymentReliability: this.calcPaymentReliability(invoices),
      ltv,
      tenureDays: daysBetween(client.createdAt, new Date()),
    });
    const churnRisk = this.determineChurnRisk(healthScore, lastContactAt, activeDealsCount);

    return { ltv, avgPaymentDelayDays, lastContactAt, activeDealsCount, activeProjectsCount, openOverdueTasks, healthScore, churnRisk, computedAt: Timestamp.now() };
  }

  async writeMetricsToClient(clientId: string, metrics: ClientMetrics): Promise<void> {
    await this.db.collection('clients').doc(clientId).update(metrics);
  }
}
```

**Unit tests:** `functions/test/clientMetricsService.test.ts` — 20+ кейсов:
- Пустой клиент (0 invoices, 0 meetings) → healthScore=0
- VIP клиент (LTV > $100k, meetings monthly) → healthScore=95+
- Забытый клиент (lastContact 180d ago, 0 deals) → churnRisk='high'
- Edge cases: null lastContactAt, 0 invoices
- Moving averages — корректная обработка trend'ов

### 7.2. Scheduled cron `recomputeClientMetrics`

**Файл:** `functions/src/scheduled/recomputeClientMetrics.ts`

```typescript
export const recomputeClientMetrics = functions
  .region('us-central1')
  .pubsub.schedule('0 4 * * *')  // 4am UTC daily
  .onRun(async () => {
    const svc = new ClientMetricsService(db);
    const clients = await db.collection('clients').get();
    for (const doc of clients.docs) {
      const metrics = await svc.recomputeClientMetrics(doc.id);
      await svc.writeMetricsToClient(doc.id, metrics);
    }
    logger.info(`recomputed metrics for ${clients.size} clients`);
  });
```

Для 24 клиентов → ~30 секунд. Scale до 1000 клиентов — добавить batching и Pub/Sub fan-out.

### 7.3. Realtime triggers

**Файл:** `functions/src/triggers/firestore/clientMetricsTriggers.ts`

```typescript
// onInvoicePaid — recompute ltv + avgPaymentDelay
export const onInvoicePaid = functions.firestore
  .document('invoices/{invoiceId}')
  .onUpdate(async (change) => {
    const before = change.before.data();
    const after = change.after.data();
    if (before.status !== 'paid' && after.status === 'paid') {
      const svc = new ClientMetricsService(db);
      const metrics = await svc.recomputeClientMetrics(after.clientId);
      await svc.writeMetricsToClient(after.clientId, metrics);
    }
  });

// onMeetingCompleted — recompute lastContactAt + healthScore
// onDealStatusChange — recompute activeDealsCount + healthScore
// onProjectStatusChange — recompute activeProjectsCount
```

**⚠️ Idempotency guards обязательны** (CLAUDE.md §2.1):
- Field-change check: если `before.status === after.status`, вернуть `null`
- Запись в `processedEvents` collection с TTL 24h
- Никогда не писать в ту же collection что trigger'ит

### 7.4. `clientInsightsService.ts` — AI-powered Next Best Action

**Файл:** `functions/src/services/clientInsightsService.ts`

```typescript
export class ClientInsightsService {
  constructor(
    private db: Firestore,
    private gemini: GoogleGenerativeAI,
  ) {}

  async generateNextBestAction(clientId: string): Promise<NextBestAction> {
    const context = await this.gatherContext(clientId);
    const prompt = this.buildPrompt(context);

    const result = await this.gemini.generateContent(prompt);
    const parsed = this.parseResponse(result);

    await this.db.collection('client_next_best_actions').doc(clientId).set({
      clientId,
      ...parsed,
      computedAt: Timestamp.now(),
    });

    return parsed;
  }

  private gatherContext(clientId: string): Promise<ClientContext> {
    // Last 5 meetings, last 5 deals, last 10 messages, current estimates
    // Format as compact JSON for Gemini
  }

  private buildPrompt(ctx: ClientContext): string {
    return `
      Ты — CRM-ассистент менеджера стройбизнеса. Анализируешь клиента и
      предлагаешь ОДНО next best action — конкретное, с приоритетом high/medium/low.

      КЛИЕНТ:
      ${JSON.stringify(ctx.client, null, 2)}

      ПОСЛЕДНИЕ ВСТРЕЧИ (${ctx.meetings.length}):
      ${ctx.meetings.map(m => `- ${m.type} ${m.status} ${m.outcome?.slice(0, 50)}`).join('\n')}

      АКТИВНЫЕ СДЕЛКИ (${ctx.activeDeals.length}):
      ${ctx.activeDeals.map(d => `- ${d.title} stage=${d.stage} value=$${d.expectedValue}`).join('\n')}

      Верни JSON:
      {
        "suggestion": "короткая формулировка действия (до 80 символов)",
        "priority": "high|medium|low",
        "reasoning": "2-3 предложения почему это",
        "confidence": 0.0-1.0
      }
    `;
  }
}
```

Запускается в cron (ночной ребилд) + on-demand через `POST /api/clients/:id/recompute-metrics`.

**Cost:** Gemini Flash @ ~$0.01 per call × 24 clients × 1/day = $0.24/day = $7/mo. Acceptable.

---

## 8. Implementation Phases

### Phase 1.1 — Data model + migration (2-3ч, PR-1)

**Scope:**
- Расширить `src/types/crm.types.ts` с новыми полями Client
- Расширить `functions/src/agent/schemas/clientSchemas.ts` (optional Zod fields)
- Миграционный скрипт `scripts/migrate-clients-to-v2.ts` (dry-run + commit)
- Скрипт задаёт `lifecycleStage` mapping из `status` для 24 существующих клиентов
- Оставляет legacy `status` нетронутым
- Не трогает UI

**Acceptance:**
- [ ] `npx tsc --noEmit` clean
- [ ] Migration dry-run: "would update 24 clients"
- [ ] Migration --commit: 24 clients get `lifecycleStage` + `segment='B'` (default) + `isFavorite=false`
- [ ] Existing `/crm/clients` UI не ломается

### Phase 1.2 — Backend API + services (10-12ч, PR-2)

**Scope:**
- `ClientMetricsService` + 20 unit tests
- `ClientInsightsService` + 10 unit tests (mock Gemini)
- Scheduled cron `recomputeClientMetrics`
- 3 Firestore triggers (invoice/meeting/deal)
- 6 новых API эндпоинтов (§5.1)
- Composite индексы на `clients`
- `client_favorites` и `client_next_best_actions` collections

**Acceptance:**
- [ ] `functions test` — все новые test suites green
- [ ] `GET /api/clients/:id/kpi` возвращает структуру из §5.2 для существующего клиента
- [ ] Cron запускается в emulator, обновляет 24 клиента за <1 мин
- [ ] Triggers idempotent (guard'ы по CLAUDE.md §2.1)
- [ ] Gemini mock в тестах — детерминированный

### Phase 1.3 — Header + Sidebar + Overview tab (10-15ч, PR-3)

**Scope:**
- Разбиение `ClientDetailsPage.tsx` на orchestrator + компоненты
- `ClientHeaderV2` + `ClientKPIBar` + `ClientBadges` + `ClientQuickActions`
- `ClientRightSidebar` с NBA, meeting, tasks, quick note
- **Вкладка 1 «Обзор»** — dashboard-like aggregate с mini-картой сделок, последних встреч, финансов
- Hooks: `useClientKPI`, `useClientInsights`, `useClientFavorite`

**Acceptance:**
- [ ] Карточка любого клиента: visible sticky header с 8 KPI + 4 бейджа
- [ ] Sidebar отображает Next Best Action от AI
- [ ] ⭐ favorite toggle работает (POST /favorite + отображение в sidebar списка "Избранные")
- [ ] Quick note sidebar: Enter → сохраняет в Client.notes
- [ ] Мобильная версия: header коллапсируется, sidebar через drawer

### Phase 1.4 — Remaining tabs: Deals, Estimates, Comms, Files (15-20ч, PR-4)

**Scope:**
- **Сделки tab** — filter `/crm/deals` по clientId + compact view
- **Сметы tab** — filter `/crm/estimates` по clientId + версии + статусы
- **Коммуникации tab** — MVP: timeline из Telegram messages + notes + email (если подключено)
- **Файлы tab** — простое дерево папок клиента (без auto-folder generation пока)
- Tabs 6 (Производство) и 10 (AI Chat) — заглушки "Coming soon"

**Acceptance:**
- [ ] Каждая вкладка рендерится за <1 сек
- [ ] Фильтрация по clientId работает на бэке (не в JS) — нужные composite индексы уже должны быть
- [ ] Empty states для клиентов без сделок/смет/файлов
- [ ] No console errors

---

## 9. Migration Plan

### 9.1. Существующие 24 клиента

**Файл:** `scripts/migrate-clients-to-v2.ts`

Логика:
```typescript
for (const doc of clients) {
  const client = doc.data();
  const lifecycleStage = mapStatusToLifecycle(client.status);
  const segment = 'B';  // Default — admin ручно проставит потом
  const isFavorite = false;
  const computedAt = Timestamp.now();

  // Run initial metrics compute
  const metrics = await metricsService.recomputeClientMetrics(doc.id);

  await doc.ref.update({
    lifecycleStage,
    segment,
    isFavorite,
    computedAt,
    ...metrics,
    // status — НЕ трогаем (backward compat)
  });
}
```

**Запуск:** Денис вручную через `GOOGLE_CLOUD_PROJECT=profit-step npx ts-node scripts/migrate-clients-to-v2.ts --dry-run` → `--commit`.

### 9.2. Rollback plan

- Backward compat поля не удаляются
- Можно откатить UI (вернуть PR) — backend продолжит писать metrics, но они не будут видны
- Метрики за cron — безвредные, не влияют на бизнес-логику, можно игнорировать

---

## 10. Testing Strategy

### 10.1. Unit tests

- **ClientMetricsService** (20+ тестов) — в §7.1 уже перечислены
- **ClientInsightsService** (10 тестов) — детерминированный Gemini mock
- **Triggers** (6 тестов) — idempotency, field-change guard, error paths
- **Migration script** (5 тестов) — dry-run без writes, rollback-safety

### 10.2. Integration tests

- `/api/clients/:id/kpi` — seed клиент с инвойсами/сделками → ожидать конкретные metrics
- Cron end-to-end в emulator: 3 seed клиента → run → проверить их всех обновление

### 10.3. E2E (optional, Cypress)

- Открыть карточку → header виден, KPI загружены
- ⭐ toggle → появился в sidebar favorites
- Quick note → сохранился в notes

### 10.4. Load

- 1000 клиентов: сколько занимает cron? Pub/Sub fan-out нужен? Target: <5 мин.

---

## 11. Acceptance Criteria (global)

Module 1 считается "v2 launched" когда:

- [ ] Client interface расширен 9+ новыми полями, миграция отработала на 24 prod-клиентах
- [ ] Cron запускается ежедневно, metrics свежие (stale=false для всех)
- [ ] Gemini cost < $10/mo
- [ ] Карточка загружается < 2 сек даже для клиентов с 100+ сделками/встречами
- [ ] Sticky header не прыгает на скролле, sidebar отслеживает viewport
- [ ] 8 KPI + 4 бейджа видны без клика на кого угодно
- [ ] Mobile — header коллапсируется, sidebar через drawer
- [ ] 8 вкладок работают (2 coming-soon), 0 console errors
- [ ] Menаджер за 10 секунд понимает кто такой клиент (UX smoke-test с Денисом)
- [ ] NPS от менеджеров после 2 недель использования: среднее 7+

---

## 12. Open Questions (для обсуждения с Денисом)

1. **Авто-мигрировать всех в `lifecycleStage='active'`?** Или сделать честный mapping? Спеклю для честного, но простой default тоже OK.
2. **Segment (A/B/C/VIP)** — ставит ручно менеджер? Или auto-rule? Предлагаю: дефолт 'B', потом ручки.
3. **⭐ Favorite** — per-user? Или глобальный для company? Per-user логичнее, делаю per-user.
4. **Quick Actions Call/Telegram/Email** — вызывают `tel:` / `tg://` / `mailto:`? Или внутренний звонок? Делаю `tel:`/`tg://`/`mailto:` — проще.
5. **Next Best Action** — насколько часто пересчитывать? Раз в сутки? По триггеру (создал сделку → пересчитать)? Стартовая гипотеза: раз в сутки в cron'е + on-demand button.
6. **Decision makers** — отдельная коллекция или массив внутри Client? Для простоты — массив. Если будут расти — вынести.
7. **`lifecycle_stage` меняется ручно или auto?** Сейчас manual, но cron может продвинуть (например, через 6 месяцев без активности → churned). Не в Phase 1.

---

## 13. References

- Parent spec: [`CRM_OVERHAUL_SPEC_V1.md`](./CRM_OVERHAUL_SPEC_V1.md) §4
- Master plan: [`MASTER_PLAN_2026-04-19.md`](./MASTER_PLAN_2026-04-19.md) §P1.4 / §P2.1
- Existing UI: `src/pages/crm/ClientDetailsPage.tsx`
- Client types: `src/types/crm.types.ts`
- Routes: `functions/src/agent/routes/clients.ts`
- Meetings (PR #31, уже в проде): справка как делать "агрегат" вкладку
- CLAUDE.md §2.1: idempotency для триггеров — обязательно для §7.3
- Warehouse V3 spec: как пример структуры phased rollout TZ
