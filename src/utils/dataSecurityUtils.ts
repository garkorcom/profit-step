/**
 * @fileoverview Утилиты для фильтрации данных перед отправкой клиенту/экспортом
 * 
 * L-03: API и Export должны применять те же FieldRestrictions, что и UI
 */

import { SensitiveField, FieldRestriction, DEFAULT_FIELD_RESTRICTIONS } from '../types/rbac.types';
import { UserRole } from '../types/user.types';

/**
 * Получить ограничения полей для роли
 */
export const getFieldRestrictionsForRole = (role: UserRole): FieldRestriction[] => {
    // Администраторы видят всё
    if (['superadmin', 'company_admin', 'admin'].includes(role)) {
        return [];
    }

    // Менеджеры не видят зарплату
    if (role === 'manager') {
        return [{ field: 'salary', hidden: true, readOnly: false }];
    }

    // Users и остальные — стандартные ограничения
    return DEFAULT_FIELD_RESTRICTIONS;
};

/**
 * Проверить, можно ли отображать/экспортировать поле
 */
export const canAccessField = (
    field: SensitiveField,
    role: UserRole
): boolean => {
    const restrictions = getFieldRestrictionsForRole(role);
    const restriction = restrictions.find(r => r.field === field);
    return !restriction?.hidden;
};

/**
 * Маска для скрытых значений
 */
export const MASKED_VALUE = '***';

/**
 * Отфильтровать чувствительные поля из объекта
 * Используется перед отправкой данных клиенту или экспортом
 * 
 * @example
 * const deal = { id: 1, cost: 5000, margin: 0.4, name: 'Deal' };
 * const filtered = filterSensitiveData(deal, ['cost', 'margin'], 'user');
 * // { id: 1, cost: '***', margin: '***', name: 'Deal' }
 */
export const filterSensitiveData = <T extends Record<string, any>>(
    data: T,
    sensitiveFields: SensitiveField[],
    role: UserRole,
    mode: 'mask' | 'remove' = 'mask'
): T => {
    const restrictions = getFieldRestrictionsForRole(role);
    const result = { ...data };

    for (const field of sensitiveFields) {
        const restriction = restrictions.find(r => r.field === field);

        if (restriction?.hidden && field in result) {
            if (mode === 'mask') {
                (result as any)[field] = MASKED_VALUE;
            } else {
                delete (result as any)[field];
            }
        }
    }

    return result;
};

/**
 * Фильтрация массива объектов
 */
export const filterSensitiveDataArray = <T extends Record<string, any>>(
    dataArray: T[],
    sensitiveFields: SensitiveField[],
    role: UserRole,
    mode: 'mask' | 'remove' = 'mask'
): T[] => {
    return dataArray.map(item => filterSensitiveData(item, sensitiveFields, role, mode));
};

/**
 * Форматирование данных для CSV экспорта с учётом прав
 * Скрытые поля полностью исключаются из заголовков
 */
export interface ExportColumn<T> {
    key: keyof T;
    header: string;
    sensitiveField?: SensitiveField;
}

export const filterExportColumns = <T>(
    columns: ExportColumn<T>[],
    role: UserRole
): ExportColumn<T>[] => {
    const restrictions = getFieldRestrictionsForRole(role);

    return columns.filter(col => {
        if (!col.sensitiveField) return true;
        const restriction = restrictions.find(r => r.field === col.sensitiveField);
        return !restriction?.hidden;
    });
};

/**
 * Подготовить данные для экспорта (фильтрует колонки и значения)
 */
export const prepareDataForExport = <T extends Record<string, any>>(
    data: T[],
    columns: ExportColumn<T>[],
    role: UserRole
): { headers: string[]; rows: any[][] } => {
    const allowedColumns = filterExportColumns(columns, role);

    const headers = allowedColumns.map(col => col.header);
    const rows = data.map(item =>
        allowedColumns.map(col => item[col.key as string] ?? '')
    );

    return { headers, rows };
};
