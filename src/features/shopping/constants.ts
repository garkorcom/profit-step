/**
 * @fileoverview Shopping Module Constants
 */

/**
 * Available units for shopping items
 */
export const SHOPPING_UNITS = ['шт', 'кг', 'л', 'м', 'упак', 'рул'] as const;

/**
 * Shopping list statuses
 */
export const SHOPPING_STATUSES = {
    ACTIVE: 'active',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
} as const;

/**
 * Default values
 */
export const DEFAULTS = {
    QUANTITY: 1,
    UNIT: 'шт',
} as const;
