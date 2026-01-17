/**
 * @fileoverview Типы для Role-Based Access Control (RBAC)
 * 
 * Система прав доступа основана на:
 * 1. Ролях (Role) — набор разрешений
 * 2. Иерархии (Hierarchy) — кто чьи данные видит
 * 3. Field-Level Security — скрытие отдельных полей
 */

import { Timestamp } from 'firebase/firestore';

// ================================
// PERMISSION TYPES
// ================================

/**
 * Сущности CRM для которых определяются права
 */
export type PermissionEntity =
    | 'deals'
    | 'contacts'
    | 'tasks'
    | 'estimates'
    | 'finance'
    | 'team'
    | 'reports';

/**
 * Уровень доступа к чтению/редактированию
 */
export type AccessLevel =
    | 'none'       // Запрещено
    | 'own'        // Только свои записи
    | 'department' // Свои + отдел
    | 'team'       // Свои + подчинённые (иерархия)
    | 'all';       // Все записи компании

/**
 * Разрешение для одной сущности
 */
export interface Permission {
    entity: PermissionEntity;
    read: AccessLevel;
    create: boolean;
    update: AccessLevel;
    delete: boolean;
    export: boolean;
}

// ================================
// FIELD-LEVEL SECURITY
// ================================

/**
 * Чувствительные поля которые можно скрывать
 */
export type SensitiveField =
    | 'cost'        // Себестоимость
    | 'margin'      // Маржинальность
    | 'discount'    // Скидка
    | 'hourlyRate'  // Почасовая ставка
    | 'salary';     // Зарплата

/**
 * Ограничение видимости поля
 */
export interface FieldRestriction {
    field: SensitiveField;
    hidden: boolean;     // Поле скрыто полностью
    readOnly: boolean;   // Только просмотр (без редактирования)
}

// ================================
// ROLE
// ================================

/**
 * Роль с набором разрешений
 * Хранится в Firestore: /roles/{roleId}
 */
export interface Role {
    id: string;
    name: string;
    description: string;

    /** Разрешения для сущностей */
    permissions: Permission[];

    /** Ограничения видимости полей */
    fieldRestrictions: FieldRestriction[];

    /** Системная роль (нельзя удалить) */
    isSystem: boolean;

    /** ID компании (для кастомных ролей) */
    companyId?: string;

    createdAt: Timestamp;
    updatedAt?: Timestamp;
}

// ================================
// HIERARCHY HELPERS
// ================================

/**
 * Узел в дереве организации
 */
export interface OrgTreeNode {
    id: string;
    displayName: string;
    role: string;
    photoURL?: string;
    children: OrgTreeNode[];
}

/**
 * Результат проверки доступа
 */
export interface AccessCheckResult {
    allowed: boolean;
    reason: string;
    level: AccessLevel;
}

// ================================
// DEFAULT PERMISSIONS
// ================================

/**
 * Дефолтные разрешения по ролям
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, Partial<Permission>[]> = {
    admin: [
        { entity: 'deals', read: 'all', create: true, update: 'all', delete: true, export: true },
        { entity: 'contacts', read: 'all', create: true, update: 'all', delete: true, export: true },
        { entity: 'tasks', read: 'all', create: true, update: 'all', delete: true, export: true },
        { entity: 'team', read: 'all', create: true, update: 'all', delete: true, export: true },
        { entity: 'finance', read: 'all', create: true, update: 'all', delete: false, export: true },
    ],
    manager: [
        { entity: 'deals', read: 'team', create: true, update: 'team', delete: false, export: true },
        { entity: 'contacts', read: 'team', create: true, update: 'team', delete: false, export: true },
        { entity: 'tasks', read: 'team', create: true, update: 'team', delete: false, export: false },
        { entity: 'team', read: 'team', create: false, update: 'none', delete: false, export: false },
        { entity: 'finance', read: 'own', create: false, update: 'none', delete: false, export: false },
    ],
    user: [
        { entity: 'deals', read: 'own', create: true, update: 'own', delete: false, export: false },
        { entity: 'contacts', read: 'own', create: true, update: 'own', delete: false, export: false },
        { entity: 'tasks', read: 'own', create: true, update: 'own', delete: false, export: false },
        { entity: 'team', read: 'none', create: false, update: 'none', delete: false, export: false },
        { entity: 'finance', read: 'own', create: false, update: 'none', delete: false, export: false },
    ],
    guest: [
        { entity: 'deals', read: 'none', create: false, update: 'none', delete: false, export: false },
        { entity: 'contacts', read: 'none', create: false, update: 'none', delete: false, export: false },
        { entity: 'tasks', read: 'own', create: false, update: 'none', delete: false, export: false },
        { entity: 'team', read: 'none', create: false, update: 'none', delete: false, export: false },
        { entity: 'finance', read: 'none', create: false, update: 'none', delete: false, export: false },
    ],
};

/**
 * Дефолтные ограничения полей для роли user
 */
export const DEFAULT_FIELD_RESTRICTIONS: FieldRestriction[] = [
    { field: 'cost', hidden: true, readOnly: false },
    { field: 'margin', hidden: true, readOnly: false },
    { field: 'salary', hidden: true, readOnly: false },
];
