/**
 * @fileoverview Типы и константы для GTD (Getting Things Done) модуля
 * 
 * GTD — методология личной продуктивности, реализованная в виде Kanban-доски.
 * Задачи хранятся в глобальной коллекции `gtd_tasks` и поддерживают:
 * - Назначение исполнителя (assignee) — задача видна как владельцу, так и assignee
 * - Привязку к клиенту (clientId) — для интеграции с CRM
 * - Приоритеты и контексты — для фильтрации и организации
 * 
 * @module types/gtd.types
 */

import { Timestamp } from 'firebase/firestore';
import { TaskMaterial } from './inventory.types';

/**
 * Возможные статусы задачи (колонки на Kanban-доске)
 * 
 * - inbox: Входящие — новые, ещё не обработанные задачи
 * - next_action: Следующие действия — задачи готовые к выполнению
 * - waiting: Ожидание — задачи, заблокированные внешними факторами
 * - projects: Проекты — многошаговые задачи
 * - estimate: На просчёт — задачи требующие расчёта времени/стоимости
 * - someday: Когда-нибудь — идеи на будущее
 * - done: Выполнено — завершённые задачи
 */
export type GTDStatus = 'inbox' | 'next_action' | 'waiting' | 'projects' | 'estimate' | 'someday' | 'done';

/**
 * Приоритеты задач
 * - high: Высокий (красный) — срочные задачи
 * - medium: Средний (оранжевый) — важные, но не срочные
 * - low: Низкий (синий) — можно отложить
 * - none: Без приоритета — по умолчанию
 */
export type GTDPriority = 'high' | 'medium' | 'low' | 'none';

/**
 * Цвета для визуального отображения приоритетов
 * Используются в Chip компонентах и индикаторах на карточках
 */
export const PRIORITY_COLORS: Record<GTDPriority, string> = {
    high: '#ef4444',    // Красный — высокий приоритет
    medium: '#f59e0b',  // Оранжевый — средний приоритет
    low: '#3b82f6',     // Синий — низкий приоритет
    none: 'transparent' // Без цвета — нет приоритета
};

/**
 * Элемент чек-листа внутри задачи
 * Хранится как массив в поле GTDTask.checklistItems
 */
export interface ChecklistItem {
    /** Уникальный ID элемента (nanoid) */
    id: string;
    /** Текст элемента */
    text: string;
    /** Флаг завершения */
    completed: boolean;
    /** Дата создания */
    createdAt: Timestamp;
    /** Дата завершения (если completed) */
    completedAt?: Timestamp;
}

/**
 * Вложение (внешняя ссылка, например Google Drive) к задаче GTD
 */
export interface TaskAttachment {
    id: string;
    url: string;
    title: string;
}


/**
 * Интерфейс проекта (deprecated, сохранён для обратной совместимости)
 * @deprecated Используйте clientId вместо projectId
 */
export interface Project {
    id: string;
    name: string;
    clientName?: string;
    status?: string;
}

/**
 * Основной интерфейс задачи GTD
 * 
 * Задачи хранятся в глобальной коллекции Firestore: `gtd_tasks/{taskId}`
 * 
 * ВАЖНО: Задача видна пользователю если он:
 * 1. Владелец (ownerId === currentUser.uid), ИЛИ
 * 2. Назначенный исполнитель (assigneeId === currentUser.uid)
 * 
 * @example
 * // Создание новой задачи
 * const newTask: Partial<GTDTask> = {
 *   ownerId: currentUser.uid,
 *   title: 'Позвонить клиенту',
 *   status: 'inbox',
 *   priority: 'high',
 *   clientId: 'client123',
 *   assigneeId: 'user456'
 * };
 */

/** Роль соисполнителя */
export type CoAssigneeRole = 'executor' | 'reviewer' | 'observer';

export const CO_ASSIGNEE_ROLE_LABELS: Record<CoAssigneeRole, string> = {
    executor: 'Исполнитель',
    reviewer: 'Ревьюер',
    observer: 'Наблюдатель',
};

/** Событие истории изменений задачи */
export interface TaskHistoryEvent {
    /** Тип события */
    type: 'created' | 'assigned' | 'co_assignee_added' | 'co_assignee_removed' | 'status_changed' | 'updated' | 'completed' | 'ai_mutation_snapshot' | 'materials_added' | 'contacts_linked';
    /** Описание события */
    description: string;
    /** ID пользователя, совершившего действие */
    userId?: string;
    /** Имя пользователя */
    userName?: string;
    /** Временная метка */
    timestamp: any; // Firestore Timestamp
    /** Дополнительные метаданные */
    meta?: Record<string, any>;
}

export interface GTDTask {
    /** Уникальный ID задачи (Firestore document ID) */
    id: string;

    /** 
     * ID владельца задачи (создателя)
     * Совпадает с Firebase Auth UID пользователя
     */
    ownerId: string;

    /** Отображаемое имя владельца (для UI, избегаем лишних запросов) */
    ownerName?: string;

    /** 
     * ID исполнителя (кому назначена задача)
     * Может быть Firebase UID или telegramId
     * Если указан — исполнитель видит задачу в своём GTD
     */
    assigneeId?: string;

    /** Отображаемое имя исполнителя */
    assigneeName?: string;

    /** 
     * Соисполнители задачи (дополнительные работники)
     * Массив объектов с id, именем и ролью
     */
    coAssignees?: Array<{ id: string; name: string; role: 'executor' | 'reviewer' | 'observer' }>;

    /**
     * Плоский массив ID соисполнителей для Firestore array-contains запросов
     * Синхронизируется с coAssignees при сохранении
     */
    coAssigneeIds?: string[];

    /**
     * История изменений задачи
     * Каждое событие содержит тип, описание и метаданные
     */
    taskHistory?: TaskHistoryEvent[];

    /** Название задачи */
    title: string;

    /** Текущий статус (в какой колонке находится) */
    status: GTDStatus;

    /** Приоритет задачи */
    priority: GTDPriority;

    /** 
     * Контекст выполнения (GTD концепция)
     * Примеры: '@home', '@work', '@computer', '@phone', '@errands'
     * Позволяет фильтровать задачи по месту/инструменту
     */
    context: string;

    /** 
     * ID клиента из коллекции /clients
     * Используется для интеграции с CRM и Time Tracking
     */
    clientId?: string;

    /** Название клиента (денормализовано для быстрого отображения) */
    clientName?: string;

    /** 
     * ID проекта из unified projects collection
     * Enables task→project linking for project-level task management
     */
    projectId?: string;

    /** Название проекта (денормализовано для быстрого отображения) */
    projectName?: string;

    /** 
     * ID контактов из Справочника, привязанных к задаче 
     */
    linkedContactIds?: string[];

    /** Дополнительные заметки к задаче */
    description?: string;

    /** Secondary descriptive memo */
    memo?: string;

    /** External attachments or links (e.g. Google Drive) */
    attachments?: TaskAttachment[];

    /** Дедлайн задачи */
    dueDate?: Timestamp;

    /** Дата создания */
    createdAt: Timestamp;

    /** Дата последнего обновления */
    updatedAt?: Timestamp;

    /** Порядок сортировки внутри колонки (для будущего drag-and-drop) */
    order?: number;

    /** Ссылка на исходное аудио (если создано через бота) */
    sourceAudioUrl?: string;

    /** Дата, когда планируется начать работу */
    startDate?: Timestamp;

    /** Дата фактического завершения (устанавливается при переходе в done) */
    completedAt?: Timestamp;

    /** Планируемая длительность (в минутах) */
    estimatedDurationMinutes?: number;

    /** Фактические трудозатраты (в минутах) */
    actualDurationMinutes?: number;

    /** Флаг напоминания (для будущих уведомлений) */
    reminderEnabled?: boolean;
    reminderTime?: Timestamp;

    /** Элементы чек-листа */
    checklistItems?: ChecklistItem[];

    // ═══════════════════════════════════════
    // WIZARD FIELDS
    // ═══════════════════════════════════════

    /** Флаг: задача требует просчёта */
    needsEstimate?: boolean;

    /** Тип задачи (для wizard и фильтров) */
    taskType?: string; // Using string to accommodate TaskType without hoisting

    // ═══════════════════════════════════════

    // ═══════════════════════════════════════
    // RATE & TIME TRACKING FIELDS
    // ═══════════════════════════════════════

    /** 
     * Почасовая ставка для этой конкретной задачи
     * Приоритет: task.hourlyRate → user.hourlyRate
     * Если указан — переопределяет дефолтный рейт сотрудника
     */
    hourlyRate?: number;

    /** 
     * Общий заработок по задаче (агрегат из work_sessions)
     * Обновляется при stopSession
     */
    totalEarnings?: number;

    /** 
     * Общее время работы над задачей (в минутах)
     * Сумма durationMinutes из всех work_sessions с relatedTaskId
     */
    totalTimeSpentMinutes?: number;

    // ═══════════════════════════════════════
    // ACCEPTANCE FIELDS (when assigned to someone else)
    // ═══════════════════════════════════════

    /** Дата принятия задачи исполнителем */
    acceptedAt?: Timestamp;

    /** ID пользователя, который принял задачу */
    acceptedBy?: string;

    // ═══════════════════════════════════════
    // SOURCE LINKING
    // ═══════════════════════════════════════

    /**
     * Source of task creation
     * - telegram: created via Telegram bot
     * - web: created via web UI
     * - voice: created via voice message
     */
    source?: 'telegram' | 'web' | 'voice';

    /** 
     * ID исходной заметки (Note) из которой была создана задача
     * Позволяет открыть Cockpit View для подробного редактирования
     */
    sourceNoteId?: string;

    // ═══════════════════════════════════════
    // INVENTORY INTEGRATION
    // ═══════════════════════════════════════

    /** Структурированные материалы задачи (связь с инвентарём) */
    materials?: TaskMaterial[];

    /** Общая стоимость материалов (план) */
    materialsCostPlanned?: number;

    /** Общая стоимость материалов (факт) */
    materialsCostActual?: number;
}

/**
 * Конфигурация колонок Kanban-доски
 * Определяет порядок и названия колонок в UI
 */
export const GTD_COLUMNS: { id: GTDStatus; title: string }[] = [
    { id: 'inbox', title: 'Inbox' },           // Входящие
    { id: 'next_action', title: 'Next Actions' }, // Следующие действия
    { id: 'projects', title: 'Projects' },     // Проекты (многошаговые)
    { id: 'waiting', title: 'Waiting For' },   // Ожидание
    { id: 'estimate', title: '📐 Estimate' },  // На просчёт
    { id: 'someday', title: 'Someday / Maybe' }, // Когда-нибудь
    { id: 'done', title: 'Done ✓' }            // Выполнено
];

// ═══════════════════════════════════════
// SMART TASK CONSTRUCTOR v2 (Motion-style)
// ═══════════════════════════════════════

/**
 * Группы действий для визуального разделения
 */
export type ActionGroup = 'supply' | 'control' | 'execute' | 'communicate';

/**
 * Маршруты задач — куда падает задача после создания
 */
export type TaskRoute = 'shopping' | 'calendar' | 'route' | 'tickets' | 'board' | 'crm';

/**
 * Типы полей для динамических форм
 */
export type FieldType = 'text' | 'number' | 'date' | 'time' | 'select' | 'camera' | 'checklist' | 'location';

/**
 * Конфигурация поля формы
 */
export interface FieldConfig {
    type: FieldType;
    label: string;
    placeholder?: string;
    required?: boolean;
}

/**
 * 12 типов задач для быстрого создания
 */
export type TaskType =
    // Группа А: Снабжение
    | 'buy' | 'deliver' | 'pickup' | 'move'
    // Группа Б: Контроль
    | 'check' | 'measure' | 'photo'
    // Группа В: Исполнение
    | 'fix' | 'install' | 'service'
    // Группа Г: Коммуникация
    | 'meet' | 'sign';

/**
 * Полная конфигурация типа задачи v2
 */
export interface TaskTypeConfig {
    emoji: string;
    label: string;
    labelShort: string;
    group: ActionGroup;
    route: TaskRoute;
    fields: FieldConfig[];
    defaults: {
        estimatedDurationMinutes?: number;
        needsEstimate?: boolean;
        priority?: GTDPriority;
        status?: GTDStatus;
        deadlineToday?: boolean;
    };
}

/**
 * Конфигурация 12 типов задач с группами, маршрутами и динамическими полями
 */
export const TASK_TYPE_CONFIG: Record<TaskType, TaskTypeConfig> = {
    // ═══════════════════════════════════════
    // ГРУППА А: СНАБЖЕНИЕ (supply)
    // ═══════════════════════════════════════
    buy: {
        emoji: '🛒',
        label: 'Купить',
        labelShort: 'Куп',
        group: 'supply',
        route: 'shopping',
        fields: [
            { type: 'checklist', label: 'Список товаров', required: true },
            { type: 'number', label: 'Бюджет', placeholder: '$' },
            { type: 'camera', label: 'Фото образца' },
        ],
        defaults: { estimatedDurationMinutes: 60, priority: 'low' }
    },
    deliver: {
        emoji: '🚚',
        label: 'Привезти',
        labelShort: 'Прив',
        group: 'supply',
        route: 'route',
        fields: [
            { type: 'location', label: 'Откуда', required: true },
            { type: 'text', label: 'Что везём' },
            { type: 'text', label: 'Контакт на месте' },
        ],
        defaults: { estimatedDurationMinutes: 60 }
    },
    pickup: {
        emoji: '📦',
        label: 'Забрать',
        labelShort: 'Забр',
        group: 'supply',
        route: 'route',
        fields: [
            { type: 'text', label: 'Что забрать', required: true },
            { type: 'location', label: 'Откуда' },
            { type: 'text', label: 'Контакт' },
        ],
        defaults: { estimatedDurationMinutes: 45 }
    },
    move: {
        emoji: '🏗️',
        label: 'Переместить',
        labelShort: 'Перем',
        group: 'supply',
        route: 'board',
        fields: [
            { type: 'text', label: 'Что переместить', required: true },
            { type: 'text', label: 'Откуда' },
            { type: 'text', label: 'Куда' },
        ],
        defaults: { estimatedDurationMinutes: 60 }
    },

    // ═══════════════════════════════════════
    // ГРУППА Б: КОНТРОЛЬ (control)
    // ═══════════════════════════════════════
    check: {
        emoji: '📋',
        label: 'Проверить',
        labelShort: 'Пров',
        group: 'control',
        route: 'calendar',
        fields: [
            { type: 'time', label: 'Дедлайн', required: true },
            { type: 'select', label: 'Исполнитель' },
            { type: 'checklist', label: 'Чек-лист' },
        ],
        defaults: { estimatedDurationMinutes: 30, deadlineToday: true }
    },
    measure: {
        emoji: '📐',
        label: 'Замерить',
        labelShort: 'Замер',
        group: 'control',
        route: 'crm',
        fields: [
            { type: 'number', label: 'Площадь (м²)' },
            { type: 'number', label: 'Количество (шт)' },
            { type: 'text', label: 'Комментарий' },
        ],
        defaults: { estimatedDurationMinutes: 30, needsEstimate: true }
    },
    photo: {
        emoji: '📸',
        label: 'Сфотографировать',
        labelShort: 'Фото',
        group: 'control',
        route: 'board',
        fields: [
            { type: 'camera', label: 'Фото', required: true },
            { type: 'text', label: 'Комментарий' },
        ],
        defaults: { estimatedDurationMinutes: 15 }
    },

    // ═══════════════════════════════════════
    // ГРУППА В: ИСПОЛНЕНИЕ (execute)
    // ═══════════════════════════════════════
    fix: {
        emoji: '🔧',
        label: 'Починить',
        labelShort: 'Почин',
        group: 'execute',
        route: 'tickets',
        fields: [
            { type: 'camera', label: 'Фото проблемы' },
            { type: 'text', label: 'Описание', required: true },
            { type: 'select', label: 'Срочность' },
        ],
        defaults: { priority: 'high', estimatedDurationMinutes: 60 }
    },
    install: {
        emoji: '⚡',
        label: 'Установить',
        labelShort: 'Устан',
        group: 'execute',
        route: 'calendar',
        fields: [
            { type: 'text', label: 'Что установить', required: true },
            { type: 'text', label: 'Требования' },
        ],
        defaults: { needsEstimate: true, estimatedDurationMinutes: 120 }
    },
    service: {
        emoji: '🧹',
        label: 'Обслужить',
        labelShort: 'Обсл',
        group: 'execute',
        route: 'calendar',
        fields: [
            { type: 'text', label: 'Тип работ', required: true },
            { type: 'select', label: 'Периодичность' },
        ],
        defaults: { estimatedDurationMinutes: 120 }
    },

    // ═══════════════════════════════════════
    // ГРУППА Г: КОММУНИКАЦИЯ (communicate)
    // ═══════════════════════════════════════
    meet: {
        emoji: '🤝',
        label: 'Встретить',
        labelShort: 'Встр',
        group: 'communicate',
        route: 'calendar',
        fields: [
            { type: 'text', label: 'Кого', required: true },
            { type: 'time', label: 'Когда', required: true },
            { type: 'text', label: 'Где' },
        ],
        defaults: { estimatedDurationMinutes: 30 }
    },
    sign: {
        emoji: '✍️',
        label: 'Подписать',
        labelShort: 'Подп',
        group: 'communicate',
        route: 'board',
        fields: [
            { type: 'text', label: 'Документ', required: true },
            { type: 'text', label: 'Контрагент' },
        ],
        defaults: { estimatedDurationMinutes: 15 }
    },
};

/**
 * Группировка типов по категориям для UI
 */
export const ACTION_GROUPS: { id: ActionGroup; label: string; emoji: string; types: TaskType[] }[] = [
    { id: 'supply', label: 'Снабжение', emoji: '📦', types: ['buy', 'deliver', 'pickup', 'move'] },
    { id: 'control', label: 'Контроль', emoji: '📋', types: ['check', 'measure', 'photo'] },
    { id: 'execute', label: 'Исполнение', emoji: '🔧', types: ['fix', 'install', 'service'] },
    { id: 'communicate', label: 'Коммуникация', emoji: '👥', types: ['meet', 'sign'] },
];
