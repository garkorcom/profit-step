/**
 * @fileoverview Code Documentation Page
 *
 * Comprehensive documentation of every module, page, hook, API, and component
 * in the Profit Step platform. Serves as the living technical reference for the
 * entire codebase.
 */

import React, { useState } from 'react';
import {
    Box,
    Container,
    Typography,
    Paper,
    Chip,
    Avatar,
    Accordion,
    AccordionSummary,
    AccordionDetails,
    alpha,
    useTheme,
    IconButton,
    Tooltip,
    Divider,
    List,
    ListItem,
    ListItemIcon,
    ListItemText,
    Button,
} from '@mui/material';
import {
    ExpandMore as ExpandMoreIcon,
    Assignment as TaskIcon,
    CalendarMonth as CalendarIcon,
    AttachMoney as FinanceIcon,
    AccountBalance as BankIcon,
    SmartToy as AIIcon,
    ShoppingCart as ShoppingIcon,
    Inventory as InventoryIcon,
    People as TeamIcon,
    Telegram as BotIcon,
    Storage as DWHIcon,
    Build as InfraIcon,
    Code as CodeIcon,
    UnfoldMore as ExpandAllIcon,
    UnfoldLess as CollapseAllIcon,
    Description as FileIcon,
    Folder as FolderIcon,
    Functions as FunctionsIcon,
    Api as ApiIcon,
    Extension as HookIcon,
    Category as TypesIcon,
    Widgets as WidgetIcon,
    Calculate as CalcIcon,
    Dashboard as DashIcon,
    Timer as TimerIcon,
    Layers as LayersIcon,
    ArrowBack as ArrowBackIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

// ═══════════════════════════════════════
// MODULE DATA
// ═══════════════════════════════════════

interface ModuleFile {
    name: string;
    description: string;
    type: 'page' | 'component' | 'hook' | 'api' | 'type' | 'service' | 'util' | 'function';
}

interface ModuleDoc {
    id: string;
    name: string;
    icon: React.ReactNode;
    description: string;
    detailedDescription: string;
    color: string;
    status: 'production' | 'beta' | 'active';
    techStack: string[];
    files: ModuleFile[];
}

const MODULES: ModuleDoc[] = [
    {
        id: 'gtd',
        name: 'GTD / Task Management',
        icon: <TaskIcon />,
        description: 'Kanban-доска, визард создания задач, Cockpit View, чек-листы',
        detailedDescription: `Полноценная система управления задачами по методологии GTD (Getting Things Done). 
Включает Kanban-доску с 6 колонками (Inbox, Next Actions, Waiting For, Scheduled, Someday, Done), 
4-шаговый визард создания задач с AI-оценкой приоритета и типа, детальную страницу задачи (Cockpit View) 
с подзадачами, материалами, таймером и AI-анализом. Поддержка Drag & Drop, фильтрации, сортировки, 
real-time подписок через Firestore onSnapshot. Оптимизирован для планшетов и foldable-устройств.`,
        color: '#3b82f6',
        status: 'production',
        techStack: ['React', 'MUI', 'Firestore', 'DnD Kit', 'Gemini AI', 'Web Speech API'],
        files: [
            { name: 'GTDPage.tsx', description: 'Входная точка модуля GTD — рендерит GTDBoard', type: 'page' },
            { name: 'GTDCreatePage.tsx', description: '4-шаговый визард создания задач (клиент → тип/приоритет → исполнители → детали). 92KB, AI-анализ, голосовой ввод', type: 'page' },
            { name: 'UnifiedCockpitPage.tsx', description: 'Детальная страница задачи (Cockpit View): подзадачи, материалы, таймер, AI Fill, история изменений. 73KB', type: 'page' },
            { name: 'TasksMasonryPage.tsx', description: 'Touch Board — альтернативная masonry-доска для планшетов и foldable', type: 'page' },
            { name: 'useGTDTasks.ts', description: 'Хук для CRUD операций с задачами, real-time подписки, Drag & Drop логика', type: 'hook' },
            { name: 'useSessionManager.ts', description: 'Централизованная логика старта/стопа рабочих сессий, привязка к задачам', type: 'hook' },
            { name: 'useAiTask.ts', description: 'AI-оценка задач: приоритет, тип, время, подзадачи через Gemini', type: 'hook' },
            { name: 'useTasksMasonry.ts', description: 'Данные и логика для Touch Board: группировка, фильтрация, жесты', type: 'hook' },
            { name: 'useKeyboardShortcuts.ts', description: 'Горячие клавиши для GTD-доски', type: 'hook' },
            { name: 'useSwipeGesture.ts', description: 'Свайп-жесты для переключения колонок на мобильных', type: 'hook' },
            { name: 'gtd.types.ts', description: 'Типы GTDTask, GTDStatus, ChecklistItem, SubTask, Material. 23KB полная модель', type: 'type' },
            { name: 'components/gtd/', description: '16 компонентов: GTDBoard, GTDColumn, GTDCard, GTDFilters, GTDEditDialog и др.', type: 'component' },
        ],
    },
    {
        id: 'calendar',
        name: 'Календарь',
        icon: <CalendarIcon />,
        description: 'Notion/Google-style календарь с Day View, Drag & Drop, Quick Add',
        detailedDescription: `Визуальный календарь задач в стиле Google Calendar / Notion. 
Режимы: месяц и день (Day View с почасовой сеткой). Drag & Drop перенос задач между датами, 
Quick Add для быстрого создания задач в выбранный слот, фильтрация по колонкам GTD, 
плавные анимации и градиентные карточки задач с цветовой кодировкой по приоритету.`,
        color: '#10b981',
        status: 'production',
        techStack: ['React', 'MUI', 'date-fns', 'DnD'],
        files: [
            { name: 'CalendarPage.tsx', description: 'Полный Calendar View: месяц/день, навигация, фильтры, drag & drop. 42KB', type: 'page' },
        ],
    },
    {
        id: 'clients',
        name: 'Клиенты / CRM',
        icon: <TeamIcon />,
        description: 'Управление клиентами, контактами, локациями, сделками',
        detailedDescription: `CRM-модуль для управления клиентской базой. Включает таблицу клиентов с поиском, 
фильтрацией по статусу, сортировкой; детальную страницу клиента с dashboard (задачи, сессии, расходы); 
форму создания/редактирования клиента (Client Builder); карточки сделок (Deals/Leads) с воронкой продаж; 
локации клиентов с геокодированием; контактный реестр; навигацию к созданию задач из карточки клиента.`,
        color: '#0ea5e9',
        status: 'production',
        techStack: ['React', 'MUI', 'Firestore', 'Google Maps Geocoding'],
        files: [
            { name: 'ClientsPage.tsx', description: 'Таблица клиентов с поиском, фильтрами статуса, Actions (задачи, детали). 53KB', type: 'page' },
            { name: 'ClientDetailsPage.tsx', description: 'Детальная карточка клиента: dashboard с задачами, сессиями, расходами', type: 'page' },
            { name: 'ClientBuilderPage.tsx', description: 'Форма создания и редактирования клиента', type: 'page' },
            { name: 'DealsPage.tsx', description: 'Воронка сделок (Leads Pipeline): этапы, конверсия, карточки лидов', type: 'page' },
            { name: 'LeadDetailsPage.tsx', description: 'Детальная страница лида с историей коммуникаций', type: 'page' },
            { name: 'useClientDashboard.ts', description: 'Хук для агрегации данных клиента: задачи, сессии, финансы', type: 'hook' },
            { name: 'useClientUsageHistory.ts', description: 'История использования и активности клиента', type: 'hook' },
            { name: 'crm.types.ts', description: 'Типы Client, Lead, Deal, Contact, Location', type: 'type' },
            { name: 'crmApi.ts', description: 'API для CRUD операций с клиентами и лидами', type: 'api' },
        ],
    },
    {
        id: 'finance',
        name: 'Финансы и Платежи',
        icon: <FinanceIcon />,
        description: 'Учёт расходов, зарплата, ставки, отчёты, PayrollPeriods',
        detailedDescription: `Финансовый модуль платформы. Управление доходами и расходами с категоризацией, 
ставки сотрудников (hourlyRate) с историей изменений, автоматический расчёт зарплат на основе рабочих сессий, 
PayrollPeriods — выгрузка периодов для бухгалтерии, CostsReport — отчёт по затратам с фильтрацией 
по проектам и категориям, ExpensesBoard — доска расходов. PDF-генерация отчётов.`,
        color: '#f59e0b',
        status: 'production',
        techStack: ['React', 'MUI', 'Firestore', 'jsPDF', 'Recharts'],
        files: [
            { name: 'FinancePage.tsx', description: 'Основная финансовая страница: ledger, платежи, баланс, графики. 62KB', type: 'page' },
            { name: 'PayrollPeriodsPage.tsx', description: 'Управление периодами зарплат: создание, расчёт, экспорт', type: 'page' },
            { name: 'PayrollReport.tsx', description: 'Отчёт по зарплатам за период с детализацией по сотрудникам', type: 'page' },
            { name: 'CostsReportPage.tsx', description: 'Отчёт по затратам: группировка по проектам, категориям, PDF export', type: 'page' },
            { name: 'ExpensesBoardPage.tsx', description: 'Kanban-доска расходов по категориям', type: 'page' },
            { name: 'useExpensesBoard.ts', description: 'Хук для управления доской расходов', type: 'hook' },
            { name: 'rateApi.ts', description: 'API для управления ставками сотрудников', type: 'api' },
            { name: 'payroll.types.ts', description: 'Типы PayrollPeriod, PayrollEntry, RateHistory', type: 'type' },
            { name: 'expensesBoard.types.ts', description: 'Типы для доски расходов. 13KB детальная модель', type: 'type' },
        ],
    },
    {
        id: 'bank',
        name: 'Bank Statements',
        icon: <BankIcon />,
        description: 'AI-парсинг банковских выписок, категоризация, Schedule C PDF',
        detailedDescription: `Модуль AI-парсинга банковских выписок. Загрузка CSV/PDF выписок, автоматическая 
AI-категоризация транзакций через Gemini (Income/Expense классификация с суффиксами), 
детекция рекуррентных платежей, поиск по vendors, привязка чеков к транзакциям, 
генерация Schedule C PDF отчёта для налоговой отчётности. Самый большой файл — 146KB.`,
        color: '#6366f1',
        status: 'production',
        techStack: ['React', 'MUI', 'Gemini AI', 'jsPDF', 'Papa Parse'],
        files: [
            { name: 'BankStatementsPage.tsx', description: 'Полный модуль парсинга выписок: загрузка, AI-категоризация, Schedule C. 146KB', type: 'page' },
        ],
    },
    {
        id: 'time-tracking',
        name: 'Тайм-трекинг',
        icon: <TimerIcon />,
        description: 'Учёт рабочего времени, сессии, отчёты с детализацией',
        detailedDescription: `Модуль учёта рабочего времени. Старт/стоп сессий через веб-интерфейс или Telegram бот, 
привязка сессий к задачам и проектам, автоматический расчёт стоимости по ставке сотрудника, 
детальные отчёты по периодам с фильтрацией по сотрудникам и проектам, экспорт данных.`,
        color: '#8b5cf6',
        status: 'production',
        techStack: ['React', 'MUI', 'Firestore', 'date-fns'],
        files: [
            { name: 'TimeTrackingPage.tsx', description: 'Отчёт по рабочим сессиям: фильтры, группировка, суммы по проектам', type: 'page' },
            { name: 'useSessionManager.ts', description: 'Хук для старта, паузы и завершения рабочих сессий', type: 'hook' },
            { name: 'useActiveSession.ts', description: 'Отслеживание текущей активной сессии пользователя', type: 'hook' },
            { name: 'timeTracking.types.ts', description: 'Типы WorkSession, SessionStatus, TimeEntry', type: 'type' },
            { name: 'components/time-tracking/', description: '8 компонентов для отображения сессий и отчётов', type: 'component' },
        ],
    },
    {
        id: 'shopping',
        name: 'Закупки',
        icon: <ShoppingIcon />,
        description: 'Списки закупок, мультивыбор, чеки, мобильный UX',
        detailedDescription: `Модуль закупок для строительных проектов. Списки материалов с привязкой к проектам, 
мультивыбор товаров для одновременной покупки, загрузка чеков (фото), отложенный ввод цен 
для проверки менеджером. Mobile-first интерфейс, интеграция с Telegram ботом для закупок "в поле".`,
        color: '#14b8a6',
        status: 'production',
        techStack: ['React', 'MUI', 'Firestore', 'Firebase Storage'],
        files: [
            { name: 'ShoppingPage.tsx', description: 'Страница закупок: списки, категории, чеки, статусы', type: 'page' },
        ],
    },
    {
        id: 'inventory',
        name: 'Склад / Inventory',
        icon: <InventoryIcon />,
        description: 'Каталог материалов, транзакции, локации, real-time подписки',
        detailedDescription: `Модуль управления инвентарём. Каталог товаров с категоризацией, отслеживание 
транзакций (приход/расход/перемещение), управление складскими локациями, real-time обновления 
через Firestore onSnapshot, фильтрация транзакций по типу и периоду, Snackbar-уведомления.`,
        color: '#78716c',
        status: 'production',
        techStack: ['React', 'MUI', 'Firestore onSnapshot'],
        files: [
            { name: 'InventoryPage.tsx', description: 'Страница инвентаря: каталог, транзакции, локации. 56KB', type: 'page' },
            { name: 'inventory.types.ts', description: 'Типы CatalogItem, Transaction, Location. 6KB', type: 'type' },
            { name: 'inventoryService.ts', description: 'Сервис с real-time подписками для инвентаря', type: 'service' },
        ],
    },
    {
        id: 'ai',
        name: 'AI & Автоматизация',
        icon: <AIIcon />,
        description: 'Gemini AI: оценка задач, Smart Input, голосовые отчёты',
        detailedDescription: `AI-платформа на базе Google Gemini 2.0 Flash. Модули: AI Task Estimation (оценка 
времени, сложности, подзадач), Smart Input (NLP-парсинг текста для создания задач), Smart Dispatcher 
(маршрутизация Telegram сообщений), Voice Reports (транскрипция голосовых отчётов), Receipt OCR 
(распознавание чеков), AI Planner (планирование задач), Bank Statement Classification, 
Price Estimation (оценка стоимости работ). Кэширование результатов, обучение на корректировках.`,
        color: '#ec4899',
        status: 'production',
        techStack: ['Gemini 2.0 Flash', 'Vertex AI', 'Google AI SDK', 'Cloud Functions'],
        files: [
            { name: 'AIReportsPage.tsx', description: 'Дашборд AI-отчётов и голосовых сообщений', type: 'page' },
            { name: 'useAiTask.ts', description: 'Хук для AI-оценки задач: приоритет, время, подзадачи', type: 'hook' },
            { name: 'aiApi.ts', description: 'API для вызова AI-функций (оценка, анализ)', type: 'api' },
            { name: 'aiTaskApi.ts', description: 'API для AI-анализа задач: parseSmartInput, estimateTask', type: 'api' },
            { name: 'aiEstimate.types.ts', description: 'Типы AIEstimation, TaskAnalysis', type: 'type' },
            { name: 'aiSmartInput.types.ts', description: 'Типы для Smart Input парсинга', type: 'type' },
            { name: 'callable/estimateTask.ts', description: 'Cloud Function: AI-оценка задачи через Gemini', type: 'function' },
            { name: 'callable/parseSmartInput.ts', description: 'Cloud Function: NLP-парсинг текста задачи', type: 'function' },
        ],
    },
    {
        id: 'team',
        name: 'Команда & RBAC',
        icon: <TeamIcon />,
        description: 'Управление пользователями, ролями, иерархией, компаниями',
        detailedDescription: `Модуль управления командой с RBAC (Role-Based Access Control). 
Иерархия ролей (SuperAdmin → Admin → Manager → Worker), field-level security, 
управление компаниями (multi-tenant), приглашение пользователей через Brevo email, 
детальная страница пользователя с профилем, паролем, безопасностью и активностью, 
Server-Side Pagination для больших команд, offboarding процесс.`,
        color: '#0ea5e9',
        status: 'production',
        techStack: ['React', 'MUI', 'Firebase Auth', 'Firestore', 'Brevo API'],
        files: [
            { name: 'TeamAdminPage.tsx', description: 'Таблица пользователей компании: фильтры, пагинация, invite. 35KB', type: 'page' },
            { name: 'UserDetailPage.tsx', description: 'Детальная страница пользователя: профиль, пароль, security, dashboard. 46KB', type: 'page' },
            { name: 'CompaniesPage.tsx', description: 'Управление компаниями (multi-tenant)', type: 'page' },
            { name: 'CompanyDashboard.tsx', description: 'Главный дашборд: KPI команды, маркетинг, лиды', type: 'page' },
            { name: 'RolesPage.tsx', description: 'Управление ролями и правами доступа', type: 'page' },
            { name: 'useFieldAccess.ts', description: 'Хук для проверки доступа к полям на основе роли', type: 'hook' },
            { name: 'useSubordinates.ts', description: 'Хук для получения подчинённых пользователя', type: 'hook' },
            { name: 'userApi.ts', description: 'API для управления пользователями', type: 'api' },
            { name: 'userDetailApi.ts', description: 'API для детальной страницы пользователя', type: 'api' },
            { name: 'userManagementApi.ts', description: 'API для административного управления: invite, block, delete. 19KB', type: 'api' },
            { name: 'rbac.types.ts', description: 'Типы Role, Permission, AccessLevel', type: 'type' },
            { name: 'user.types.ts', description: 'Типы UserProfile, PlatformUser', type: 'type' },
        ],
    },
    {
        id: 'bot',
        name: 'Telegram Bot',
        icon: <BotIcon />,
        description: 'Worker Bot: тайм-трекинг, закупки, голосовые, GPS-детекция',
        detailedDescription: `Telegram-бот для полевых работников. Функции: старт/стоп рабочих сессий с автоматическим 
расчётом зарплаты, GPS-детекция проекта по фото (EXIF-координаты), закупки с мультивыбором и загрузкой 
чеков, голосовая транскрипция через Gemini для создания GTD-задач, синхронизация с веб-интерфейсом 
через Firestore триггеры, модульная архитектура (handlers), Smart Dispatcher для маршрутизации сообщений.`,
        color: '#0088cc',
        status: 'production',
        techStack: ['Node.js', 'Telegraf', 'Cloud Functions', 'Gemini AI', 'Firestore'],
        files: [
            { name: 'onWorkerBotMessage.ts', description: 'Главный handler Telegram-бота: маршрутизация сообщений', type: 'function' },
            { name: 'handlers/inboxHandler.ts', description: 'Handler голосовых сообщений и GTD-задач', type: 'function' },
            { name: 'handlers/shoppingHandler.ts', description: 'Handler закупок: мультивыбор, чеки', type: 'function' },
            { name: 'handlers/sessionHandler.ts', description: 'Handler рабочих сессий: старт/стоп/пауза', type: 'function' },
            { name: 'handlers/photoHandler.ts', description: 'Handler фотоотчётов с GPS-извлечением', type: 'function' },
        ],
    },
    {
        id: 'estimates',
        name: 'Сметы / Estimates',
        icon: <CalcIcon />,
        description: 'Калькулятор смет, электрические расчёты, шаблоны',
        detailedDescription: `Модуль создания и управления сметами на строительные работы. 
Estimate Builder — визуальный конструктор смет с позициями, категориями и расчётом итогов. 
Electrical Estimator — специализированный калькулятор для электромонтажных работ 
с библиотекой материалов и нормативами. Список смет с фильтрацией и поиском.`,
        color: '#d97706',
        status: 'active',
        techStack: ['React', 'MUI', 'Firestore'],
        files: [
            { name: 'EstimatesPage.tsx', description: 'Список смет с фильтрами и поиском', type: 'page' },
            { name: 'EstimateBuilderPage.tsx', description: 'Конструктор смет: позиции, категории, расчёт итогов', type: 'page' },
            { name: 'ElectricalEstimatorPage.tsx', description: 'Калькулятор электромонтажных работ. 65KB', type: 'page' },
            { name: 'estimatesApi.ts', description: 'API для CRUD операций со сметами', type: 'api' },
            { name: 'estimate.types.ts', description: 'Типы Estimate, EstimateItem, Category', type: 'type' },
        ],
    },
    {
        id: 'dwh',
        name: 'Data Warehouse',
        icon: <DWHIcon />,
        description: 'BigQuery интеграция, ELT pipeline, аудит-события',
        detailedDescription: `Модуль Data Warehouse на Google BigQuery. Гибридный ELT pipeline: Extension-based 
(Firebase → BigQuery) + Custom Triggers для аудит-событий. Централизованный auditLogger записывает 
события (создание/обновление/удаление задач, расходов) в BigQuery через Cloud Functions триггеры. 
Партиционированные таблицы, формат audit_events, автоматическая агрегация метрик.`,
        color: '#4285f4',
        status: 'beta',
        techStack: ['BigQuery', 'Cloud Functions', 'Firestore Triggers'],
        files: [
            { name: 'activityLogger.ts', description: 'Централизованный логгер аудит-событий для BigQuery', type: 'function' },
            { name: 'metricsAggregation.ts', description: 'Агрегация метрик из BigQuery', type: 'function' },
        ],
    },
    {
        id: 'infra',
        name: 'Инфраструктура',
        icon: <InfraIcon />,
        description: 'PWA, Firebase, anti-loop guards, CI/CD, оптимизации',
        detailedDescription: `Инфраструктурный слой платформы. PWA (Progressive Web App) с установкой на устройства, 
сервис-воркер для офлайн-режима, Firebase Hosting для деплоя. Anti-loop guards для предотвращения 
бесконечных циклов в Cloud Functions триггерах (idempotency). Lazy loading всех страниц через 
React.lazy() и Suspense. Firebase Authentication для авторизации. Мониторинг Firestore operations.`,
        color: '#64748b',
        status: 'production',
        techStack: ['Firebase', 'PWA', 'React.lazy', 'Workbox', 'Cloud Functions v2'],
        files: [
            { name: 'usePWA.ts', description: 'Хук для PWA: install prompt, offline status', type: 'hook' },
            { name: 'useOfflineStatus.ts', description: 'Отслеживание офлайн-статуса', type: 'hook' },
            { name: 'useGeoLocation.ts', description: 'Хук геолокации для GPS-функций', type: 'hook' },
            { name: 'AppRouter.tsx', description: 'Роутер приложения: 40+ маршрутов, lazy loading, guards', type: 'component' },
            { name: 'MainLayout.tsx', description: 'Основной layout: Header + Content + Footer', type: 'component' },
            { name: 'Header.tsx', description: 'Навигационный header с меню модулей', type: 'component' },
            { name: 'Footer.tsx', description: 'Footer приложения (скрыт на GTD-страницах)', type: 'component' },
            { name: 'firebase.ts', description: 'Инициализация Firebase App, Auth, Firestore, Storage', type: 'service' },
        ],
    },
];

// ═══════════════════════════════════════
// STATS & HELPERS
// ═══════════════════════════════════════

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
    production: { label: 'Production', color: '#22c55e' },
    beta: { label: 'Beta', color: '#f59e0b' },
    active: { label: 'В разработке', color: '#3b82f6' },
};

const FILE_TYPE_ICONS: Record<string, React.ReactNode> = {
    page: <FileIcon fontSize="small" />,
    component: <WidgetIcon fontSize="small" />,
    hook: <HookIcon fontSize="small" />,
    api: <ApiIcon fontSize="small" />,
    type: <TypesIcon fontSize="small" />,
    service: <FunctionsIcon fontSize="small" />,
    util: <CodeIcon fontSize="small" />,
    function: <FunctionsIcon fontSize="small" />,
};

const FILE_TYPE_COLORS: Record<string, string> = {
    page: '#3b82f6',
    component: '#8b5cf6',
    hook: '#ec4899',
    api: '#f59e0b',
    type: '#10b981',
    service: '#6366f1',
    util: '#64748b',
    function: '#0ea5e9',
};

const FILE_TYPE_LABELS: Record<string, string> = {
    page: 'Страница',
    component: 'Компонент',
    hook: 'Хук',
    api: 'API',
    type: 'Типы',
    service: 'Сервис',
    util: 'Утилита',
    function: 'Cloud Function',
};

// ═══════════════════════════════════════
// ARCHITECTURE DATA
// ═══════════════════════════════════════

const ARCHITECTURE_SECTIONS = [
    {
        title: 'src/pages/',
        icon: <FileIcon />,
        color: '#3b82f6',
        description: '30+ страниц приложения',
        items: [
            'crm/ — 20 страниц CRM модулей (GTD, Calendar, Finance, Clients...)',
            'admin/ — 5 страниц администрирования (Team, Companies, Roles)',
            'estimates/ — 3 страницы калькулятора смет',
            'superadmin/ — 1 суперадмин дашборд',
            'auth/ — 3 страницы авторизации (Login, Signup, ForgotPassword)',
            'DashboardPage, ProfilePage, SettingsPage, AboutProjectPage, DevIndexPage',
        ],
    },
    {
        title: 'src/hooks/',
        icon: <HookIcon />,
        color: '#ec4899',
        description: '16 custom React hooks',
        items: [
            'useGTDTasks — CRUD и real-time подписки для задач',
            'useSessionManager — управление рабочими сессиями',
            'useAiTask — AI-оценка через Gemini',
            'useExpensesBoard — доска расходов',
            'useClientDashboard — агрегация данных клиента',
            'usePWA — PWA установка и offline',
            'useSwipeGesture — свайп-жесты для мобильных',
            'useKeyboardShortcuts — горячие клавиши',
            'useFieldAccess — RBAC проверка доступа к полям',
            'useSubordinates — иерархия подчинённых',
        ],
    },
    {
        title: 'src/api/',
        icon: <ApiIcon />,
        color: '#f59e0b',
        description: '12 API модулей',
        items: [
            'userManagementApi — административное управление (19KB)',
            'projectsApi — управление проектами (11KB)',
            'userDetailApi — детали пользователя (9KB)',
            'companiesApi — CRUD компаний',
            'estimatesApi — CRUD смет',
            'aiTaskApi — AI-оценка задач',
            'avatarApi — управление аватарами',
            'rateApi — ставки сотрудников',
            'taskApi — CRUD задач',
            'crmApi — общие CRM операции',
        ],
    },
    {
        title: 'src/components/',
        icon: <WidgetIcon />,
        color: '#8b5cf6',
        description: '13 директорий, 67+ компонентов',
        items: [
            'gtd/ — 16 компонентов GTD-доски',
            'time-tracking/ — 8 компонентов тайм-трекинга',
            'tasks/ — 7 компонентов задач',
            'admin/ — 10 компонентов администрирования',
            'layout/ — Header, Footer, MainLayout, Sidebar',
            'dashboard/ — KPICard, AIReportsSection',
            'crm/ — 7 CRM компонентов',
            'expenses/ — компоненты расходов',
            'tasks-masonry/ — компоненты Touch Board',
            'rbac/ — компоненты RBAC',
            'pwa/ — PWAInstallBanner',
        ],
    },
    {
        title: 'src/types/',
        icon: <TypesIcon />,
        color: '#10b981',
        description: '16 файлов с TypeScript типами',
        items: [
            'gtd.types.ts — 23KB, полная модель GTD-задач',
            'expensesBoard.types.ts — 13KB, модель расходов',
            'notes.types.ts — 12KB, заметки и комментарии',
            'crm.types.ts — CRM сущности (Client, Lead, Deal)',
            'inventory.types.ts — инвентарь и транзакции',
            'rbac.types.ts — роли и разрешения',
            'dashboard.types.ts — типы дашборда',
            'user.types.ts — пользователи платформы',
            'timeTracking.types.ts — рабочие сессии',
        ],
    },
    {
        title: 'functions/src/',
        icon: <FunctionsIcon />,
        color: '#0ea5e9',
        description: 'Firebase Cloud Functions backend',
        items: [
            'triggers/ — 21 Firestore trigger (onCreate, onUpdate, onDelete)',
            'callable/ — 15 callable functions (AI, user management)',
            'scheduled/ — 9 cron jobs (агрегация, напоминания)',
            'services/ — 6 бэкенд-сервисов (AI, email, payments)',
            'utils/ — 8 утилит (auditLogger, geocoding, validation)',
            'http/ — HTTP endpoints',
            'email/ — Brevo email интеграция',
            'index.ts — 23KB, регистрация всех функций',
        ],
    },
];

// ═══════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════

const CodeDocumentationPage: React.FC = () => {
    const theme = useTheme();
    const navigate = useNavigate();
    const [expandedAll, setExpandedAll] = useState(false);
    const [expanded, setExpanded] = useState<string | false>(false);

    const totalFiles = MODULES.reduce((acc, m) => acc + m.files.length, 0);
    const totalPages = MODULES.reduce((acc, m) => acc + m.files.filter(f => f.type === 'page').length, 0);
    const totalHooks = MODULES.reduce((acc, m) => acc + m.files.filter(f => f.type === 'hook').length, 0);

    const toggleAll = () => {
        setExpandedAll(!expandedAll);
        setExpanded(false);
    };

    const handleAccordionChange = (panel: string) => (_: React.SyntheticEvent, isExpanded: boolean) => {
        setExpanded(isExpanded ? panel : false);
        if (isExpanded) setExpandedAll(false);
    };

    return (
        <Box sx={{ minHeight: '100vh', bgcolor: '#fafbfc', pb: 6 }}>
            {/* Hero Section */}
            <Box
                sx={{
                    background: `linear-gradient(135deg, ${alpha('#1e293b', 0.95)}, ${alpha('#334155', 0.9)})`,
                    color: 'white',
                    py: { xs: 4, md: 6 },
                    px: 2,
                    position: 'relative',
                    overflow: 'hidden',
                    '&::before': {
                        content: '""',
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: `radial-gradient(circle at 20% 50%, ${alpha('#3b82f6', 0.15)} 0%, transparent 50%),
                                     radial-gradient(circle at 80% 50%, ${alpha('#8b5cf6', 0.1)} 0%, transparent 50%)`,
                    },
                }}
            >
                <Container maxWidth="lg" sx={{ position: 'relative', zIndex: 1 }}>
                    <Button
                        startIcon={<ArrowBackIcon />}
                        onClick={() => navigate('/admin/dashboard')}
                        sx={{ color: 'rgba(255,255,255,0.7)', mb: 2, '&:hover': { color: 'white' } }}
                    >
                        Назад к Dashboard
                    </Button>

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                        <Avatar
                            sx={{
                                width: 64,
                                height: 64,
                                bgcolor: alpha('#3b82f6', 0.2),
                                border: `2px solid ${alpha('#3b82f6', 0.4)}`,
                                fontSize: '1.5rem',
                            }}
                        >
                            <CodeIcon sx={{ fontSize: 32 }} />
                        </Avatar>
                        <Box>
                            <Typography variant="h3" fontWeight={800} sx={{ fontSize: { xs: '1.75rem', md: '2.5rem' } }}>
                                Документация кода
                            </Typography>
                            <Typography variant="body1" sx={{ opacity: 0.7 }}>
                                Полное описание модулей, страниц, хуков и API платформы Profit Step
                            </Typography>
                        </Box>
                    </Box>

                    {/* Stats Row */}
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                        {[
                            { label: 'Модулей', value: MODULES.length, icon: <FolderIcon fontSize="small" />, color: '#3b82f6' },
                            { label: 'Страниц', value: totalPages, icon: <FileIcon fontSize="small" />, color: '#22c55e' },
                            { label: 'Хуков', value: totalHooks, icon: <HookIcon fontSize="small" />, color: '#ec4899' },
                            { label: 'Файлов', value: totalFiles, icon: <LayersIcon fontSize="small" />, color: '#f59e0b' },
                            { label: 'Cloud Functions', value: '45+', icon: <FunctionsIcon fontSize="small" />, color: '#0ea5e9' },
                        ].map((stat) => (
                            <Paper
                                key={stat.label}
                                elevation={0}
                                sx={{
                                    px: 2.5,
                                    py: 1.5,
                                    borderRadius: 3,
                                    bgcolor: alpha('#fff', 0.08),
                                    border: `1px solid ${alpha('#fff', 0.12)}`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1.5,
                                    backdropFilter: 'blur(10px)',
                                }}
                            >
                                <Box sx={{ color: stat.color }}>{stat.icon}</Box>
                                <Box>
                                    <Typography variant="h6" fontWeight={700} lineHeight={1.2} sx={{ color: 'white' }}>
                                        {stat.value}
                                    </Typography>
                                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.6)' }}>
                                        {stat.label}
                                    </Typography>
                                </Box>
                            </Paper>
                        ))}
                    </Box>
                </Container>
            </Box>

            {/* Main Content */}
            <Container maxWidth="lg" sx={{ mt: 4 }}>
                {/* Toolbar */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                    <Typography variant="h5" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <DashIcon color="primary" /> Модули платформы
                    </Typography>
                    <Tooltip title={expandedAll ? 'Свернуть все' : 'Развернуть все'}>
                        <IconButton onClick={toggleAll} sx={{ bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
                            {expandedAll ? <CollapseAllIcon /> : <ExpandAllIcon />}
                        </IconButton>
                    </Tooltip>
                </Box>

                {/* Module Accordions */}
                {MODULES.map((module) => {
                    const isOpen = expandedAll || expanded === module.id;
                    const statusCfg = STATUS_CONFIG[module.status];

                    return (
                        <Accordion
                            key={module.id}
                            expanded={isOpen}
                            onChange={handleAccordionChange(module.id)}
                            elevation={0}
                            disableGutters
                            sx={{
                                mb: 1.5,
                                border: '1px solid',
                                borderColor: isOpen ? alpha(module.color, 0.4) : 'divider',
                                borderRadius: '12px !important',
                                overflow: 'hidden',
                                transition: 'border-color 0.3s, box-shadow 0.3s',
                                '&::before': { display: 'none' },
                                ...(isOpen && {
                                    boxShadow: `0 4px 20px ${alpha(module.color, 0.1)}`,
                                }),
                            }}
                        >
                            <AccordionSummary
                                expandIcon={<ExpandMoreIcon />}
                                sx={{
                                    px: 2.5,
                                    py: 0.5,
                                    '&.Mui-expanded': {
                                        borderBottom: '1px solid',
                                        borderColor: 'divider',
                                    },
                                }}
                            >
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%', pr: 2 }}>
                                    <Avatar
                                        sx={{
                                            bgcolor: alpha(module.color, 0.12),
                                            color: module.color,
                                            width: 44,
                                            height: 44,
                                        }}
                                    >
                                        {module.icon}
                                    </Avatar>
                                    <Box sx={{ flex: 1, minWidth: 0 }}>
                                        <Typography fontWeight={700} fontSize="1rem">
                                            {module.name}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary" noWrap>
                                            {module.description}
                                        </Typography>
                                    </Box>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
                                        <Chip
                                            label={statusCfg.label}
                                            size="small"
                                            sx={{
                                                bgcolor: alpha(statusCfg.color, 0.1),
                                                color: statusCfg.color,
                                                fontWeight: 600,
                                                fontSize: '0.7rem',
                                            }}
                                        />
                                        <Chip
                                            label={`${module.files.length} файлов`}
                                            size="small"
                                            variant="outlined"
                                            sx={{ fontWeight: 600, fontSize: '0.7rem' }}
                                        />
                                    </Box>
                                </Box>
                            </AccordionSummary>

                            <AccordionDetails sx={{ p: 0 }}>
                                {/* Detailed Description */}
                                <Box sx={{ px: 3, py: 2, bgcolor: alpha(module.color, 0.02) }}>
                                    <Typography variant="body2" sx={{ lineHeight: 1.7, whiteSpace: 'pre-line', color: 'text.secondary' }}>
                                        {module.detailedDescription}
                                    </Typography>

                                    {/* Tech Stack */}
                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 2 }}>
                                        {module.techStack.map((tech) => (
                                            <Chip
                                                key={tech}
                                                label={tech}
                                                size="small"
                                                variant="outlined"
                                                sx={{
                                                    fontSize: '0.65rem',
                                                    height: 22,
                                                    borderColor: alpha(module.color, 0.3),
                                                    color: module.color,
                                                }}
                                            />
                                        ))}
                                    </Box>
                                </Box>

                                <Divider />

                                {/* Files List */}
                                <List dense sx={{ py: 0 }}>
                                    {module.files.map((file, idx) => (
                                        <ListItem
                                            key={`${file.name}-${idx}`}
                                            sx={{
                                                px: 3,
                                                py: 0.75,
                                                '&:hover': { bgcolor: alpha(module.color, 0.03) },
                                                borderBottom: idx < module.files.length - 1 ? '1px solid' : 'none',
                                                borderColor: alpha('#000', 0.04),
                                            }}
                                        >
                                            <ListItemIcon sx={{ minWidth: 36, color: FILE_TYPE_COLORS[file.type] }}>
                                                {FILE_TYPE_ICONS[file.type]}
                                            </ListItemIcon>
                                            <ListItemText
                                                primary={
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                        <Typography
                                                            variant="body2"
                                                            fontWeight={600}
                                                            sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
                                                        >
                                                            {file.name}
                                                        </Typography>
                                                        <Chip
                                                            label={FILE_TYPE_LABELS[file.type]}
                                                            size="small"
                                                            sx={{
                                                                height: 18,
                                                                fontSize: '0.6rem',
                                                                bgcolor: alpha(FILE_TYPE_COLORS[file.type], 0.1),
                                                                color: FILE_TYPE_COLORS[file.type],
                                                                fontWeight: 600,
                                                            }}
                                                        />
                                                    </Box>
                                                }
                                                secondary={file.description}
                                                secondaryTypographyProps={{ variant: 'caption', sx: { lineHeight: 1.4 } }}
                                            />
                                        </ListItem>
                                    ))}
                                </List>
                            </AccordionDetails>
                        </Accordion>
                    );
                })}

                {/* Architecture Section */}
                <Box sx={{ mt: 6, mb: 3 }}>
                    <Typography variant="h5" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
                        <FolderIcon color="primary" /> Архитектура проекта
                    </Typography>

                    <Box sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
                        gap: 2,
                    }}>
                        {ARCHITECTURE_SECTIONS.map((section) => (
                            <Paper
                                key={section.title}
                                elevation={0}
                                sx={{
                                    p: 2.5,
                                    borderRadius: 3,
                                    border: '1px solid',
                                    borderColor: 'divider',
                                    transition: 'all 0.2s',
                                    '&:hover': {
                                        borderColor: alpha(section.color, 0.4),
                                        boxShadow: `0 4px 16px ${alpha(section.color, 0.08)}`,
                                    },
                                }}
                            >
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                                    <Avatar
                                        sx={{
                                            width: 36,
                                            height: 36,
                                            bgcolor: alpha(section.color, 0.1),
                                            color: section.color,
                                        }}
                                    >
                                        {section.icon}
                                    </Avatar>
                                    <Box>
                                        <Typography fontWeight={700} sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                                            {section.title}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {section.description}
                                        </Typography>
                                    </Box>
                                </Box>

                                <List dense sx={{ py: 0 }}>
                                    {section.items.map((item, idx) => (
                                        <ListItem key={idx} sx={{ px: 0, py: 0.25 }}>
                                            <ListItemText
                                                primary={item}
                                                primaryTypographyProps={{
                                                    variant: 'caption',
                                                    sx: { lineHeight: 1.5, color: 'text.secondary' },
                                                }}
                                            />
                                        </ListItem>
                                    ))}
                                </List>
                            </Paper>
                        ))}
                    </Box>
                </Box>

                {/* Footer */}
                <Paper
                    elevation={0}
                    sx={{
                        mt: 4,
                        p: 3,
                        borderRadius: 3,
                        border: '1px solid',
                        borderColor: 'divider',
                        textAlign: 'center',
                        background: `linear-gradient(135deg, ${alpha('#3b82f6', 0.03)}, ${alpha('#8b5cf6', 0.03)})`,
                    }}
                >
                    <Typography variant="body2" color="text.secondary">
                        Profit Step — платформа для управления строительными проектами
                    </Typography>
                    <Typography variant="caption" color="text.disabled">
                        {MODULES.length} модулей • {totalFiles} файлов документировано • {totalPages} страниц • {totalHooks} хуков
                    </Typography>
                </Paper>
            </Container>
        </Box>
    );
};

export default CodeDocumentationPage;
