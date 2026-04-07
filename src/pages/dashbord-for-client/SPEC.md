# ТЗ: Unified Client Dashboard (с share-to-client)

**Цель:** **ОДИН** дашборд, который сотрудник открывает изнутри и видит **всё**, а клиент открывает по share-link и видит **только часть**.

**Создан:** 2026-04-07
**Branch:** `feature/project-hierarchy-fix`
**Заменяет:** предыдущая версия этого файла описывала отдельный external portal. Объединено по новому решению Дениса.

---

## 1. Big Idea

> Один компонент. Два источника данных. Видимость определяется на бэкенде, не на фронте.

**Почему так, а не два отдельных дашборда:**
- ❌ Два дашборда = двойной код, рассинхронизация, "забыли обновить второй", разные баги.
- ❌ Два дашборда = два места где надо менять каждое поле.
- ✅ Один дашборд = одна спецификация, одна логика рендеринга, одна точка контроля.

**Почему фильтрация на бэкенде:**
- ❌ Если фильтровать на фронте (CSS hide / `if (mode === 'client')`) — клиент откроет DevTools и всё увидит.
- ✅ Если фильтровать на бэкенде — клиент **физически не получает** internal данные. Сетевой запрос их не возвращает.

---

## 2. Текущее состояние (важно — не начинать с нуля)

В репозитории УЖЕ есть две параллельные реализации этой идеи. Первый AI агент сделал их раньше:

### 2.1. Internal view (`/dashboard/client/:id`)

| Файл | Состояние |
|---|---|
| `src/pages/dashboard/client/[id].tsx` | Был хардкод-моком, переписан на ветке `claude/confident-lewin` под реальные данные через `GET /api/clients/:id`. **Этот файл также модифицирован в `feature/project-hierarchy-fix`** — есть конфликт версий, надо смерджить. |
| `functions/src/agent/routes/clients.ts:183` `GET /api/clients/:id` | Существует, агрегирует clients/projects/gtd_tasks/costs/work_sessions/estimates/sites. |

### 2.2. External view (`/portal/:slug`)

| Файл | Состояние |
|---|---|
| `src/pages/portal/ClientPortalPage.tsx` | 341 строки, **уже подключён к реальным данным** через хук |
| `src/hooks/useClientPortal.ts` | 198 строк, ходит напрямую в Firestore (5 onSnapshot подписок: projects, estimates, gtd_tasks, project_ledger, photos) |
| `src/utils/slugify.ts` | 13 строк, `name → slug` |
| `src/pages/portal/components/EstimateView.tsx` | 307 строк, поддерживает comments + approval (пишет в Firestore с клиента) |
| `src/pages/portal/components/TimelineSlider.tsx` | 121 строки |
| `src/pages/portal/components/PaymentSchedule.tsx` | 136 строк |
| `src/pages/portal/components/PhotoGallery.tsx` | 248 строк, lightbox + категории |
| `src/pages/portal/components/InspectionsView.tsx` | 181 строки |
| Backend endpoint для портала | **Не существует.** Портал ходит прямо в Firestore. |

### 2.3. Что это значит

**НЕ НАДО:**
- Создавать новые папки `dashbordclient/` или новый component tree с нуля
- Переписывать `useClientPortal.ts` или `ClientPortalPage.tsx`
- Делать новую реализацию из 7 компонентов из старого ТЗ v2.1

**НАДО:**
- Унифицировать существующие два набора кода в общую component library
- Добавить НЕДОСТАЮЩУЮ часть: backend endpoint для портала + share-token система + механизм approval
- Зафиксировать чёткое правило "что видит клиент, что не видит" и обеспечить его на сервере

---

## 3. Архитектура

### 3.1. URL routing

| URL | Viewer | Auth | Data endpoint |
|---|---|---|---|
| `/dashboard/client/:id` | Сотрудник | Firebase Auth + RBAC | `GET /api/clients/:id` (полный response) |
| `/portal/:slug?token=:t` | Клиент | URL token | `GET /api/portal/:slug?token=:t` (отфильтрованный) |

### 3.2. Data shape (response contracts)

#### 3.2.1. Internal endpoint (`GET /api/clients/:id`)

Уже существует в `functions/src/agent/routes/clients.ts:183`. **Нужно расширить** так, чтобы ответ был структурирован по уровням видимости:

```ts
// Текущий формат:
{ client, projects, tasks, costs, timeTracking, estimates, sites }

// Целевой формат:
{
  client: { ...client },              // тот же
  shared: {                           // то что МОЖНО показать клиенту
    estimates: [...],                 // только non-internal, и без internal cost columns
    timeline: { phases, currentPhase },
    payments: [...],                  // только credit/debit с клиентом
    photos: [...],                    // только public_visible
    inspections: [...],
    tasksForClient: [...],            // только client_visible
  },
  internal: {                         // только для сотрудника
    profit: { revenue, spend, profit, marginPct, tier },
    costs: { total, byCategory, items },     // полный breakdown с поставщиками
    laborEarnings: number,
    sessions: [{ employeeName, date, minutes, earnings }],
    notes: [{ author, date, content }],
    redFlags: [...],
    fullEstimates: [...],             // с internal cost columns
    fullTasks: [...],                 // все задачи, включая internal
  }
}
```

**Ключевой принцип:** internal view получает И `shared`, И `internal`. Portal view получает ТОЛЬКО `shared`.

#### 3.2.2. Portal endpoint (`GET /api/portal/:slug?token=:t`) — НОВЫЙ

```ts
// functions/src/agent/routes/portal.ts (новый файл)

GET /api/portal/:slug?token=:t

Validation:
1. token exists in `client_portal_tokens` collection
2. token.revokedAt is null
3. token.expiresAt > now
4. token.clientId matches the client whose slug = :slug
5. log to `portal_views` collection

Response:
{
  client: {
    name, address, projectAddress,
    contactName,                      // главный контакт
    // НЕ возвращать: email, phone других контактов, internal notes, totalRevenue
  },
  shared: { ...same shape as internal endpoint's `shared` key },
  approvalState: {
    estimateId: { sectionId: 'approved' | 'questioned' | 'pending' }
  }
}
```

### 3.3. Component tree (React)

```
src/components/client-dashboard/                  ← НОВАЯ shared library
│
├─ ClientDashboardLayout.tsx                       ← page shell: header + tabs
│
├─ sections/                                       ← видны и сотруднику, и клиенту
│   ├─ HeaderSection.tsx                           ← name, address, contact, current stage, % complete
│   ├─ EstimateSection.tsx                         ← `showInternalCost?: boolean` prop
│   ├─ TimelineSection.tsx
│   ├─ PaymentsSection.tsx
│   ├─ GallerySection.tsx
│   ├─ InspectionsSection.tsx
│   └─ TasksSection.tsx
│
├─ internal-only/                                  ← только сотрудник
│   ├─ KPICards.tsx                                ← Profit/Margin/Costs/Labor
│   ├─ CostBreakdown.tsx                           ← chart + per-supplier breakdown
│   ├─ InternalNotes.tsx
│   ├─ RedFlagsBanner.tsx
│   ├─ TeamActivity.tsx                            ← work sessions с employee names
│   └─ EditActions.tsx                             ← edit estimate, create task
│
└─ sharing/                                        ← только сотрудник
    ├─ ShareWithClientButton.tsx                   ← в header справа
    ├─ ShareLinkModal.tsx                          ← генерация токена + preview
    └─ TokensList.tsx                              ← список активных линков, можно revoke

src/pages/
├─ dashboard/client/[id].tsx                       ← INTERNAL: <ClientDashboardLayout mode="internal" data={internalData} />
└─ portal/ClientPortalPage.tsx                     ← CLIENT: <ClientDashboardLayout mode="client" data={portalData} />

src/hooks/
├─ useClientDashboard.ts                           ← INTERNAL: GET /api/clients/:id
├─ useClientPortal.ts                              ← CLIENT: GET /api/portal/:slug?token=:t (заменяем direct Firestore доступ)
├─ useShareLink.ts                                 ← INTERNAL: создать/удалить token

functions/src/agent/routes/
├─ clients.ts                                      ← добавить структурирование response (shared/internal)
├─ portal.ts                                       ← НОВЫЙ
└─ sharing.ts                                      ← НОВЫЙ (POST/DELETE/GET /api/clients/:id/share-tokens)

functions/src/agent/lib/
└─ portalFilter.ts                                 ← НОВАЯ: pure function buildPortalResponse(internalData) → portalData
                                                     Используется обоими endpoint'ами как single source of truth
                                                     для "что сжимать"
```

### 3.4. Visibility matrix

| Section | Internal | Client | Источник правды |
|---|---|---|---|
| **Header** | | | |
| Client name | ✅ | ✅ | `client.name` |
| Project address | ✅ | ✅ | `client.address` |
| Phone (`tel:` link) | ✅ | ❌ | `client.phone` |
| Email (`mailto:` link) | ✅ | ❌ | `client.email` |
| Status (new/contacted/customer) | ✅ | ❌ | `client.status` |
| Tags | ✅ | ❌ | `client.tags` |
| Total revenue (LTV) | ✅ | ❌ | `client.totalRevenue` |
| Current stage label | ✅ | ✅ | computed |
| Overall progress % | ✅ | ✅ | computed |
| **Share with client button** | ✅ | — | UI only |
| **Edit client button** | ✅ | ❌ | UI only |
| **KPI Cards** | | | |
| Costs total (что МЫ потратили) | ✅ | ❌ | `internal.costs.total` |
| Labor earnings (что МЫ заплатили) | ✅ | ❌ | `internal.laborEarnings` |
| Profit | ✅ | ❌ | `internal.profit.profit` |
| Margin % с цветом | ✅ | ❌ | `internal.profit.marginPct` |
| Estimates total (что КЛИЕНТ платит) | ✅ | ✅ | sum of `shared.estimates` |
| **Cost breakdown by category** | ✅ | ❌ | `internal.costs.byCategory` |
| **Estimate Section** | | | |
| Список items | ✅ | ✅ | `shared.estimates[].items` |
| Description | ✅ | ✅ | `item.description` |
| Quantity, unit | ✅ | ✅ | `item.quantity, item.unit` |
| Client price (`unitPrice * qty`) | ✅ | ✅ | `item.total` |
| Internal cost (`unitCostPrice * qty`) | ✅ | ❌ | `item.unitCostPrice * qty` |
| Margin per item | ✅ | ❌ | computed |
| Total per category | ✅ | ✅ | sum |
| Approval status | ✅ (видит кто и когда) | ✅ (может approve) | `shared.approvalState` |
| Comments thread | ✅ (видит все) | ✅ (видит свои + ответы) | `shared.estimates[].comments` |
| **Timeline Section** | | | |
| Phase list with progress | ✅ | ✅ | `shared.timeline.phases` |
| Current phase highlight | ✅ | ✅ | `shared.timeline.currentPhase` |
| Per-task drill-down | ✅ | ❌ | `internal.fullTasks` |
| Expected dates | ✅ | ✅ | `shared.timeline.phases[].estimatedDate` |
| Internal task assignee | ✅ | ❌ | `internal.fullTasks[].assignee` |
| **Payments Section** | | | |
| Payment schedule | ✅ | ✅ | `shared.payments` |
| Paid / Pending / Upcoming chips | ✅ | ✅ | `payment.status` |
| Receipt links | ✅ | ✅ (только свои платежи) | `payment.receiptUrl` |
| Internal ledger entries (зарплаты, расходы) | ✅ | ❌ | `internal.costs.items` |
| **Gallery Section** | | | |
| Renders (дизайн) | ✅ | ✅ | `shared.photos` filter `category=render` |
| Progress photos | ✅ | ✅ | `shared.photos` filter `category=progress` |
| Before photos | ✅ | ✅ | `shared.photos` filter `category=before` |
| Internal/team-only photos (документация для бригады) | ✅ | ❌ | `internal.photos` (новый bucket) |
| Lightbox | ✅ | ✅ | UI |
| Upload button | ✅ | ❌ | UI only |
| **Inspections Section** | | | |
| Список инспекций со статусами | ✅ | ✅ | `shared.inspections` |
| Дата и результат | ✅ | ✅ | `inspection.date, inspection.status` |
| Internal notes по инспекции | ✅ | ❌ | `inspection.internalNotes` |
| **Tasks Section** | | | |
| Client-visible tasks (что от КЛИЕНТА ждём) | ✅ | ✅ | `shared.tasksForClient` |
| Internal team tasks | ✅ | ❌ | `internal.fullTasks` |
| Task assignee names | ✅ | ❌ | only in internal section |
| **Internal Notes Section** | ✅ | ❌ | `internal.notes` |
| **Red Flags Banner** | ✅ | ❌ | `internal.redFlags` |
| **Team Activity Section** | ✅ | ❌ | `internal.sessions` |

### 3.5. Share flow

```
┌──────────────────┐
│ Сотрудник в      │
│ /dashboard/      │
│ client/abc123    │
└────────┬─────────┘
         │ кликает "Share with client" в header
         ▼
┌──────────────────┐
│ ShareLinkModal   │
│ открывается      │
└────────┬─────────┘
         │ POST /api/clients/abc123/share-tokens
         │ body: { expiresInDays: 30 }
         ▼
┌──────────────────────────────────────────────────┐
│ Backend:                                          │
│ 1. Auth check (caller has permission)             │
│ 2. Generate token: nanoid(20)                     │
│ 3. Compute slug: ensureUniqueSlug(client.name)    │
│ 4. Save to client_portal_tokens collection        │
│ 5. Return { slug, token, url, expiresAt }         │
└────────┬──────────────────────────────────────────┘
         ▼
┌──────────────────────────────────────────────────┐
│ Modal показывает:                                 │
│ • https://app.profit-step.com/portal/jim-dvorkin │
│   ?token=xx88aaff                                 │
│ • [Copy link] [Open preview] [Send via SMS]      │
└────────┬─────────────────────────────────────────┘
         │ сотрудник копирует и отправляет клиенту
         ▼
┌──────────────────┐
│ Клиент открывает │
│ ссылку на        │
│ телефоне         │
└────────┬─────────┘
         │ GET /api/portal/jim-dvorkin?token=xx88aaff
         ▼
┌──────────────────────────────────────────────────┐
│ Backend portal endpoint:                          │
│ 1. Validate token (exists, not revoked, not       │
│    expired, slug matches)                         │
│ 2. Load full data via internal logic              │
│ 3. Filter through portalFilter.ts                 │
│ 4. Log view to portal_views collection            │
│ 5. Trigger Telegram notification "Jim opened"     │
│ 6. Return filtered response                       │
└────────┬──────────────────────────────────────────┘
         ▼
┌──────────────────┐
│ Клиент видит     │
│ свой portal      │
│ (без internal    │
│  данных)         │
└──────────────────┘
```

### 3.6. Approval flow

```
Клиент в /portal/jim-dvorkin?token=...
  → видит EstimateSection с items
  → внизу секции "Bathroom" нажимает [Approve this section]
  → POST /api/portal/jim-dvorkin/approve
       body: { token, estimateId, sectionId, decision: 'approved', comment? }
  ↓
Backend:
  1. Validate token
  2. Validate decision in ['approved', 'questioned']
  3. Write to estimate_approvals collection:
     { estimateId, sectionId, status, comment, by: 'client', clientId, at, ip, userAgent }
  4. Update estimate doc: approvalState[sectionId] = 'approved'
  5. Trigger Telegram bot: "✅ Jim approved Bathroom section ($25,000)"
  6. Return updated approvalState
  ↓
Сотрудник в /dashboard/client/abc123
  (refresh или real-time)
  → видит badge "✅ Approved by client at 14:30 today"
  → видит full audit trail (кто, когда, IP)
```

---

## 4. Phased delivery

### Phase 0: Подготовка (1 день)

- [ ] **0.1.** Решить открытые вопросы из §6 (минимум 1, 2, 5, 7)
- [ ] **0.2.** Засеять Firestore тестовыми данными для одного клиента (Jim Dvorkin) — без этого ничего нельзя продемонстрировать
- [ ] **0.3.** Смерджить две версии `[id].tsx` (моя из `claude/confident-lewin` vs текущая в `feature/project-hierarchy-fix`) — выбрать одну как базу

### Phase 1: Demo-режим (2 дня) — показать клиенту на встрече

Цель: открыть на iPad перед клиентом, провести по всем секциям, не покраснеть.

- [ ] **1.1.** Создать `src/components/client-dashboard/` с базовой структурой
- [ ] **1.2.** Перенести существующие 5 компонентов из `src/pages/portal/components/` в `src/components/client-dashboard/sections/` (Estimate, Timeline, Payments, Gallery, Inspections). Добавить prop `showInternalCost?: boolean` где надо.
- [ ] **1.3.** Создать `ClientDashboardLayout` который принимает `mode: 'internal' | 'client'` + `data` и рендерит правильный набор секций
- [ ] **1.4.** Переключить `ClientPortalPage.tsx` на использование `<ClientDashboardLayout mode="client" data={...} />`
- [ ] **1.5.** Переключить `dashboard/client/[id].tsx` на использование `<ClientDashboardLayout mode="internal" data={...} />`
- [ ] **1.6.** **Минимальный share без backend:** временно генерировать URL вида `/portal/:slug?demo=1` без проверки токена (для встречи)
- [ ] **1.7.** Скриншот всех секций обоих режимов на iPad-разрешении 1024×768

**DoD Phase 1:** Денис открывает у себя `/dashboard/client/jim-dvorkin-id` → видит всё. Открывает `/portal/jim-dvorkin?demo=1` в режиме incognito → видит только публичную часть. Скриншоты в `docs/demo-screenshots/`.

### Phase 2: Soft launch (1 неделя) — реально дать одному клиенту

- [ ] **2.1.** Backend endpoint `POST/GET/DELETE /api/clients/:id/share-tokens` (functions/src/agent/routes/sharing.ts)
- [ ] **2.2.** Коллекция `client_portal_tokens` + composite index `(slug, token)` + Firestore rules (read-only для всех, write только functions)
- [ ] **2.3.** Backend endpoint `GET /api/portal/:slug?token=:t` (functions/src/agent/routes/portal.ts)
- [ ] **2.4.** Lib `functions/src/agent/lib/portalFilter.ts` — pure function `buildPortalResponse(internalData) → portalData`. **Покрыть юнит-тестами в первую очередь** — это критичный контракт безопасности.
- [ ] **2.5.** Расширить `GET /api/clients/:id` чтобы возвращать структуру `{ client, shared, internal }` вместо плоской
- [ ] **2.6.** Frontend `useClientPortal` переключить с прямых Firestore-запросов на новый endpoint
- [ ] **2.7.** UI компоненты `ShareWithClientButton` + `ShareLinkModal` в internal view
- [ ] **2.8.** Backend `POST /api/portal/:slug/approve` + коллекция `estimate_approvals`
- [ ] **2.9.** EstimateSection в client mode: написать кнопки Approve / Question, отправлять через portal endpoint
- [ ] **2.10.** Telegram notification на approve + on first portal open
- [ ] **2.11.** Логирование `portal_views`
- [ ] **2.12.** Backfill: для существующих клиентов сгенерировать первый share token + slug

**DoD Phase 2:** Один реальный клиент успешно использовал портал ≥1 неделю. Approve приходит в Telegram. Сотрудник может revoke token. Никакие internal данные не утекают (проверено через `curl /api/portal/...` без admin auth).

### Phase 3: Production (1 месяц)

- [ ] **3.1.** Magic link auth (Firebase Auth passwordless email link) вместо `?token=` в URL
- [ ] **3.2.** Email уведомления клиенту: новые фото / новый платёж / новая фаза
- [ ] **3.3.** Полная аналитика portal_views (дашборд для команды)
- [ ] **3.4.** PDF export estimate (jspdf или backend)
- [ ] **3.5.** i18n (как минимум EN/RU переключатель)
- [ ] **3.6.** Rate limiting на portal endpoint (express-rate-limit)
- [ ] **3.7.** Privacy / security audit
- [ ] **3.8.** Lighthouse > 85 на portal странице
- [ ] **3.9.** Нагрузочный тест 100 одновременных порталов

---

## 5. Технические решения

### 5.1. Slug uniqueness

Текущий `slugify("Jim Dvorkin") = "jim-dvorkin"` хрупкий: два клиента с тем же именем → конфликт.

**Решение:** при создании клиента генерировать slug, проверять уникальность, в случае конфликта добавлять суффикс:
- `jim-dvorkin` (первый)
- `jim-dvorkin-2` (второй)
- `jim-dvorkin-3` (третий)

Хранить в `client.portalSlug` (новое поле). Backfill для существующих.

### 5.2. Token format

`nanoid(20)` → 20 символов URL-safe. ~140 бит энтропии. Достаточно против перебора.

URL: `https://app.profit-step.com/portal/jim-dvorkin?token=V1StGXR8_Z5jdHi6B-myT`

### 5.3. Token storage

Коллекция `client_portal_tokens`:
```ts
{
  id: string,                    // auto
  clientId: string,
  slug: string,                  // denormalized для индекса
  token: string,                 // уникальный
  createdBy: string,             // userId
  createdAt: Timestamp,
  expiresAt: Timestamp,          // обычно +30 дней
  revokedAt: Timestamp | null,
  lastUsedAt: Timestamp | null,
  useCount: number,
}
```

Composite index: `(slug, token)` для быстрой валидации.

### 5.4. Portal endpoint security

```ts
// functions/src/agent/routes/portal.ts (псевдокод)

router.get('/api/portal/:slug', async (req, res, next) => {
  const { slug } = req.params;
  const { token } = req.query;

  if (!token || typeof token !== 'string') {
    return res.status(401).json({ error: 'Token required' });
  }

  // 1. Lookup token
  const tokenSnap = await db.collection('client_portal_tokens')
    .where('slug', '==', slug)
    .where('token', '==', token)
    .limit(1)
    .get();

  if (tokenSnap.empty) {
    // Don't leak whether slug exists or token is wrong
    await sleep(jitter(100, 300));        // anti-timing attack
    return res.status(401).json({ error: 'Invalid link' });
  }

  const tokenDoc = tokenSnap.docs[0];
  const tokenData = tokenDoc.data();

  // 2. Check status
  if (tokenData.revokedAt) return res.status(401).json({ error: 'Link revoked' });
  if (tokenData.expiresAt.toMillis() < Date.now()) return res.status(401).json({ error: 'Link expired' });

  // 3. Load client + full data (reuse internal endpoint logic)
  const fullData = await loadClientDashboardData(tokenData.clientId);

  // 4. Filter through pure function (single source of truth for visibility)
  const portalData = buildPortalResponse(fullData);

  // 5. Log view
  await db.collection('portal_views').add({
    clientId: tokenData.clientId,
    tokenId: tokenDoc.id,
    ip: req.ip,
    userAgent: req.headers['user-agent'] || null,
    at: FieldValue.serverTimestamp(),
  });

  // 6. Update token usage
  await tokenDoc.ref.update({
    lastUsedAt: FieldValue.serverTimestamp(),
    useCount: FieldValue.increment(1),
  });

  // 7. (async) Telegram notification on first view
  if ((tokenData.useCount || 0) === 0) {
    await notifyTelegramFirstOpen(tokenData.clientId);
  }

  res.json(portalData);
});
```

### 5.5. portalFilter pure function

```ts
// functions/src/agent/lib/portalFilter.ts

export function buildPortalResponse(full: InternalDashboardData): PortalData {
  return {
    client: {
      name: full.client.name,
      address: full.client.address,
      projectAddress: full.client.projectAddress || full.client.address,
      contactName: full.client.contacts?.[0]?.name || null,
      // EXPLICITLY NOT INCLUDED:
      // email, phone, status, tags, totalRevenue, internalNotes, customFields
    },
    shared: {
      estimates: full.shared.estimates.map(stripInternalCostColumns),
      timeline: full.shared.timeline,
      payments: full.shared.payments,
      photos: full.shared.photos.filter(p => p.visibility !== 'internal'),
      inspections: full.shared.inspections.map(stripInternalNotes),
      tasksForClient: full.shared.tasksForClient,
    },
    approvalState: full.shared.approvalState,
  };
}

function stripInternalCostColumns(estimate: Estimate): PublicEstimate {
  return {
    ...estimate,
    items: estimate.items.map(item => ({
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
      total: item.total,
      // NOT INCLUDED: unitCostPrice, supplierName, supplierContact, internalNotes
    })),
    // NOT INCLUDED: internalCost, margin, marginPct
  };
}

function stripInternalNotes(inspection: Inspection): PublicInspection {
  const { internalNotes, ...rest } = inspection;
  return rest;
}
```

**КРИТИЧНО:** этот файл — security boundary. Юнит-тесты должны проверять что:
1. `unitCostPrice` НЕ присутствует в результате
2. `internalNotes` НЕ присутствует
3. `email`, `phone`, `tags`, `totalRevenue` НЕ присутствуют
4. Случайное добавление новых internal полей в Estimate type не пробрасывается через фильтр (использовать explicit allow-list, не remove-list)

---

## 6. Открытые вопросы

1. **Существует ли реальный Jim Dvorkin в Firestore сейчас?** Если нет — кто и когда засеет? Без этого нельзя продемонстрировать ничего.
2. **Какой формат estimate items в БД?** В EstimateView.tsx ожидается `{ description/name, quantity, unit, unitPrice/unitCostPrice, ... }`. Это совпадает с реальной схемой? Где указан `unitCostPrice` (источник internal cost)?
3. **Поле `estimateType: 'internal'`** — реально ли проставляется? Если нет — фильтр пропустит ВСЁ и клиент увидит наши internal цены. **Самый опасный баг** который надо проверить ДО первой демонстрации.
4. **Phases/stages проекта** — какой канонический набор? Откуда брать (group by `task.context`, отдельная коллекция, поле `phase` на projects)?
5. **Inspections** — отдельная коллекция или фильтр по словам? Если фильтр — какие именно слова, на каких языках?
6. **Photo categories** — как маркировать (filename prefix, metadata, отдельная коллекция)? Сейчас filename prefix — хрупко.
7. **Approval юридически что-то значит?** Если да — нужны IP, timestamps, audit trail (это есть в плане). Если ОЧЕНЬ важно — DocuSign-like с подписью.
8. **Кто может Share?** Все логиннутые сотрудники или только PM/admin? RBAC на share endpoint.
9. **Token expiration по умолчанию** — 7/30/90 дней? Должно ли продлеваться при использовании?
10. **Revoke flow** — если сотрудник revoke'нул, и клиент в этот момент открыл портал — показывать "session expired" с просьбой запросить новую ссылку? Или просто 401?
11. **Multiple tokens на одного клиента?** Можно ли иметь активными несколько share-link'ов одновременно (для разных людей со стороны клиента — например жена и муж)?
12. **Что делать когда клиент задал question в estimate?** Кому уведомление, через какой канал, как ответ возвращается обратно в портал?
13. **Internal user в роли клиента** — должен ли сотрудник видеть превью exactly как клиент? (Кнопка "Open preview" в ShareLinkModal)
14. **Storage для photos** — `clients/{clientId}/photos/` единая коллекция или разделять по фазам/категориям?
15. **Когда отправлять Telegram alert** — на каждый approve или batch (раз в час)?

---

## 7. Definition of Done (всё вместе)

### Функционал
- [ ] Сотрудник видит **полный** дашборд по `/dashboard/client/:id`
- [ ] Кнопка "Share with client" генерирует токен и показывает URL
- [ ] Кнопка "Open preview" открывает portal в новой вкладке (с тем же токеном)
- [ ] Клиент по `/portal/:slug?token=:t` видит **только shared** часть
- [ ] Клиент может approve / question секцию estimate
- [ ] Approve приходит в Telegram + видна в internal view с audit trail
- [ ] Token можно revoke из internal view
- [ ] Истёкший / revoked token возвращает 401

### Безопасность
- [ ] `portalFilter.ts` покрыт юнит-тестами на отсутствие internal полей в результате
- [ ] `curl https://app.../api/portal/jim-dvorkin?token=invalid` → 401, не утечка
- [ ] `curl https://app.../api/clients/abc123` без admin auth → 401
- [ ] `curl https://app.../api/portal/jim-dvorkin?token=valid` → не содержит `unitCostPrice`, `internalNotes`, `email`, `phone`, `totalRevenue`
- [ ] DevTools network tab при просмотре portal: ни одного запроса не возвращает internal данные

### Качество
- [ ] `tsc --noEmit` без ошибок
- [ ] `npm run lint` без ошибок
- [ ] Юнит-тесты на `portalFilter.ts` (минимум 5 кейсов)
- [ ] Юнит-тесты на token validation (expired, revoked, wrong slug)
- [ ] Скриншоты обоих режимов в `docs/demo-screenshots/`
- [ ] Lighthouse > 80 на portal странице

### Документация
- [ ] Этот файл (`SPEC.md`) — обновляется по мере реализации
- [ ] `docs/api/portal.md` — описание contract'а (request/response, error codes)
- [ ] README в `src/components/client-dashboard/` — как использовать `ClientDashboardLayout`

---

## 8. Что НЕ делать

- **Не** дублировать UI рендер-логику в двух местах. Один компонент, два режима.
- **Не** фильтровать internal данные на frontend. Только на backend.
- **Не** хранить токены в plain text если они long-lived (хеш или encrypt-at-rest). Для MVP — plain OK.
- **Не** реализовывать chat / messaging внутри портала на этой итерации. Только comments в estimate секциях.
- **Не** делать magic link сразу. Сначала просто `?token=` в URL. Magic link — Phase 3.
- **Не** трогать `_old_estimator_backup` и `docs/legacy/` — они уже мёртвые.
- **Не** объединять с admin dashboard (`/dashboard`). Это другая страница, другая логика, не путать.

---

## 9. Замечание о названии папки

Эта папка называется `dashbord-for-client` (опечатка: `dashbord` вместо `dashboard`). **Рекомендация**: переименовать в `client-dashboard` или `unified-client-dashboard` ДО того, как код в неё положишь — потом будет дороже (импорты, маршруты, история git). Альтернативы:
- `client-dashboard/` — нейтрально
- `unified-client-dashboard/` — выразительно, но длинно
- Оставить как есть, если намеренно

---

## 10. История этого ТЗ

- **2026-04-07 v1** — описывал отдельный external portal (только клиентский view). Отвечал на вопрос "что показать клиенту".
- **2026-04-07 v2 (текущая)** — переписан как unified dashboard после решения Дениса делать ОДИН дашборд с share-mode, а не два отдельных. Сохраняет всю аналитику текущего состояния кода из v1.
