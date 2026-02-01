# ⚙️ Техническая документация API

## Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│                      FRONTEND                                │
│                   React + TypeScript                         │
│                      MUI v6                                  │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    FIREBASE                                  │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│  │  Firestore  │ │    Auth     │ │   Storage   │            │
│  │   (NoSQL)   │ │  (Google)   │ │   (Files)   │            │
│  └─────────────┘ └─────────────┘ └─────────────┘            │
│  ┌─────────────────────────────────────────────┐            │
│  │          Cloud Functions                     │            │
│  │    (Triggers, HTTP, Scheduled)              │            │
│  └─────────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                 EXTERNAL SERVICES                            │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│  │  Telegram   │ │   Gemini    │ │  Nominatim  │            │
│  │   Bot API   │ │   (AI)      │ │ (Geocoding) │            │
│  └─────────────┘ └─────────────┘ └─────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

---

## Firestore Collections

### users
```typescript
{
  id: string;           // Firebase Auth UID
  email: string;
  displayName: string;
  role: 'owner' | 'admin' | 'manager' | 'worker';
  companyId: string;
  hourlyRate?: number;
  telegramId?: string;
  createdAt: Timestamp;
}
```

### employees
```typescript
{
  id: string;
  userId: string;       // Reference to users
  name: string;
  hourlyRate: number;   // Admin-set rate
  status: 'active' | 'inactive';
}
```

### clients
```typescript
{
  id: string;
  name: string;
  contacts: Contact[];
  locations: Location[];
  balance: number;
  status: 'active' | 'inactive' | 'archived';
}
```

### workSessions
```typescript
{
  id: string;
  userId: string;
  clientId: string;
  startTime: Timestamp;
  endTime?: Timestamp;
  hourlyRate: number;
  totalEarnings?: number;
  status: 'active' | 'paused' | 'completed';
}
```

### gtd_tasks
```typescript
{
  id: string;
  ownerId: string;
  ownerName: string;
  title: string;
  description?: string;
  status: 'inbox' | 'next_actions' | 'projects' | 'waiting' | 'estimate' | 'someday' | 'done';
  priority: 'high' | 'medium' | 'low' | 'none';
  clientId?: string;
  assigneeId?: string;
  dueDate?: Timestamp;
  acceptedAt?: Timestamp;
  acceptedBy?: string;
}
```

### receipts
```typescript
{
  id: string;
  userId: string;
  clientId: string;
  amount: number;
  receiptPhotoUrl: string;
  goodsPhotoUrl?: string;
  status: 'awaiting_goods_photo' | 'pending' | 'confirmed';
  paymentSource?: string;
}
```

### shoppingLists / shoppingItems
```typescript
// Lists
{ id, clientId, name, status }

// Items  
{ id, listId, name, quantity, status, actualPrice }
```

---

## Cloud Functions

### HTTP Triggers

| Function | Endpoint | Description |
|----------|----------|-------------|
| `onWorkerBotMessage` | POST | Telegram webhook |
| `onTelegramMessage` | POST | Lead bot webhook |
| `diagnoseBot` | GET | Bot diagnostics |

### Firestore Triggers

| Function | Trigger | Description |
|----------|---------|-------------|
| `onWorkSessionCreate` | onCreate | Notify admin |
| `onWorkSessionUpdate` | onUpdate | Recalculate earnings |
| `onReceiptUpdate` | onUpdate | Update client balance |
| `onUserCreate` | onCreate | Initialize user |

### Scheduled (Cron)

| Function | Schedule | Description |
|----------|----------|-------------|
| `finalizeExpiredSessions` | Every 6h | Auto-close stuck sessions |
| `checkLongBreaks` | Every 1h | Alert on long breaks |
| `generateDailyPayroll` | Daily 2am | Calculate daily totals |

---

## Environment Variables

```bash
# Firebase (auto-configured)
GCLOUD_PROJECT=profit-step
FIREBASE_CONFIG=...

# Telegram Bots
WORKER_BOT_TOKEN=<bot_token>
WORKER_PASSWORD=9846
ADMIN_GROUP_ID=<chat_id>

# AI
GEMINI_API_KEY=<key>
```

### Firebase Config
```bash
firebase functions:config:set \
  worker_bot.token="..." \
  worker_bot.password="9846" \
  worker_bot.admin_group_id="..."
```

---

## API Endpoints

### Telegram Bot Callbacks

```
shop:menu           — Shopping menu
shop:select         — Select items
shop:confirm_amount — Confirm OCR amount
shop:payment:<src>  — Set payment source
shop:allocate:<id>  — Allocate to client
```

### Internal Services

```typescript
// shoppingBotService.ts
processReceipt(receiptId, data)
addGoodsPhoto(receiptId, photoUrl)
getActiveItems(userId)

// geocodingService.ts
geocodeAddress(address): Promise<{lat, lng}>
```

---

## Deployment

### Frontend
```bash
npm run build
firebase deploy --only hosting
```

### Functions
```bash
cd functions
npm run deploy
# or
firebase deploy --only functions
```

### Full Deploy
```bash
firebase deploy
```

---

## Monitoring

### Logs
```bash
firebase functions:log
firebase functions:log --only onWorkerBotMessage -n 50
```

### Console
- https://console.firebase.google.com/project/profit-step

---

*Обновлено: Январь 2026*
