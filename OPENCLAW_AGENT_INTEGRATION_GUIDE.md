# Интеграция AI-Агента (OpenClaw) в CRM Profit Step

Этот документ является установочным и вспомогательным руководством для программирования API и интеграции локального агента **OpenClaw** (на базе LangGraph/Pydantic) с бэкендом **Profit Step CRM**.

В основе лежит эталонный архитектурный план: **Зеркальная типизация**.
Использование `Pydantic` на стороне агента и `Zod` на стороне бэкенда гарантирует 100% защиту базы от «галлюцинаций» ИИ. 

---

## 1. Архитектура интеграции

1. **OpenClaw Agent (`~/.openclaw/agents/profit_step/`)**
   - Использует **Pydantic** для строгой типизации входных параметров (Function Calling).
   - Взаимодействует с БД в 2 этапа (Например: сначала Поиск ID проекта через `search_project`, затем Создание задачи).
2. **Profit Step Backend (`/functions/src/api.ts`)**
   - Единый **API-шлюз на Express**, экспортируемый через `functions.https.onRequest(app)`.
   - Использует платформу **Zod** для зеркальной валидации входящих данных.
   - При ошибках Zod возвращает статус `400 BadRequest` с деталями ошибки, чтобы агент мог **совершить самокоррекцию**.

---

## 2. Безопасность и Авторизация

Т.к. агент работает локально, а Firebase Functions "торчат" наружу:
- Middleware Express в `api.ts` проверяет заголовок:
  `Authorization: Bearer <AGENT_API_KEY>`
- Токен берется из переменных окружения Firebase (Secret Manager или `.env`).

---

## 3. Проектирование Эндпоинтов и Pydantic Tools

### 3.1. Умный поиск проекта (Resolution)
LLM в тексте оперирует названиями ("Farmer's Milk"), а БД работает по ID.
* **Эндпоинт CRM:** `GET /api/projects/search?query=Farmer`
* **Agent Tool:** `search_project.py`
* **Алгоритм:** Перед созданием любой сущности агент обязан вызвать этот инструмент, чтобы найти `project_id`.

### 3.2. Управление задачами (Tasks)
* **Эндпоинт CRM:** `POST /api/tasks`
* **Agent Tool:** `create_task.py`
* **Схема валидации (Zod & Pydantic):**
  - `project_id` (string, required) - получено из `search_project`
  - `task_title` (string, required)
  - `amount` (number, optional)
  - `description` (string, optional)

### 3.3. Тайм-трекинг работяг (Time Tracking)
* **Эндпоинт CRM:** `POST /api/time-tracking`
* **Agent Tool:** `track_time.py`
* **Схема валидации:**
  - `action` (enum: "start" | "stop")
  - `project_id` (string, required)
  - `comment` (string, optional)

### 3.4. Фиксация расходов (Expenses)
* **Эндпоинт CRM:** `POST /api/expenses`
* **Agent Tool:** `add_expense.py`
* **Схема валидации:**
  - `project_id` (string, required)
  - `amount` (number, required)
  - `currency` (string, default "USD")
  - `description` (string)

---

## 4. Как начать доработку (Шаги для ИИ/Кодера)

1. **Создание Шлюза:** В папке `profit-step/functions/src/` создать файл (например `apiGateway.ts`) или добавить в `index.ts` Express-приложение.
2. **Middleware & Zod:** Подключить проверку Bearer токена и написать схему (например `CreateTaskSchema = z.object({...})`).
3. **Локальный Эмулятор:** Запустить `npm run build && firebase emulators:start --only functions,firestore`.
4. **Создание Тулзов Агента:** В `~/.openclaw/agents/profit_step/skills/` написать `search_project.py` и `create_task.py`. Обязательно передавать ошибки `400` обратно агенту строкой `return f"Ошибка валидации: {response.text}"`.
5. **Тестирование:** Отправить команду ИИ-агенту: *"Я закончил монтаж у Farmer's Milk, добавь задачу отправить счет на 500 долларов"*. Если все сделано верно, агент найдет проект и создаст задачу.
