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

/**
 * Возможные статусы задачи (колонки на Kanban-доске)
 * 
 * - inbox: Входящие — новые, ещё не обработанные задачи
 * - next_action: Следующие действия — задачи готовые к выполнению
 * - waiting: Ожидание — задачи, заблокированные внешними факторами
 * - projects: Проекты — многошаговые задачи
 * - someday: Когда-нибудь — идеи на будущее
 * - done: Выполнено — завершённые задачи
 */
export type GTDStatus = 'inbox' | 'next_action' | 'waiting' | 'projects' | 'someday' | 'done';

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

    /** Дополнительные заметки к задаче */
    description?: string;

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
    // AI ESTIMATION FIELDS
    // ═══════════════════════════════════════

    /** Предполагаемая стоимость работы (рассчитано AI) */
    estimatedCost?: number;

    /** Количество работников */
    crewSize?: number;

    /** Предложенные материалы (от AI) */
    aiMaterials?: string[];

    /** Выбранные пользователем материалы */
    selectedMaterials?: string[];

    /** Предложенные инструменты (от AI) */
    aiTools?: string[];

    /** Выбранные пользователем инструменты */
    selectedTools?: string[];

    /** Объяснение AI-оценки */
    aiReasoning?: string;

    /** Флаг: была ли использована AI-оценка */
    aiEstimateUsed?: boolean;
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
    { id: 'someday', title: 'Someday / Maybe' }, // Когда-нибудь
    { id: 'done', title: 'Done ✓' }            // Выполнено
];
