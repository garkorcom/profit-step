# Инвентаризация захардкоженного (P-1.1)

## Metadata

- **Автор:** Claude Code Opus 4.7 (1M context)
- **Дата:** 2026-04-19
- **Цель:** зафиксировать всё что нужно менять / параметризовать при переезде на новый Firebase-проект и/или сервер
- **Метод:** grep по ключевым паттернам (`localhost`, `192.168.*`, `profit-step.*`, emails, API keys, `projectId:`)
- **Scope:** рабочая ветка origin/main (после PR #28 Warehouse V3). `node_modules/`, `build/`, `lib/` исключены.

---

## 0. TL;DR (что больше всего болит)

- **1 хардкоженный LAN IP** `192.168.86.32:8001` в navbar Admin — всем кроме Дениса показывает таймаут.
- **7 хардкоженных `localhost:` URL** в production-коде фронта и бэка (blueprint AI, infra-map, landings, client-portal dev). Нужны env-variable fallback и явные empty-state.
- **Firebase Web API key `AIzaSy…Th8E` + `projectId: "profit-step"`** повторены в **5 standalone HTML-лендингах** под `public/promo*` + `public/saas-landing/*`. При переезде на новый Firebase-проект — править каждый файл.
- **~20 скриптов в `scripts/` и `functions/src/scripts/`** с хардкоженным `projectId: 'profit-step'`. Нужен единый паттерн `process.env.GOOGLE_CLOUD_PROJECT ?? 'profit-step'`.
- **Нет `.firebaserc`** — Firebase CLI знает про проект через локальный кэш `firebase use`. При клонировании репо на новую машину — неявная привязка теряется.
- **Личные email** `garkor.com@gmail.com`, `garkorusa@gmail.com`, `dev@garkor.com`, `info@garkor.com` рассыпаны по UI-копирайту, лендингам, SettingsPage и SDK pyproject.

---

## 1. 🔴 Критично — захардкожено в production-коде

### 1.1. Browser-visible (попадает в собранный JS-бандл)

| # | Файл:строка | Что | Последствия на новом сервере |
|---|---|---|---|
| 1.1.1 | `src/components/layout/Header.tsx:166` | `{ path: 'EXTERNAL:http://192.168.86.32:8001', label: 'Server Dashboard' }` | **404 / timeout** для кого-либо вне LAN Дениса. Убрать или env-флаг. |
| 1.1.2 | `src/pages/InfraMapPage.tsx:110` | `INFRA_API = import.meta.env.VITE_INFRA_API_URL \|\| 'http://localhost:8001'` | Дефолт = localhost. На новой машине без `VITE_INFRA_API_URL` → `Failed to fetch`. |
| 1.1.3 | `src/pages/crm/LandingsPage.tsx:20` | `url: 'http://localhost:3003'` (в списке лендингов) | Ссылка ведёт в никуда для пользователя. |
| 1.1.4 | `src/components/estimates/EstimatorLangGraphUI.tsx:53,98,124` | `fetch('http://localhost:8000/api/upload-blueprint')` + `.../estimate` + `.../estimate/resume` — **3 хардкода** | Blueprint-AI сервис на :8000 у Дениса. На новой машине фичa полностью мёртвая. |
| 1.1.5 | `src/hooks/useClientPortal.ts:92` | `'http://localhost:5001/profit-step/us-central1/agentApi'` — fallback для local emulator | Двойной хардкод: localhost + `projectId=profit-step`. На новом проекте эмулятор не поймает. |
| 1.1.6 | `src/hooks/useAiTask.ts:112`, `src/api/aiTaskApi.ts:16` | `connectFunctionsEmulator(functionsEast, '127.0.0.1', 5001)` | Emulator OK, но при смене `region` перестанет работать. |
| 1.1.7 | `src/firebase/firebase.ts:37-54` | 4× `connectXxxEmulator(…, '127.0.0.1', …)` + 5× `console.log('http://localhost:…')` | OK — только в emulator mode, не попадает в prod. Оставить. |

### 1.2. Backend / scripts (серверная сторона)

| # | Файл:строка | Что | Действие |
|---|---|---|---|
| 1.2.1 | `functions/src/scripts/processBlueprint.ts:204` | `axios.post('http://localhost:8000/api/upload-blueprint', …)` | Env-variable `BLUEPRINT_AI_URL` |
| 1.2.2 | `functions/src/metricsAggregation.ts` + `activityLogger.ts` + `scheduled/scheduledDayPlan.ts` + `avatarProcessor.ts` + `brevoStatusChecker.ts` + `notifications/alertNotifications.ts` + `scripts/checkModels.ts` + `api/erpV4Api.ts` | **~20 хардкодов `.region('us-central1')`** | OK если регион не меняется. Если да — grep + sed. |

### 1.3. Скрипты админа (~20 файлов)

Все с **`projectId: 'profit-step'` хардкодом:**

- `scripts/link-denis-telegram.js:24`
- `scripts/publish-timer-sync-devlog.js:6`
- `scripts/migrate-inventory-simple-to-v3.ts:120` (есть fallback `process.env.GCLOUD_PROJECT`, можно скопировать паттерн в остальные)
- `scripts/verify-balance-formula.ts:66`
- `scripts/monitor-production.sh:118`
- `scripts/publish-gtd-ai-devlog.js:6`
- `scripts/load-pasco-inspectors.mjs:13` + `load-pasco-inspectors-admin.mjs:13`
- `scripts/publish-estimator-v5-devlog.js:21`
- `scripts/link-denis-telegram.sh:7`
- `scripts/check-user-role.js:9`
- `scripts/broadcast-bot-instruction.js:6`
- `scripts/publish-daily-summary.js:20`
- `scripts/seed-devlog-admin.js:14`
- `scripts/migrate-multi-user.js:24`
- `functions/src/scripts/createTestAdmin.ts:7`
- `functions/src/scripts/seedPriceList.ts:13`
- `functions/seed_garkor_project.js:15`

**Шаблон замены:**
```ts
projectId: process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? 'profit-step'
```

### 1.4. Public HTML лендинги — Firebase config

Все **5 standalone HTML** содержат embedded Firebase config с ключами от prod-проекта:

| Файл:строка | Что |
|---|---|
| `public/promo/index.html:825-828` | apiKey + authDomain + projectId + storageBucket |
| `public/promo-high-end/index.html:483-486` | то же |
| `public/promo-creative/index.html:484-487` | то же |
| `public/promo-garkor/index.html:530-533` | то же |
| `public/saas-landing/index.html:1040-1043` | то же |
| `public/saas-landing/ru.html:674-677` | то же |
| `scripts/load-pasco-inspectors.mjs:11-14` | тот же config в скрипте |
| `docs/legacy-nov2025/test-email.html:220-223` | **старый ключ** `AIzaSy…FNY` (вероятно stale — проверить) |

**Используемый Firebase Web API key:** `AIzaSyDjBgLGw60VDlMkFu3w9DiSwTftH6nTh8E`
(Повторю: это не секрет — идентификатор проекта. Но специфичен для `profit-step`.)

На новом проекте → нужно перезаписать во всех 5 HTML + скрипте одним sed или генерацией из template.

---

## 2. 🟠 Personal info / brand identity

| # | Где | Что |
|---|---|---|
| 2.1 | `src/pages/SettingsPage.tsx:155-162` | Hardcoded в UI: `info@garkor.com`, `garkorusa@gmail.com` как получатель тестовых писем |
| 2.2 | `public/saas-landing/*.html`, `public/promo-garkor/*.html`, `public/platform/index.html` | `mailto:garkor.com@gmail.com`, `dev@garkor.com` в футерах |
| 2.3 | `sdk/python/pyproject.toml:12` | `authors = [{ name = "GARKOR Corp", email = "dev@garkor.com" }]` |
| 2.4 | `.agent/workflows/publish-summary.md:35` | Путь `~/.config/firebase/garkor_com_gmail.com_application_default_credentials.json` |
| 2.5 | `.agent/workflows/git.md:39` | «ключ "anttww" добавлен к аккаунту @garkorcom» — актуально для рабочего процесса, не для миграции |
| 2.6 | `functions/EMAIL_SETUP.md:127,137` | Инструкции `EMAIL_USER=your-email@gmail.com` — шаблон, не реальное значение, OK |

**Решение:** при миграции либо оставить как есть (если новый владелец не меняется), либо найти-и-заменить на новые email'ы компании.

---

## 3. 🟡 Firebase / hosting / API URLs

Эти URL попадают в документы и в UI-копирайт:

- `https://profit-step.web.app` — 30+ мест в docs/, README, CLAUDE.md, SDK README, AI_ASSISTANT_BOT_PROMPT.md, OPENCLAW_AGENT_INTEGRATION_GUIDE.md
- `https://us-central1-profit-step.cloudfunctions.net/agentApi` — в src: `shareApi.ts`, `useTransactionMutations.ts`, `useClientDashboardData.ts`, `AutoApproveRulesDialog.tsx`, и SDK `client.py` (`DEFAULT_BASE_URL`)
- `profit-step.firebaseapp.com` — auth domain, в 6 HTML
- `profit-step.firebasestorage.app` / `profit-step.appspot.com` — storage bucket, в тех же 6 HTML

Во фронтенд-коде (`src/`) это уже обёрнуто в `import.meta.env.VITE_FIREBASE_FUNCTIONS_URL || '<hardcoded>'` — OK для миграции, **но дефолт будет врать**, если забыть env.

В SDK Python: **без env-фолбэка**, `DEFAULT_BASE_URL` жёстко. При переезде надо либо поменять константу + bump версию, либо добавить env-override.

---

## 4. 🟡 Telegram bots / webhook endpoints

| # | Где | Что |
|---|---|---|
| 4.1 | Docs + CLAUDE.md | `@crmapiprofit_bot` — AI-ассистент бот, зарегистрирован на `us-central1-profit-step.cloudfunctions.net/agentApi` как webhook |
| 4.2 | Worker bot | Webhook `onWorkerBotMessage` — тот же проект |
| 4.3 | Costs bot | Webhook `onCostsBotMessage` — тот же проект |

**При переезде Telegram bots требуют:**
1. Обновить webhook URL в Telegram BotFather → новый cloud functions URL
2. Если нет желания трогать bot token — можно оставить на старом сервере как proxy, но это грязно
3. Токены ботов: в `functions/.env` (gitignored) — брать оттуда на старом сервере, переносить на новый

---

## 5. ✅ OK / не требует изменений

1. `src/firebase/firebase.ts` — `127.0.0.1` для Firebase Emulator Suite, обёрнуто в `if (isEmulator)`. Не попадает в prod-бандл.
2. `firestore.rules.test.ts` — `projectId: 'profit-step-test'` — тестовая привязка, отдельный проект.
3. Все `us-central1` в functions — согласованно с deploy region. Если регион не меняется — оставить.
4. `@gmail.com` в тестовых fixture'ах (`functions/test/agentApi/clients.test.ts:37`) — legit test data.

---

## 6. 📋 Чего НЕТ в репо (значит надо будет явно перенести)

- **`.firebaserc`** — отсутствует. `firebase deploy` без флага `--project` работает благодаря локальному `firebase use` кэшу в `~/.config/configstore/firebase-tools.json`. **На новой машине это сломается.** Нужно либо добавить `.firebaserc` с обоими проектами (prod + staging), либо документировать `firebase use`.
- **`.env`, `.env.local`, `.env.test`** — gitignored. Нужны заново при переезде.
- **`functions/.env`** — gitignored. Содержит секреты (Anthropic, Google Gemini, Telegram bot tokens, SMTP). Инвентаризация секретов — отдельный документ P-1.3.
- **`service-account-key.json`** — gitignored. Нужен для скриптов что не используют ADC.

---

## 7. Следующие шаги

Этот документ — **инвентаризация**, не правки. Чтобы перейти в действие:

1. **P-1.2 (env consolidation, 3-4ч):** править §1 — все хардкоды в продакшн-коде через env-variable с безопасными дефолтами (empty-state вместо `http://localhost:xxx`).
2. **P-1.3 (secrets inventory, 1ч):** документ `SECRETS.md` — что в `.env` / `functions/.env` сейчас, откуда брать на новом проекте.
3. **P-1.4 (firebase topology, 1ч):** `FIREBASE_TOPOLOGY.md` — collections / indexes / functions / hosting / auth providers.
4. **Параллельно (nice-to-have):** добавить `.firebaserc.example` с образцом multi-env конфигурации.

---

## 8. Suggested env variables to introduce

Минимальный набор чтобы вычистить §1:

```bash
# Frontend (.env.production / .env.local)
VITE_FIREBASE_API_KEY=...                # из Firebase console
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_FUNCTIONS_URL=...          # уже используется
VITE_INFRA_API_URL=                      # пусто = скрыть /admin/infra-map
VITE_BLUEPRINT_AI_URL=                   # пусто = скрыть EstimatorLangGraphUI
VITE_SERVER_DASHBOARD_URL=               # пусто = не показывать в nav

# Backend (functions/.env)
BLUEPRINT_AI_URL=                        # для processBlueprint.ts
# Secrets inventory — отдельным документом (P-1.3)

# Scripts
GOOGLE_CLOUD_PROJECT=profit-step         # прописать в shell profile или .env
```

---

## References

- Parent plan: [`MASTER_PLAN_2026-04-19.md`](../tasks/MASTER_PLAN_2026-04-19.md) — §P-1
- CLAUDE.md §2.3: секреты никогда в git
- CLAUDE.md Memory «functions.config() shutdown March 2026» — не относится, `functions.config()` уже не используется в текущем коде
