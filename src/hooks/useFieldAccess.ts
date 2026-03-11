/**
 * @fileoverview Хук для проверки доступа к чувствительным полям
 * 
 * Проверяет права текущего пользователя на просмотр/редактирование
 * чувствительных полей (себестоимость, маржа, скидка и т.д.)
 */

import { useMemo } from 'react';
import { useAuth } from '../auth/AuthContext';
import {
    SensitiveField,
    FieldRestriction,
    DEFAULT_FIELD_RESTRICTIONS
} from '../types/rbac.types';
import { UserRole } from '../types/user.types';

/**
 * Результат проверки доступа к полю
 */
export interface FieldAccessResult {
    /** Поле полностью скрыто */
    hidden: boolean;
    /** Поле только для чтения */
    readOnly: boolean;
    /** Полный доступ */
    fullAccess: boolean;
}

/**
 * Дефолтные ограничения по ролям
 * Админы и менеджеры видят всё, остальные — ограничены
 */
const ROLE_FIELD_RESTRICTIONS: Record<UserRole, FieldRestriction[]> = {
    superadmin: [], // Полный доступ
    company_admin: [], // Полный доступ
    admin: [], // Полный доступ
    manager: [
        { field: 'salary', hidden: true, readOnly: false },
    ],
    user: DEFAULT_FIELD_RESTRICTIONS,
    estimator: [
        { field: 'cost', hidden: false, readOnly: true },
        { field: 'margin', hidden: true, readOnly: false },
        { field: 'salary', hidden: true, readOnly: false },
    ],
    guest: [
        { field: 'cost', hidden: true, readOnly: false },
        { field: 'margin', hidden: true, readOnly: false },
        { field: 'discount', hidden: true, readOnly: false },
        { field: 'hourlyRate', hidden: true, readOnly: false },
        { field: 'salary', hidden: true, readOnly: false },
    ],
};

/**
 * Хук для проверки доступа к чувствительным полям
 * 
 * @example
 * const { checkFieldAccess, canViewCost, canEditDiscount } = useFieldAccess();
 * 
 * if (canViewCost) {
 *   return <span>{cost}</span>;
 * } else {
 *   return <span>***</span>;
 * }
 */
export const useFieldAccess = () => {
    const { userProfile } = useAuth();

    /**
     * Проверить доступ к конкретному полю
     */
    const checkFieldAccess = useMemo(() => {
        return (field: SensitiveField): FieldAccessResult => {
            if (!userProfile) {
                return { hidden: true, readOnly: true, fullAccess: false };
            }

            const role = userProfile.role as UserRole;
            const restrictions = ROLE_FIELD_RESTRICTIONS[role] || DEFAULT_FIELD_RESTRICTIONS;

            const restriction = restrictions.find(r => r.field === field);

            if (!restriction) {
                // Нет ограничений = полный доступ
                return { hidden: false, readOnly: false, fullAccess: true };
            }

            return {
                hidden: restriction.hidden,
                readOnly: restriction.readOnly,
                fullAccess: !restriction.hidden && !restriction.readOnly,
            };
        };
    }, [userProfile]);

    // Shorthand методы для часто используемых полей
    const costAccess = useMemo(() => checkFieldAccess('cost'), [checkFieldAccess]);
    const marginAccess = useMemo(() => checkFieldAccess('margin'), [checkFieldAccess]);
    const discountAccess = useMemo(() => checkFieldAccess('discount'), [checkFieldAccess]);
    const hourlyRateAccess = useMemo(() => checkFieldAccess('hourlyRate'), [checkFieldAccess]);
    const salaryAccess = useMemo(() => checkFieldAccess('salary'), [checkFieldAccess]);

    return {
        checkFieldAccess,

        // Себестоимость
        canViewCost: !costAccess.hidden,
        canEditCost: costAccess.fullAccess,
        costAccess,

        // Маржа
        canViewMargin: !marginAccess.hidden,
        canEditMargin: marginAccess.fullAccess,
        marginAccess,

        // Скидка
        canViewDiscount: !discountAccess.hidden,
        canEditDiscount: discountAccess.fullAccess,
        discountAccess,

        // Почасовая ставка
        canViewHourlyRate: !hourlyRateAccess.hidden,
        canEditHourlyRate: hourlyRateAccess.fullAccess,
        hourlyRateAccess,

        // Зарплата
        canViewSalary: !salaryAccess.hidden,
        canEditSalary: salaryAccess.fullAccess,
        salaryAccess,

        // Текущая роль (для отладки)
        currentRole: userProfile?.role,
    };
};

export default useFieldAccess;
