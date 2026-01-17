/**
 * @fileoverview Типы для модального окна создания задачи
 */

export interface TaskFormState {
    // === Основные поля ===
    assigneeType: 'self' | 'employee';
    assigneeId: string | null;
    clientId: string | null;
    description: string;

    // === Финансы ===
    cost: number;
    peopleCount: number;
    plannedHours: number;

    // === Даты ===
    startDate: Date;
    startTime: string | null;  // HH:mm format
    endDate: Date | null;
    endTime: string | null;

    // === Доп. поля ===
    priority: 'low' | 'medium' | 'high';
    templateId: string | null;

    // === UI State ===
    saving: boolean;
    errors: Record<string, string>;
}

export interface TaskTemplate {
    id: string;
    name: string;
    defaultHours: number;
    defaultPeople: number;
    defaultCost?: number;
    icon?: string;
}

export interface CreateTaskDTO {
    assigneeId: string;
    clientId: string;
    description: string;
    cost: number;
    peopleCount: number;
    plannedHours: number;
    startDate: Date;
    endDate: Date | null;
    priority: 'low' | 'medium' | 'high';
    status: 'pending' | 'in_progress' | 'done';
    createdAt: Date;
    createdBy: string;
    companyId: string;
}

export interface CreateTaskModalProps {
    open: boolean;
    onClose: () => void;
    onSuccess?: () => void;
    defaultClientId?: string;
    defaultDate?: Date;
}

// Поля, которые СОХРАНЯЮТСЯ после "Save & Add More"
export const PERSISTENT_FIELDS: (keyof TaskFormState)[] = [
    'clientId',
    'startDate',
    'startTime',
    'endDate',
    'endTime',
    'peopleCount',
];

// Шаблоны задач
export const TASK_TEMPLATES: TaskTemplate[] = [
    { id: 'unload', name: 'Разгрузка', defaultHours: 2, defaultPeople: 3, icon: '📦' },
    { id: 'install', name: 'Монтаж', defaultHours: 8, defaultPeople: 2, icon: '🔧' },
    { id: 'cleanup', name: 'Уборка', defaultHours: 4, defaultPeople: 2, icon: '🧹' },
    { id: 'delivery', name: 'Доставка', defaultHours: 3, defaultPeople: 1, icon: '🚚' },
    { id: 'meeting', name: 'Встреча', defaultHours: 1, defaultPeople: 1, icon: '🤝' },
];

// Пресеты времени
export const TIME_PRESETS = ['08:00', '09:00', '10:00', '14:00', '16:00'];

// Дефолтные значения
export const getDefaultFormState = (): TaskFormState => ({
    assigneeType: 'self',
    assigneeId: null,
    clientId: null,
    description: '',
    cost: 0,
    peopleCount: 1,
    plannedHours: 0,
    startDate: new Date(),
    startTime: '09:00',
    endDate: null,
    endTime: null,
    priority: 'medium',
    templateId: null,
    saving: false,
    errors: {},
});
