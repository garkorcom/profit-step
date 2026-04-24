# Next Session · Resume plan

Сессия приостановлена 2026-04-21 (утро после Google Cloud Next 2026). Открой этот файл первым.

---

## 🚀 Phase 0 · Week 1 — BASE БЕЗ AI (первое что делаем)

**ВАЖНО:** Решение от 2026-04-21: **сначала база, потом AI**. Строим работающий time tracking **без единой AI-фичи**. AI incrementally добавляем в Phase 1 после 2 недель stabilization.

**Источник:** [`TIME_TRACKING_IMPORT.md`](TIME_TRACKING_IMPORT.md) — детальный план импорта из profit-step.

**Стратегия:** портируем ~1,800 lines production-ready time tracking из profit-step, адаптируем под multi-tenant. Никаких AI роутеров / A2A / Channel Router — это Phase 1+.

### Day 1 · Firebase project + data layer

Setup:
- Create Firebase project `easytimercost-dev`
- Install emulator suite
- Initialize `functions/` folder

Port from profit-step:
- `src/types/timeTracking.types.ts` → `functions/src/types/timeTracking.ts`
- `src/types/payroll.types.ts` → `functions/src/types/payroll.ts`
- **Add `tenantId` field everywhere** (multi-tenant isolation — новое для нас)

Deliverables:
- Working Firebase project + emulator running locally
- TypeScript types ported + tests pass

### Day 2 · Firestore collections + rules

Schema (multi-tenant):
```
tenants/{tenantId}/work_sessions/{sessionId}
tenants/{tenantId}/workers/{workerId}
tenants/{tenantId}/clients/{clientId}
tenants/{tenantId}/payroll_periods/{periodId}
tenants/{tenantId}/audit_events/{eventId}
```

Deliverables:
- `firestore.rules` с multi-tenant RLS (see TIME_TRACKING_IMPORT.md §6)
- Firestore indexes for common queries (sessions by date, by worker, by client)
- Seed script с test tenant + 3 workers + 3 clients для local dev

### Day 3 · Core backend services (port from profit-step)

Port as-is:
- `functions/src/services/TimeTrackingService.ts` (241 lines) — session close logic, duration calc, break deduction, cross-platform ID
- `functions/src/services/payroll.ts` — bucket formula (salary/payments/adjustments/balance)

Deliverables:
- Both services working in emulator
- Unit tests passing (port from `functions/test/payroll.unit.test.ts`)

### Day 4 · CRUD API endpoints (no AI)

Port + simplify from `functions/src/agent/routes/timeTracking.ts` (remove AI parts):
- `POST /api/sessions/start`
- `POST /api/sessions/stop`
- `POST /api/sessions/pause` / `resume`
- `GET /api/sessions/active`
- `GET /api/sessions` (list + filters)
- `PUT /api/sessions/:id` (admin edit with audit)
- `POST /api/sessions/:id/admin-stop`

Deliverables:
- All endpoints working in emulator
- Integration tests: full session lifecycle end-to-end

### Day 5 · Scheduled jobs (port from profit-step as-is)

Port:
- `generateDailyPayroll` (4 AM cron)
- `finalizeExpiredSessions` (1 AM cron, 48h immutable)
- `autoStopStaleTimers` (every 30 min, 12h max)
- `checkLongBreaks` (every 1 hour, 1h max break)

Deliverables:
- All scheduled functions deployed + tested with fake-timer
- Idempotency guards (payroll_runs collection) working

### Day 6 · Basic Telegram bot (keyboard only, NO NLU)

Setup:
- `node-telegram-bot-api` + Firebase Admin SDK
- Webhook endpoint (Cloud Function)

Flows (deterministic, no AI):
- `/start` — register worker (link telegram_id ↔ firebase_uid)
- Main menu inline keyboard: [🏁 Start] [⏸ Pause] [🏁 Stop] [💰 Balance] [📋 Shifts]
- Start shift: client picker → optional photo → optional location → confirm
- Stop shift: confirm dialog
- No text parsing. No AI anywhere.

Deliverables:
- Bot working in Telegram (test with real bot)
- 5-step session lifecycle covered

### Day 7 · Smoke test + next steps

Actions:
- Deploy to Firebase dev project
- Run end-to-end smoke:
  - Create test tenant
  - Create test worker (self as telegram user)
  - Start shift via bot → 5 min wait → stop shift
  - Verify session in Firestore
  - Run generateDailyPayroll → check payroll ledger
- Document bugs found
- Plan Week 2 (Worker PWA + Admin UI)

Deliverables:
- Working Phase 0 Week 1 foundation
- Smoke test report
- Updated NEXT_SESSION.md with Week 2 plan

---

## Где мы остановились (prior commits)

✅ **Закоммичено + запушено** (branch `claude/suspicious-brattain-f027a1`):

| Commit | Что |
|---|---|
| `991bd92` | AI-first ERP prototype · 23 страницы · self-docs ядро · MINI_TZ + 100 USE_CASES |
| `4f9b72a` | TZ Lint page (10 consistency checks) |
| `f818dea` | Dev Notes + dev-mode toggle + subtle FAB |
| `8bf0344` | Starter-kit: portable self-docs.js + README + MIGRATION + React adapter |
| `b17932a` | NEXT_SESSION.md (first version) |
| *TBD*     | PATH.md (architectural constitution) + MINI_TZ v2 + this Week 1 plan |

**PR URL:** https://github.com/garkorcom/profit-step/pull/new/claude/suspicious-brattain-f027a1

**Архитектурная конституция:** [`PATH.md`](PATH.md) — читать ПЕРВЫМ на следующей сессии, потом этот файл.

---

## ⏸ Что было в работе когда прервались

**Задача:** «Можем ли брать куски из profit-step для нового проекта?»

Начал анализ — успел просканировать `functions/src/` и `src/` верхнеуровнево, увидел:
- backend: activityLogger, adminCreateUserWithPassword, agent/, api/, config/, email/, exports/, http/, index.ts + index_v2.ts
- frontend: App, api, auth, components, constants, features, firebase, hooks, modules, pages, router, services

**Осталось сделать:**
- Полный аудит functions/src/** + src/** — что reusable, что domain-specific
- Создать `easytimercost/starter-kit/PROFIT_STEP_IMPORTS.md` с:
  - Копи-паст-команды `cp -r profit-step/X → new-project/Y`
  - Пометки «copy as-is / extract pattern / reference only»
  - Coupling warnings (что потянет за собой)

---

## 🎯 Queue на следующую сессию (в порядке приоритета)

### 🔴 Высокий приоритет

1. **Совместный разбор profit-step — что брать** (сессия-обсуждение, не автомат)
   Денис и Claude проходят по кускам, решают каждый: yes/no/modify.
   **Формат предлагаемого диалога:**
   - Claude открывает конкретную папку/файл (`functions/src/agent/routes/` например)
   - Пересказывает что там в 3-5 строк
   - Денис говорит: «берём / не берём / берём паттерн, не код»
   - Claude помечает в отдельный файл `PROFIT_STEP_IMPORTS.md`
   - Идём дальше

   **Категории к обсуждению** (не автомат-решение):
   - [ ] Backend: `functions/src/agent/routes/*.ts` — паттерн Express роутов для агент API
   - [ ] Backend: `functions/src/triggers/telegram/handlers/` — session management pattern
   - [ ] Backend: `functions/src/index.ts` + `defineSecret` — централизованные secrets
   - [ ] Backend: `activityLogger.ts`, `adminCreateUserWithPassword.ts` — auth utilities
   - [ ] Infrastructure: `firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`
   - [ ] Dev config: `.oxlintrc.json`, `.oxfmtrc.jsonc`, `vite.config`, emulator setup
   - [ ] Frontend: `src/api/crmApi.ts` — wrapper pattern для Firestore
   - [ ] Frontend: `src/auth/` — auth hooks
   - [ ] Frontend: `src/components/` — какие компоненты reusable (dashboard widgets, ErrorBoundary)
   - [ ] Frontend: `src/pages/dashbord-for-client/` — RLS-aware pattern
   - [ ] Testing: `cypress/`, `functions/test/`, `scripts/seed-*`
   - [ ] `CLAUDE.md` паттерн (инструкции для агентов) — адаптировать?

   **НЕ обсуждаем** (явно domain-specific):
   - `modules/time/`, `modules/expenses/`, `modules/workers/`, `modules/clients/`
   - `siteDashboard/`, `estimator/`, `ElectricalEstimatorPage`
   - `onWorkerBotMessage.ts` конкретная логика
   - Payroll formula
   - Construction-specific данные

2. **Пропатчить 6 багов которые AI-агент нашёл** (~45м)
   Демо полного цикла «AI find → AI fix → verify → commit».
   Список багов в комментариях коммита `f818dea` (они в localStorage под expenses/clients/workers/call-summary).
   Конкретно:
   - UC-counter `0%` когда UC нет → должно быть `—` (shell.js)
   - Breadcrumb в call-summary не несёт `?id=c1`
   - Workers.html: overpaid worker без alert chip
   - Workers: foreman без подписи бригады
   - client-overview sparse spec (заполнить в meta.js)
   - AI-generate UC на страницах с full spec (enhance shell.js)

### 🟠 Средний приоритет

3. **Async storage adapter** для starter-kit v2 (~1ч)
   Заменить sync `STORAGE._write` на async с pluggable backend.
   Firestore example + fallback localStorage.

4. **CI lint integration** (~30м)
   `_tz_lint.html` как headless CLI команда: `node selfdocs-lint.js > lint.json`.
   GitHub Action example.

5. **React adapter — проверить на реальном React проекте** (~30м)
   Сейчас только `.tsx` файл, не тестирован.
   Создать минимальный Vite+React app, подключить, проверить.

### 🟡 Низкий приоритет (позже)

6. **Multi-tenant через storageKeys prefix** — 20м
7. **npm package publish** — 1ч (нужен GitHub repo + package.json + publish workflow)
8. **Claude Vision runtime** для AI-run UC в headless — экспериментально, на backend через Firebase Function

### ⏳ Отложено (не начинать пока)

- **Phase 1 production build EasyTimerCost** (MINI_TZ.md) — это отдельный масштабный track, когда решим что прототип годен
- **Voice input через Web Speech / Whisper** — требует API

---

## Быстрый старт следующей сессии

```bash
cd /Users/denysharbuzov/Projects/profit-step/.claude/worktrees/suspicious-brattain-f027a1
git status                              # должна быть чистая, на claude/suspicious-brattain-f027a1
git log --oneline -5                    # увидишь 4 коммита из этой сессии

# Запустить превью
# ─ prototype (EasyTimerCost) на :5175
# ─ starter-kit на :5176

# Открыть главные точки входа
open http://127.0.0.1:5175/_review.html              # morning review
open http://127.0.0.1:5175/_feedback.html            # Kanban с фидбеком
open http://127.0.0.1:5175/_tz_lint.html             # TZ consistency
open http://127.0.0.1:5176/examples/minimal.html     # starter-kit в чистом виде
```

---

## Текущее состояние self-docs стека

```
ПРОТОТИП (easytimercost/prototype/)
├─ 23 HTML страницы, 17 wired with self-docs
├─ shell.js + meta.js + styles.css
├─ _review, _feedback (Kanban), _master_tz (coverage), _tz_lint (10 checks), infodebag (visual docs)
└─ Все закоммичено

STARTER-KIT (easytimercost/starter-kit/)
├─ self-docs.js (~25KB, portable, zero-deps, i18n en/ru)
├─ templates/page-template.html
├─ examples/minimal.html + react-adapter.tsx
├─ README.md + MIGRATION.md
└─ Тестировано на :5176, работает

PLANNING DOCS
├─ MINI_TZ.md (24KB) — полный spec для прод-сборки
├─ USE_CASES.md (50KB) — 100 юз-кейсов
└─ NEXT_SESSION.md ← ты тут
```

---

## Вопросы к Денису на следующую сессию

1. **Новый проект под self-docs — какой?**
   - Новый CRM для другой ниши?
   - Standalone SaaS?
   - Open-source (npm publish)?
   - Внутренний tool для твоей команды?
   → В зависимости от ответа — что именно extract'ить из profit-step.

2. **Фаза 1 production EasyTimerCost — начинаем или прототип как есть идёт на demo клиентам?**
   - Прототип как ТЗ для внешнего разработчика? (тогда PR с доками достаточно)
   - Сам реализуешь на основе MINI_TZ? (тогда идём в Phase 1 product build)

3. **AI runtime в Claude Code — как регулярная практика?**
   - Ручной запуск `/pickup "проверь портал"` когда есть настроение?
   - Cron через CronCreate раз в день?
   - Trigger на commit (pre-push hook)?

---

## Что ВАЖНО НЕ ЗАБЫТЬ

- 🚫 **Не трогать main profit-step код** без явного разрешения. Мы в worktree, production в main repo.
- 🚫 **Не деплоить** в Firebase без прямого запроса.
- ✅ **Все правки — в `easytimercost/`** (isolated prototype).
- ✅ **Commit по ходу** — не копить diff до конца сессии.
- ✅ **Todos используй как memory** — план слоёв, статус фаз.
