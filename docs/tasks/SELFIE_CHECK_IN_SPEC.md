# Task: Restore selfie check-in at shift start + harden end-of-shift photo flow

## Metadata

- **PM:** Denis (direct request)
- **Requested by:** Denis
- **Date:** 2026-04-16
- **Priority:** P1 (trust / fraud control)
- **Estimated effort:** M
- **Status:** TODO
- **Related bot:** `@gartime_bot` (worker Telegram bot, codebase handler `onWorkerBotMessage`)

## Goal

Восстановить **обязательный запрос селфи при старте смены** в боте `@gartime_bot`
(сейчас бот пропускает этот шаг после коммита `961f482` 2026-04-14) и **закрепить
текущий запрос фото при завершении смены** так, чтобы его нельзя было случайно
сломать. Цель — подтверждение физического присутствия правильного сотрудника
на объекте (против "один пришёл, двое в таймере") + фотодоказательство факта
выполнения работы.

Главная продуктовая мысль: предыдущая реализация была неудачной, потому что
пыталась навязать 8-шаговый гейт (checklist → photo → voice → description),
который все пропускали. Новая должна быть **короткой, но не обходимой без следа**.

## Context / почему так

**История вопроса:**

- 2025-12-07 коммит `4ba78b6` — впервые ввёл `startPhotoUrl` / `endPhotoUrl` +
  `awaitingStartPhoto` / `awaitingEndPhoto` в поток смен.
- 2026-04-14 коммит `961f482` — упростил старт до
  `location → confirm → active session` и удалил установку
  `awaitingStartPhoto: true`. Код-обработчик `mediaHandler.ts:131-183` при
  этом НЕ удалён — он просто никогда не триггерится, потому что флаг не
  выставляется. Коммит был сделан потому что «все пропускают, смысла нет».
- 2026-04-16 Денис пишет: «бот перестал спрашивать селфи, верни». Значит
  нужен **обратный откат + усиление**, чтобы скипы были видны и редки.

**Что уже есть и работает (не трогать, переиспользовать):**

- `functions/src/triggers/telegram/handlers/mediaHandler.ts:131-183` — полный
  обработчик «получил фото → сохранил в Storage → записал в сессию →
  асинхронно запустил face verification». Только не вызывается.
- `functions/src/triggers/telegram/handlers/mediaHandler.ts:602-654` —
  `saveTelegramFile()` хелпер. Скачивает из Telegram API, кладёт в Storage,
  отдаёт signed URL. Переиспользуемый.
- `functions/src/triggers/telegram/verifyEmployeeFace.ts` (судя по ссылке в
  mediaHandler — перепроверить точный путь) — Gemini AI сравнение
  селфи с `referenceFacePhotoUrl` из `platform_users`.
- `src/types/timeTracking.types.ts` — все поля (`startPhotoId/Url`,
  `startMediaType`, `faceMatch`, `faceConfidence`, `faceMismatchReason`) уже
  описаны в TS-типе.
- `src/components/time-tracking/TimeTrackingTable.tsx:331-356` — колонки
  «Start photo» и «End photo» в админке, с thumbnails и ссылками «открыть в
  новой вкладке». Уже работают для end photo.
- `firestore.rules:384-388` — `work_sessions` открыты на read/create/update
  для `isSignedIn()`. Никакой миграции не нужно.

**Что сломано:**

- `functions/src/triggers/telegram/handlers/locationFlow.ts:262-277` — в
  блоке создания сессии нет `awaitingStartPhoto: true`. Это единственная
  причина, почему поток селфи на старте мёртвый.

## Требования

### Функциональные — СТАРТ СМЕНЫ

1. **F-1. После подтверждения геолокации** (клик «✅ Да, начать» →
   `handleLocationConfirmStart` в `locationFlow.ts:223-296`) сессия всё так
   же создаётся (не отменяем предыдущий фикс), но дополнительно:
   - добавить `awaitingStartPhoto: true` в документ сессии
   - сразу после `sendMessage(...)` про «Смена начата» **НЕ звать**
     `sendMainMenu()` — вместо этого отправить отдельное сообщение с
     просьбой селфи:
     ```
     📸 Сделай селфи на фоне объекта — так мы подтверждаем, что ты на месте.
     Просто сфоткай себя и отправь в чат.
     ```
     Клавиатура:
     ```
     [ ❓ Нет камеры / не могу сейчас ]
     ```

2. **F-2. Когда работник присылает фото** (`mediaHandler.ts:131-183`
   обрабатывает `awaitingStartPhoto`):
   - текущая логика сохранения в Storage + запись `startPhotoUrl` +
     асинхронный `verifyEmployeeFace()` — **оставить как есть**
   - после сохранения вызвать `sendMainMenu(chatId, userId)` — теперь
     работник может жать Break / Finish Work
   - удалить следующий шаг «🎙 Запиши голосовое: что планируешь сегодня
     делать?» (старый мёртвый шаг, его тоже выключил коммит 961f482 —
     чтобы не возвращать всю 8-шаговую пыточную)

3. **F-3. Кнопка «Нет камеры / не могу сейчас»** (edge case, но обязательный):
   - записать в сессию `startPhotoSkipped: true`,
     `startPhotoSkipReason: 'worker_refused_no_camera'`,
     `startPhotoSkippedAt: Timestamp.now()`
   - снять флаг `awaitingStartPhoto: false`
   - отправить работнику: `⚠️ Ок, смена идёт. Но админ получит уведомление
     что ты не прислал подтверждение на старте.`
   - вызвать `sendAdminNotification(...)` с явным флагом в духе
     `⚠️ ${employeeName} стартовал БЕЗ селфи: ${clientName}`
   - вызвать `sendMainMenu()`

4. **F-4. Face verification failure** (сейчас уже работает, но формулировку
   усилить): если `verifyEmployeeFace()` вернул `match: false`, кроме
   текущего `⚠️ ПРЕДУПРЕЖДЕНИЕ:` работнику — отправить **синхронное**
   уведомление админу (`sendAdminNotification`) в том же стиле. Сейчас там
   только обновление полей в Firestore, админ узнаёт только если смотрит
   таблицу. Нужно активное пуш-уведомление.

### Функциональные — КОНЕЦ СМЕНЫ

5. **F-5. Текущий поток** (location → photo → voice → description →
   finalize) сохраняется как есть. Только два изменения:

6. **F-6. Переименовать промпт** на стопе: сейчас бот пишет «📸 Теперь
   отправь фото выполненной работы». Хороший текст, но добавить ясности:
   ```
   📸 Финальное фото объекта / результата работы.
   Это нужно для подтверждения выполнения — пришли 1–2 фото.
   ```
   Клавиатура остаётся `[⏩ Пропустить фото]`.

7. **F-7. Кнопка «Пропустить фото»** на финише: как и на старте — запись
   `endPhotoSkipped: true`, `endPhotoSkipReason: 'worker_skipped_on_finish'`,
   уведомление админа. СЕЙЧАС просто переходит к voice, без никакого следа
   в сессии, что фото не было — это скрытая дыра.

### Нефункциональные

- **N-1. Backward compatibility:** существующие открытые сессии (status =
  active, без `awaitingStartPhoto`) продолжают работать как сейчас — без
  селфи. Новые сессии, созданные после деплоя, получают новый флаг. Не
  backfill'им.
- **N-2. Performance:** никаких новых вызовов в цикле. Единственный
  дополнительный запрос на сессию — загрузка фото (уже оптимизировано через
  signed URL), plus один асинхронный face-verification вызов (уже есть).
- **N-3. Security/PII:** селфи живёт в Firebase Storage в bucket'е
  `work_photos/{sessionId}/start_{ts}.jpg`, signed URL с UUID токеном.
  Никаких изменений в storage.rules не требуется. Фото ВИДЯТ только
  admin/manager через таблицу (админ-панель уже под Firebase Auth).
- **N-4. Observability:** записи в `activity_logs` уже есть (`Медиа начала
  смены` / `Медиа окончания смены`). Добавить ещё два типа для skip:
  ```
  content: 'Селфи старта пропущено работником'
  content: 'Финальное фото пропущено работником'
  ```

## API / schema изменения

### Firestore — `work_sessions` коллекция

Новые поля (опциональные, все с дефолтом через отсутствие):

| Поле | Тип | Когда пишется | Смысл |
|---|---|---|---|
| `startPhotoSkipped` | boolean | в F-3 | работник сам отказался |
| `startPhotoSkipReason` | string (enum) | вместе с `startPhotoSkipped` | причина |
| `startPhotoSkippedAt` | Timestamp | вместе | когда |
| `endPhotoSkipped` | boolean | в F-7 | аналогично |
| `endPhotoSkipReason` | string | вместе | |
| `endPhotoSkippedAt` | Timestamp | вместе | |

Возможные значения `*SkipReason` (enum в коде, но в Firestore хранится как
строка):

```typescript
type PhotoSkipReason =
  | 'worker_refused_no_camera'     // F-3
  | 'worker_skipped_on_finish'     // F-7
  | 'timeout_auto_skip';           // если введём авто-скип по таймауту (см. Out of scope)
```

Поля `startPhotoUrl`, `startPhotoId`, `startMediaType`, `faceMatch`,
`faceConfidence`, `faceMismatchReason` — уже в схеме, не добавляем.

### Тип TypeScript

Обновить `src/types/timeTracking.types.ts` (WorkSession interface) —
добавить 6 опциональных полей выше.

### Firestore rules

Не трогать. Существующие правила (`isSignedIn()` на create/update) покрывают.

### Firebase Storage rules

Не трогать. Используется уже существующий путь `work_photos/{sessionId}/`.

## Admin UI изменения

**Файл:** `src/components/time-tracking/TimeTrackingTable.tsx:331-356`

Сейчас колонка «Start photo» либо показывает thumbnail с URL, либо «—».
Добавить третий вариант:

- Если `startPhotoUrl` → thumbnail (как сейчас)
- Если `startPhotoSkipped === true` → красный warning-чип
  «⚠️ Skipped (<reason>)» с tooltip'ом с `startPhotoSkippedAt`
- Иначе → «—» (старые сессии, pre-feature)

Аналогично для end photo. Логика простая, UI изменение минимальное, <30
строк в одном файле.

**Дополнительно:** в админском notifier-канале (сейчас это Telegram
`sendAdminNotification`) явные пуши на skip и face-mismatch дают Денису
возможность сразу реагировать. Это покрывается F-3 и F-4.

## Acceptance criteria

Claude Code (или Никита) считает задачу выполненной когда:

- [ ] F-1. Новая сессия после location confirm получает
      `awaitingStartPhoto: true` и бот шлёт сообщение с просьбой селфи
- [ ] F-2. После получения фото `startPhotoUrl` записан, face verification
      отрабатывает async, работник видит главное меню
- [ ] F-3. Кнопка «Нет камеры / не могу сейчас» пишет 3 `skip*` поля в
      сессию, шлёт админу пуш, даёт работнику продолжить
- [ ] F-4. При face mismatch админ получает Telegram-пуш (не только запись
      в Firestore)
- [ ] F-6. Промпт на стопе переформулирован
- [ ] F-7. Кнопка «Пропустить фото» на стопе пишет `endPhotoSkipped*` +
      пушит админа
- [ ] `tsc --noEmit` проходит для `functions/` и для корневого проекта
- [ ] `oxlint src functions/src` warning count не увеличился
- [ ] `vite build` успешен
- [ ] Новый юнит-тест на hook'и в `mediaHandler.ts` (эмулируя Telegram
      getFile → Storage upload → session update). Особенно case F-3 и F-7
      (skip paths).
- [ ] Admin UI в `TimeTrackingTable.tsx` рендерит 3-е состояние «Skipped
      (reason)» без падений
- [ ] PR против `feature/project-hierarchy-fix`
- [ ] Implementation log в
      `~/projects/pipeline/2026-04-16/nikita-selfie-check-in-log.md`

## State machine diagrams

### Новый поток СТАРТА смены

```
worker  | bot
─────────────────────────────────────────────
send location
        │
        ├─► findNearbyProject(lat, lng)
        │   store pending_starts/{userId}
        └─► "Локация определена! Объект: <name>. Это старт работы?"
            [✅ Да, начать] [🔄 Другой объект] [❌ Отмена]

click "Да, начать"
        │
        ├─► create work_sessions with:
        │     status: 'active',
        │     awaitingStartPhoto: true,    ← NEW
        │     startLocation: {lat, lng}
        │
        ├─► "✅ Смена начата! Объект: <name>, таймер пошёл."
        └─► "📸 Сделай селфи на фоне объекта..."
            [❓ Нет камеры / не могу сейчас]   ← NEW

send photo ─────────────────────────────────┐
        │                                    │
        ├─► saveTelegramFile() →             │
        │   work_photos/{sid}/start_{ts}     │
        │                                    │
        ├─► session.update({                 │
        │     startPhotoUrl,                 │
        │     startPhotoId,                  │
        │     awaitingStartPhoto: false      │
        │   })                               │
        │                                    │
        ├─► verifyEmployeeFace() async       │
        │   if mismatch → alert admin        │
        │                                    │
        └─► "✅ Фото принято. Удачной работы!"│
            sendMainMenu() ─────────────────┤
                                             │
OR click "Нет камеры" ──────────────────────┤
        │                                    │
        ├─► session.update({                 │
        │     awaitingStartPhoto: false,     │
        │     startPhotoSkipped: true,       │
        │     startPhotoSkipReason: '...',   │
        │     startPhotoSkippedAt: now       │
        │   })                               │
        │                                    │
        ├─► sendAdminNotification(           │
        │     "⚠️ <name> стартовал без селфи"│
        │   )                                │
        │                                    │
        └─► "⚠️ Ок, смена идёт без фото.    │
             Админ уведомлён."               │
            sendMainMenu() ─────────────────┤
                                             │
                                             ▼
                                      active session,
                                      menu with Break / Finish
```

### Новый поток СТОПА смены (только меняется skip branch)

```
worker  | bot
─────────────────────────────────────────────
click "⏹ Завершить смену"
        │
        ├─► session.update({awaitingEndLocation: true})
        └─► "📍 Отправь текущую геопозицию"
            [📍 Отправить локацию][⏩ Пропустить][❌ Отмена]

send location
        │
        ├─► compute distance from startLocation
        ├─► session.update({
        │     endLocation, awaitingEndLocation: false,
        │     awaitingEndPhoto: true,
        │     locationMismatch: dist > 500m
        │   })
        └─► "📸 Финальное фото объекта / результата..."  ← F-6
            [⏩ Пропустить фото]

send photo
        │
        ├─► saveTelegramFile() → work_photos/{sid}/end_{ts}
        ├─► session.update({
        │     endPhotoUrl, endPhotoId,
        │     awaitingEndPhoto: false,
        │     awaitingEndVoice: true
        │   })
        └─► "🎙 Запиши голосовое: что успел сделать?"

OR click "Пропустить фото"  ← F-7 NEW branch
        │
        ├─► session.update({
        │     awaitingEndPhoto: false,
        │     endPhotoSkipped: true,
        │     endPhotoSkipReason: 'worker_skipped_on_finish',
        │     endPhotoSkippedAt: now,
        │     awaitingEndVoice: true
        │   })
        ├─► sendAdminNotification(
        │     "⚠️ <name> финишировал без фото"
        │   )
        └─► "🎙 Ок, фото пропущено. Запиши голосовое..."

(voice → description → finalize — без изменений)
```

## Out of scope (намеренно НЕ в этом таске)

- ❌ **Автоматический таймаут** «не прислал селфи за 5 минут → автоскип».
  Хочется, но это отдельный scheduler (cron) + edge case логики. Оставить
  на следующую итерацию (`task-selfie-auto-timeout.md`).
- ❌ **Обязательность селфи** (нельзя отказаться). Мы НЕ делаем skip
  невозможным — только очень заметным. Если через неделю данные покажут
  что 80% работников жмут skip — тогда вводим требование face_verification
  pass перед активацией смены. Пока — прозрачная видимость.
- ❌ **Автоматический pause при face mismatch**. Сейчас сессия продолжает
  работать даже при mismatch — просто помечается. Для автопаузы нужны
  бизнес-правила («3 mismatch подряд → auto-pause»), это следующая итерация.
- ❌ **Перевыпуск селфи в середине смены** («random check-in»). Хочется,
  но вне этого таска.
- ❌ **Показ селфи в клиентском портале**. Нельзя — фото работников не
  должны утекать клиентам.
- ❌ **Переход на WhatsApp-бота или iOS app**. Таска чисто про Telegram-бот
  `@gartime_bot`.

## Open questions

1. **Q-1.** Нужно ли заблокировать мастер-меню (`sendMainMenu`) до прихода
   селфи? Сейчас предлагаю НЕ блокировать: если работник 2 минуты не
   присылает фото и жмёт «⏸ Перерыв» — сессия сама перейдёт в `paused` по
   текущей логике, а `awaitingStartPhoto` останется висеть. Менее
   раздражающе, чем уходить в тупик.
   → **Дефолт: не блокировать**, если Денис против — добавим в тесты
     следующим коммитом.

2. **Q-2.** Что делать если работник вместо селфи шлёт текст? Сейчас у
   бота есть text handler, который может перекрыть флаг. Нужно проверить в
   `onWorkerBotMessage.ts` — что происходит если при `awaitingStartPhoto:
   true` приходит текст. Вероятный ответ: текст отрабатывает как обычный
   command, photo-флаг висит. Проверить и, если баг, добавить guard:
   «⚠️ Сначала пришли селфи (или жми ❓ Нет камеры)».

3. **Q-3.** Видео вместо фото. Сейчас `mediaHandler.ts` принимает и
   `message.video` и `message.document`. Оставляем такое поведение
   (работник может послать видео и оно зачтётся как selfie verification?
   Или только photo?). **Решение в коде:** для F-1 (start) — принимать
   ТОЛЬКО `message.photo` (face verification не работает на видео/PDF).
   Для end photo — как сейчас, любой медиа-тип.

## Risks и mitigations

| Риск | Вероятность | Mitigation |
|---|---|---|
| Face verification Gemini API падает → все селфи получают `faceMatch: false` | Medium | Текущий код правильно ловит exception и не блокирует сессию; админ увидит warning chip, может игнорить |
| Работник быстро жмёт «Нет камеры» на каждый старт → селфи обходятся | High | F-3 шлёт ПУШ админу каждый раз. Через неделю анализ — если >30% skip, делаем следующий таск «force mode» |
| Telegram file API медленно отвечает → `saveTelegramFile` таймаут → сессия остаётся в `awaitingStartPhoto: true` | Low | Текущий код уже ловит exception; добавить кнопку «Повторить отправку» в следующей итерации |
| Storage quota / biling interaction | Low | 1 фото ~500KB × ~20 смен/день = 10MB/day. В пределах free tier $0 |
| Старые открытые сессии без `awaitingStartPhoto` застревают | None | Backward compat — отсутствие флага = старая логика |

## Test plan

**Unit tests** (`functions/test/mediaHandler.test.ts` — создать новый):

1. `handleMediaUpload` когда `awaitingStartPhoto: true` → Storage upload +
   session update + face verify trigger.
2. `handleMediaUpload` когда `awaitingEndPhoto: true` → end photo flow.
3. `handleStartPhotoSkip` новый handler → записывает 3 skip поля + шлёт
   админу.
4. `handleEndPhotoSkip` аналогично.

**Integration test** (`functions/test/workerBotShiftFlow.test.ts`):

- Полный поток: location → confirm → photo → menu. Проверить что сессия
  в финальном состоянии `active`, `startPhotoUrl` установлен,
  `awaitingStartPhoto: false`.
- Skip-поток: location → confirm → skip → menu. Проверить `startPhotoSkipped
  === true`, админ получил `sendAdminNotification` (мокнуть).

**Manual smoke test** (в Telegram после деплоя):

1. Отправить боту геолокацию → проверить что просит селфи
2. Прислать селфи → проверить админскую таблицу: thumbnail появился
3. Повторить → жать «Нет камеры» → проверить админский пуш + warning chip
4. Завершить смену без фото → проверить `endPhotoSkipped*`

## Timeline estimate

- S1 (0.5h): locationFlow.ts правка (F-1 только)
- S2 (0.5h): добавить callback handler для skip-кнопки (`location_photo_skip`
  / новый `start_photo_skip` / `end_photo_skip`) в роутер
- S3 (0.5h): F-6/F-7 тексты и skip-ветка для end photo
- S4 (1h): F-4 синхронный админский пуш на face mismatch
- S5 (0.5h): TS-типы + admin UI warning chip
- S6 (2h): unit + integration тесты
- S7 (0.5h): ручной smoke test

**Итого: ~5.5 часа**

## Files to touch (summary)

| File | Change |
|---|---|
| `functions/src/triggers/telegram/handlers/locationFlow.ts` | Line 262-277: добавить `awaitingStartPhoto: true`. Line 286-295: перегруппировать — сначала selfie prompt, потом main menu только после фото/skip |
| `functions/src/triggers/telegram/handlers/mediaHandler.ts` | Line 177-183: удалить "запиши голосовое что планируешь" (dead после 961f482), вместо этого вызвать `sendMainMenu`. Line 212-218: переформулировать под F-6 |
| `functions/src/triggers/telegram/handlers/mediaHandler.ts` (new handlers) | Добавить `handleStartPhotoSkip(chatId, userId)` и `handleEndPhotoSkip(chatId, userId)` |
| `functions/src/triggers/telegram/onWorkerBotMessage.ts` | Router: подписать callback_data на новые кнопки skip + text handler guard для `awaitingStartPhoto: true` (см. Q-2) |
| `src/types/timeTracking.types.ts` | 6 новых optional полей в `WorkSession` |
| `src/components/time-tracking/TimeTrackingTable.tsx:331-356` | 3-е состояние `Skipped(reason)` для Start/End photo колонок |
| `functions/test/mediaHandler.test.ts` | создать |
| `functions/test/workerBotShiftFlow.test.ts` | создать |

## Deployment

Hosting + Functions deploy по CLAUDE.md §5. Только Денис деплоит. Перед
деплоем:

1. `npm --prefix functions run build` — проходит
2. `firebase emulators:start` — проверить поток локально
3. `firebase deploy --only functions:onWorkerBotMessage`
4. Мониторить `firebase functions:log --only onWorkerBotMessage` первые 30
   мин на предмет ошибок в media upload / face verify.
5. Через час — проверить Firestore: появились ли сессии с новыми полями.
