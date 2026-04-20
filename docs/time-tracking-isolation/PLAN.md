# Time Tracking — site ↔ bot autonomy plan

**Draft 2026-04-19** · Claude Opus 4.7 · Scope: архитектурный план изоляции времени, чтобы сайт и бот работали независимо, а сайт был источником правды.

## Цель (формулировка Дениса)

- **Сайт работает автономно.** Если бот завис, упал, заблокирован телеграмом — админ и сотрудники всё равно могут работать через веб.
- **Бот работает автономно (как клиент).** Если сайт фронтенд пересобирается/деплоится/сломан — бот всё равно принимает смены.
- **Сайт главный.** Вся бизнес-логика (валидация геофенса, 48h finalize, начисление, антилуп) живёт на стороне сайта (backend/functions). Бот — тонкий chat-клиент, который дергает API.
- **Запуск смены возможен с обоих.** Сайт и бот — равноправные входы, но **обрабатываются одной и той же функцией** (никаких двух разных `startSession` c разной логикой).

## Текущее состояние (факт)

Проверено: `functions/src/triggers/telegram/handlers/sessionManager.ts` + `src/pages/crm/TimeTrackingPage.tsx` + FinancePage.

```
┌──────────────────┐                    ┌──────────────────┐
│    Web (site)    │                    │  Telegram bot    │
│  TimeTracking UI │                    │  sessionManager  │
│  FinancePage     │                    │  onWorkerBot...  │
└────────┬─────────┘                    └────────┬─────────┘
         │ пишет напрямую                         │ пишет напрямую
         │ work_sessions                          │ work_sessions
         ▼                                        ▼
      ┌────────────────────────────────────────────┐
      │     Firestore: work_sessions collection   │
      └────────────────────────────────────────────┘
         ▲ триггеры                                ▲ триггеры
         │ onWorkSessionCreate                     │ incrementLoginCount
         │ onWorkSessionUpdate                     │ trackUserActivation
         │ ...                                     │ ...
         └────────────────────────────────────────┘
```

**Проблемы сегодня:**

- **Бизнес-логика дублирована.** Формула начислений, идемпотентность, геофенс, 48h finalize — реализованы и на сайте, и в боте с дрифтом (см. safety matrix #23/32/33: bot баланс для Алексея ≠ UI).
- **Валидация дублирована.** Бот валидирует одно, сайт — другое. Можно написать сессию с `durationMinutes: 0` через UI, которая в боте была бы отклонена.
- **Нет чёткого API.** Если завтра сделают iOS-клиент, он будет писать напрямую в Firestore со своим набором багов.
- **Timezone drift.** Бот считает "сегодня" в America/NY, сайт — в браузерной tz. Один и тот же Алексей видит разные числа.
- **Auto-close / finalize** работает через cron на функциях → если cron упал, сайт покажет pending-сессии вечно.

**Что работает хорошо (оставляем):**

- Firestore как единое хранилище — сайт и бот оба читают один и тот же `work_sessions`. Это правильно.
- Бот и сайт физически развязаны (разные процессы, разные deploy units).
- Типы `WorkSession` вынесены (compile-time contract).

## Целевая архитектура

```
            ┌────────────────────────────────────────────────┐
            │   Time Tracking API (canonical backend)         │
            │   functions/src/modules/timeTracking/           │
            │                                                 │
            │   HTTPS callable / REST:                        │
            │   - startSession({userId, clientId, start...})  │
            │   - endSession({sessionId, end...})             │
            │   - pauseSession / resumeSession                │
            │   - getMyActiveSession                          │
            │   - getMyBalance({range})                       │
            │   - adjustSession (admin)                       │
            │                                                 │
            │   Zod schemas на все inputs                     │
            │   ЕДИНСТВЕННОЕ место, где пишется work_sessions │
            │   Firestore rules: writes блокируются с клиента │
            └───────────┬────────────────────────┬───────────┘
                        │                        │
                    HTTPS                     HTTPS
                        ▲                        ▲
            ┌───────────┴──────────┐  ┌─────────┴──────────┐
            │      Web (site)      │  │  Telegram bot      │
            │  tnt thin client:    │  │  thin chat layer:  │
            │  crmApi.time.start() │  │  - parse message   │
            │  React UI            │  │  - format reply    │
            │                      │  │  - call API        │
            └──────────────────────┘  └────────────────────┘
                        │                        │
                        └──────┬─────────────────┘
                        читают те же Firestore данные
                          work_sessions + users
                         (чтение разрешено обоим)
```

**Свойства архитектуры:**

- **Single source of truth** — API. Одна функция `startSession` в одном месте.
- **Бот = view + input.** Парсит текст/голос, делает callable, форматирует ответ. Никакой бизнес-логики.
- **Сайт = view + admin.** React UI делает те же callable, что и бот.
- **Firestore writes locked** — rules запрещают прямой write в `work_sessions` с клиента; только через callable.
- **Failure domains independent:**
  - Site frontend down → bot работает (callable через functions).
  - Bot down → site работает (callable через functions).
  - Functions down → оба падают (это и есть общий failure, как задумано).

## План миграции (8 шагов, ~2-3 недели, zero-downtime)

Каждый шаг — отдельный PR, reviewable independently. Behavior-preserving на каждом этапе.

### Шаг 1. Module shell + contracts (no behavior change)

Как в Finance:
- `functions/src/modules/timeTracking/` folder
- `api/schemas.ts` — zod схемы для всех inputs (StartSessionInput, EndSessionInput, …)
- `api/types.ts` — outputs
- `index.ts` — barrel, `no-restricted-imports` rule для functions/src
- Empty shells для 6-8 callable handlers

**Риск:** zero. Только файлы, ничего не подключено.

### Шаг 2. Define `startSession` handler (canonical)

- Вытащить текущую логику startSession из `sessionManager.ts`:
  - валидация пользователя (active, has rate)
  - геофенс check (radius check)
  - startPhoto handling (optional, может быть skipped)
  - создание doc в work_sessions
  - возврат sessionId + greeting text
- Zod на input, structured error codes на output
- Unit tests (mock Firestore)

**Риск:** zero, пока никто не вызывает.

### Шаг 3. Bot → API (single call site)

- `sessionManager.ts` перестаёт писать в Firestore напрямую
- Вызывает `startSession(...)` из `modules/timeTracking/api`
- Всё остальное в боте (inline keyboards, message formatting, state machine) остаётся
- **Боту всё ещё можно дергать API изнутри functions (direct call, не HTTPS).** Это внутренняя зависимость, не сетевая — но через типизированный интерфейс.

**Риск:** средний. Нужен тщательный тест — локально на эмуляторе + ручной smoke через @tg-bot-dev.

### Шаг 4. Web → API

- `src/pages/crm/TimeTrackingPage.tsx` + все admin-действия: "Стартовать смену за воркера", "Остановить", "Скорректировать"
- Новый клиентский API в `src/api/timeTrackingApi.ts` — thin wrapper над `functions.httpsCallable('startSession')`
- `FinancePage.tsx` "Add Payment" / "Add Adjustment" — callable вместо `addDoc`

**Риск:** средний. Admin workflow тестируется вручную на preview channel.

### Шаг 5. Repeat 2→3→4 для остальных handlers

По одному handler за PR:
- endSession + auto-close
- pauseSession / resumeSession
- adjustSession
- voidSession
- recordPayment

Каждый PR — 1 handler, 1 bot-callsite, 1 web-callsite, ~200-400 строк diff.

### Шаг 6. Firestore rules lockdown

После того как ВСЕ write-пути идут через callable:
```
match /work_sessions/{sessionId} {
  allow read: if request.auth != null && <companyId check>;
  allow write: if false; // writes go through callable only
}
```

**Риск:** высокий если где-то пропущен client write. Защита: запустить правила в `rules-unit-testing` + emulator test, который пытается писать и падает.

### Шаг 7. Telemetry + chaos tests

- Structured logging на API (userId, source: 'web'|'bot', result)
- Dashboard: bot calls vs web calls per minute
- Chaos drill: убить бота, проверить что site работает (уже должно работать — проверка).
- Chaos drill: положить functions, проверить что UX корректно деградирует (error toast, retry).

### Шаг 8. Delete old paths

- Удалить direct Firestore write-пути в `sessionManager.ts`, `onWorkerBotMessage.ts`, `TimeTrackingPage.tsx`
- Удалить legacy handlers
- Bot reduces to ~500 строк (сейчас ~2000+ только `sessionManager.ts`)

## Критерии успеха

После шага 8:
- [ ] grep `collection(db, 'work_sessions')` в write-контексте вне `functions/src/modules/timeTracking/api/` → 0 совпадений
- [ ] Сайт запускает/останавливает смену, бот полностью оффлайн 2 часа → данные консистентны
- [ ] Бот запускает/останавливает смену, web frontend deploy идёт 5 минут → бот не замечает
- [ ] Цифры баланса в боте и в UI совпадают с точностью до копейки (safety matrix #23/32/33)

## Риски и митигации

| Риск | Митигация |
|---|---|
| Передеплой functions на каждом шаге | Деплоить в непиковое время, rollback за 2 мин через `firebase hosting:rollback` + `firebase functions:delete <name>` + redeploy previous |
| Bot/site одновременно на старой и новой версии → данные расползаются | Backward-compat: новый API пишет в тот же doc shape. Старый путь читает новые doc'и как валидные. |
| Firestore rules блокируют админский скрипт | Admin скрипты идут через admin SDK (bypasses rules by design) |
| Loss of session state в боте при перезапуске | Уже решено в sessionManager (state в Firestore, не в памяти) |
| Cron auto-close полагается на старую модель | Cron вызывает тот же `endSession(auto: true)` |

## Что НЕ входит в этот план

- Переписать Telegram бота на новый framework. Оставляем `node-telegram-bot-api`, меняем только payload logic.
- Отдельный сервис вне Firebase. Остаёмся в Cloud Functions — они уже разделены per-handler, отдельный deploy unit на handler.
- Миграция данных в work_sessions. Формат documents не меняется.

## Зависимости и последовательность с другим работами

Порядок рекомендуется:
1. **Сначала дофиксить Telegram bot balance mismatch** (safety matrix #23/32/33) — быстрый win, доказывает что унификация формулы работает на одной функции.
2. **Anti-loop self-update guard fix** (ready code от предыдущего PR) — перед Шагом 6, потому что Firestore rules lockdown требует доверия к триггерам.
3. **Security PR B** (RLS на `work_sessions`) — сам по себе Шаг 6 этого плана, но его можно сделать БЕЗ полного API migration, если успеть заранее.
4. **Split FinancePage UI** — не блокирует, но облегчает Шаг 4 (меньше callsites в одном файле).

## Оценка усилий

- Шаг 1-2: 1 день
- Шаг 3 (bot → API): 2-3 дня + тестирование
- Шаг 4 (web → API): 1-2 дня
- Шаг 5 (остальные handlers): 5-7 дней, по одному per PR
- Шаг 6 (rules): 0.5 дня + тесты
- Шаг 7 (telemetry): 1-2 дня
- Шаг 8 (cleanup): 0.5 дня

**Итого: 2-3 недели** одним разработчиком, по шагу за PR.

## Первый конкретный PR (если сегодня начинать)

Название: `refactor(timeTracking): module shell + contracts`

Содержимое:
- `functions/src/modules/timeTracking/` папка
- `api/schemas.ts` — zod: StartSessionInput, EndSessionInput, PauseSessionInput, etc.
- `api/types.ts` — Output types
- `api/errors.ts` — structured error codes: USER_NOT_FOUND, GEOFENCE_VIOLATION, NO_ACTIVE_SESSION, DUPLICATE_START, etc.
- `index.ts` — barrel
- ESLint boundary rule (`no-restricted-imports` для `work_sessions` collection reach outside module)
- `docs/time-tracking-isolation/PLAN.md` — этот документ

**Как у Finance PR #48:** чисто структурный, zero behavior change, foundation for следующих шагов.
