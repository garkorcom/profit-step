# TZ: Telegram Bot PO Commands (Advance Accounts)

**Created:** 2026-04-09
**Author:** Denis + Claude Code
**Status:** Spec Ready
**Priority:** High — workers need to report expenses from the field
**Branch:** TBD (from `feature/project-hierarchy-fix`)

---

## 1. Overview

Workers get PO (podotchet/advance) cash to buy materials on job sites. Right now they track expenses only through the CRM web UI, which is inconvenient from the field. This spec adds PO commands to the existing Telegram worker bot so they can:

- View their PO balance and open advances
- Report expenses with photo receipts directly from the chat
- Return unused cash
- See transaction history per advance

**Out of scope for V1:** Issuing advances (admin-only via CRM), payroll deductions, write-offs, approval workflows.

---

## 2. Entry Points

### 2.1. Main Menu Button

Add `📦 PO / Авансы` button to the main menu keyboard. Appears in all states (not working, working, on break).

**Location:** `telegramUtils.ts` → `buildStatusAndKeyboard()` — add button to all three keyboard layouts.

### 2.2. Balance in Session End Message

Already implemented (PR #10). After session end, bot shows:
```
💚 Баланс ЗП: *$1,250.00*
📊 Начислено с начала года: $3,500.00
💸 Выплачено: $2,250.00
📦 Баланс ПО: *$500.00* (2 авансов)
```

### 2.3. Direct Command

`/po` — shortcut to PO overview (same as pressing the menu button).

---

## 3. Bot Flows

### 3.1. PO Overview (entry point)

**Trigger:** User presses `📦 PO / Авансы` or types `/po`

**Action:**
1. Query `advance_accounts` where `employeeId in [telegramId, String(telegramId), firebaseUid]` AND `status == 'open'`
2. Query `advance_transactions` for those advances where `status == 'active'`
3. Compute balances using `computeAdvanceBalance()` logic

**Message:**
```
📦 *Авансовые счета*

💰 Общий баланс ПО: *$750.00*
📋 Открытых авансов: 2

1️⃣ *Kitchen Remodel* — $500 из $800
   📅 Выдан: 3 апр 2026
   ⚡ Потрачено: $300

2️⃣ *Bathroom Tiles* — $250 из $250
   📅 Выдан: 7 апр 2026
   ⚡ Потрачено: $0
```

**Inline keyboard:**
```
[📸 Отчёт о расходе]  [💵 Вернуть]
[🔍 История]           [❌ Закрыть]
```

**Callback data:**
- `po_expense` → start expense report flow
- `po_return` → start return flow
- `po_history` → show transaction history
- `po_close` → delete message (or send main menu)

**Edge case — no open advances:**
```
📦 *Авансовые счета*

У вас нет открытых авансов.
Если вам нужен аванс на материалы — обратитесь к руководителю.
```
Keyboard: `[❌ Закрыть]`

---

### 3.2. Expense Report Flow (📸 Отчёт о расходе)

**Trigger:** User presses `po_expense` callback button

**Step 1 — Select advance** (if multiple open):
```
📸 *Отчёт о расходе*

Выберите аванс:
```
Inline keyboard with one button per advance:
```
[Kitchen Remodel — $500 осталось]
[Bathroom Tiles — $250 осталось]
[❌ Отмена]
```
Callback: `po_expense_adv_{advanceId}`

If only 1 open advance → skip to Step 2 automatically.

**Step 2 — Enter amount:**
```
💵 *Сумма расхода*

Аванс: Kitchen Remodel ($500 осталось)
Введите сумму в долларах (например: 150 или 150.50):
```

Bot waits for text message with number. Validation:
- Must be a positive number
- If exceeds remaining balance → warning (but allow, as overspend is possible)
- Store pending state in memory/Firestore: `po_pending_{chatId}` temp doc

**Step 3 — Description:**
```
📝 *Описание*

Что купили? Например:
• Drywall sheets 20 pcs
• Screws and anchors at Home Depot
```

Bot waits for text message.

**Step 4 — Receipt photo (optional):**
```
📷 *Чек / Receipt*

Отправьте фото чека или нажмите "Без чека":
```
Inline keyboard: `[📷 Без чека]` (callback: `po_expense_no_receipt`)

If user sends a photo → upload to Firebase Storage at path:
`advance_receipts/{advanceId}/{transactionId}.jpg`

**Step 5 — Category (optional, quick pick):**
```
🏷 *Категория*

Выберите категорию:
```
Inline keyboard (2 buttons per row):
```
[🧱 Materials]  [🔧 Tools]
[⛽ Fuel]       [🍔 Food]
[📦 Other]
```
Callback: `po_expense_cat_{categoryId}`

**Step 6 — Confirmation:**
```
✅ *Подтверждение расхода*

📋 Аванс: Kitchen Remodel
💵 Сумма: $150.00
📝 Drywall sheets 20 pcs
🏷 Materials
📷 Чек: ✅ Приложен

Всё верно?
```
Inline keyboard:
```
[✅ Подтвердить]  [❌ Отмена]
```
Callback: `po_expense_confirm` / `po_expense_cancel`

**On confirm:**
1. Create `advance_transactions` document:
   ```
   {
     advanceId, employeeId, employeeName,
     type: 'expense_report',
     amount, description, category,
     hasReceipt: true/false,
     receiptUrl: <uploaded URL or null>,
     createdBy: <firebaseUid or telegramId>,
     createdAt: serverTimestamp(),
     status: 'active',
     source: 'telegram_bot'  // NEW field to track source
   }
   ```
2. If new balance == 0 → auto-settle advance (update `advance_accounts` doc)
3. Send confirmation message:
   ```
   ✅ *Расход записан!*

   $150.00 — Drywall sheets 20 pcs
   Остаток по авансу: $350.00
   ```
4. **Notify admin** via admin group:
   ```
   📦 *PO Расход*
   👤 Ivan Petrov
   💵 $150.00 — Drywall sheets 20 pcs
   📋 Kitchen Remodel ($350 осталось)
   📷 Чек: ✅
   ```
   (With receipt photo if available)

---

### 3.3. Return Flow (💵 Вернуть)

**Trigger:** `po_return` callback

**Step 1 — Select advance** (same as expense, skip if only one)

**Step 2 — Enter amount:**
```
💵 *Возврат средств*

Аванс: Kitchen Remodel ($500 осталось)
Введите сумму возврата:
```
Pre-fill suggestion: remaining balance.
Validation: cannot exceed remaining balance.

**Step 3 — Confirmation:**
```
✅ *Подтверждение возврата*

📋 Аванс: Kitchen Remodel
💵 Возврат: $200.00
Остаток после возврата: $300.00

Подтвердить?
```

**On confirm:**
1. Create `advance_transactions` with `type: 'return'`
2. Auto-settle if balance == 0
3. Send confirmation + notify admin:
   ```
   💵 *PO Возврат*
   👤 Ivan Petrov
   💵 $200.00 возвращено
   📋 Kitchen Remodel ($300 осталось)
   ```

---

### 3.4. History Flow (🔍 История)

**Trigger:** `po_history` callback

**Action:** Show last 10 transactions across all open advances.

**Message:**
```
📜 *История операций PO*

1. 📸 $150.00 — Drywall sheets (Kitchen Remodel)
   🧱 Materials • 8 апр 2026

2. 💵 $200.00 — Возврат (Kitchen Remodel)
   3 апр 2026

3. 📸 $75.50 — Paint and brushes (Bathroom Tiles)
   🔧 Tools • 7 апр 2026

📋 Итого записей: 3
```

Inline keyboard:
```
[⬅️ Назад к авансам]
```
Callback: `po_back_to_overview`

---

## 4. State Management

### 4.1. Conversation State

Bot needs to track multi-step flows (expense report is 5 steps). Use a temp Firestore document:

**Collection:** `bot_po_state` (auto-cleanup after 1 hour)

```typescript
interface BotPOState {
  chatId: number;
  userId: number;
  flow: 'expense' | 'return';
  step: 'select_advance' | 'enter_amount' | 'enter_description' | 'upload_receipt' | 'select_category' | 'confirm';
  advanceId?: string;
  amount?: number;
  description?: string;
  receiptFileId?: string;  // Telegram file_id
  receiptUrl?: string;     // Firebase Storage URL
  category?: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;    // +1 hour
}
```

### 4.2. State Routing in handleMessage()

In the main `handleMessage()` function, BEFORE other text handlers, check for active PO state:

```typescript
// Check for active PO flow
const poState = await getPOState(chatId);
if (poState) {
  await handlePOFlowMessage(chatId, userId, text, message, poState);
  return;
}
```

This intercepts text messages and photos while the user is in a PO flow.

### 4.3. Cleanup

- State expires after 1 hour (TTL field)
- User can cancel at any step → delete state doc
- If user sends `/start` or `/menu` → delete state doc and show main menu
- On successful completion → delete state doc

---

## 5. Implementation Architecture

### 5.1. New File: `functions/src/triggers/telegram/poHandler.ts`

Separate handler module (like ShoppingHandler, InboxHandler, GtdHandler).

**Exports:**
```typescript
export async function handlePOCommand(chatId: number, userId: number): Promise<void>;
export async function handlePOCallback(chatId: number, userId: number, data: string, messageId: number): Promise<void>;
export async function handlePOFlowMessage(chatId: number, userId: number, text: string, message: any, state: BotPOState): Promise<void>;
```

### 5.2. Integration Points in onWorkerBotMessage.ts

**1. Import:**
```typescript
import { handlePOCommand, handlePOCallback, handlePOFlowMessage } from './poHandler';
```

**2. In handleMessage() — add PO state check:**
```typescript
// After login check, before AI assistant
const poState = await getPOState(chatId);
if (poState) {
  await handlePOFlowMessage(chatId, userId, text, message, poState);
  return;
}
```

**3. In handleMessage() — add /po command:**
```typescript
if (text === '/po' || text === '📦 PO / Авансы') {
  await handlePOCommand(chatId, userId);
  return;
}
```

**4. In handleCallbackQuery() — add PO callback routing:**
```typescript
if (callbackData.startsWith('po_')) {
  await handlePOCallback(chatId, userId, callbackData, messageId);
  return;
}
```

### 5.3. Menu Button Addition in telegramUtils.ts

In `buildStatusAndKeyboard()`, add `📦 PO / Авансы` button to all three keyboard states:

**Not working keyboard:**
```
[▶️ Начать смену]
[📊 Мой статус] [❓ Помощь]
[🛒 Shopping] [📥 Inbox]
[📋 Tasks] [📦 PO / Авансы]   // NEW
```

**Working keyboard:**
```
[⏹ Завершить смену]
[⏸ Перерыв] [📊 Мой статус]
[❓ Помощь] [🛒 Shopping]
[📥 Inbox] [📦 PO / Авансы]   // NEW
```

**On break keyboard:**
```
[▶️ Продолжить работу]
[⏹ Завершить смену]
[📊 Мой статус] [❓ Помощь]
[📦 PO / Авансы]              // NEW
```

---

## 6. Cross-ID Matching

Workers may have sessions under different IDs (Telegram numeric ID vs Firebase UID). Use the same pattern as the YTD salary balance:

```typescript
const platformUser = await findPlatformUser(userId);
const searchIds: (string | number)[] = [userId, String(userId)];
if (platformUser) searchIds.push(platformUser.id);
```

Then query with `where('employeeId', 'in', searchIds)`.

---

## 7. Receipt Upload

### 7.1. Photo Handling

When user sends a photo during the receipt step:
1. Get `file_id` from `message.photo[-1]` (largest size)
2. Download via Telegram API: `GET https://api.telegram.org/bot{TOKEN}/getFile?file_id={fileId}`
3. Upload to Firebase Storage at `advance_receipts/{advanceId}/{transactionId}.jpg`
4. Save URL in transaction document

### 7.2. Existing Pattern

The bot already handles photo uploads in `saveTelegramFile()` (line 2582 of onWorkerBotMessage.ts). Reuse this function.

---

## 8. Admin Notifications

All PO actions send notifications to the admin Telegram group:

| Action | Notification |
|--------|-------------|
| Expense report | `📦 PO Расход: {name} — ${amount} — {description} ({project}, ${remaining} осталось) 📷 ✅/❌` |
| Return | `💵 PO Возврат: {name} — ${amount} ({project}, ${remaining} осталось)` |
| Auto-settle | `✅ PO Закрыт: {name} — {project} (баланс $0)` |

If expense has a receipt photo → send the photo along with the notification (use `sendPhoto` Telegram API method).

---

## 9. Error Handling

| Scenario | Response |
|----------|----------|
| No open advances | "У вас нет открытых авансов. Обратитесь к руководителю." |
| Invalid amount (not a number) | "Введите числовую сумму, например: 150 или 150.50" |
| Amount exceeds balance | Warning + allow (overspend creates reimbursement) |
| Receipt upload failed | "Расход записан, но загрузка чека не удалась. Отправьте чек позже через CRM." |
| Firestore write failed | "Произошла ошибка. Попробуйте ещё раз или запишите расход в CRM." |
| State expired (>1 hour) | "Сессия истекла. Начните заново: /po" |
| User cancelled | "Операция отменена." + return to PO overview |

---

## 10. Testing Checklist

- [ ] `/po` shows overview with correct balances
- [ ] Worker with no advances sees empty state
- [ ] Expense report flow: amount → description → receipt → category → confirm
- [ ] Expense with receipt photo → photo uploaded to Storage, URL saved
- [ ] Expense without receipt → `hasReceipt: false`
- [ ] Return flow: amount → confirm
- [ ] Auto-settle when balance reaches $0
- [ ] Admin notification sent for each action
- [ ] Cross-ID matching works (Telegram ID vs Firebase UID)
- [ ] State cleanup after completion
- [ ] State cleanup on cancel
- [ ] State cleanup on /start or /menu
- [ ] Concurrent flows don't interfere (one user, one flow at a time)
- [ ] History shows last 10 transactions correctly
- [ ] Menu button appears in all three keyboard states

---

## 11. Future (V2)

- **Bulk receipt upload** — send multiple photos, each becomes a separate expense
- **OCR** — auto-extract amount + store name from receipt photo (Google Vision API)
- **Voice notes** — describe expense by voice, AI transcribes
- **Approval workflow** — admin approves/rejects expenses from Telegram
- **Reminders** — bot reminds workers with overdue advances (>14 days)
- **Category auto-detect** — AI guesses category from description
- **/po_report** — admin command to see all open advances across workers

---

## 12. Files to Create / Modify

| File | Action | Size est. |
|------|--------|-----------|
| `functions/src/triggers/telegram/poHandler.ts` | **CREATE** — main PO handler | ~400 lines |
| `functions/src/triggers/telegram/onWorkerBotMessage.ts` | **MODIFY** — add routing + state check | ~30 lines |
| `functions/src/triggers/telegram/telegramUtils.ts` | **MODIFY** — add PO button to menus | ~10 lines |
| `firestore.rules` | **MODIFY** — add `bot_po_state` collection rules | ~5 lines |

**Total estimated:** ~450 lines of new code, ~40 lines of modifications.
