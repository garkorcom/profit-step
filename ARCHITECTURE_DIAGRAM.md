# 🏗️ Profit Step — Архитектурная Диаграмма

> Все связи между модулями, потоки данных и зависимости

---

## 1. Высокоуровневая архитектура

```mermaid
graph TB
    subgraph "👤 Пользователи"
        ADMIN["🔑 Admin"]
        WORKER["👷 Worker"]
        CLIENT["🤝 Client"]
        BOT_USER["📱 Telegram User"]
    end

    subgraph "🌐 Frontend (React SPA)"
        APP["App.tsx"]
        ROUTER["AppRouter.tsx"]
        AUTH["AuthContext"]
        
        subgraph "Pages"
            DASH["Dashboard"]
            CRM_P["CRM Pages"]
            TASKS_P["Tasks Pages"]
            FIN_P["Finance Pages"]
            EST_P["Estimates Pages"]
            ADMIN_P["Admin Pages"]
        end
        
        subgraph "Shared"
            HOOKS["Custom Hooks (21)"]
            API_LAYER["API Layer (18)"]
            TYPES["TypeScript Types (24)"]
            UTILS["Utils (8)"]
        end
    end

    subgraph "⚡ Backend (Cloud Functions)"
        TRIGGERS["Firestore Triggers"]
        CALLABLE["Callable Functions"]
        SCHEDULED["CRON Jobs (9)"]
        AGENT_API["Agent API (REST)"]
        AI_SERVICES["AI Services (9)"]
        EMAIL_SVC["Email Service"]
        NOTIFICATIONS["Notifications"]
    end

    subgraph "🗄️ Data Layer"
        FIRESTORE["Firestore DB"]
        STORAGE["Cloud Storage"]
        BIGQUERY["BigQuery (DWH)"]
    end

    subgraph "🤖 External"
        TELEGRAM["Telegram Bots"]
        GEMINI["Google Gemini"]
        CLAUDE["Anthropic Claude"]
        OPENCLAW["OpenClaw Gateway"]
        BREVO["Brevo (Email)"]
    end

    ADMIN & WORKER --> APP
    CLIENT --> APP
    BOT_USER --> TELEGRAM

    APP --> ROUTER --> AUTH
    ROUTER --> DASH & CRM_P & TASKS_P & FIN_P & EST_P & ADMIN_P
    
    CRM_P & TASKS_P & FIN_P & EST_P --> HOOKS
    HOOKS --> API_LAYER --> FIRESTORE
    
    TELEGRAM --> TRIGGERS
    TRIGGERS --> FIRESTORE
    CALLABLE --> FIRESTORE
    AI_SERVICES --> GEMINI & CLAUDE
    AGENT_API --> OPENCLAW
    SCHEDULED --> FIRESTORE
    TRIGGERS --> BIGQUERY
    EMAIL_SVC --> BREVO
    NOTIFICATIONS --> TELEGRAM
```

---

## 2. Связи между модулями

```mermaid
graph LR
    subgraph "CRM"
        CLIENTS["Clients"]
        CONTACTS["Contacts"]
        DEALS["Deals/Leads"]
    end

    subgraph "Tasks & Work"
        GTD["GTD Board"]
        TIMER["Time Tracking"]
        COCKPIT["Cockpit View"]
        SHOPPING["Shopping"]
        CALENDAR["Calendar"]
    end

    subgraph "Finance"
        PAYROLL["Payroll"]
        COSTS["Costs/Expenses"]
        INVOICES["Invoices"]
        BANK["Bank Statements"]
        RECONCILE["Reconciliation"]
        PNL["P&L Report"]
    end

    subgraph "Estimates"
        CALC["Calculator"]
        BLUEPRINT["AI Blueprint"]
        PROJECTS["Project Library"]
    end

    subgraph "Operations"
        INVENTORY["Inventory"]
        AI_REPORTS["AI Reports"]
    end

    subgraph "Admin"
        TEAM["Team Management"]
        RBAC["RBAC Roles"]
        COMPANIES["Companies"]
    end

    %% CRM → Tasks
    CLIENTS -->|"clientId"| GTD
    CLIENTS -->|"clientId"| TIMER
    CLIENTS -->|"clientId"| COCKPIT

    %% CRM → Finance
    CLIENTS -->|"clientId"| COSTS
    CLIENTS -->|"clientId"| INVOICES

    %% CRM → Estimates
    CLIENTS -->|"clientId"| PROJECTS

    %% Tasks → Finance
    TIMER -->|"work_sessions"| PAYROLL
    TIMER -->|"duration * rate"| PNL

    %% Estimates → Tasks
    PROJECTS -->|"Convert to Tasks"| GTD

    %% Estimates → Finance
    PROJECTS -->|"Approved → Revenue"| PNL

    %% Finance internal
    COSTS --> PNL
    INVOICES --> PNL
    BANK --> RECONCILE
    PAYROLL --> PNL

    %% Operations
    COSTS -->|"Auto-stock"| INVENTORY
    GTD -->|"Materials"| INVENTORY

    %% Admin → All
    TEAM -->|"hourlyRate"| TIMER
    TEAM -->|"role"| RBAC
    RBAC -->|"permissions"| GTD & COSTS & CLIENTS

    %% AI connections
    BLUEPRINT -.->|"Gemini Vision"| CALC
    SHOPPING -.->|"AI Parse"| COSTS
```

---

## 3. Поток данных: Telegram → Firestore → UI

```mermaid
sequenceDiagram
    participant TG as 📱 Telegram
    participant CF as ⚡ Cloud Function
    participant FS as 🗄️ Firestore
    participant UI as 🖥️ React UI
    participant AI as 🤖 AI (Gemini)

    Note over TG,UI: Сценарий: Рабочий начинает смену через бота

    TG->>CF: Сообщение "/start"
    CF->>FS: Query employees (telegramId)
    FS-->>CF: Employee profile
    CF->>TG: Keyboard с клиентами

    TG->>CF: Выбор клиента "Steve's Office"
    CF->>FS: Create work_session (status: active)
    FS-->>UI: onSnapshot → ActiveSessionIndicator

    Note over TG,UI: Проходит рабочий день...

    TG->>CF: "🛑 Stop"
    CF->>TG: "Что делал?"
    TG->>CF: Голосовое сообщение

    CF->>AI: Transcribe + Smart Dispatch
    AI-->>CF: {intent: "stop_work", description: "..."}
    CF->>FS: Update work_session (status: completed, duration, earnings)
    FS-->>UI: onSnapshot → TimeTrackingTable обновляется
    CF->>FS: Update payroll calculations
    FS-->>UI: FinancePage → Payroll обновляется
```

---

## 4. AI Pipeline: Blueprint Estimator

```mermaid
flowchart TD
    UPLOAD["📤 Upload PDF Blueprint"] --> RASTER["🖼️ PDF → Images (pdfjs-dist)"]
    RASTER --> PAGES["📄 Split into Pages"]
    
    PAGES --> JOB["🗄️ Create blueprint_jobs in Firestore"]
    JOB --> TRIGGER["⚡ onBlueprintJobCreated Trigger"]
    
    TRIGGER --> GEMINI["🤖 Gemini Vision API"]
    GEMINI --> ANALYZE["Analyze: Scale, Rooms, Devices"]
    
    ANALYZE --> RESULTS["📊 Page Results"]
    RESULTS --> CROSS["✅ Cross-Verification"]
    CROSS --> CONFIDENCE["🎯 AI Confidence Scoring"]
    
    CONFIDENCE --> ESTIMATE["💰 Generate Estimate"]
    ESTIMATE --> REVIEW["👁️ Human Review UI"]
    REVIEW --> APPROVE["✅ Approve → Project Library"]
    APPROVE --> TASKS["📋 Convert to GTD Tasks"]

    style GEMINI fill:#4285f4,color:#fff
    style CONFIDENCE fill:#ff9800,color:#fff
    style APPROVE fill:#2e7d32,color:#fff
```

---

## 5. Firestore Collections Map

```mermaid
erDiagram
    USERS {
        string uid PK
        string email
        string displayName
        string companyId FK
        string role "admin|manager|worker|estimator|guest"
        number telegramId
        number hourlyRate
        timestamp createdAt
    }

    COMPANIES {
        string id PK
        string name
        string ownerId FK
    }

    CLIENTS {
        string id PK
        string name
        string address
        string phone
        string email
        array aliases "AI entity resolution"
        string companyId FK
    }

    DEALS {
        string id PK
        string clientId FK
        string stage "new_lead|estimating|contract|in_progress|completed"
        number value
    }

    GTD_TASKS {
        string id PK
        string title
        string status "inbox|next_action|projects|waiting|someday|done"
        string priority "high|medium|low|none"
        string assignedTo FK
        string clientId FK
        string projectId FK
        timestamp deadline
        timestamp createdAt
    }

    WORK_SESSIONS {
        string id PK
        string employeeId FK "telegramId or Firebase UID"
        string clientId FK
        string relatedTaskId FK
        timestamp startTime
        timestamp endTime
        number durationMinutes
        number hourlyRate
        number sessionEarnings
        string status "active|paused|completed|auto_closed"
    }

    COSTS {
        string id PK
        string category
        number amount
        string clientId FK
        string projectId FK
        string submittedBy FK
        string status "pending|approved|rejected"
    }

    PROJECTS {
        string id PK
        string name
        string clientId FK
        string status "draft|sent|approved|rejected|completed"
    }

    CONTACTS {
        string id PK
        string name
        string phone
        string email
        string type "client_rep|inspector|subcontractor"
    }

    INVENTORY_ITEMS {
        string id PK
        string name
        number quantity
        string assignedTo FK
        string location
    }

    BLUEPRINT_JOBS {
        string id PK
        string projectId FK
        string pageUrl
        string status "pending|processing|completed|failed"
        object aiResult
    }

    USERS ||--o{ GTD_TASKS : "creates/assigned"
    USERS ||--o{ WORK_SESSIONS : "tracks time"
    USERS }|--|| COMPANIES : "belongs to"
    CLIENTS ||--o{ DEALS : "has deals"
    CLIENTS ||--o{ GTD_TASKS : "linked tasks"
    CLIENTS ||--o{ WORK_SESSIONS : "sessions for"
    CLIENTS ||--o{ COSTS : "costs for"
    CLIENTS ||--o{ PROJECTS : "estimates for"
    PROJECTS ||--o{ BLUEPRINT_JOBS : "has blueprints"
    GTD_TASKS ||--o{ WORK_SESSIONS : "time tracked"
```

---

## 6. Архитектура деплоя

```mermaid
graph TB
    subgraph "Firebase Project: profit-step"
        HOSTING["🌐 Firebase Hosting<br/>React SPA (PWA)"]
        FUNCTIONS["⚡ Cloud Functions<br/>Node 20, v5"]
        FIRESTORE_DB["🗄️ Firestore<br/>nam5 region"]
        AUTH["🔐 Firebase Auth"]
        STORAGE_B["📁 Cloud Storage"]
    end

    subgraph "Google Cloud"
        BIGQUERY_W["📊 BigQuery<br/>Data Warehouse"]
        VISION["👁️ Cloud Vision API"]
        VERTEX["🧠 Vertex AI (Gemini)"]
    end

    subgraph "External Services"
        ANTHROPIC["🤖 Anthropic Claude"]
        BREVO_E["📧 Brevo (Email)"]
        TELEGRAM_B["📱 Telegram Bot API"]
        OPENCLAW_G["🔗 OpenClaw Gateway<br/>(VPS: farmersmilkbot)"]
    end

    HOSTING --> FIRESTORE_DB
    HOSTING --> AUTH
    HOSTING --> STORAGE_B
    FUNCTIONS --> FIRESTORE_DB
    FUNCTIONS --> BIGQUERY_W
    FUNCTIONS --> VISION
    FUNCTIONS --> VERTEX
    FUNCTIONS --> ANTHROPIC
    FUNCTIONS --> BREVO_E
    FUNCTIONS --> TELEGRAM_B
    FUNCTIONS --> OPENCLAW_G
```

---

## 7. Сводная таблица зависимостей

### Frontend зависимости
| Пакет | Версия | Назначение |
|-------|--------|-----------|
| react | 19.2 | UI фреймворк |
| @mui/material | 7.3 | UI компоненты |
| react-router-dom | 7.9 | Маршрутизация |
| firebase | 12.4 | Firebase SDK |
| recharts | 3.5 | Графики |
| d3 | 7.9 | Визуализации |
| leaflet | 1.9 | Карты |
| jspdf | 4.1 | PDF генерация |
| pdfjs-dist | 5.4 | PDF рендеринг |
| xlsx | 0.18 | Excel экспорт |
| gantt-task-react | 0.3 | Диаграмма Ганта |
| @hello-pangea/dnd | 18.0 | Drag & Drop |
| @dnd-kit/* | 6-10 | Drag & Drop (альтернатива) |
| react-hook-form | 7.66 | Формы |

### Backend зависимости
| Пакет | Версия | Назначение |
|-------|--------|-----------|
| firebase-admin | 12.0 | Firebase Admin SDK |
| firebase-functions | 5.0 | Cloud Functions |
| @google/generative-ai | 0.24 | Gemini API |
| @google-cloud/vertexai | 1.10 | Vertex AI |
| @anthropic-ai/sdk | 0.74 | Claude API |
| openai | 6.25 | OpenAI API |
| @google-cloud/bigquery | 7.9 | BigQuery |
| @google-cloud/vision | 5.3 | Vision OCR |
| sharp | 0.34 | Обработка изображений |
| fuse.js | 7.1 | Fuzzy search |
| zod | 3.25 | Валидация схем |
| nodemailer | 7.0 | Email |
| cheerio | 1.2 | HTML парсинг |
| axios | 1.13 | HTTP клиент |
