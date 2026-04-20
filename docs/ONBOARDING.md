# Onboarding — новая машина или новый разработчик

> **Цель:** за ~15 минут поднять проект локально так, чтобы можно было запускать emulators, писать код и деплоить (если у тебя есть прод-доступ). Без передачи `.env` файлов через мессенджеры, без «забытых» секретов на старых ноутбуках.

---

## 1. Предустановки

Нужны один раз на машину:

```bash
# Node 20 (LTS). Проверь: node --version
brew install node@20      # mac
nvm install 20            # альтернатива

# Firebase CLI
npm install -g firebase-tools

# Google Cloud SDK (для Secret Manager + ADC)
brew install --cask google-cloud-sdk
```

---

## 2. Клонирование репо

```bash
git clone git@github.com:garkorcom/profit-step.git
cd profit-step
npm install
npm --prefix functions install
```

---

## 3. Аутентификация (без `.env` файлов)

Это ключевой шаг. Раньше секреты передавались через `.env` файлы и носились между машинами — больше так **не делаем**. Секреты живут в Google Secret Manager и доступ к ним выдаётся через IAM.

```bash
# 3.1. Авторизуйся в Firebase своим аккаунтом
firebase login

# 3.2. Авторизуй Application Default Credentials
# Это нужно чтобы Secret Manager SDK в коде мог читать значения через твой аккаунт
gcloud auth application-default login

# 3.3. Укажи активный проект
firebase use default
gcloud config set project profit-step
```

Проверка: `firebase projects:list` — должен быть `profit-step`. `gcloud secrets list` — должен показать 10+ секретов.

---

## 4. Выдача прав новому разработчику (делает Денис)

Если ты — Денис, и у тебя новый разработчик:

1. Firebase Console → Project Settings → Users and permissions → Add user
2. IAM role: `Firebase Developer` + `Secret Manager Secret Accessor`
3. Отправь разработчику этот ONBOARDING.md и его email

**Отозвать доступ:** IAM → удалить role. Все его локальные инструменты потеряют доступ к проекту, читать секреты больше не смогут. Секретные файлы на его ноутбуке — не существуют, потому что их нет.

---

## 5. Локальный dev через emulators (без прод-секретов)

```bash
# Dev-fallback .env (опционально): заглушки, свой личный бот для тестов, мок-ключи
cp functions/.env.example functions/.env
# Отредактируй functions/.env и положи туда тестовые значения.
# НИКОГДА не клади туда прод-токены — они в GSM, не нужны локально.

# Запуск
npm run emulator                     # firestore + auth + functions + hosting
npm run test                         # unit tests
npm run test:security                # firestore rules
```

Если в `functions/.env` пусто — emulators всё равно запустятся, но AI/bot функции упадут с «missing secret». Это ожидаемо для local dev без секретов.

---

## 6. Prod-деплой

Требует роли `Firebase Admin` в IAM.

```bash
npm --prefix functions run build

# Рекомендованный порядок для чувствительных функций:
firebase deploy --only functions:diagnoseBot
firebase deploy --only functions:onWorkerBotMessage

# Остальное батчами
firebase deploy --only functions
firebase deploy --only hosting
```

Подробнее про staged deploy — `CLAUDE.md §5`.

**Что НЕ нужно делать:**
- `firebase deploy --only functions` сразу после клонирования, не потестив в emulators
- Деплоить в часы пик — бригадиры используют бота с 7:00 AM EST

---

## 7. Ротация секретов

Когда токен бота или AI-ключ скомпрометирован или пришла пора ротации:

```bash
# Интерактивно
./scripts/setup-secrets.sh            # прочитает functions/.env, обновит что надо

# Одной командой (для одного секрета)
echo "NEW_VALUE" | firebase functions:secrets:set WORKER_BOT_TOKEN --data-file=-

# После ротации — редеплой затронутых функций
firebase deploy --only functions:onWorkerBotMessage,functions:diagnoseBot,functions:scheduledDayPlan
```

Cloud Functions подтянут новое значение при следующем холодном старте. Если нужно сразу — редеплой гарантирует рестарт.

В будущем (Phase 6 плана) — это будет через admin UI на `/admin/secrets`.

---

## 8. Переезд на другую машину (твою же)

```bash
# Старая машина
# 1. Убедись что у тебя нет uncommitted .env с прод-значениями
git status
# 2. Удали копии секретов с диска (если делал bootstrap из раздаточки)
rm -f functions/.env.backup

# Новая машина
git clone ...
# Делай всё из §1-3 выше. firebase login + gcloud adc login.
# .env копировать НЕ надо — прод-секреты не нужны для dev.
```

Смена ноутбука = просто `git clone` + `firebase login` + `gcloud auth application-default login`. 0 копирования `.env` файлов.

---

## 9. Troubleshooting

### «Missing WORKER_BOT_TOKEN» в production логах

1. Проверь что секрет есть: `gcloud secrets list | grep WORKER_BOT_TOKEN`
2. Проверь что функция объявила binding: посмотри в коде `{ secrets: [WORKER_BOT_TOKEN] }` или `.runWith({ secrets: ... })`
3. Редеплой функции: `firebase deploy --only functions:<name>`

### `.value() is not a function` в тестах

`defineSecret` недоступен в Jest по умолчанию. В юнит-тестах мокай `functions/src/config`:

```ts
jest.mock('../../config', () => ({
  WORKER_BOT_TOKEN: { value: () => 'test-token' },
  // ...
}));
```

### `Permission denied on secret projects/.../secrets/X/versions/latest`

IAM role не настроена. Попроси Дениса добавить `Secret Manager Secret Accessor` на твой аккаунт.

---

## 10. Куда смотреть дальше

- `CLAUDE.md` — общие правила для проекта
- `docs/migration/SECRETS.md` — полный каталог секретов с их назначением
- `functions/src/config/secrets.ts` — декларация всех `defineSecret()` + per-function группы
- `functions/src/config/env.ts` — non-secret environment
