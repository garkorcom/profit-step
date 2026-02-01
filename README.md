# Profit Step — CRM & Team Management Platform

**Комплексная платформа управления командой и бизнес-процессами**

## 🚀 Быстрый старт

```bash
# Установка зависимостей
npm install
cd functions && npm install && cd ..

# Локальный запуск
npm start

# Деплой
firebase deploy
```

## 📁 Структура проекта

```
profit-step/
├── src/                    # React Frontend
│   ├── components/         # UI компоненты
│   ├── pages/             # Страницы
│   ├── hooks/             # React хуки
│   ├── features/          # Модули фич
│   ├── services/          # API сервисы
│   └── types/             # TypeScript типы
├── functions/             # Firebase Cloud Functions
│   └── src/
│       ├── triggers/      # Telegram боты
│       └── services/      # Бизнес-логика
├── docs/                  # Документация
└── firestore.rules        # Правила безопасности
```

## 🔧 Модули системы

| Модуль | Описание | Документация |
|--------|----------|--------------|
| **Time Tracking** | Учёт рабочего времени | [Docs](docs/TIME_TRACKING.md) |
| **GTD Tasks** | Управление задачами (Kanban) | [Docs](docs/GTD_TASK_CREATION.md) |
| **Finance** | Зарплаты и расчёты | [Docs](docs/FINANCE_MODULE.md) |
| **Shopping** | Закупки и чеки | [Docs](docs/SHOPPING_MODULE.md) |
| **Clients/CRM** | Управление клиентами | [Docs](docs/CRM_MODULE.md) |
| **Telegram Bot** | Рабочий бот | [Docs](docs/TELEGRAM_BOT.md) |

## 🤖 Telegram Bot

- **@ProfitStepWorkerBot** — бот для работников
- Учёт времени, голосовые отчёты, закупки
- Подробнее: [docs/TELEGRAM_BOT.md](docs/TELEGRAM_BOT.md)

## 🌐 URLs

- **Production:** https://profit-step.web.app
- **Firebase Console:** https://console.firebase.google.com/project/profit-step

## 👥 Роли пользователей

| Роль | Доступ |
|------|--------|
| **Owner** | Полный доступ |
| **Admin** | Управление командой |
| **Manager** | Клиенты, задачи, отчёты |
| **Worker** | Свои задачи, время |

## 🛠 Tech Stack

- **Frontend:** React 18, TypeScript, MUI v6
- **Backend:** Firebase (Firestore, Functions, Auth, Storage)
- **Bot:** Telegram Bot API
- **AI:** Gemini (голосовое распознавание)

## 📞 Поддержка

Telegram: @garkor
