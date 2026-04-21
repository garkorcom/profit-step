# План extraction 4 модулей (v2)

> **Статус:** PLAN (не начат)
> **Версия:** 2 (2026-04-20 — переработан с v1: добавлены data strategy, метрики, testing/observability, versioning, cost, rejected alternatives, FAQ)
> **Audit:** [`MODULE_EXTRACTABILITY_AUDIT.md`](./MODULE_EXTRACTABILITY_AUDIT.md)
> **Итоговый результат:** 4 независимых service/package, versioned contracts, monorepo остаётся thin gateway + shared libs.

---

## 0. TL;DR

| Phase | Scope | Effort (1 FTE) | Rollback |
|---|---|---|---|
| 0 — Pre-work | shared package + contracts + заменить 15 cross-reads | 2-3 нед | Не мержить PR |
| 1 — MONEY pilot | extract finance + costs в отдельный service | 2 нед | Feature flag flip, 1 мин |
| 2 — CLIENT | extract clients + deals + 18 components | 2-3 нед | Feature flag flip |
| 3 — USER | extract users + teams + telegram gateway | 3 нед | Feature flag flip ⚠ auth-critical |
| 4 — TIME TRACKING | extract последним (2/5 extractability) | 3-4 нед | Feature flag flip + event backfill |
| **Total** | **12-15 недель FTE**, или ~9 мес при 30% двух инженеров |

**Критично:** Phase 0 **обязательно** до любого extraction. Без shared interfaces модули нельзя extract без breaking cross-module reads.

---

## 1. Решение стартовать — 4 блока prerequisites

### 1.1 Business drivers (хотя бы один обязателен)
- [ ] **Second product / white-label:** есть конкретный клиент/партнёр который хочет использовать модуль CRM (например только MONEY для учёта у другой компании)?
- [ ] **Multi-tenancy separation:** нужно изолировать данные клиентов сильнее чем Firestore RLS позволяет?
- [ ] **Team scaling:** ≥ 3 инженеров, нужна параллельная работа над модулями без merge conflicts?
- [ ] **Performance/cost:** узкое место в одном модуле требует отдельного scaling profile (GPU для AI?, больше memory для finance batch?)

Если все 4 = ❌ → extraction **не имеет смысла**, делать модуляризацию в `src/modules/*` без packages.

### 1.2 Technical prerequisites
- [ ] Production stable: 2+ недели без P0 bugs
- [ ] Pipeline follow-ups закрыты ([`PIPELINE_FOLLOWUPS_TZ.md`](./PIPELINE_FOLLOWUPS_TZ.md) — 5 pending items)
- [ ] CRM Overhaul Spec стабилизирован (сейчас DRAFT) — boundary модулей может поменяться
- [ ] CI/CD зелёный ≥ 95% времени (сейчас Anti-Loop tests broken — нужно починить)

### 1.3 Team prerequisites
- [ ] Driver: full-time инженер на 12+ недель (или 30% двух на 9 мес)
- [ ] Код-ревьюер который видел Firebase/TS monorepo before
- [ ] DevOps: кто разбирается в Cloud Functions deploy + Secret Manager (сейчас — Денис сам)

### 1.4 Infrastructure prerequisites
- [ ] Workload Identity Federation настроен (см. `GitHub Actions deploy TZ`)
- [ ] Branch protection на `main`
- [ ] Observability baseline: logs aggregation, error tracking (Sentry?) — не ноль

**Если хоть одно из §1.1-1.4 не выполнено → отложить extraction, зафиксировать план, вернуться через квартал.**

---

## 2. Phase 0 — Pre-work (inside monorepo)

### 2.1 Task graph (DAG — порядок важен)

```
0.1 shared package setup  ──┐
                            ├─→ 0.3 adapters (can run parallel per module)
0.2 contract interfaces  ───┤
                            │
                            ├─→ 0.4 contract tests
                            │
                            └─→ 0.5 replace cross-reads ← BLOCKING for all later phases
```

### 2.2 Task 0.1 — Shared package (0.5 дня)

**Что:** `packages/shared/`, монорепо workspaces.

```
packages/shared/
├── src/
│   ├── types/auth.ts          (AuthContext, Role, Scope — только types)
│   ├── types/money.ts         (Decimal, Currency, Money)
│   ├── types/identity.ts      (UserId/ClientId/ProjectId — branded types)
│   ├── types/timestamps.ts    (FirestoreTimestamp, ISODate helpers)
│   ├── utils/phone.ts         ← merge src/utils/phone.ts + functions/src/agent/utils/phone.ts
│   ├── utils/ids.ts
│   ├── utils/dates.ts         (timezone, period math)
│   └── index.ts (barrel)
├── package.json
└── tsconfig.json
```

**Success metric:**
```bash
grep -rn "normalizePhone" src/ functions/src/
# должно показать что оба места импортируют из @profit-step/shared
```

**Зачем branded types:** `type UserId = string & {__brand: 'UserId'}` — TypeScript не даёт случайно передать `ClientId` туда где ждут `UserId`. Сейчас везде `string` — типовых багов много.

### 2.3 Task 0.2 — Contract interfaces (1-2 дня)

`packages/contracts/` с 4 interface files + Zod schemas.

**Пример UserService:**

```typescript
// packages/contracts/src/UserService.ts
export interface UserService {
  getUser(id: UserId): Promise<User | null>;
  getHourlyRate(id: UserId): Promise<Money | null>;
  getEffectiveTeamMemberIds(foremanId: UserId): Promise<UserId[]>;
  resolveFromTelegramId(telegramId: string): Promise<User | null>;
}

// Zod schemas for input validation at the boundary
export const UserIdSchema = z.string().min(1).brand<'UserId'>();
export const UserSchema = z.object({ id: UserIdSchema, ... });
```

**Критерий готовности interface:**
- Покрывает **все** текущие cross-reads по данным этого модуля (grep + audit)
- Не содержит implementation deals (Firestore-specific types, FieldValue, etc.)
- Все методы идемпотентны или явно помечены мутирующими
- Version 1.0.0 в package.json — после extract нельзя breaking-change без мажора

### 2.4 Task 0.3 — Firestore adapters (2 дня, параллельно per module)

```typescript
// functions/src/agent/services/userFirestoreAdapter.ts
import type { UserService } from '@profit-step/contracts';
import * as admin from 'firebase-admin';

export class UserFirestoreAdapter implements UserService {
  private db = admin.firestore();

  async getUser(id: UserId): Promise<User | null> {
    const doc = await this.db.collection('users').doc(id).get();
    return doc.exists ? toUser(doc) : null;
  }
  // ...
}

// DI point в agentApi.ts
const userService: UserService = new UserFirestoreAdapter();
```

**Важно:** adapter **не экспортирует Firestore internals** — только domain types. `toUser(doc)` конвертирует Firestore doc → clean domain object.

### 2.5 Task 0.4 — Contract tests (1-2 дня)

```typescript
// packages/contracts/tests/UserService.contract.ts
export function userServiceContractTests(makeService: () => UserService) {
  describe('UserService contract', () => {
    it('getUser returns null for non-existent', async () => {
      const svc = makeService();
      expect(await svc.getUser('does-not-exist' as UserId)).toBeNull();
    });
    // ... 20+ tests covering every method + edge cases
  });
}

// functions/test/userFirestoreAdapter.test.ts
import { userServiceContractTests } from '@profit-step/contracts/tests';
userServiceContractTests(() => new UserFirestoreAdapter());

// Позже в Phase 3 после extract:
// packages/user-sdk/tests/httpAdapter.test.ts
// userServiceContractTests(() => new UserHttpAdapter('http://user-service'));
```

**Один test suite — обе implementations.** Когда extract-нём USER, HTTP adapter должен пройти те же тесты.

### 2.6 Task 0.5 — Replace cross-module reads (3-5 дней)

**Это главная работа Phase 0.** Конкретный grep:

```bash
# До Phase 0:
grep -rn "db.collection('users')" functions/src/agent/routes/timeTracking.ts | wc -l
# 8

# После Phase 0:
# 0 (все заменены на userService.getUser())
```

**Scope (priority order):**
1. `timeTracking.ts` — 8 reads users + 3 reads clients + 4 reads gtd_tasks = **15 замен** (основной блок)
2. `finance.ts` + `costs.ts` — 4 reads users + 2 reads clients
3. `clients.ts` — 2 reads users

**Acceptance:**
- `grep -rn "db.collection('\\(users\\|clients\\|work_sessions\\|costs\\)')" functions/src/agent/routes/` — возвращает **только owner routes**
- Все существующие integration tests проходят

### 2.7 Phase 0 success metrics

| Метрика | До | После |
|---|---|---|
| Direct cross-module Firestore reads | 15 | 0 |
| Shared utils duplication (phone normalize) | 2 места | 1 место (shared) |
| Branded types coverage | 0% | 100% для UserId/ClientId/ProjectId |
| Contract interfaces | 0 | 4 |
| Contract tests per interface | 0 | ≥10 tests |

---

## 3. Data strategy (КРИТИЧНО — не было в v1)

### 3.1 Firestore ownership boundaries

После Phase 0, у каждого модуля — **эксклюзивная запись** в свои коллекции. Чтение между модулями — только через contracts.

| Collection | Owner | Readers (через contract) |
|---|---|---|
| `users`, `employees`, `teams`, `companies` | USER | все остальные (ReadOnly) |
| `clients`, `deals`, `contacts` | CLIENT | MONEY (fuzzy), TIME (display) |
| `work_sessions`, `time_entries`, `breaks` | TIME | MONEY (payroll calc) |
| `costs`, `invoices`, `payments`, `salaries`, `advances` | MONEY | USER (admin view?) |
| `projects` | ⚠ shared — решить в Phase 0 | — |
| `gtd_tasks` | ⚠ shared — решить в Phase 0 | — |
| `activity_log`, `notifications` | cross-cutting — вынести в events service Phase 5? | — |

### 3.2 IAM enforcement

**После extraction физически запретить cross-read:**

Каждый extracted service получает свой service account:
- `money-service@profit-step.iam.gserviceaccount.com`
- `client-service@...`
- `user-service@...`
- `time-tracking-service@...`

IAM binding даёт service account доступ **только к своим коллекциям** через Firestore custom rules:

```javascript
// firestore.rules
service cloud.firestore {
  match /databases/{db}/documents {
    match /costs/{doc} {
      allow read, write: if request.auth.uid == 'money-service-SA-uid';
    }
    match /users/{doc} {
      allow read: if true;  // все могут читать (для contracts)
      allow write: if request.auth.uid == 'user-service-SA-uid';
    }
  }
}
```

Это **hard boundary** — даже если кто-то случайно напишет cross-module `db.collection('costs')` в USER service, Firestore откажет.

### 3.3 Data migration (не сейчас, Phase 5+)

На текущем этапе extraction **данные остаются в одной Firestore БД**. Это облегчает rollback.

В будущем (Phase 5, если понадобится — **не в этом плане**):
- Каждый модуль → отдельный Firestore project или Postgres schema
- Миграция через dual-write: новый service пишет в обе БД месяц, проверяем diff, cutover

---

## 4. Phase 1 — MONEY extract (пилот)

### 4.1 Task breakdown

| # | Task | Effort | Дёлай после |
|---|---|---|---|
| 1.1 | Создать `packages/money/` структуру (move finance.ts + costs.ts + services) | 1 день | Phase 0 |
| 1.2 | Добавить `{ secrets: [...] }` bindings для money service | 2ч | 1.1 |
| 1.3 | Standalone Cloud Function `moneyApi` | 1 день | 1.1-1.2 |
| 1.4 | Feature flag `USE_EXTERNAL_MONEY` на agentApi | 0.5 дня | 1.3 |
| 1.5 | Canary deploy: 0% → 1% → 10% → 100% | 2-3 дня (с паузами) | 1.4 |
| 1.6 | Cleanup: удалить `routes/finance.ts` + `costs.ts` из agentApi после 100% stable | 0.5 дня | 1.5 через неделю |
| 1.7 | Update docs + SDK | 1 день | 1.6 |

**Total: 2 недели** (с canary pauses на monitoring).

### 4.2 Success metrics

| Метрика | Acceptance |
|---|---|
| `packages/money/` direct Firestore reads на чужие коллекции | **0** |
| Payroll calculation diff между monolith и external | **0.00** (до цента) за 7 тестовых дней |
| p95 latency `/api/finance/context` | ≤ 1.2× от monolith baseline |
| Cost impact | + $5-15/мес (Cloud Function idle time) |
| 50 use cases smoke test (в режиме USE_EXTERNAL_MONEY=true) | 100% pass |

### 4.3 Canary rollout

```bash
# Week 1
firebase functions:config:set money.external=false
# Deploy money service, нет трафика

# Day 1: 1% трафика
# agentApi.ts:
if (process.env.USE_EXTERNAL_MONEY === 'true' && Math.random() < 0.01) {
  return proxy(moneyServiceUrl);
}

# Day 2: monitoring → если diff = 0, p95 ok → 10%
# Day 3: 10% stable → 50%
# Day 4: 50% stable → 100%
```

### 4.4 Rollback

- Env var: `USE_EXTERNAL_MONEY=false`
- Redeploy `agentApi` (1 мин)
- Финансы снова в monolith
- Money service остаётся deployed — можно пробовать ещё раз

---

## 5. Phase 2 — CLIENT extract

Тот же паттерн. Отличия:
- **Frontend scope большой** — 5 pages + 18+ components в `src/pages/` и `src/components/crm/`
- **Phone utils уже в shared после Phase 0** — проще
- **getCachedClients()** — нужен refactor в `ClientCacheService` (синглтон в runtime)
- **Fuzzy search (Fuse.js)** — отдельный `ClientSearchService` с lazy-init

### 5.1 Success metrics (отличия от Phase 1)

| Метрика | Acceptance |
|---|---|
| `packages/client/` direct reads на users | 0 |
| Client search latency (p95) | ≤ 500ms |
| Frontend bundle size `src/modules/client/` chunk | ≤ 300kb gzipped |

**Effort:** 2-3 недели.

---

## 6. Phase 3 — USER extract (⚠ auth-critical)

### 6.1 Risk: auth breakage = всё упадёт

USER владеет `users` коллекцией + RBAC logic + Telegram linking. Breakage = **все остальные сервисы не могут аутентифицировать запросы**.

### 6.2 Mitigations
- **Auth gateway** — отдельный сервис `packages/auth-gateway/` который проверяет token и возвращает `AuthContext`
- **Dual deploy на 1+ месяц:** старый monolith agentApi продолжает работать, new user-service работает параллельно. Агенты переключаются по feature flag по одному.
- **Canary строже:** 0.1% → 1% → 10% → 50% → 100%, каждый шаг минимум 2 дня stable

### 6.3 Telegram gateway = отдельный мини-проект

Webhook `POST /telegram-webhook` принимает updates, resolve Telegram ID → User ID через auth-gateway, forward в target service (worker-bot в main).

**Effort:** +1 неделя поверх USER.

### 6.4 Success metrics

| Метрика | Acceptance |
|---|---|
| Auth failure rate (401/403) | не выше baseline + 0.1% |
| Telegram webhook processing latency | ≤ 2× baseline |
| Cross-tenant test suite | pass |

**Effort:** 2 нед USER + 1 нед telegram-gateway = **3 недели**.

---

## 7. Phase 4 — TIME TRACKING extract (последний)

### 7.1 Зависимости (strict pre-requisite)

- Phase 0 Task 0.5 ЗАКРЫТ (все cross-reads через contracts)
- Phase 3 USER extract ЗАВЕРШЁН (TIME вызывает UserService уже через HTTP)
- Phase 1 MONEY extract ЗАВЕРШЁН (payroll pipeline с новой стороны тестирован)

### 7.2 Специфика

- **41 usage `useActiveSession` в frontend** → каждый нужно проверить
- **Bot handlers** `sessionManager.ts` напрямую работают с `work_sessions` → либо остаются в monorepo и вызывают TimeSessionService, либо выносятся в time-tracking-bot-handler
- **State sync: `activeSessionId` в users** → нужен event-driven update (Pub/Sub event `session.started` / `session.stopped`, подписчик в USER service обновляет поле)

### 7.3 Event bus introduction

Для sync state между services — Google Cloud Pub/Sub:
```
TIME TRACKING publishes  → topic: session-events
USER service subscribes  → updates users.activeSessionId
MONEY subscribes         → debit hourly rate incrementally
```

### 7.4 Success metrics

| Метрика | Acceptance |
|---|---|
| Active session state consistency (TIME ↔ USER) | 100% после event propagation (lag ≤ 2s p99) |
| Worker bot session start flow latency | ≤ 1.5× baseline |
| Payroll calculation accuracy | 100% (diff = $0.00) |

**Effort:** 3-4 недели (самый большой phase).

---

## 8. Cross-phase concerns

### 8.1 Testing strategy

| Level | Coverage target | Tools |
|---|---|---|
| Unit (per service) | ≥ 80% lines | jest (existing) |
| Contract (shared) | 100% contract methods | `userServiceContractTests` style |
| Integration (service + Firestore emulator) | critical paths only | jest + `firebase-functions-test` |
| E2E (service + real Firestore staging) | 20 scenarios per phase | Cypress + staging env |
| Chaos (random service shutdown) | 5 scenarios | manual + monitoring |

### 8.2 Observability

Каждый service должен иметь:
- **Structured logs** (JSON, `severity`, `traceId`, `userId`)
- **Metrics** (requests/sec, p50/p95/p99 latency, error rate) — Google Cloud Monitoring
- **Distributed tracing** (OpenTelemetry) — `traceId` проходит через весь flow `agentApi → money-service → Firestore`
- **Health endpoint** `/api/health` возвращает `{ status, deps: { firestore, userService } }`

**До Phase 0** нужен minimum: structured logs в каждой Cloud Function (сейчас — частично есть через `logger.info/error`).

### 8.3 Versioning contracts

Semver для `packages/contracts`:
- **Major (X.0.0)** — breaking change: переименование метода, удаление поля, изменение типа
- **Minor (0.X.0)** — добавление нового метода (backward-compatible)
- **Patch (0.0.X)** — clarification, docs

**Правило:** каждый extracted service объявляет в своём manifest:
```json
{
  "consumes": {
    "@profit-step/contracts": "^1.2.0"
  }
}
```

При major-bump контракта нужен migration period (dual-implementation) минимум 1 релиз.

### 8.4 Cost impact

| Item | Было | Станет | Delta |
|---|---|---|---|
| Cloud Functions invocations | 1× agentApi | 1× agentApi + 4× module services | + $10-30/мес cold starts |
| Cloud Function memory | 512MB agentApi | 512MB × 5 services | + $20-50/мес if minInstances=1 |
| Network egress (service-to-service) | 0 | few GB/мес | + $1-5/мес |
| Secret Manager accesses | ~10/hour | ~50/hour (each service its own secrets) | + $1/мес |
| Logging volume | 1× | 5× | + $2-10/мес |
| **Estimated total delta** | | | **+ $35-100/мес** |

Не катастрофа, но не нулевое. На annually ~ $500-1200.

### 8.5 Deploy pipeline changes

После extract каждый service — отдельный GitHub Action workflow с target:
```yaml
# .github/workflows/deploy-money.yml
on:
  push:
    branches: [main]
    paths: ['packages/money/**', 'packages/shared/**', 'packages/contracts/**']
jobs:
  deploy:
    steps:
      - run: firebase deploy --only functions:moneyApi
```

Любой PR который трогает `packages/shared/` или `packages/contracts/` автоматически триггерит deploy **всех** 4 services (broad blast radius — смотреть осторожно).

---

## 9. Rejected alternatives (почему именно этот подход)

### 9.1 «Сразу микросервисы на Kubernetes»
- ❌ В 10 раз дороже — нужен GKE cluster, monitoring stack, Helm charts
- ❌ Overkill для 4 модулей
- ❌ Команда не имеет k8s опыта
- ✅ Правильно для 50+ сервисов, не для нашего случая

### 9.2 «Event-sourcing с CQRS»
- ❌ Слишком много cognitive load
- ❌ Data migration в 100× раз сложнее
- ❌ Firestore не поддерживает natively (нужен Kafka/Pulsar)
- ✅ Паттерн для финансовых систем с аудитом каждого события, но payroll не настолько критичен

### 9.3 «Просто модуляризация в `src/modules/*` без packages»
- ⚠ Меньше overhead чем extraction
- ⚠ Но нельзя extract в отдельный git-репо позже
- ⚠ Нет hard IAM boundary — любой модуль может нарушить
- **Это путь если §1.1 (business drivers) не сработает** — fallback plan

### 9.4 «Один big-bang rewrite»
- ❌ 3-6 месяцев без features — бизнес этого не переживёт
- ❌ Rollback = impossible
- ❌ Все баги всплывают одновременно

---

## 10. Intermediate stop conditions

Что если остановимся на каждой фазе?

| После | Состояние | Работает ли прод? | Useful? |
|---|---|---|---|
| Phase 0 | Shared package + contracts, direct reads заменены | ✅ Да (без изменений) | ✅ Codebase чище, меньше coupling — выигрыш даже без extraction |
| Phase 1 (MONEY) | 1 из 4 модулей extract-нут | ✅ Да (feature flag) | ✅ Валидирован подход, pattern есть |
| Phase 2 (CLIENT) | 2 из 4 extract | ✅ Да | ⚠ Полумера — 2 ещё в monolith |
| Phase 3 (USER) | 3 из 4 | ✅ Да | ✅ Важные — USER + auth — уже отдельно |
| Phase 4 (TIME TRACKING) | Все 4 extract | ✅ Да | ✅ Полное разделение, монорепо thin |

**Safe stop после Phase 0 и Phase 1.** После Phase 2-3 нежелательно останавливаться — инфраструктура 2 service'ов дублируется для сопровождения.

---

## 11. Risks & mitigations (детально)

| # | Risk | Probability | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Contract interface упускает важный use case → нужна major bump (ломает всё) | High | Medium | Усиленное code review на Phase 0, список known use cases из audit |
| R2 | Service-to-service latency убивает UX | Medium | High | Batch reads (1 round trip для N users), aggressive caching в adapters, monitor p95 |
| R3 | Auth breakage (Phase 3) кладёт весь прод | Low | **Critical** | Dual-deploy ≥ 1 мес, canary 0.1% start, rollback < 1 min |
| R4 | Event bus (Phase 4) даёт eventual consistency → UX баги | Medium | Medium | Synchronous critical reads (session active) через HTTP, async для аналитики |
| R5 | Cost runaway (Pub/Sub dead-letter loops) | Low | High | Max retries=3 + dead-letter topic + alert при 10+/мин failed events |
| R6 | Team loses motivation за 3 месяца без user features | High | High | Phase 0 + Phase 1 deliverable за 5 недель — это первый concrete win |
| R7 | Business roadmap меняется, модуль X теряет смысл extract | Medium | Medium | Pause между phase'ами для re-evaluation |
| R8 | Secret Manager стоит дороже ожидаемого | Low | Low | Secret caching в service (5-min TTL) — уже есть в Firebase runtime |

---

## 12. Timeline — три реалистичных сценария

### Сценарий A — Full-time driver (12 недель)
```
W1-W3: Phase 0
W4-W5: Phase 1 (MONEY)
W6: Stability window / feature work
W7-W9: Phase 2 (CLIENT) + Phase 3 USER параллельно (нужен 2-й инженер)
W10: Stability window
W11-W14: Phase 4 (TIME TRACKING)
```

### Сценарий B — 30% от 2 инженеров (9 месяцев)
```
Месяц 1-2: Phase 0
Месяц 3-4: Phase 1
Месяц 5: Stability + review
Месяц 6-7: Phase 2 + Phase 3
Месяц 8-9: Phase 4
```

### Сценарий C — "Только Phase 0" (3-4 недели)
Если §1.1 business driver не сработал — stop после Phase 0. Получаем:
- Cleaner codebase
- Contracts готовы для будущего
- 15 cross-reads устранено
- Zero deploy risk

Это **не потерянное время** даже если extraction в итоге не произошла.

---

## 13. 2-day pilot test — ЗАВЕРШЁН (2026-04-20, PR #56 deployed to prod)

**Результат: 🟢 GREEN — переход к полному Phase 0 одобрен.**

### Что сделано за ~4 часа
- `packages/shared/` с phone util + barrel export
- `packages/contracts/` с `UserService` interface + branded `UserId`
- `UserFirestoreAdapter` в `functions/src/agent/services/`
- 1 из 8 `db.collection('users')` в `timeTracking.ts` (line 970, start action) заменён на `userService.getUser()`
- Re-export shims в `src/utils/phone.ts` + `functions/src/agent/utils/phone.ts` сохраняют backwards compat
- Path aliases в root `tsconfig.json` + `vite.config.ts` + `functions/tsconfig.json`
- `tsc-alias` для runtime resolution (см. §13.5)
- **Deploy:** `firebase deploy --only functions:agentApi` ✅, `/api/time-tracking/active-all` returns 200 OK с реальными сессиями

### Verification
- Functions build: `tsc && tsc-alias` — passes
- Vite build: passes, bundle size не изменился
- Runtime: `normalizePhone('+1 (555) 123-4567') → '+15551234567'` ✅
- Runtime: `UserFirestoreAdapter` instantiates, все 3 метода — functions
- Existing imports `from '../utils/phone'` работают без изменений (re-export shim)

### 13.5 Ключевой learning: tsc-alias vs npm workspaces

**Проблема pilot:** TypeScript `paths` в `tsconfig.json` работают **только compile-time**. Скомпилированный `.js` содержит `require("@profit-step/shared")`, который Node.js runtime не резолвит — нет такого модуля в `node_modules/`.

**Решение pilot:** `tsc-alias` как post-build step. Переписывает `require("@profit-step/shared")` → `require("../../../../packages/shared/src")` в `.js` файлах. Работает, но добавляет tool в critical path build'а.

**Правильное долгосрочное решение для Phase 0: npm workspaces.** Root `package.json`:
```json
{ "workspaces": ["packages/*"] }
```
- `npm install` создаёт symlink `node_modules/@profit-step/shared` → `packages/shared`
- Node резолвит `require('@profit-step/shared')` без post-build magic
- Индустриальный стандарт (Lerna/Turborepo/Nx построены на workspaces)

**Но:** Firebase Functions deploy packages только `functions/` папку — hoisted deps в root `node_modules` НЕ попадают в upload. Требуется `predeploy` hook, копирующий `packages/*` в `functions/node_modules/@profit-step/`, ИЛИ переключение на Firebase-совместимый bundling (esbuild).

**Итог для Phase 0:**
1. Root `workspaces: ["packages/*"]` — для dev + Vite + тестов
2. Либо `predeploy` копирование для Firebase, либо оставить `tsc-alias` ТОЛЬКО для functions build
3. Это решение — отдельная follow-up задача, см. §15

### Go / no-go критерии — ✅ MET
- ✅ Все 4 build проходят
- ✅ Re-export backwards compat работает
- ✅ Adapter call identical к direct read
- ✅ Deploy + smoke успешны
- ✅ Total effort ~4 часа (well under 2-day budget)

### ❌ Если бы упал — fallback
Переключение на «модуляризацию в `src/modules/*` без packages» — см. §9.3.

---

## 14. FAQ

### Q: Почему 4 модуля а не 2 или 10?
**A:** Из audit — эти 4 имеют чёткие domain boundaries и разные ownership'ы в реальной жизни (HR управляет USER, бухгалтер — MONEY, sales — CLIENT, operations — TIME TRACKING). Проекты, задачи, файлы — cross-cutting, не модули сами по себе.

### Q: Что если нам нужен только MONEY extract (для white-label бухгалтерии)?
**A:** Делай Phase 0 + Phase 1. Останавливайся. §10 подтверждает — после Phase 1 система stable.

### Q: Можем мы пропустить Phase 0?
**A:** Нет. Без interfaces cross-module reads упадут при extraction. Phase 0 — обязательный fundament.

### Q: Что с Firestore rules после extraction?
**A:** Rules остаются в монорепо (shared firestore.rules). Extraction service accounts добавляются туда. См. §3.2.

### Q: Может ли monolith продолжать работать во время extraction?
**A:** Да. Feature flags на каждый extracted модуль → можно держать оба варианта live сколь угодно долго.

### Q: Что если найдём баг в extracted service месяц спустя?
**A:** `USE_EXTERNAL_<MODULE>=false`, redeploy agentApi, откат в monolith. 1 минута. См. rollback section каждой phase.

### Q: Нужно ли переписывать SDK Python?
**A:** Только когда base URL меняется. Если `moneyApi` на той же cloudfunctions.net subdomain — SDK ничего не знает.

### Q: Как долго держать dual-deploy?
**A:** Минимум 1 месяц на каждую phase после 100% rollout, чтобы поймать edge cases на end-of-month/payroll cycle.

---

## 15. Next steps

**Статус 2026-04-20:** Pilot ✅ shipped (PR #56). План валидирован. Далее ↓

### Immediate (this week)
1. **Workspaces migration** (~1-2 дня):
   - Добавить `"workspaces": ["packages/*"]` в root `package.json`
   - Решить Firebase deploy packaging (либо `predeploy` copy, либо keep tsc-alias как safety net для functions)
   - Test vite + functions build + deploy
   - Remove tsc-alias из critical path если возможно
2. **Phase 0.2 expand contracts**: дописать `TimeTrackingService`, `ClientService`, `MoneyService` interfaces (по §2.3 template)
3. **Phase 0.3 expand adapters**: создать `TimeTrackingFirestoreAdapter`, `ClientFirestoreAdapter`, `MoneyFirestoreAdapter`

### Phase 0 execution (2-3 недели по §12)
4. Заменить оставшиеся 7 cross-reads в `timeTracking.ts` через adapter
5. Audit + replace cross-reads в остальных модулях (CLIENT/MONEY)
6. Contract tests (Pact or simple integration)
7. Branded types rollout (`UserId`, `ClientId`, `ProjectId`, `Money`)

### Phase 1+ (см. §4-7)
8. MONEY extract (pilot для standalone service) — §4
9. CLIENT extract — §5
10. USER extract (⚠ auth-critical) — §6
11. TIME TRACKING extract (последний) — §7

---

## 16. References

- Audit: [`MODULE_EXTRACTABILITY_AUDIT.md`](./MODULE_EXTRACTABILITY_AUDIT.md)
- Precedent (Finance modularized): [`src/modules/finance/`](../../src/modules/finance/), PR [#48](https://github.com/garkorcom/profit-step/pull/48), PR [#49](https://github.com/garkorcom/profit-step/pull/49)
- Pipeline debt: [`PIPELINE_FOLLOWUPS_TZ.md`](./PIPELINE_FOLLOWUPS_TZ.md)
- Master plan: [`MASTER_PLAN_2026-04-19.md`](./MASTER_PLAN_2026-04-19.md)
- Secret Manager setup (dependency): [`../ONBOARDING.md`](../ONBOARDING.md)
