# Инвентаризация секретов (P-1.3)

## Metadata

- **Автор:** Claude Code Opus 4.7 (1M context)
- **Дата:** 2026-04-19
- **Цель:** каталог всех секретов проекта — откуда брать на новом сервере, кто владелец, критичность
- **Scope:** `functions/.env`, `.env` / `.env.local`, `service-account-key.json`, Firebase config, Telegram bots
- **⚠️ Правило:** этот файл содержит **только названия и метаданные**. Значения никогда не попадают в git — живут в gitignored `.env` файлах и в Google Secret Manager.

---

## TL;DR

При переезде на новый Firebase-проект нужно **18 секретов**. Пять из них (AI ключи + Telegram worker bot token) — критические: без них половина продукта не работает. Три (email / WhatsApp / Anthropic) — легко выдаются заново. Остальные — конфигурация, а не секреты, но всё равно надо проставить.

---

## 1. Firebase Admin / Service Account

| Ключ | Откуда | Где используется | Критичность | Действие на переезде |
|---|---|---|---|---|
| `service-account-key.json` (gitignored, repo root или `functions/`) | Firebase Console → Project Settings → Service accounts → Generate new private key | Миграционные скрипты (`scripts/migrate-*`, `scripts/verify-balance-formula.ts`, `functions/_debug_scripts/*`) | HIGH | Сгенерировать новый JSON у нового проекта, положить в gitignored путь. ADC (`gcloud auth application-default login`) — альтернатива, не требует файла. |
| `GOOGLE_APPLICATION_CREDENTIALS` env var | Путь к service-account-key.json или к ADC file | Firebase Admin SDK fallback | HIGH | Установить в shell profile: `export GOOGLE_APPLICATION_CREDENTIALS=~/path/to/key.json` |
| `FIREBASE_TOKEN` (GitHub Actions secret) | `firebase login:ci` | Deploy gate workflow (`firebase-deploy-gate.yml:174`) | HIGH | Сгенерировать новый CI токен, записать в Actions Secrets нового репо. |

---

## 2. `functions/.env` — секреты бэкенда (Cloud Functions runtime)

**Этот файл gitignored.** Firebase автоматически загружает его при `firebase deploy --only functions`. На новом проекте нужно создать копию с новыми значениями.

### 2.1. AI API keys

| Переменная | Провайдер | Как получить | Критичность | Где используется |
|---|---|---|---|---|
| `GEMINI_API_KEY` | Google AI Studio | https://aistudio.google.com/app/apikey | **CRITICAL** | Blueprint AI, Gemini Vision, telegramAIAssistant, faceVerification, receiptOcrService, shoppingAIService, smartDispatcherService, gtdHandler, inboxHandler, mediaHandler, bankAIParser, onNoteCreated — 13+ файлов |
| `ANTHROPIC_API_KEY` | Anthropic Console | https://console.anthropic.com/settings/keys | MEDIUM | blueprintAIService (вторая модель) |
| `OPENAI_API_KEY` | OpenAI platform | https://platform.openai.com/api-keys | LOW | blueprintAIService (fallback), onTelegramMessage, onWhatsAppMessage — редко используется |

### 2.2. Telegram bots

| Переменная | Bot username | Назначение | Критичность | Как получить |
|---|---|---|---|---|
| `WORKER_BOT_TOKEN` | `@profitstep_worker_bot` (или аналог) | Основной бот для рабочих — селфи check-in, таймер, фотоотчёты | **CRITICAL** | Отдельный токен у @BotFather. На переезде: старый токен можно **переиспользовать**, только сменить webhook URL через `setWebhook` API. |
| `COSTS_BOT_TOKEN` | `@profitstep_costs_bot` (или аналог) | Бот для расходов — фото чеков + OCR | HIGH | Аналогично |
| `TELEGRAM_TOKEN` | `@crmapiprofit_bot` | AI-ассистент для внешнего разработчика | MEDIUM | Аналогично. Если переключаем на новый проект — сообщить внешнему разработчику про новый webhook. |
| `TELEGRAM_BOT_TOKEN` | Super-estimator bot | Blueprint AI pipeline output | LOW | Аналогично |
| `WORKER_PASSWORD` | — | Пароль для связывания сотрудника с ботом (security) | HIGH | Рандомная строка 16+ символов. На переезде можно сгенерировать новый, но тогда всем сотрудникам разослать через админа. |

### 2.3. Email (Brevo SMTP)

| Переменная | Источник | Критичность | Примечание |
|---|---|---|---|
| `EMAIL_HOST` | `smtp-relay.brevo.com` (константа) | LOW | Скопировать как есть |
| `EMAIL_PORT` | `587` (константа) | LOW | Скопировать как есть |
| `EMAIL_USER` | Brevo console → SMTP & API → SMTP settings | HIGH | На новом проекте либо создать новый Brevo аккаунт, либо переиспользовать текущий |
| `EMAIL_PASSWORD` | Brevo SMTP key | HIGH | Хранится в Brevo, можно перевыпустить |
| `EMAIL_FROM` | Любой верифицированный домен в Brevo | MEDIUM | Например `noreply@profit-step.com` |

### 2.4. WhatsApp

| Переменная | Критичность | Примечание |
|---|---|---|
| `WHATSAPP_VERIFY_TOKEN` | LOW | Stub — WhatsApp integration not live yet. Любая строка. |

### 2.5. Внутренний API

| Переменная | Назначение | Критичность | Примечание |
|---|---|---|---|
| `AGENT_API_KEY` | Master-токен для `/api/*` с правами admin (bypass RLS) | **CRITICAL** | Рандомная 40+ hex строка. Используется сторонними агентами (`@crmapiprofit_bot`, OpenClaw). Перевыпуск требует уведомления всех интеграций. |
| `OWNER_UID` | Firebase Auth UID владельца проекта | MEDIUM | На новом проекте — зарегистрировать свой Google аккаунт через Auth, скопировать UID из Firebase Console → Authentication → Users |
| `OWNER_DISPLAY_NAME` | Read-only для логов/writeoff'ов | LOW | Просто строка, не секрет |

### 2.6. Необязательные/потенциальные

| Переменная | Когда нужна |
|---|---|
| `BLUEPRINT_AI_URL` | Если у компании запущен Blueprint-AI Python service (LangGraph на порту 8000) |
| `BREVO_API_KEY` | Если используется Brevo Transactional API (не только SMTP) — сейчас не выяснено используется ли |
| `SENTRY_DSN` | Когда подключим Sentry (сейчас не подключён — риск из CLAUDE.md §4) |

---

## 3. `.env.local` / `.env.production` — секреты фронтенда (Vite build time)

**Этот файл gitignored.** Встраивается в бандл на `npm run build` — **НЕ БЫВАЕТ СЕКРЕТОВ**, только публичные идентификаторы.

| Переменная | Источник | Критичность | Замена на новом проекте |
|---|---|---|---|
| `VITE_FIREBASE_API_KEY` | Firebase Console | PUBLIC (identity, not secret) | Скопировать новый apiKey из Firebase Console |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Console | PUBLIC | `{new-project}.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | Firebase Console | PUBLIC | `{new-project-id}` |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase Console | PUBLIC | `{new-project}.firebasestorage.app` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase Console | PUBLIC | Новое число |
| `VITE_FIREBASE_APP_ID` | Firebase Console | PUBLIC | Новый ID |
| `VITE_FIREBASE_FUNCTIONS_URL` | Cloud Functions URL | PUBLIC | `https://us-central1-{new-project}.cloudfunctions.net/agentApi` |
| `VITE_USE_EMULATORS` | Dev-only | — | Не ставить в prod |
| `VITE_INFRA_API_URL` | Optional | — | См. HARDCODED_INVENTORY §7 |
| `VITE_SERVER_DASHBOARD_URL` | Optional | — | Оставить пустым если нет dashboard сервера |
| `VITE_BLUEPRINT_AI_URL` | Optional | — | Если есть LangGraph service |
| `VITE_CCTV_LANDING_URL` | Optional | — | Обычно пусто в prod |

---

## 4. Статичные HTML лендинги

6 файлов под `public/promo*`, `public/saas-landing/*` содержат Firebase config **захардкожено** (не через env, т.к. Vite их не компилирует):

- `public/promo/index.html`
- `public/promo-high-end/index.html`
- `public/promo-creative/index.html`
- `public/promo-garkor/index.html`
- `public/saas-landing/index.html`
- `public/saas-landing/ru.html`

При переезде — **заменить apiKey + authDomain + projectId + storageBucket в каждом** (sed или ручками). Это не секрет, но менять надо.

---

## 5. Передача секретов на новую машину/сервер

**Рекомендуемый порядок:**

1. **На старом сервере:** `cat functions/.env > /tmp/envs-backup.txt` (плюс `.env.local` + `service-account-key.json`)
2. **Перенос:** через password manager (1Password/Bitwarden) ИЛИ через зашифрованный архив (`age -p` / `gpg -c`). **НИКОГДА через email/slack/git/paste.**
3. **На новом сервере:** разложить в правильные пути (functions/.env, .env.local), дать права `chmod 600`, проверить что gitignored.
4. **Удалить /tmp backup'ы.**

**Альтернатива (рекомендую для крупных проектов):** Google Secret Manager:
```bash
# На новом проекте
gcloud secrets create ANTHROPIC_API_KEY --data-file=<(echo "sk-ant-...") --project=new-project-id
# В функции:
import { defineSecret } from 'firebase-functions/params';
const anthropicKey = defineSecret('ANTHROPIC_API_KEY');
```
Это убирает .env файлы полностью — секреты живут в Google Cloud, IAM рулит доступом.

---

## 6. Чек-лист переноса (в порядке приоритета)

- [ ] service-account-key.json нового проекта
- [ ] `functions/.env` с 18 переменными
- [ ] `.env.local` или `.env.production` с 12 публичными vars
- [ ] 6 HTML лендингов: apiKey + authDomain + projectId + storageBucket переписать
- [ ] GitHub Actions Secrets: `FIREBASE_TOKEN` обновить
- [ ] Telegram webhook URLs обновить через `setWebhook` API (4 бота)
- [ ] Firebase Auth authorized domains добавить новый хост
- [ ] Brevo Sender Identity подтвердить новый домен (если домен меняется)

---

## References

- Parent plan: [`MASTER_PLAN_2026-04-19.md`](../tasks/MASTER_PLAN_2026-04-19.md) §P-1.3
- Inventory: [`HARDCODED_INVENTORY.md`](./HARDCODED_INVENTORY.md)
- Topology: [`FIREBASE_TOPOLOGY.md`](./FIREBASE_TOPOLOGY.md) (P-1.4)
- CLAUDE.md §2.3: правила обращения с секретами
