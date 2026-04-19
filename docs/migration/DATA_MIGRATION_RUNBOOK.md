# Data Migration Runbook (P-1.5)

## Metadata

- **Автор:** Claude Code Opus 4.7 (1M context)
- **Дата:** 2026-04-19
- **Цель:** пошаговая процедура переноса Firestore + Storage + Auth с текущего проекта `profit-step` на новый Firebase-проект
- **Scope:** читается последовательно, каждый шаг можно прервать и возобновить
- **Предварительно:** прочитать [`FIREBASE_TOPOLOGY.md`](./FIREBASE_TOPOLOGY.md), [`SECRETS.md`](./SECRETS.md), [`HARDCODED_INVENTORY.md`](./HARDCODED_INVENTORY.md)

---

## TL;DR

1. Создать новый Firebase-проект, выдать Blaze план
2. Настроить `.env.local`, `functions/.env`, `service-account-key.json` для нового проекта
3. Экспорт данных (GCS export — managed, быстро)
4. Импорт данных в новый проект
5. Re-deploy functions, hosting, rules, indexes
6. Переключить Telegram webhooks через BotFather
7. Cutover: обновить DNS (если custom domain) / уведомить клиентов
8. Мониторинг 48ч

**Timeline:**
- Small prep (2ч): `.env`, service account, новый проект
- Data transfer (15-30 мин для типичной Firestore, 5-10 мин Storage)
- Deploy (30 мин): functions + hosting + rules
- Post-cutover (48ч): pure мониторинг

---

## 0. Предусловия

**Убедиться что есть:**

- [ ] Новый Firebase-проект создан в Console (`https://console.firebase.google.com`)
- [ ] Blaze plan активирован на новом проекте (нужен для Cloud Functions)
- [ ] `gcloud CLI` установлен и авторизован (`gcloud auth login`)
- [ ] `firebase CLI` установлен, версия ≥ 14
- [ ] Local `.env.local` пока что на старом проекте (не трогать)
- [ ] Ветка main зелёная (миграцию делать на стабильном коде)
- [ ] Backup текущей prod БД сделан (см. §2.1 ниже — export перед любыми правками)

**Не забыть:**

- [ ] Предупредить команду о downtime window (обычно нужно 30-60 мин на cutover)
- [ ] Уведомить внешнего разработчика `@crmapiprofit_bot` что webhook изменится
- [ ] Задокументировать rollback-процедуру (см. §9)

---

## 1. Создание нового Firebase-проекта

### 1.1. Firebase Console

1. Перейти https://console.firebase.google.com
2. "Add project" → имя `profit-step-v2` (или любое)
3. Google Analytics — по желанию
4. После создания: **Project settings** → запомнить Project ID

### 1.2. Enable APIs

```bash
NEW_PROJECT="profit-step-v2"  # ← твой новый project id

gcloud config set project $NEW_PROJECT

# Включить все необходимые API
gcloud services enable \
  firestore.googleapis.com \
  firebase.googleapis.com \
  firebasehosting.googleapis.com \
  cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com \
  firebaseauth.googleapis.com \
  identitytoolkit.googleapis.com \
  firebasestorage.googleapis.com \
  firebaserules.googleapis.com \
  pubsub.googleapis.com \
  cloudscheduler.googleapis.com \
  eventarc.googleapis.com \
  run.googleapis.com
```

### 1.3. Firestore database

```bash
# Создаёт Firestore в Native mode в us-central (matches текущего проекта)
gcloud firestore databases create --location=us-central --project=$NEW_PROJECT
```

### 1.4. Storage bucket

Firebase автоматически создаст bucket при первом upload. Либо явно:

```bash
gcloud storage buckets create gs://$NEW_PROJECT.firebasestorage.app \
  --location=us-central1 \
  --project=$NEW_PROJECT
```

### 1.5. Auth providers

Firebase Console → Authentication → Sign-in method:
- Enable **Email/Password**
- Enable **Google**
- **Authorized domains**: добавить новый hosting domain `{NEW_PROJECT}.web.app` (уже будет), и custom domain если есть

### 1.6. Service account key

Firebase Console → Project Settings → Service accounts → "Generate new private key" → сохранить как `service-account-key.json` в repo root или `functions/`. **НЕ КОММИТИТЬ** — уже в `.gitignore`.

### 1.7. `.firebaserc` alias

```bash
# В repo
cat > .firebaserc <<EOF
{
  "projects": {
    "default": "profit-step",
    "new": "$NEW_PROJECT"
  }
}
EOF

# Переключиться на новый
firebase use new
```

---

## 2. Экспорт данных с текущего проекта

### 2.1. Firestore (рекомендуемый путь — managed export)

Быстрее скриптов. Firestore дампит в GCS bucket, импорт — обратный вызов.

```bash
OLD_PROJECT="profit-step"
BACKUP_BUCKET="gs://profit-step-migration-backup"

# 2.1.1. Создать bucket для бэкапа (один раз)
gcloud storage buckets create $BACKUP_BUCKET --location=us-central1 --project=$OLD_PROJECT

# 2.1.2. Дать Firestore SA права писать в bucket
FIRESTORE_SA="service-$(gcloud projects describe $OLD_PROJECT --format='value(projectNumber)')@gcp-sa-firestore.iam.gserviceaccount.com"

gsutil iam ch serviceAccount:$FIRESTORE_SA:roles/storage.admin $BACKUP_BUCKET

# 2.1.3. Экспорт (ALL collections)
gcloud firestore export $BACKUP_BUCKET/dump-$(date +%Y%m%d-%H%M%S) \
  --project=$OLD_PROJECT

# Output: long operation ID, можно мониторить:
# gcloud firestore operations describe <operation-id>
```

**Время:** для типичной БД 10к документов ~2-5 минут. Для большой 100к+ ~30 мин.

### 2.2. Firestore (альтернатива — JSON export через скрипт)

Для небольших данных или если нужен diff-friendly JSON:

```bash
# Dry-run (считает, не пишет)
GOOGLE_CLOUD_PROJECT=profit-step \
  npx ts-node scripts/migration/export-firestore-json.ts --dry-run

# Полный экспорт
GOOGLE_CLOUD_PROJECT=profit-step \
  npx ts-node scripts/migration/export-firestore-json.ts --out=./firestore-dump

# Выборочный экспорт (clients + gtd_tasks только)
GOOGLE_CLOUD_PROJECT=profit-step \
  npx ts-node scripts/migration/export-firestore-json.ts \
  --out=./firestore-dump \
  --collections=clients,gtd_tasks
```

Дамп кладётся в `./firestore-dump/<collection>/part-XXXX.json` + `manifest.json`.

### 2.3. Storage

```bash
NEW_PROJECT="profit-step-v2"
gsutil -m cp -r gs://profit-step.firebasestorage.app gs://$NEW_PROJECT.firebasestorage.app
```

Флаг `-m` = параллельная загрузка. Может длиться 10-60 мин зависимо от объёма.

### 2.4. Auth users

```bash
# Экспорт из старого проекта
firebase auth:export users.json --project=profit-step

# Импорт в новый (будет в §4.3)
# firebase auth:import users.json --project=profit-step-v2
```

`users.json` содержит хэши паролей + UIDs. **GitIgnore**, не коммитить!

---

## 3. Импорт данных в новый проект

### 3.1. Firestore через managed import

```bash
OLD_DUMP_URL="gs://profit-step-migration-backup/dump-YYYYMMDD-HHMMSS"
NEW_PROJECT="profit-step-v2"

# 3.1.1. Дать новому Firestore SA права читать дамп
NEW_FIRESTORE_SA="service-$(gcloud projects describe $NEW_PROJECT --format='value(projectNumber)')@gcp-sa-firestore.iam.gserviceaccount.com"
gsutil iam ch serviceAccount:$NEW_FIRESTORE_SA:roles/storage.objectViewer gs://profit-step-migration-backup

# 3.1.2. Импорт
gcloud firestore import $OLD_DUMP_URL --project=$NEW_PROJECT

# Мониторинг:
gcloud firestore operations list --project=$NEW_PROJECT
```

### 3.2. Firestore через скрипт (альтернатива)

```bash
# Dry-run
GOOGLE_CLOUD_PROJECT=$NEW_PROJECT \
  npx ts-node scripts/migration/import-firestore-json.ts --in=./firestore-dump --dry-run

# Commit
GOOGLE_CLOUD_PROJECT=$NEW_PROJECT \
  npx ts-node scripts/migration/import-firestore-json.ts --in=./firestore-dump --commit
```

Скрипт проверит что `GOOGLE_CLOUD_PROJECT != profit-step` (чтобы случайно не залить prod обратно). Чтобы обойти — `--force`.

### 3.3. Storage

Уже скопировали в §2.3 командой `gsutil cp`. Verify:

```bash
gsutil du -s gs://profit-step.firebasestorage.app
gsutil du -s gs://$NEW_PROJECT.firebasestorage.app
# Значения должны совпадать (в байтах)
```

### 3.4. Auth users

```bash
firebase auth:import users.json --hash-algo=SCRYPT \
  --hash-key=$(cat scrypt-hash-key.txt) \
  --salt-separator=$(cat salt-separator.txt) \
  --rounds=$(cat rounds.txt) \
  --mem-cost=$(cat mem-cost.txt) \
  --project=$NEW_PROJECT
```

Firebase при экспорте выдаст `hash-algo` и параметры. Если забыли сохранить — Firebase Console → Authentication → Users → Import users → там же можно загрузить JSON через UI.

---

## 4. Деплой functions / rules / indexes / hosting в новый проект

Порядок важен — rules + indexes **до** functions и hosting.

```bash
firebase use new

# 4.1. Rules + indexes (БЫСТРО — не ждать долго)
firebase deploy --only firestore:rules,firestore:indexes,storage:rules

# 4.2. Functions (5-15 мин, 113 функций)
firebase deploy --only functions

# 4.3. Hosting (зависит от env: смотри ниже)
cp .env.local .env.local.backup
# Отредактировать .env.local — новый projectId, новый apiKey из Firebase Console
# См. SECRETS.md §3 для списка переменных

npm run build
firebase deploy --only hosting

# 4.4. Вернуть .env.local на старый проект если миграция ещё не финальная
cp .env.local.backup .env.local
```

---

## 5. Post-migration configuration

### 5.1. Telegram webhooks

```bash
# Для каждого из 4 ботов (worker, costs, crmapiprofit, super-estimator):

NEW_FUNCTIONS_URL="https://us-central1-$NEW_PROJECT.cloudfunctions.net"

# Worker bot
curl -X POST "https://api.telegram.org/bot<WORKER_BOT_TOKEN>/setWebhook" \
  -d "url=$NEW_FUNCTIONS_URL/onWorkerBotMessage"

# Costs bot
curl -X POST "https://api.telegram.org/bot<COSTS_BOT_TOKEN>/setWebhook" \
  -d "url=$NEW_FUNCTIONS_URL/onCostsBotMessage"

# AI assistant (crmapiprofit)
curl -X POST "https://api.telegram.org/bot<TELEGRAM_TOKEN>/setWebhook" \
  -d "url=$NEW_FUNCTIONS_URL/telegramWebhook"
```

Проверить: `https://api.telegram.org/bot<TOKEN>/getWebhookInfo`

### 5.2. Firebase Auth authorized domains

Console → Authentication → Settings → Authorized domains → добавить `{NEW_PROJECT}.web.app` и custom domain если есть.

### 5.3. Static HTML landings

Обновить Firebase config в 6 HTML'ах (см. [`HARDCODED_INVENTORY.md §1.4`](./HARDCODED_INVENTORY.md)):

```bash
# Найти и заменить одним sed (после визуального audit)
NEW_API_KEY="AIzaSy..."  # из Firebase Console → Project settings

find public -name "*.html" -type f -exec sed -i '' \
  "s|apiKey: \"AIzaSyDjBgLGw60VDlMkFu3w9DiSwTftH6nTh8E\"|apiKey: \"$NEW_API_KEY\"|g" {} \;

find public -name "*.html" -type f -exec sed -i '' \
  "s|authDomain: \"profit-step.firebaseapp.com\"|authDomain: \"$NEW_PROJECT.firebaseapp.com\"|g" {} \;

# ... повторить для projectId / storageBucket / messagingSenderId / appId
```

Затем `npm run build && firebase deploy --only hosting`.

### 5.4. OpenAPI spec

Обновить любые external references на `https://profit-step.web.app/api/docs/spec.json` → `https://$NEW_PROJECT.web.app/api/docs/spec.json`. Уведомить внешнего разработчика AI-бота.

---

## 6. Verification (перед DNS cutover)

### 6.1. Smoke tests

```bash
# Health
curl https://$NEW_PROJECT.web.app/api/health | jq
# Должно вернуть {"status":"ok","version":"4.5.0",...}

# Login flow → открыть в браузере
# https://$NEW_PROJECT.web.app
# → Google login
# → попасть на /admin/dashboard
# → проверить что клиенты, задачи, финансы отрендерились

# Telegram worker bot
# → в чате с ботом отправить /start
# → бот должен ответить (проверяет webhook setup)

# Functions logs
firebase functions:log --project=$NEW_PROJECT --limit=20
# Не должно быть error'ов или таймаутов
```

### 6.2. Data integrity

```bash
# Сравнить счётчики в старом и новом
# Для каждой важной коллекции:

for col in clients users gtd_tasks work_sessions bank_transactions; do
  echo "=== $col ==="
  echo "OLD: $(gcloud firestore operations list --project=profit-step --format=json | jq -r '.[] | select(.metadata.collectionIds[] == "'$col'") | .metadata.progressDocuments.completedWork')"
  echo "NEW: $(gcloud firestore operations list --project=$NEW_PROJECT --format=json | jq -r '.[] | select(.metadata.collectionIds[] == "'$col'") | .metadata.progressDocuments.completedWork')"
done

# Или проще — через admin UI:
# https://$NEW_PROJECT.web.app/admin/companies → counter
# https://profit-step.web.app/admin/companies → counter
# Сверить визуально
```

---

## 7. DNS cutover (если custom domain)

Отдельный runbook: [`DNS_DOMAINS.md`](./DNS_DOMAINS.md) (P-1.7).

Если используется только `*.web.app`:
- Сообщить пользователям новый URL
- Оставить старый проект ещё 2 недели как standby
- После 2 недель — удалить старый проект (Firebase Console → delete)

---

## 8. Monitoring (48ч window)

### 8.1. Что смотреть

```bash
# Live логи
firebase functions:log --project=$NEW_PROJECT

# Billing
# Console → Billing → Budgets → убедиться что нет всплесков
# CLAUDE.md §2.1: "infinite loop = $10,000+ billing bomb"

# Ошибки функций
# Firebase Console → Functions → Dashboard → Errors
# Должно быть 0 errors первые 24ч

# Auth
# Firebase Console → Authentication → Users → проверить что count совпадает
```

### 8.2. Алёрты (настроить перед cutover)

Cloud Monitoring → alerts:
- Cloud Functions error rate > 5% за 10 минут
- Firestore read budget exhaustion
- Billing threshold ($100/day baseline)

---

## 9. Rollback plan

Если что-то сломалось в первые 24-48ч:

### 9.1. Быстрый rollback через DNS

Вернуть DNS на старый `profit-step.web.app`. Поскольку старый проект не удалён — всё продолжит работать.

### 9.2. Rollback Telegram webhooks

```bash
# Старый functions URL
OLD_FUNCTIONS_URL="https://us-central1-profit-step.cloudfunctions.net"

curl -X POST "https://api.telegram.org/bot<WORKER_BOT_TOKEN>/setWebhook" \
  -d "url=$OLD_FUNCTIONS_URL/onWorkerBotMessage"
# Повторить для всех ботов
```

### 9.3. Data divergence после cutover

Если данные писались в новый проект и нужно вернуть — двусторонняя синхронизация сложна. Лучший вариант:

1. Принять потерю данных с cutover (если мало)
2. Или вручную экспортировать diff и заливать обратно

**Мораль:** cutover делать в low-traffic окно (вечер воскресенья), с подтверждением smoke-тестов, и быть готовым вернуть всё за 15 минут.

---

## 10. Cleanup (через 2 недели после successful migration)

- [ ] Удалить старый bucket `gs://profit-step-migration-backup`
- [ ] Удалить локальные дампы `./firestore-dump`, `users.json`
- [ ] Удалить старый service-account-key.json (оставить только новый)
- [ ] Архивировать старый Firebase-проект (НЕ удалять пока не убедишься в стабильности)
- [ ] Обновить docs: README, CLAUDE.md, handoffs — заменить `profit-step.web.app` → новый domain
- [ ] Удалить `profit-step` alias из `.firebaserc`, оставить только `new` как default

---

## 11. Чеклист (итоговый)

### Pre-cutover

- [ ] Новый Firebase-проект создан + Blaze план
- [ ] `.firebaserc` обновлён с alias
- [ ] `service-account-key.json` сохранён
- [ ] `.env.local` подготовлен с новыми значениями (пока в backup)
- [ ] Firestore export OK (managed или JSON)
- [ ] Storage скопирован (`gsutil cp`)
- [ ] Auth users экспортированы (`firebase auth:export`)

### Migration window

- [ ] Firestore import в новый проект OK
- [ ] Auth users imported
- [ ] Storage sizes match
- [ ] Rules + indexes deployed
- [ ] Functions deployed (113 функций)
- [ ] Hosting deployed с новыми env
- [ ] Telegram webhooks переключены (4 бота)
- [ ] Firebase Auth authorized domains обновлены
- [ ] Static HTML landings обновлены
- [ ] `/api/health` → 200 OK
- [ ] Login flow → OK
- [ ] Dashboard render → OK

### Post-cutover

- [ ] DNS cutover (если custom domain)
- [ ] 48ч мониторинг — 0 ошибок
- [ ] Data integrity spot-checks
- [ ] 2 недели shadow period
- [ ] Cleanup старых ресурсов

---

## References

- Parent plan: [`MASTER_PLAN_2026-04-19.md`](../tasks/MASTER_PLAN_2026-04-19.md) §P-1.5
- Inventory: [`HARDCODED_INVENTORY.md`](./HARDCODED_INVENTORY.md)
- Secrets: [`SECRETS.md`](./SECRETS.md)
- Topology: [`FIREBASE_TOPOLOGY.md`](./FIREBASE_TOPOLOGY.md)
- DNS plan: [`DNS_DOMAINS.md`](./DNS_DOMAINS.md) (P-1.7)
- Export script: [`scripts/migration/export-firestore-json.ts`](../../scripts/migration/export-firestore-json.ts)
- Import script: [`scripts/migration/import-firestore-json.ts`](../../scripts/migration/import-firestore-json.ts)
- [Firebase docs — export/import](https://firebase.google.com/docs/firestore/manage-data/export-import)
- [Firebase docs — auth import/export](https://firebase.google.com/docs/auth/admin/import-users)
