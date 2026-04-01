# 50 Use Cases — Profit Step API на стройплощадке

> Реальные сценарии использования API агентами (OpenClaw), ботами (Telegram) и интеграциями на строительных объектах.

---

## 🏗️ Утреннее открытие объекта (Daily Start)

**1. Рабочий приехал — запуск таймера голосом**
Рабочий пишет в Telegram бот: «Я на объекте Стива, начинаю ставить розетки»
→ `POST /api/time-tracking` `{ action: "start", taskTitle: "Установка розеток", clientName: "Steve" }`

**2. Забыл отметиться утром — ретро-старт**
Рабочий пишет в 10:00: «Я на объекте с 7 утра»
→ `POST /api/time-tracking` `{ action: "start", startTime: "2026-04-01T07:00:00Z", taskTitle: "..." }`

**3. Прораб проверяет кто сейчас на смене**
→ `GET /api/time-tracking/active-all`
Видит список всех работающих, с таймерами и клиентами.

**4. Прораб видит что Олег задвоился — остановка чужой сессии**
→ `POST /api/time-tracking/admin-stop` `{ sessionId: "stale-session-id" }`

**5. Утренний статус по объекту**
Прораб просит ИИ: «Что по объекту Стива?»
→ `GET /api/projects/status?clientName=Steve`
Получает: 15 задач, $2500 расходов, 80.5 часов отработано.

---

## 📋 Управление задачами (Task Management)

**6. Создание задачи из голосового сообщения**
Рабочий: «Надо закупить провод 12AWG, 200 метров, к пятнице»
ИИ парсит → `POST /api/gtd-tasks` `{ title: "Закупить провод 12AWG 200м", dueDate: "2026-04-05", priority: "high", status: "next_action" }`

**7. Назначение задачи конкретному работнику**
→ `PATCH /api/gtd-tasks/:id` `{ assigneeId: "ivan-id", assigneeName: "Иван Петров" }`

**8. Пометка задачи как выполненной**
→ `PATCH /api/gtd-tasks/:id` `{ status: "completed" }`

**9. Перенос задачи в «когда-нибудь»**
Клиент просит отложить покраску → `PATCH /api/gtd-tasks/:id` `{ status: "someday" }`

**10. Пакетный просмотр «что делать сегодня»**
→ `GET /api/gtd-tasks/list?status=next_action&assigneeId=ivan-id&sortBy=priority&sortDir=desc`

**11. Просмотр просроченных задач**
→ `GET /api/gtd-tasks/list?dueBefore=2026-04-01T00:00:00Z&status=next_action,waiting`

**12. Удаление отменённой задачи**
Клиент отменил покраску → `DELETE /api/gtd-tasks/:id` (архивация, не физическое удаление)

**13. Привязка задачи к проекту**
→ `POST /api/gtd-tasks` `{ title: "Монтаж щитка", projectId: "proj-id", clientId: "abc" }`

**14. Установка бюджета на задачу**
→ `PATCH /api/gtd-tasks/:id` `{ budgetAmount: 5000, budgetCategory: "materials" }`

**15. Отслеживание прогресса**
→ `PATCH /api/gtd-tasks/:id` `{ progressPercentage: 75 }`

---

## 💰 Расходы и закупки (Costs)

**16. Рабочий купил материалы — фиксация чека**
Иван фоткает чек из Home Depot и пишет: «Провод и розетки на объект Стива, $127.50»
→ `POST /api/costs` `{ clientName: "Steve", category: "materials", amount: 127.50, description: "Провод 12AWG + розетки GFCI" }`

**17. Заправка рабочего грузовика**
→ `POST /api/costs` `{ category: "fuel", amount: 65.00, description: "Полный бак F-150" }`

**18. Обед бригады за счёт компании**
→ `POST /api/costs` `{ category: "food", amount: 45.00, description: "Lunch Subway x3" }`

**19. Возврат денег работнику (reimbursement)**
Иван потратил из своих → `POST /api/costs` `{ category: "reimbursement", amount: 127.50 }`
> Сумма записывается как отрицательная — это компенсация.

**20. Отмена ошибочного расхода**
Дублирующий чек → `DELETE /api/costs/:id` (voided)

**21. Отчёт по расходам за месяц**
→ `GET /api/costs/list?from=2026-03-01&to=2026-03-31`
Ответ включает `sum.byCategory` — разбивка по категориям.

**22. Расходы на конкретный объект**
→ `GET /api/costs/list?clientName=Steve&category=materials,tools`

**23. Привязка расхода к задаче**
Провод куплен для задачи «Монтаж щитка» → `POST /api/costs` `{ taskId: "task-id", ... }`

---

## ⏱️ Трекинг времени и зарплата (Time & Payroll)

**24. Остановка таймера в конце дня**
Рабочий: «Всё, закончил»
→ `POST /api/time-tracking` `{ action: "stop" }`
Ответ: `"Сессия завершена: 480мин, $240.00"`

**25. Забыл остановить вчера — ретро-стоп**
→ `POST /api/time-tracking` `{ action: "stop", endTime: "2026-03-31T17:00:00Z" }`

**26. Проверка «я сейчас на таймере?»**
→ `POST /api/time-tracking` `{ action: "status" }`

**27. Расчёт зарплаты за неделю**
→ `GET /api/time-tracking/summary?from=2026-03-25&to=2026-03-31`
Ответ включает `employees[]` с `totalHours` и `totalEarnings`.

**28. Зарплата конкретного работника**
→ `GET /api/time-tracking/summary?from=2026-03-01&to=2026-03-31&employeeId=ivan-id`

**29. Регистрация нового работника из Telegram**
Новый рабочий пишет боту → `POST /api/users/create-from-bot` `{ telegramId: 123456, displayName: "Олег", hourlyRate: 25, role: "worker" }`

**30. Обновление ставки работника**
Повышение → `POST /api/users/create-from-bot` `{ telegramId: 123456, hourlyRate: 30 }`
Если юзер есть — обновляет ставку.

**31. Массовый шатдаун — прораб останавливает все сессии**
`GET /api/time-tracking/active-all` → получает все `sessionId` → цикл `POST /api/time-tracking/admin-stop` для каждого.

---

## 👤 Клиенты и контакты (CRM)

**32. Новый клиент по звонку**
Менеджер: «Звонил новый клиент, жилой дом в Остине»
→ `POST /api/clients` `{ name: "John Smith", type: "residential", address: "456 Oak Ave, Austin TX" }`

**33. Добавление магазинов рядом с объектом**
→ `PATCH /api/clients/:id` `{ nearbyStores: ["Home Depot на 5th St", "Lowe's на Congress Ave"] }`

**34. Поиск клиента по неточному имени**
Рабочий: «Что там по Джонсону?»
→ `GET /api/clients/search?q=Johnson`

**35. Добавление контакта субподрядчика**
→ `POST /api/contacts` `{ name: "Mike the Plumber", phones: [{ number: "+1-555-333", label: "cell" }], roles: ["plumber"], linkedProjects: ["proj-id"] }`

**36. Поиск всех электриков в базе**
→ `GET /api/contacts/search?q=electric&role=electrician`

**37. Поиск контактов привязанных к проекту**
→ `GET /api/contacts/search?q=&projectId=proj-id`

---

## 📐 Сметы и оценки (Estimates)

**38. ИИ-агент создает смету по чертежу**
Estimator парсит PDF blueprint и генерирует items:
→ `POST /api/estimates` `{ address: "789 Elm St", items: [...], taxRate: 8.25 }`
Если клиента по этому адресу нет — он **автоматически создаётся**.

**39. Отправка сметы клиенту**
→ `PATCH /api/estimates/:id` `{ status: "sent" }`

**40. Клиент утвердил смету**
→ `PATCH /api/estimates/:id` `{ status: "approved" }`

**41. Конвертация сметы в задачи**
Утверждённая смета → рабочие задачи:
→ `POST /api/estimates/:id/convert-to-tasks`
Создаёт parent task + sub-tasks по категориям (Material, Labor, Service).

**42. Просмотр всех черновых смет**
→ `GET /api/estimates/list?status=draft`

---

## 🗂️ Проекты и файлы (Projects & Files)

**43. Создание проекта под клиента**
→ `POST /api/projects` `{ clientId: "abc", name: "Remodel Kitchen", type: "work", address: "789 Elm St", areaSqft: 500 }`

**44. Загрузка чертежа на проект**
Estimator отправляет blueprint:
→ `POST /api/projects/:id/files` `{ fileName: "floor-plan.pdf", contentType: "application/pdf", base64Data: "..." }`
Автоматическое версионирование при повторной загрузке.

**45. Разбивка многостраничного PDF чертежа**
→ `POST /api/blueprint/split` `{ projectId: "proj-id", fileId: "file-id" }`
Каждая страница сохраняется отдельно с размерами (width/height).

**46. Создание объекта (Site) с пермитом**
→ `POST /api/sites` `{ clientId: "abc", name: "Main Office", address: "789 Elm St", type: "commercial", permitNumber: "PRM-2026-001" }`

---

## 🏦 Финансы и банк (Finance)

**47. AI парсит банковскую выписку и загружает транзакции**
PDF → ИИ парсит → `POST /api/finance/transactions/batch` `{ transactions: [{...}, {...}] }`
Все создаются со статусом `draft`.

**48. Бухгалтер утверждает пачку транзакций**
→ `POST /api/finance/transactions/approve`
Автоматически: создаёт записи в `costs`, сохраняет правила классификации, обновляет статус на `approved`.

**49. Откат ошибочно утверждённых транзакций**
→ `POST /api/finance/transactions/undo` `{ transactionIds: ["tx-1", "tx-2"] }`
Удаляет связанные costs и возвращает `draft`.

**50. Контекст для AI-классификатора**
→ `GET /api/finance/context`
Возвращает: активные проекты, категории, и **правила автоклассификации** (какой merchant → какая категория/проект). Используется при обработке каждой новой выписки.

---

## 📊 Аналитика (ERP & Reporting)

**Бонус: Change Order**
Клиент попросил добавить розетки на кухне:
→ `POST /api/change-orders` `{ title: "Доп. розетки на кухне", items: [...] }`
Автоматический номер CO-001.

**Бонус: Purchase Order**
Закупка материалов с отслеживанием отклонений:
→ `POST /api/purchase-orders` `{ vendor: "Home Depot", items: [...], plannedTotal: 500 }`
Автоматически считает `varianceAmount` (фактическая - плановая).

**Бонус: Plan vs Fact**
Прораб: «Сколько мы уже потратили vs смета?»
→ `GET /api/plan-vs-fact?clientName=Steve`
Ответ включает planned/actual/variance по materials/labor/subcontract + margin + alerts.

---

## Паттерны комбинирования

### Полный цикл нового объекта (7 вызовов):
```
POST /api/clients           → clientId
PATCH /api/clients/:id      → nearbyStores
POST /api/projects          → projectId  
POST /api/projects/:id/files → загрузка чертежа
POST /api/blueprint/split   → разбивка на страницы
POST /api/estimates         → estimateId
POST /api/estimates/:id/convert-to-tasks → taskIds
```

### Полный рабочий день работника (3 вызова):
```
POST /api/time-tracking     → { action: "start" }
POST /api/costs             → фиксация закупки
POST /api/time-tracking     → { action: "stop" }
```

### Еженедельный отчёт прораба (3 вызова):
```
GET /api/time-tracking/summary  → зарплаты
GET /api/costs/list             → расходы
GET /api/plan-vs-fact           → бюджет vs факт
```
