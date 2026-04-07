# 🗺️ Profit Step — Полная Карта Проекта

> **Последнее обновление**: Апрель 2026  
> **Стек**: React 19 + MUI 7 + Firebase Functions v5 + Firestore + Gemini/Claude AI  
> **Платформа**: PWA (iPad Pro 11" first, mobile responsive)

---

## 📊 Статистика проекта

| Метрика | Значение |
|---------|----------|
| Frontend страницы | 40+ React pages |
| Backend Cloud Functions | 70+ exports |
| TypeScript типов | 24 файла |
| API модулей (frontend) | 18 файлов |
| Custom Hooks | 21+ |
| Firestore триггеров | 8 групп |
| CRON задач | 9 scheduled functions |
| Telegram ботов | 3 (Worker, Costs, AI Assistant) |
| Линтер | 510 warnings, 165 errors (oxlint) |

---

## 📁 Корневая структура

```
profit-step/
├── src/                         # 🖥️ React Frontend (SPA)
├── functions/                   # ⚡ Firebase Cloud Functions (Backend)
├── admin/                       # 📋 INSTRUCTION — модуль Администрирования
├── billing-shutdown-function/   # 🛑 Аварийный стоп-кран (отдельная GCF)
├── crm/                         # 📋 INSTRUCTION — модуль CRM
├── crm_api/                     # 📖 Документация Agent API + тесты
├── cypress/                     # 🧪 E2E тесты
├── dashboard/                   # 📋 INSTRUCTION — модуль Dashboard
├── docs/                        # 📚 Документация (8 гайдов)
├── estimates/                   # 📋 INSTRUCTION — модуль Сметы
├── finance/                     # 📋 INSTRUCTION — модуль Финансы
├── operations/                  # 📋 INSTRUCTION — модуль Операции
├── performance/                 # 🏎️ Lighthouse тесты
├── public/                      # 🌐 PWA assets + landing pages
├── scripts/                     # 🔧 Утилитарные скрипты (23 штуки)
├── tasks/                       # 📋 INSTRUCTION — модуль Задачи & Работа
├── _archived/                   # 📦 Архив (timer-v2-fsm)
├── __mocks__/                   # 🎭 Jest моки
├── .agent/                      # 🤖 Конфиг AI агентов (workflows)
├── .claude/                     # 🤖 Конфиг Claude
├── .github/                     # 🔄 CI/CD конфиги
├── .vscode/                     # ⚙️ Настройки VS Code
├── .venv/                       # 🐍 Python виртуальное окружение
├── build/                       # 📦 Собранный frontend (output)
└── node_modules/                # 📦 npm зависимости
```

---

## 🖥️ `/src/` — React Frontend

### `/src/api/` — API модули (18 файлов)
Слой доступа к Firestore. Каждый файл инкапсулирует CRUD операции для одной сущности.

| Файл | Назначение |
|------|-----------|
| `aiApi.ts` | Запросы к AI сервисам (Gemini) |
| `aiTaskApi.ts` | Генерация задач через AI (Claude scope analysis) |
| `avatarApi.ts` | Загрузка/обработка аватаров пользователей |
| `blueprintApi.ts` | Работа с чертежами (AI Blueprint Estimator) |
| `companiesApi.ts` | CRUD компаний (multi-tenant) |
| `crmApi.ts` | CRM операции (клиенты, сделки) |
| `devlogService.ts` | DevLog/Blog — публикации, seed-скрипты |
| `erpV4Api.ts` | ERP v4: Punch Lists, Work Acts, Payment Schedule |
| `estimatesApi.ts` | CRUD смет и калькуляций |
| `projectsApi.ts` | Управление проектами (создание, обновление, версии) |
| `rateApi.ts` | Управление расценками (hourlyRate) |
| `savedEstimateApi.ts` | Сохраненные сметы (библиотека) |
| `sitesApi.ts` | Объекты/площадки клиентов |
| `taskApi.ts` | CRUD задач (GTD) |
| `userApi.ts` | Профиль текущего пользователя |
| `userDetailApi.ts` | Детальная информация о пользователях (админ) |
| `userManagementApi.ts` | Управление пользователями (приглашение, удаление, роли) |
| `_deprecated_projectApi.ts` | ⚠️ Устаревший API проектов (не используется) |

### `/src/auth/` — Аутентификация
| Файл | Назначение |
|------|-----------|
| `AuthContext.tsx` | React Context для Firebase Auth. Хранит `currentUser`, `userProfile`, `loading`. Проверяет роли и компании. |

### `/src/components/` — Компоненты (18 групп)

#### `components/admin/` — Административные (10 компонентов)
| Файл | Назначение |
|------|-----------|
| `AvatarUpload.tsx` | Загрузка аватара с превью |
| `CostWarningDialog.tsx` | Предупреждение о стоимости операции |
| `CreateUserDialog.tsx` | Диалог создания пользователя |
| `InviteUserDialog.tsx` | Диалог приглашения по email |
| `OffboardingWizard.tsx` | Мастер увольнения (переназначение данных) |
| `OrgChartSelect.tsx` | Выбор позиции в оргструктуре |
| `OrgTreeView.tsx` | Визуализация оргструктуры (дерево) |
| `UserFormDialog.tsx` | Форма редактирования пользователя |
| `UserProfileModal.tsx` | Модалка профиля пользователя |
| `UserSlideOver.tsx` | Боковая панель информации о пользователе |

#### `components/common/` — Общие (4 компонента)
| Файл | Назначение |
|------|-----------|
| `LocationPicker.tsx` | Выбор географической позиции (Leaflet) |
| `StatCard.tsx` | Карточка статистики (KPI метрика) |
| `StatusIndicator.tsx` | Индикатор статуса (LED-стиль) |
| `index.ts` | Barrel export |

#### `components/companies/` — Компании (2)
| Файл | Назначение |
|------|-----------|
| `CompaniesTable.tsx` | Таблица компаний |
| `CompanyFormDialog.tsx` | Форма создания/редактирования компании |

#### `components/contacts/` — Контакты (1)
| Файл | Назначение |
|------|-----------|
| `GlobalContactQuickAdd.tsx` | Быстрое добавление контакта (глобальное) |

#### `components/crm/` — CRM компоненты (11)
| Файл | Назначение |
|------|-----------|
| `BotLogsViewer.tsx` | Просмотр логов Telegram бота |
| `ClientEditDialog.tsx` | Редактирование клиента |
| `ClientTasksTab.tsx` | Вкладка задач клиента |
| `CreateSessionDialog.tsx` | Диалог создания рабочей сессии |
| `EditSessionDialog.tsx` | Редактирование сессии |
| `EmployeeDetailsDialog.tsx` | Детали сотрудника |
| `LeadDetailsDialog.tsx` | Детали лида (воронка) |
| `LocationMap.tsx` | Карта местоположения (Leaflet) |
| `ProjectFilesTab.tsx` | Файлы проекта |
| `ProjectFinanceTab.tsx` | Финансовая вкладка проекта |
| `TaskMaterialsTab.tsx` | Материалы для задачи |

#### `components/dashboard/` — Дашборд (3)
| Файл | Назначение |
|------|-----------|
| `AIReportsSection.tsx` | Секция AI-генерированных отчетов |
| `KPICard.tsx` | Карточка KPI |
| `widgets/` | Виджеты дашборда |

#### `components/estimates/` — Сметы (9)
| Файл | Назначение |
|------|-----------|
| `AiMappingDialog.tsx` | AI маппинг элементов чертежа |
| `BlueprintFileSummary.tsx` | Сводка файла чертежа |
| `BlueprintPagesGrid.tsx` | Грид страниц чертежа |
| `BlueprintUploadDialog.tsx` | Загрузка чертежа (63KB — большой файл) |
| `BlueprintV2Pipeline.tsx` | V2 пайплайн обработки чертежа |
| `CrossVerification.tsx` | Перекрестная верификация AI результатов |
| `EstimatorLangGraphUI.tsx` | UI для LangGraph визуализации |
| `PageResultsView.tsx` | Результаты анализа страницы |
| `pipeline/` | Подкомпоненты пайплайна |

#### `components/expenses/` — Расходы (2)
| Файл | Назначение |
|------|-----------|
| `ExpensesBoardHeader.tsx` | Шапка доски расходов |
| `SmartTransactionCard.tsx` | Карточка транзакции с AI-категоризацией |

#### `components/finance/` — Финансы (3)
| Файл | Назначение |
|------|-----------|
| `PnLView.tsx` | Profit & Loss отчет |
| `expenses/` | Подкомпоненты расходов |
| `invoices/` | Подкомпоненты счетов |

#### `components/gtd/` — GTD Задачи (15 компонентов)
| Файл | Назначение |
|------|-----------|
| `GTDBoard.tsx` | Kanban доска (49KB — большой файл) |
| `GTDColumn.tsx` | Колонка канбана (Drag & Drop) |
| `GTDEditDialog.tsx` | Редактирование задачи (66KB — очень большой) |
| `GTDFilterBuilder.tsx` | Конструктор фильтров |
| `GTDSubtasksTable.tsx` | Таблица подзадач (71KB — очень большой) |
| `GTDTaskCard.tsx` | Карточка задачи |
| `AuditTaskInput.tsx` | Ввод задачи аудита |
| `CompactHeader.tsx` | Компактный заголовок (iPad) |
| `ColumnIndicator.tsx` | Индикатор колонки |
| `DynamicFormField.tsx` | Динамическое поле формы |
| `RepairTicketInput.tsx` | Ввод заявки на ремонт |
| `ShoppingListInput.tsx` | Ввод списка покупок |
| `TaskChecklist.tsx` | Чеклист задачи |
| `TaskHistoryTimeline.tsx` | Таймлайн истории задачи |
| `index.ts` | Barrel export |

#### `components/layout/` — Лейаут (4)
| Файл | Назначение |
|------|-----------|
| `Header.tsx` | Навигация (22KB — большой, содержит все меню) |
| `Footer.tsx` | Подвал страницы |
| `MainLayout.tsx` | Обертка с Header + Footer + Outlet |
| `ActiveSessionIndicator.tsx` | Индикатор активной рабочей сессии |

#### `components/projects/` — Проекты (2)
| Файл | Назначение |
|------|-----------|
| `ProjectGanttChart.tsx` | Диаграмма Ганта (gantt-task-react) |
| `ProjectTimeLapse.tsx` | Таймлапс проекта (визуализация прогресса) |

#### `components/pwa/` — PWA (1)
| Файл | Назначение |
|------|-----------|
| `PWAInstallBanner.tsx` | Баннер установки PWA |

#### `components/rbac/` — Контроль доступа (2)
| Файл | Назначение |
|------|-----------|
| `PermissionMatrix.tsx` | Матрица разрешений (RBAC) |
| `SecureField.tsx` | Поле с контролем доступа |

#### `components/tasks/` — Задачи AI (3)
| Файл | Назначение |
|------|-----------|
| `AiDraftPreview.tsx` | Превью AI-сгенерированной задачи |
| `AiGenerateButton.tsx` | Кнопка генерации через AI |
| `SmartCockpitInput.tsx` | Умный ввод в Cockpit View |

#### `components/tasks-masonry/` — Masonry View (2)
| Файл | Назначение |
|------|-----------|
| `TaskSquare.tsx` | Квадратная карточка задачи |
| `TasksMasonryHeader.tsx` | Заголовок masonry-вида |

#### `components/tasks-unified/` — Unified Tasks (2)
| Файл | Назначение |
|------|-----------|
| `TasksTableView.tsx` | Табличный вид задач |
| `TasksMapView.tsx` | Карта задач (геолокация) |

#### `components/time-tracking/` — Тайм-трекинг (8)
| Файл | Назначение |
|------|-----------|
| `TimeTrackingFilters.tsx` | Фильтры (дата, статус, сотрудник) |
| `TimeTrackingSummary.tsx` | Сводные карточки (часы, сессии) |
| `TimeTrackingCharts.tsx` | Графики (активность по дням) |
| `TimeTrackingTable.tsx` | Таблица сессий |
| `TimeTrackingAnalytics.tsx` | Аналитика трекинга |
| `AdminStartSessionDialog.tsx` | Старт сессии (админ) |
| `AdminStopSessionDialog.tsx` | Стоп сессии (админ) |
| `index.ts` | Barrel export |

---

### `/src/constants/` — Константы
| Файл | Назначение |
|------|-----------|
| `electricalDevices.ts` | Справочник электрических устройств (для калькулятора) |

### `/src/features/` — Бизнес-модули
| Директория | Назначение |
|-----------|-----------|
| `inventory/` | Складской учет (сервис + компоненты + хуки + views) |
| `shopping/` | Списки покупок (сервис + компоненты + хуки + views) |

### `/src/firebase/` — Firebase SDK
| Файл | Назначение |
|------|-----------|
| `firebase.ts` | Инициализация Firebase App, Auth, Firestore, Storage. Поддержка эмуляторов. |

### `/src/hooks/` — Custom Hooks (21 файл)
| Файл | Назначение |
|------|-----------|
| `useActiveSession.ts` | Активная рабочая сессия текущего юзера |
| `useAiTask.ts` | Генерация задач через AI |
| `useClientDashboard.ts` | Данные дашборда клиента (10KB) |
| `useClientUsageHistory.ts` | История использования клиентом |
| `useExpensesBoard.ts` | Доска расходов (13KB) |
| `useFieldAccess.ts` | RBAC контроль доступа к полям |
| `useGTDTasks.ts` | CRUD задач GTD (10KB) |
| `useGeoLocation.ts` | Геолокация устройства |
| `useKeyboardShortcuts.ts` | Горячие клавиши |
| `useOfflineStatus.ts` | Детекция offline режима |
| `usePWA.ts` | PWA install orchestration |
| `usePdfRasterizer.ts` | Растеризация PDF (для чертежей) |
| `useSessionManager.ts` | Управление таймером сессий (9KB) |
| `useSubordinates.ts` | Подчиненные сотрудники (иерархия) |
| `useSwipeGesture.ts` | Свайп жесты (iPad touch) |
| `useTasksMasonry.ts` | Логика masonry вида задач (14KB) |
| `useTeamProjectHistory.ts` | История проектов команды |
| `useVoiceInput.ts` | Голосовой ввод (Web Speech API) |
| `dashboard/` | Хуки дашборда |
| `finance/` | Финансовые хуки |
| `__tests__/` | Тесты хуков |

### `/src/pages/` — Страницы (40+)

#### Корневые страницы
| Файл | Маршрут | Назначение |
|------|---------|-----------|
| `DashboardPage.tsx` | `/dashboard` | Старый дашборд (legacy) |
| `ProfilePage.tsx` | `/profile` | Профиль пользователя |
| `SettingsPage.tsx` | `/settings` | Настройки |
| `AIReportsPage.tsx` | `/ai-reports` | AI-отчеты |
| `AboutProjectPage.tsx` | `/about` | О проекте (30KB) |
| `CodeDocumentationPage.tsx` | `/docs` | Документация кода (66KB) |
| `DevIndexPage.tsx` | `/dev-map` | Карта разработки (14KB) |
| `DevLogBlogPage.tsx` | `/blog` | Блог разработки (20KB) |
| `InfraMapPage.tsx` | `/admin/infra-map` | Карта инфраструктуры (33KB) |

#### `pages/admin/` — Админ-панель
| Файл | Маршрут | Назначение |
|------|---------|-----------|
| `CompanyDashboard.tsx` | `/admin/dashboard` | Главный дашборд компании (23KB) |
| `TeamAdminPage.tsx` | `/admin/team` | Управление командой (36KB) |
| `UserDetailPage.tsx` | `/admin/team/:userId` | Детали пользователя (46KB) |
| `CompaniesPage.tsx` | `/admin/companies` | Управление компаниями |
| `RolesPage.tsx` | `/admin/roles` | RBAC роли |
| `DevLogCreatePage.tsx` | `/admin/devlog/new` | Создание DevLog поста |

#### `pages/auth/` — Авторизация
| Файл | Маршрут | Назначение |
|------|---------|-----------|
| `LoginPage.tsx` | `/login` | Вход |
| `SignupPage.tsx` | `/signup` | Регистрация |
| `ForgotPasswordPage.tsx` | `/forgot-password` | Восстановление пароля |

#### `pages/crm/` — CRM модули (22 страницы)
| Файл | Маршрут | Назначение |
|------|---------|-----------|
| `ClientsPage.tsx` | `/crm/clients` | Список клиентов (68KB) |
| `ClientDetailsPage.tsx` | `/crm/clients/:id` | Детали клиента |
| `ClientBuilderPage.tsx` | `/crm/clients/new` | Создание клиента |
| `ContactsPage.tsx` | `/crm/contacts` | Контакты |
| `DealsPage.tsx` | `/crm/deals` | Воронка продаж |
| `LeadDetailsPage.tsx` | `/crm/leads/:id` | Детали лида |
| `UnifiedTasksPage.tsx` | `/crm/tasks` | Unified задачи |
| `UnifiedCockpitPage.tsx` | `/crm/cockpit/:taskId` | Cockpit View (104KB ⚠️) |
| `GTDPage.tsx` | `/crm/gtd` | GTD обертка |
| `GTDCreatePage.tsx` | `/crm/gtd/new` | Создание задачи (89KB ⚠️) |
| `TimeTrackingPage.tsx` | `/crm/time-tracking` | Тайм-трекинг |
| `FinancePage.tsx` | `/crm/finance` | Финансы (66KB) |
| `BankStatementsPage.tsx` | `/crm/bank-statements` | Банковские выписки (146KB ⚠️) |
| `ReconciliationPage.tsx` | `/crm/reconciliation` | Сверка |
| `ExpensesBoardPage.tsx` | `/crm/expenses-board` | Доска расходов |
| `CostsReportPage.tsx` | `/crm/costs` | Отчет по затратам |
| `ShoppingPage.tsx` | `/crm/shopping` | Списки покупок |
| `InventoryPage.tsx` | `/crm/inventory` | Склад (56KB) |
| `PayrollPeriodsPage.tsx` | `/crm/payroll-periods` | Зарплатные периоды |
| `TasksMasonryPage.tsx` | `/crm/tasks-masonry` | Masonry вид задач |
| `CalendarPage.tsx` | — (не в роутере) | Календарь (43KB) |
| `PayrollReport.tsx` | — (вспомогательный) | Зарплатный отчет |

#### `pages/estimates/` — Сметы (7 страниц)
| Файл | Маршрут | Назначение |
|------|---------|-----------|
| `EstimatesPage.tsx` | `/estimates` | Список смет |
| `EstimateBuilderPage.tsx` | `/estimates/new` | Конструктор сметы |
| `EstimateDetailPage.tsx` | `/estimates/projects/:id/versions/:id` | Детали версии |
| `ElectricalEstimatorPage.tsx` | `/estimates/electrical` | Электрический калькулятор (107KB ⚠️) |
| `SavedEstimatesPage.tsx` | `/estimates/projects` | Сохраненные сметы |
| `ProjectWorkspacePage.tsx` | `/estimates/projects/:id` | Рабочее пространство проекта |
| `SettingsCalculatorPage.tsx` | `/settings/calculator` | Настройки калькулятора |

#### Другие страницы
| Группа | Страницы |
|--------|---------|
| `pages/portal/` | `ClientPortalPage.tsx` — Портал клиента (публичный) |
| `pages/sites/` | `SiteDashboardPage.tsx` — Дашборд объекта |
| `pages/dashboard/` | `client/[id].tsx` — Дашборд клиента |
| `pages/debug/` | `SystemHealthCheck.tsx` — Диагностика системы |
| `pages/superadmin/` | `SuperAdminDashboard.tsx` — Супер-админ |

### `/src/router/` — Маршрутизация
| Файл | Назначение |
|------|-----------|
| `AppRouter.tsx` | Все маршруты приложения. ProtectedLayout + PublicRoute. Lazy loading. |

### `/src/services/` — Внешние сервисы
| Файл | Назначение |
|------|-----------|
| `contactsService.ts` | CRUD контактов (Firestore) |
| `geocodingService.ts` | Геокодирование адресов |
| `pdfToImageService.ts` | Конвертация PDF → изображение |

### `/src/types/` — TypeScript типы (24 файла)
| Файл | Описание |
|------|----------|
| `gtd.types.ts` | GTD задачи (28KB — самый большой тип) |
| `erp.types.ts` | ERP v4 типы (12KB) |
| `expensesBoard.types.ts` | Доска расходов (14KB) |
| `notes.types.ts` | Заметки и чеклисты (12KB) |
| `crm.types.ts` | CRM сущности |
| `blueprint.types.ts` | Чертежи и AI pipeline |
| `rbac.types.ts` | RBAC роли и разрешения |
| `inventory.types.ts` | Склад |
| `dashboard.types.ts` | Дашборд |
| `user.types.ts` | Пользователи |
| `timeTracking.types.ts` | Тайм-трекинг |
| `estimate.types.ts` | Сметы |
| `devlog.types.ts` | DevLog |
| `project.types.ts` | Проекты |
| `finance.types.ts` | Финансы |
| `payroll.types.ts` | Зарплаты |
| `report.types.ts` | Отчеты |
| `invoice.types.ts` | Счета |
| `contact.types.ts` | Контакты |
| `task.types.ts` | Задачи (legacy) |
| `savedEstimate.types.ts` | Сохраненные сметы |
| `aiEstimate.types.ts` | AI оценки |
| `aiSmartInput.types.ts` | Smart Input AI |
| `uuid.d.ts` | Декларация uuid |

### `/src/utils/` — Утилиты (8 файлов)
| Файл | Назначение |
|------|-----------|
| `circuitBreaker.ts` | Circuit Breaker паттерн (защита от каскадных ошибок) |
| `dataSecurityUtils.ts` | Утилиты безопасности данных |
| `dateFormatters.ts` | Форматирование дат и длительности |
| `employeeUtils.ts` | Утилиты для работы с сотрудниками |
| `estimateValidation.ts` | Валидация смет |
| `exportBlueprintPdf.ts` | Экспорт чертежа в PDF |
| `geoUtils.ts` | Геолокационные утилиты |
| `hierarchyUtils.ts` | Утилиты иерархии (оргструктура, 9KB) |

---

## ⚡ `/functions/` — Firebase Cloud Functions (Backend)

### `/functions/src/` — Исходники

#### Корневые файлы
| Файл | Назначение |
|------|-----------|
| `index.ts` | Главный экспорт (675 строк, 70+ exports) |
| `index_v2.ts` | V2 функции (дополнительные) |
| `activityLogger.ts` | Логирование активности (BigQuery audit) |
| `adminCreateUserWithPassword.ts` | Создание юзера с паролем (admin callable) |
| `adminManageUser.ts` | Управление пользователем (пароль, telegram, logout) |
| `avatarProcessor.ts` | Обработка аватаров (Sharp) |
| `brevoWebhook.ts` | Вебхук Brevo (email tracking) |
| `brevoStatusChecker.ts` | Проверка статуса Brevo |
| `metricsAggregation.ts` | Агрегация метрик дашборда |
| `monitorPaginationCosts.ts` | Мониторинг стоимости пагинации |

#### `agent/` — OpenClaw Agent API
| Файл | Назначение |
|------|-----------|
| `agentApi.ts` | Express REST API для агентов |
| `agentHelpers.ts` | Хелперы агента (user lookup, task creation) |
| `agentMiddleware.ts` | Auth middleware (Bearer token) |
| `agentScheduled.ts` | CRON для агентов (invalidate cache, cleanup) |
| `routeContext.ts` | Контекст маршрутов |
| `routes/` | REST маршруты |
| `schemas/` | Zod схемы валидации |
| `utils/` | Утилиты агента |

#### `api/` — REST API
| Файл | Назначение |
|------|-----------|
| `erpV4Api.ts` | ERP v4: Punch List, Work Acts, Payment Schedule, Warranty, NPS, Plan vs Fact (25KB) |
| `qualityLoop.ts` | Quality Loop: submitForReview, verifyTask |

#### `callable/` — Callable Functions (8 групп)
| Директория | Функции |
|-----------|---------|
| `admin/` | `forceFinishAllSessions` — Принудительное завершение всех сессий |
| `ai/` | `analyzePage`, `analyzeBlueprintV3`, `estimateTask`, `generateAiTask`, `modifyAiTask`, `generateLeadSummary`, `parseSmartInput`, `parseClientWebsite`, `verifyEstimatePlausibility`, `scopeMatcher` |
| `finance/` | `uploadBankStatement`, `categorizeBankTransactions` |
| `gtd/` | `generateDayPlan`, `moveGtdTask` |
| `messaging/` | `sendMessage`, `sendWorkerMessage` |
| `notes/` | `splitChecklistItem`, `mergeNotes`, `generatePriceEstimate` |
| `payroll/` | `closePayrollPeriod` |
| `sessions/` | `updateWorkSession` |

#### `email/` — Email сервис
| Файл | Назначение |
|------|-----------|
| `emailService.ts` | Nodemailer + Brevo. Отправка приглашений, уведомлений |
| `templates/` | HTML шаблоны писем |

#### `exports/` — Генерация отчетов
| Файл | Назначение |
|------|-----------|
| `generateProjectDigest.ts` | PDF дайджест проекта |

#### `http/` — HTTP endpoints
| Файл | Назначение |
|------|-----------|
| `diagnoseBot.ts` | Диагностика Telegram бота |

#### `notifications/` — Уведомления
| Файл | Назначение |
|------|-----------|
| `alertNotifications.ts` | Бюджетные и дедлайн алерты (каждые 6 часов) |

#### `scheduled/` — CRON задачи (9)
| Файл | Расписание | Назначение |
|------|-----------|-----------|
| `autoStopStaleTimers.ts` | Периодически | Остановка зависших таймеров |
| `checkLongBreaks.ts` | Периодически | Проверка длинных перерывов |
| `checkLongSessions.ts` | Периодически | Проверка сессий > N часов |
| `deadlineReminders.ts` | Периодически | Напоминания о дедлайнах GTD |
| `finalizeExpiredSessions.ts` | Периодически | Финализация истекших сессий |
| `generateDailyPayroll.ts` | Ежедневно | Генерация зарплатных записей |
| `monitorFunctionLoops.ts` | — (отключен) | Мониторинг петель функций |
| `scheduledDayPlan.ts` | Утром | AI планирование дня |
| `sendSessionReminders.ts` | — (отключен) | Напоминания о сессиях |

#### `services/` — AI сервисы (9 файлов)
| Файл | Назначение |
|------|-----------|
| `blueprintAIService.ts` | AI обработка чертежей (Gemini Vision, 35KB) |
| `contextResolver.ts` | Резолвер контекста для AI |
| `costsAIService.ts` | AI категоризация расходов |
| `faceVerificationService.ts` | Верификация лица (Cloud Vision) |
| `receiptOcrService.ts` | OCR чеков |
| `shoppingAIService.ts` | AI парсинг списков покупок |
| `shoppingBotService.ts` | Сервис бота покупок |
| `smartDispatcherService.ts` | Smart Dispatcher (роутинг интентов, 17KB) |
| `telegramAIAssistant.ts` | AI ассистент Telegram |

#### `triggers/` — Firestore/Auth триггеры (8 групп)
| Директория | Триггеры |
|-----------|---------|
| `crons/` | `autoCloseStaleSessions` — Автозакрытие сессий |
| `firestore/` | `calculateActualCost`, `onBlueprintBatchCreated`, `onBlueprintJobCreated`, `onCostCreated`, `onNoteCreated`, `onTaskCreate`, `onTaskUpdate` |
| `leads/` | `onLeadCreate` — Обработка нового лида |
| `receipts/` | `onReceiptUpdate` — Обновление чека → ledger |
| `telegram/` | `onWorkerBotMessage` (113KB ⚠️), `onCostsBotMessage`, `onTelegramMessage`, handlers/, rateUtils, telegramUtils |
| `users/` | `incrementLoginCount`, `logUserUpdates`, `trackUserActivation`, `updateCompanyMemberCount` |
| `whatsapp/` | `onWhatsAppMessage` |
| `workSessions/` | `onWorkSessionCreate`, `onWorkSessionUpdate` |

#### `types/` — Backend типы
| Файл | Назначение |
|------|-----------|
| `aiAccuracy.ts` | Типы точности AI |
| `aiCache.ts` | Типы кеша AI |
| `aiEstimate.ts` | AI оценки |
| `aiTemplates.ts` | Шаблоны AI промптов |
| `blueprint.types.ts` | Типы чертежей |

#### `utils/` — Backend утилиты (9)
| Файл | Назначение |
|------|-----------|
| `aiCacheUtils.ts` | Кеширование AI ответов |
| `auditLogger.ts` | Логирование в BigQuery |
| `bankAIParser.ts` | AI парсер банковских выписок (12KB) |
| `constants.ts` | Константы |
| `estimateValidation.ts` | Валидация смет |
| `geoUtils.ts` | Геоутилиты (расчет дистанций) |
| `guards.ts` | Auth guards и проверки ролей (8KB) |
| `templateMatcher.ts` | Сопоставление шаблонов |
| `workerMessaging.ts` | Отправка сообщений рабочим |

---

## 📖 Вспомогательные папки

### `/crm_api/` — Документация Agent API
| Файл | Назначение |
|------|-----------|
| `API_INSTRUCTION.md` | Полная документация REST API (28KB) |
| `IMPROVEMENTS.md` | Предложения по улучшению |
| `TEST_RESULTS.md` | Результаты тестов |
| `USE_CASES.md` | Сценарии использования |
| `backups/` | Бэкапы |

### `/docs/` — Пользовательская документация
| Файл | Назначение |
|------|-----------|
| `CRM_MODULE.md` | Документация CRM |
| `FINANCE_MODULE.md` | Документация финансов |
| `GTD_TASK_CREATION.md` | Документация создания задач GTD |
| `SHOPPING_MODULE.md` | Документация покупок |
| `TECHNICAL_API.md` | Техническое API |
| `TELEGRAM_BOT.md` | Документация Telegram бота |
| `TIME_TRACKING.md` | Документация тайм-трекинга |
| `USER_GUIDE.md` | Руководство пользователя |
| `legacy-nov2025/` | Устаревшая документация |

### `/scripts/` — Утилитарные скрипты (23 файла)
| Файл | Назначение |
|------|-----------|
| `seedTestData.ts` | Генерация тестовых данных |
| `seed-devlog.js` / `seed-devlog-admin.js` | Seed DevLog постов |
| `seed-wiki-core.js` | Seed Wiki |
| `publish-*.js` (6 файлов) | Публикация devlog постов |
| `migrate-*.js/ts` (3 файла) | Миграции данных |
| `refactor-*.js` (2 файла) | Рефакторинг скрипты |
| `check-user-role.js` | Проверка роли пользователя |
| `link-denis-telegram.*` | Привязка Telegram аккаунта |
| `load-pasco-inspectors.*` | Загрузка инспекторов |
| `monitor-production.sh` | Мониторинг продакшна |
| `stamp-sw.js` | Штамповка Service Worker |
| `broadcast-bot-instruction.js` | Рассылка через бота |

### `/billing-shutdown-function/` — Аварийный стоп
Отдельная Cloud Function для автоматического отключения сервисов при превышении бюджета Google Cloud.

### `/performance/` — Тесты производительности
| Файл | Назначение |
|------|-----------|
| `lighthouse.test.js` | Lighthouse CI тесты |

### `/cypress/` — E2E тесты
| Директория | Назначение |
|-----------|-----------|
| `e2e/` | Сценарии тестов |
| `support/` | Вспомогательные команды |

### `/public/` — Статические ресурсы
| Элемент | Назначение |
|---------|-----------|
| `index.html` | HTML точка входа |
| `manifest.json` | PWA манифест |
| `service-worker.js` | Service Worker |
| `*.png` / `*.ico` | Иконки приложения |
| `pdf.worker.min.mjs` | PDF.js воркер (1MB) |
| `promo*/` | Промо-лендинги |
| `saas-landing/` | SaaS лендинг |
| `visa-aggregator-landing/` | Лендинг визового агрегатора |
| `coffee-subscription-premium/` | Лендинг кофейной подписки |

### `/_archived/` — Архив
| Директория | Назначение |
|-----------|-----------|
| `timer-v2-fsm/` | Archived: Timer V2 Finite State Machine (заменен текущей реализацией) |

---

## ⚙️ Конфигурационные файлы

| Файл | Назначение |
|------|-----------|
| `firebase.json` | Firebase проект (Firestore, Functions, Storage, Hosting, Emulators) |
| `.firebaserc` | Firebase project alias |
| `firestore.rules` | Правила безопасности Firestore (22KB) |
| `firestore.indexes.json` | Индексы Firestore (13KB) |
| `storage.rules` | Правила безопасности Storage |
| `tsconfig.json` | TypeScript конфиг (frontend) |
| `package.json` | npm зависимости (frontend) |
| `.oxlintrc.json` | Конфиг Oxlint |
| `.oxfmtrc.jsonc` | Конфиг Oxfmt |
| `jest.config.js` | Конфиг Jest |
| `cypress.config.ts` | Конфиг Cypress |
| `.env` / `.env.local` | Переменные окружения |
| `CODE_ARCHITECTURE.md` | Архитектура кода (legacy, частичная) |
| `README.md` | README проекта |
