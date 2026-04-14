# Telegram Bot Fix — Detailed Plan + 50 Use Cases

**Date:** 2026-04-14
**Author:** Claude (by Denis's request)
**Status:** PLAN (review needed)
**Files:** `onWorkerBotMessage.ts`, `onWorkSessionUpdate.ts`, `telegramUtils.ts`

---

## Текущее состояние (State Machine)

### START flow:
```
📍 Location → pending_starts → Confirm
  → CREATE session (status: active, awaitingChecklist: true)
  → Checklist (3 вопроса)
  → awaitingStartPhoto: true → Photo (face verify async)
  → awaitingStartVoice: true → Voice (Gemini transcribe)
  → SESSION ACTIVE → Main Menu
```

### END flow:
```
⏹ Завершить → awaitingEndLocation: true → Location (anti-fraud)
  → awaitingEndPhoto: true → Photo
  → awaitingEndVoice: true → Voice (Gemini transcribe)
  → awaitingDescription: true → Text (optional)
  → finalizeSession() → status: completed → Main Menu
```

### BREAK flow:
```
⏸ Перерыв → status: paused, lastBreakStart
▶️ Продолжить → break record, totalBreakMinutes++, status: active
```

---

## Обнаруженные баги (7 штук)

### BUG-1: `📝 SKIP` отображается в summary при завершении
**Файл:** `onWorkerBotMessage.ts:1515`
**Причина:** `finalizeSession(chatId, userId, activeSession, "SKIP")` — литерал "SKIP" записывается в `description` и показывается в сообщении юзеру.
**Строка вывода:** 2041 — `📝 ${description}` показывает "SKIP".
**Fix:** Заменить `"SKIP"` на `"Описание не указано"` в `handleSkipMedia`. В `finalizeSession` сообщение: если description === "Описание не указано" — не показывать в summary.

### BUG-2: Ghost message "Ты сейчас не на смене" после завершения
**Файл:** `onWorkerBotMessage.ts:2050`, `telegramUtils.ts:228`
**Причина:** `sendMainMenu()` вызывается после `finalizeSession()`. Внутри `sendMainMenu` → `getActiveSession(userId)` → сессия уже `completed` → return null → `buildStatusAndKeyboard(null, ...)` → "Ты сейчас не на смене".
**Проблема:** UX — пользователь видит "Смена завершена!" и сразу "Ты не на смене". Второе сообщение — лишнее шум, путает.
**Fix:** После `finalizeSession` НЕ вызывать `sendMainMenu`. Вместо этого — отправить keyboard напрямую (без status text). Или: добавить параметр `skipStatusMessage` в `sendMainMenu`.

### BUG-3: Двойные "No active session" при быстром двойном нажатии
**Файл:** `onWorkerBotMessage.ts:1477-1481`
**Причина:** Юзер нажимает "Пропустить" дважды быстро. Первый skip → `finalizeSession` завершает сессию. Второй skip → `getActiveSession` → null → "No active session".
**Причина #2:** `processed_messages` idempotency guard (строка 123-137) работает по `message_id` — но кнопки Telegram генерируют НОВЫЕ message_id для каждого нажатия.
**Fix:** В `handleSkipMedia` — если `!activeSession`, не слать ошибку, а молча игнорировать (или слать мягкое "✅ Готово").

### BUG-4: Дубль "Рабочая смена завершена (Web CRM)" от Firestore trigger
**Файл:** `onWorkSessionUpdate.ts:66-78`, `onWorkerBotMessage.ts:1932-1940`
**Причина:** `finalizeSession()` обновляет status → `completed`, но НЕ ставит `updatedBySource: 'telegram_bot'`. Триггер `onWorkSessionUpdate` проверяет `after.updatedBySource === 'telegram_bot'` — не находит → думает что это Web CRM → шлёт дубликат уведомления.
**Fix:** Добавить `updatedBySource: 'telegram_bot'` в `updateData` внутри `finalizeSession()`.

### BUG-5: Emergency reset (/start) не сбрасывает `awaitingEndLocation`
**Файл:** `onWorkerBotMessage.ts:190-191`
**Причина:** В if-условии и в update payload отсутствует `awaitingEndLocation`. Если юзер нажал "Завершить" → бот ждёт локацию → юзер нажимает /start → stuck.
**Fix:** Добавить `awaitingEndLocation` в проверку и в reset payload.

### BUG-6: Баланс в боте считается из коллекции `payments`, а не `work_sessions`
**Файл:** `onWorkerBotMessage.ts:2027-2032`
**Причина:** Бот запрашивает `payments` коллекцию для расчёта выплат. Но в CRM выплаты записываются в `work_sessions` с `type: 'payment'`. Если `payments` коллекция пустая → `totalPayments = 0` → баланс неправильный.
**Реальность:** На скриншоте Dennys показывает "выплачено $0.00" — значит `payments` коллекция пуста, а реальные выплаты в `work_sessions`.
**Fix:** Считать paid из `work_sessions` WHERE `type = 'payment'` (совпадает с API summary).

### BUG-7: `new Date().getHours()` в UTC вместо ET
**Файл:** `onWorkerBotMessage.ts:2039`, `telegramUtils.ts:221`
**Причина:** Cloud Functions запущены в UTC. `new Date().getHours()` вернёт UTC час. В 7AM по Tampa (EDT) → `getHours() = 11` (UTC). Приветствие будет "Привет" вместо "Доброе утро".
**Impact:** Низкий (cosmetric), но легко починить.
**Fix:** Использовать `date-fns-tz` для конвертации в `America/New_York`.

---

## 50 Use Cases

### START FLOW (UC 1–18)

| # | Use Case | Ожидаемый результат | Текущий баг? |
|---|----------|-------------------|-------------|
| UC-1 | **Happy path**: локация → confirm → чеклист Да×3 → фото → голосовое → active | Сессия создана, все данные заполнены, main menu "ты на объекте X" | ✅ OK |
| UC-2 | Локация → confirm → чеклист → **skip фото** → **skip голос** → active | Сессия с `skippedStartPhoto: true`, `skippedStartVoice: true` | ✅ OK |
| UC-3 | Локация → **нет match** → выбрать клиента из списка → чеклист → фото → голос | Сессия с выбранным клиентом | ✅ OK |
| UC-4 | Локация → confirm → **двойной клик** "Да, начать" | Второй клик: "У тебя уже есть активная смена" (guard строка 1115) | ✅ OK |
| UC-5 | Локация отправлена, **ждём >30 мин**, потом confirm | "Данные устарели (>30 мин)" (TTL guard строка 1107) | ✅ OK |
| UC-6 | Локация → confirm → **ставка $0** | Предупреждение "Ставка не установлена" (строка 1158) | ✅ OK |
| UC-7 | Локация → confirm при **уже активной сессии** | "У тебя уже есть активная смена" (строка 1116) | ✅ OK |
| UC-8 | Отправка **live location** (трансляция) | Игнорируется (guard строка 890-895) | ✅ OK |
| UC-9 | Чеклист → Да/Да/Да → переход к фото | `awaitingStartPhoto: true`, запрос фото | ✅ OK |
| UC-10 | Чеклист → **Нет** на любой вопрос → следующий | Ответ записывается, flow не блокируется | ✅ OK |
| UC-11 | Чеклист → **двойной клик** на ту же кнопку | Игнорируется (step mismatch guard строка 681) | ✅ OK |
| UC-12 | Start фото → отправка фотографии → face match OK | Фото сохранено, `awaitingStartVoice: true` | ✅ OK |
| UC-13 | Start фото → **face mismatch** | Сессия продолжается, `faceMatch: false`, admin уведомлен | ✅ OK |
| UC-14 | Start фото → отправка **видео** вместо фото | Принимается, сохраняется как mp4 | ✅ OK |
| UC-15 | Start фото → отправка **.exe файла** | "Этот тип файла не поддерживается" (строка 1571) | ✅ OK |
| UC-16 | Start фото → **skip** → голос | `skippedStartPhoto: true`, переход к voice | ✅ OK |
| UC-17 | Start голос → запись голоса → Gemini транскрибирует | `plannedTaskSummary` заполнен, сессия active | ✅ OK |
| UC-18 | Start голос → **skip** → active | `skippedStartVoice: true`, сессия active, main menu | ✅ OK |

### END FLOW (UC 19–36)

| # | Use Case | Ожидаемый результат | Текущий баг? |
|---|----------|-------------------|-------------|
| UC-19 | **Happy path**: finish → локация → фото → голос → текст → finalize | Сессия completed, все данные, summary, balance | ✅ OK |
| UC-20 | Finish → **skip локация** → фото → skip → голос → skip → finalize | Сессия с `skippedEndLocation`, `skippedEndPhoto`, description="SKIP" | ⚠️ **BUG-1**: "SKIP" в summary |
| UC-21 | Finish → skip всё быстро → **двойное нажатие "Пропустить"** | Первый skip → finalize, второй → ? | ❌ **BUG-3**: "No active session" ×2 |
| UC-22 | Finish → локация **>500м** от старта | `locationMismatch: true`, `needsAdjustment: true` | ✅ OK |
| UC-23 | Finish → end голос с **проблемами** ("сломалась труба") | Admin уведомлён, `issuesReported` записан | ✅ OK |
| UC-24 | Finish → **cron уже закрыл** сессию | "Смена была автоматически закрыта" (transaction guard строка 2007) | ✅ OK |
| UC-25 | Finish **во время паузы** (не resume, сразу finish) | `endTime = lastBreakStart` (работа до перерыва), перерыв не засчитан | ✅ OK |
| UC-26 | Finish → summary показывает **description** | Если skip → "📝 SKIP" | ❌ **BUG-1** |
| UC-27 | Finish → **"Рабочая смена завершена (Web CRM)"** дубль | Приходит дубль от `onWorkSessionUpdate` trigger | ❌ **BUG-4** |
| UC-28 | Finish → **main menu** показывает "Ты не на смене" | Ghost message сразу после "Смена завершена!" | ❌ **BUG-2** |
| UC-29 | Finish → голос с **task updates** (прогресс 80%) | `gtd_tasks` обновлены, `progressPercentage: 80` | ✅ OK |
| UC-30 | Finish → текстовое описание вместо голоса | `description` = введённый текст | ✅ OK |
| UC-31 | Finish → **hourlyRate = 0** | `needsAdjustment: true`, `rateWarning` | ✅ OK |
| UC-32 | Finish → **daily totals** расчёт | "За сегодня: Xч Yмин ($Z)" | ✅ OK |
| UC-33 | Finish → **balance** показывает "$0 выплачено" | Если все выплаты в `work_sessions` type='payment', а бот ищет в `payments` | ❌ **BUG-6** |
| UC-34 | Finish → приветствие **"Доброе утро"** в 3PM по Tampa | UTC offset → неправильное время суток | ⚠️ **BUG-7** (cosmetic) |
| UC-35 | **Late finish** (⚠️ Finish Late) → ввод причины | `needsAdjustment: true`, `awaitingDescription: true` | ✅ OK |
| UC-36 | Finish → сессия **>12 часов** | "Смена длится уже Xч! Забыли завершить?" (строка 284) | ✅ OK |

### BREAK FLOW (UC 37–43)

| # | Use Case | Ожидаемый результат | Текущий баг? |
|---|----------|-------------------|-------------|
| UC-37 | Pause → Resume через **15 мин** | Break record: 15 мин, `status: active` | ✅ OK |
| UC-38 | Pause → Resume через **2 часа** | Capped to 60 мин, `autoAdjusted: true`, admin flag | ✅ OK |
| UC-39 | Pause → **Finish** (без resume) | `endTime = lastBreakStart`, перерыв до конца не засчитан | ✅ OK |
| UC-40 | Pause → Resume → **cross-lookup** (Telegram ID ↔ Firebase UID) | `getActiveSession()` с cross-lookup находит сессию | ✅ OK (пофикшено ранее) |
| UC-41 | **Двойной клик** "Перерыв" | Первый → paused, второй → `getActiveSession()` вернёт paused сессию → повторный update `lastBreakStart` (⚠️ перезапишет старый breakStart) | ⚠️ Minor: перезапись breakStart |
| UC-42 | Resume **без активной** paused сессии | "Нет смены на паузе" | ✅ OK |
| UC-43 | Pause → **больше 12ч** → cron auto-close? | Зависит от конфигурации cron. `finalizeExpiredSessions` может закрыть | ✅ OK (handled by cron) |

### EDGE CASES (UC 44–50)

| # | Use Case | Ожидаемый результат | Текущий баг? |
|---|----------|-------------------|-------------|
| UC-44 | **/start** во время любого awaiting state | Emergency reset: все flags = false, возврат к main menu | ❌ **BUG-5**: `awaitingEndLocation` не сбрасывается |
| UC-45 | Фото отправлено **без активной сессии** | "No active session to attach media to" | ✅ OK |
| UC-46 | **Альбом фото** (5 штук разом) | Только первое обработано, остальные → `media_group_id` skip | ✅ OK |
| UC-47 | **Cancel** во время end flow | Revert: `awaitingEnd*: false`, возврат к active session | ✅ OK |
| UC-48 | Mid-shift **голосовое** без intent close | Создаёт inbox note, не закрывает сессию | ✅ OK |
| UC-49 | Mid-shift **фото** | Добавляется в `photoUrls[]`, лог активности | ✅ OK |
| UC-50 | **Незарегистрированный** юзер пишет боту | "Access Denied. Please enter password" | ✅ OK |

---

## Сводка багов по use cases

| Баг | Use Cases | Severity | Effort |
|-----|-----------|----------|--------|
| **BUG-1**: "SKIP" в summary | UC-20, UC-26 | Medium | S (5 мин) |
| **BUG-2**: Ghost "не на смене" | UC-28 | Medium | S (10 мин) |
| **BUG-3**: Двойное "No active session" | UC-21 | Low | S (5 мин) |
| **BUG-4**: Дубль от trigger | UC-27 | High | S (5 мин) |
| **BUG-5**: Emergency reset incomplete | UC-44 | Medium | S (5 мин) |
| **BUG-6**: Balance из wrong collection | UC-33 | High | M (20 мин) |
| **BUG-7**: UTC time greeting | UC-34 | Low | S (5 мин) |

**Total effort: ~1 час кодирования + тест + deploy**

---

## План фиксов (порядок)

### Fix 1: BUG-4 — Дубль от trigger (HIGH, 5 мин)
**Файл:** `onWorkerBotMessage.ts` строка ~1932
**Что:** Добавить `updatedBySource: 'telegram_bot'` в `updateData` объект в `finalizeSession()`.
```typescript
const updateData: any = {
    description: safeDescription,
    endTime: endTime,
    durationMinutes: totalMinutes,
    sessionEarnings: 0,
    status: 'completed',
    updatedBySource: 'telegram_bot',  // ← ADD THIS
    awaitingDescription: false,
    totalBreakMinutes: totalDeductibleBreak
};
```
**Проверка:** UC-27 — после fix дубль "Web CRM" не приходит.

### Fix 2: BUG-1 — "SKIP" в summary (MEDIUM, 5 мин)
**Файл:** `onWorkerBotMessage.ts` строки 1515, 1519
**Что:** Заменить `"SKIP"` → `"Описание не указано"`.
```typescript
// Line 1515:
await finalizeSession(chatId, userId, activeSession, "Описание не указано");
// Line 1519:
await finalizeSession(chatId, userId, activeSession, "Описание не указано");
```
**Плюс:** В `finalizeSession` (строка 2041) — не показывать описание если оно "Описание не указано":
```typescript
const descDisplay = safeDescription === 'Описание не указано' ? '' : `\n📝 ${safeDescription}`;
```
**Проверка:** UC-20, UC-26 — "SKIP" больше не видно.

### Fix 3: BUG-2 — Ghost "не на смене" (MEDIUM, 10 мин)
**Файл:** `onWorkerBotMessage.ts` строка 2050
**Что:** Не вызывать `sendMainMenu()` после `finalizeSession()`. Вместо этого — отправить ТОЛЬКО keyboard (без status сообщения).
```typescript
// BEFORE (line 2050):
await sendMainMenu(chatId, userId);

// AFTER:
await sendMessage(chatId, "👇 Что дальше?", {
    keyboard: [
        [{ text: '▶️ Начать смену' }],
        [{ text: '📊 Мой статус' }, { text: '❓ Помощь' }],
        [{ text: '🛒 Shopping' }, { text: '📥 Inbox' }],
        [{ text: '📋 Tasks' }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
});
```
**Проверка:** UC-28 — нет "Ты не на смене" после "Смена завершена!".

### Fix 4: BUG-3 — Двойное "No active session" (LOW, 5 мин)
**Файл:** `onWorkerBotMessage.ts` строка 1479-1482
**Что:** Молча игнорировать если нет активной сессии (юзер уже закрыл).
```typescript
async function handleSkipMedia(chatId: number, userId: number) {
    const activeSession = await getActiveSession(userId);
    if (!activeSession) {
        // Session already finalized (double-tap) — silently ignore
        return;
    }
    ...
```
**Проверка:** UC-21 — нет спама "No active session".

### Fix 5: BUG-5 — Emergency reset incomplete (MEDIUM, 5 мин)
**Файл:** `onWorkerBotMessage.ts` строки 190-203
**Что:** Добавить `awaitingEndLocation` в проверку и reset.
```typescript
// Line 190-191: add awaitingEndLocation to condition
if (data.awaitingLocation || data.awaitingChecklist || data.awaitingStartPhoto || data.awaitingStartVoice
    || data.awaitingEndLocation || data.awaitingEndPhoto || data.awaitingEndVoice || data.awaitingDescription) {

// Line 193-203: add awaitingEndLocation to reset
await activeSession.ref.update({
    awaitingLocation: false,
    awaitingChecklist: false,
    awaitingStartPhoto: false,
    awaitingStartVoice: false,
    awaitingEndLocation: false,  // ← ADD THIS
    awaitingEndPhoto: false,
    awaitingEndVoice: false,
    awaitingDescription: false,
    skippedStartPhoto: data.awaitingStartPhoto || false,
    skippedEndPhoto: data.awaitingEndPhoto || false,
});
```
**Проверка:** UC-44 — /start сбрасывает awaitingEndLocation.

### Fix 6: BUG-6 — Balance из wrong collection (HIGH, 20 мин)
**Файл:** `onWorkerBotMessage.ts` строки 2016-2036
**Что:** Заменить запрос к `payments` на запрос к `work_sessions` WHERE `type = 'payment'`.
```typescript
// BEFORE (line 2027-2030):
const paymentsSnap = await admin.firestore().collection('payments')
    .where('employeeId', '==', String(userId))
    .get();
const totalPayments = paymentsSnap.docs.reduce((sum, d) => sum + Math.abs(d.data().amount || 0), 0);

// AFTER: check both collections (work_sessions payments + legacy payments)
const [wsPaymentsSnap, legacyPaymentsSnap] = await Promise.all([
    admin.firestore().collection('work_sessions')
        .where('employeeId', '==', userId)
        .where('type', '==', 'payment')
        .get(),
    admin.firestore().collection('payments')
        .where('employeeId', '==', String(userId))
        .get()
]);
const wsPayments = wsPaymentsSnap.docs.reduce((sum, d) =>
    sum + Math.abs(d.data().sessionEarnings || 0), 0);
const legacyPayments = legacyPaymentsSnap.docs.reduce((sum, d) =>
    sum + Math.abs(d.data().amount || 0), 0);
const totalPayments = wsPayments + legacyPayments;
```
**Плюс:** Earned должен фильтровать `type` NOT IN `['payment', 'manual_adjustment']`:
```typescript
const sessionsSnap = await admin.firestore().collection('work_sessions')
    .where('employeeId', '==', userId)
    .where('status', '==', 'completed')
    .where('startTime', '>=', Timestamp.fromDate(yearStart))
    .get();
// Filter earned: only regular + correction
const totalEarned = sessionsSnap.docs
    .filter(d => !d.data().type || d.data().type === 'regular' || d.data().type === 'correction')
    .reduce((sum, d) => sum + (d.data().sessionEarnings || 0), 0);
```
**Проверка:** UC-33 — баланс совпадает с CRM Finance page.

### Fix 7: BUG-7 — UTC greeting (LOW, 5 мин)
**Файл:** `onWorkerBotMessage.ts` строка 2039, `telegramUtils.ts` строка 221
**Что:** Использовать `toZonedTime` для получения локального часа.
```typescript
import { toZonedTime } from 'date-fns-tz';
const TZ = 'America/New_York';
const localNow = toZonedTime(new Date(), TZ);
const hour = localNow.getHours();
```
**Проверка:** UC-34 — в 7AM Tampa → "Доброе утро", а не "Привет".

---

## Порядок имплементации

| Step | Fix | Баг | Строки кода | Время |
|------|-----|-----|------------|-------|
| 1 | Fix 1 | BUG-4 (дубль trigger) | 1 строка | 2 мин |
| 2 | Fix 2 | BUG-1 ("SKIP") | 4 строки | 5 мин |
| 3 | Fix 3 | BUG-2 (ghost message) | 10 строк | 10 мин |
| 4 | Fix 4 | BUG-3 (double tap) | 3 строки | 3 мин |
| 5 | Fix 5 | BUG-5 (emergency reset) | 2 строки | 2 мин |
| 6 | Fix 6 | BUG-6 (balance) | 15 строк | 15 мин |
| 7 | Fix 7 | BUG-7 (UTC greeting) | 4 строки | 5 мин |
| 8 | Build | `npm --prefix functions run build` | — | 2 мин |
| 9 | Test | Прогнать UC 20,21,26,27,28,33,34,44 | — | 10 мин |
| 10 | Deploy | `firebase deploy --only functions:onWorkerBotMessage,functions:onWorkSessionUpdate` | — | 5 мин |

**Total: ~1 час**

---

## Матрица покрытия: UC → Bug → Fix

| UC | Описание | Bug | Fix | Verified |
|----|----------|-----|-----|----------|
| UC-1 | Happy path start | — | — | — |
| UC-2 | Skip photo+voice start | — | — | — |
| UC-3 | Manual client select | — | — | — |
| UC-4 | Double-click confirm | — | — | — |
| UC-5 | TTL >30min | — | — | — |
| UC-6 | Rate $0 | — | — | — |
| UC-7 | Already active session | — | — | — |
| UC-8 | Live location | — | — | — |
| UC-9 | Checklist all Yes | — | — | — |
| UC-10 | Checklist No | — | — | — |
| UC-11 | Checklist double-click | — | — | — |
| UC-12 | Start photo OK | — | — | — |
| UC-13 | Face mismatch | — | — | — |
| UC-14 | Video instead of photo | — | — | — |
| UC-15 | Blocked file type | — | — | — |
| UC-16 | Skip start photo | — | — | — |
| UC-17 | Start voice OK | — | — | — |
| UC-18 | Skip start voice | — | — | — |
| UC-19 | Happy path end | — | — | — |
| **UC-20** | **Skip all end** | **BUG-1** | **Fix 2** | ⏳ |
| **UC-21** | **Double-tap skip** | **BUG-3** | **Fix 4** | ⏳ |
| UC-22 | Location >500m | — | — | — |
| UC-23 | Voice with issues | — | — | — |
| UC-24 | Cron already closed | — | — | — |
| UC-25 | Finish while paused | — | — | — |
| **UC-26** | **SKIP in summary** | **BUG-1** | **Fix 2** | ⏳ |
| **UC-27** | **Duplicate trigger** | **BUG-4** | **Fix 1** | ⏳ |
| **UC-28** | **Ghost "не на смене"** | **BUG-2** | **Fix 3** | ⏳ |
| UC-29 | Voice task updates | — | — | — |
| UC-30 | Text description | — | — | — |
| UC-31 | Rate $0 finish | — | — | — |
| UC-32 | Daily totals | — | — | — |
| **UC-33** | **Balance wrong collection** | **BUG-6** | **Fix 6** | ⏳ |
| **UC-34** | **UTC greeting** | **BUG-7** | **Fix 7** | ⏳ |
| UC-35 | Late finish | — | — | — |
| UC-36 | >12h warning | — | — | — |
| UC-37 | Normal break | — | — | — |
| UC-38 | Break >60min cap | — | — | — |
| UC-39 | Finish while paused | — | — | — |
| UC-40 | Break cross-lookup | — | — | — |
| UC-41 | Double-click pause | — | — | — |
| UC-42 | Resume no paused | — | — | — |
| UC-43 | Break >12h cron | — | — | — |
| **UC-44** | **/start missing endLoc** | **BUG-5** | **Fix 5** | ⏳ |
| UC-45 | Photo no session | — | — | — |
| UC-46 | Album photos | — | — | — |
| UC-47 | Cancel end flow | — | — | — |
| UC-48 | Mid-shift voice | — | — | — |
| UC-49 | Mid-shift photo | — | — | — |
| UC-50 | Unregistered user | — | — | — |

**Результат:** 7 багов из 50 UC, 7 фиксов, все простые (1-15 строк каждый).
