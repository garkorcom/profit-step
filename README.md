# Profit Step - CRM Система

Современная CRM система для управления бизнесом, построенная на React + TypeScript + Firebase.

## 🚀 Технологии

- **Frontend**: React 18 + TypeScript
- **UI**: Material-UI v7
- **Backend**: Firebase (Firestore, Auth, Storage)
- **Routing**: React Router v7

## 📦 Установка

```bash
# Установка зависимостей
npm install

# Создание .env.local файла
cp .env.example .env.local
# Заполните .env.local своими Firebase credentials
```

## 🔥 Firebase Setup

1. Создайте проект в [Firebase Console](https://console.firebase.google.com/)
2. Включите Authentication (Email/Password)
3. Создайте Firestore Database
4. Включите Storage
5. Скопируйте конфигурацию в `.env.local`

## 📂 Структура проекта

```
src/
├── api/           # Firebase API layer
├── auth/          # Компоненты аутентификации
├── components/    # Переиспользуемые UI компоненты
├── contexts/      # React Context для глобального состояния
├── firebase/      # Firebase конфигурация
├── hooks/         # Custom React hooks
├── pages/         # Страницы приложения
├── router/        # Настройка роутинга
├── types/         # TypeScript типы
└── utils/         # Утилиты и хелперы
```

## 🎯 Модули

### 1. Клиенты/Контрагенты
- Управление клиентами и партнерами
- История взаимодействий
- Контактная информация

### 2. Проекты/Сделки
- Управление проектами
- Tracking прогресса
- Связь с клиентами

### 3. Задачи/Календарь
- Task management
- Планирование
- Дедлайны и напоминания

### 4. Документы/Файлы
- Хранение документов
- Версионирование
- Связь с проектами

## 🛠️ Команды

```bash
# Запуск dev сервера
npm start

# Сборка production
npm run build

# Запуск тестов
npm test
```

## 📝 Разработка

Проект находится в стадии разработки. Базовая структура создана, ожидается ТЗ для реализации модулей.

---

## Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

### Available Scripts

In the project directory, you can run:

#### `npm start`

Runs the app in the development mode.
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

#### `npm test`

Launches the test runner in the interactive watch mode.

#### `npm run build`

Builds the app for production to the `build` folder.
