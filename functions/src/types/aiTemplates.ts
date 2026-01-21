/**
 * @fileoverview Types for AI Estimate Templates
 * 
 * Provides instant estimates for common tasks without API calls
 * using pattern matching against predefined templates.
 */

import { Timestamp } from 'firebase-admin/firestore';

/**
 * Template for common task estimation
 * Stored in Firestore: ai_estimate_templates/{id}
 */
export interface AIEstimateTemplate {
    /** Auto-generated ID */
    id?: string;

    /** Glob pattern to match, e.g. "розетк*", "выключател*" */
    pattern: string;

    /** Alternative keywords for matching */
    keywords: string[];

    // ═══════════════════════════════════════
    // PER-UNIT ESTIMATES
    // ═══════════════════════════════════════

    /** Hours per unit of work */
    hoursPerUnit: number;

    /** Default units if not specified in description */
    defaultUnits: number;

    /** Unit name for display, e.g. "шт", "м²" */
    unitName: string;

    /** Regex to extract quantity, e.g. "(\\d+)\\s*(шт|штук|розет)" */
    unitRegex: string;

    // ═══════════════════════════════════════
    // RESOURCES
    // ═══════════════════════════════════════

    /** Standard materials for this task type */
    materials: string[];

    /** Standard tools for this task type */
    tools: string[];

    /** Explanation template for reasoning */
    reasoning: string;

    // ═══════════════════════════════════════
    // METADATA
    // ═══════════════════════════════════════

    /** Priority for conflict resolution (higher = first) */
    priority: number;

    /** Whether this template is active */
    isActive: boolean;

    /** Role filter (optional), e.g. "electrician" */
    roleFilter?: string;

    /** When template was created */
    createdAt: Timestamp;

    /** When template was last updated */
    updatedAt?: Timestamp;
}

/**
 * Result from template matching
 */
export interface TemplateMatchResult {
    /** Whether a template was found */
    matched: boolean;

    /** The matched template */
    template?: AIEstimateTemplate;

    /** Extracted quantity from description */
    quantity: number;

    /** Calculated total hours */
    totalHours: number;
}

export const TEMPLATE_CONFIG = {
    /** Collection name */
    COLLECTION: 'ai_estimate_templates',

    /** Default hourly rate for cost calculation */
    DEFAULT_HOURLY_RATE: 95,
} as const;

/**
 * Default templates to seed
 */
export const DEFAULT_TEMPLATES: Omit<AIEstimateTemplate, 'id' | 'createdAt'>[] = [
    {
        pattern: 'розетк*',
        keywords: ['розетка', 'outlet', 'socket'],
        hoursPerUnit: 0.5,
        defaultUnits: 1,
        unitName: 'шт',
        unitRegex: '(\\d+)\\s*(шт|штук|розет)',
        materials: ['Подрозетник', 'Кабель NYM 3×2.5', 'Розетка'],
        tools: ['Перфоратор', 'Отвертка', 'Индикатор напряжения'],
        reasoning: 'Установка розетки включает: разметку, сверление, прокладку кабеля, монтаж подрозетника и подключение.',
        priority: 10,
        isActive: true,
    },
    {
        pattern: 'выключател*',
        keywords: ['выключатель', 'switch'],
        hoursPerUnit: 0.3,
        defaultUnits: 1,
        unitName: 'шт',
        unitRegex: '(\\d+)\\s*(шт|штук|выключ)',
        materials: ['Установочная коробка', 'Выключатель', 'Кабель'],
        tools: ['Отвертка', 'Индикатор напряжения'],
        reasoning: 'Установка выключателя: демонтаж старого, подключение нового, проверка.',
        priority: 10,
        isActive: true,
    },
    {
        pattern: 'люстр*',
        keywords: ['люстра', 'светильник', 'chandelier', 'lamp'],
        hoursPerUnit: 1.0,
        defaultUnits: 1,
        unitName: 'шт',
        unitRegex: '(\\d+)\\s*(шт|штук|люстр|светильн)',
        materials: ['Крепёж потолочный', 'Клеммы WAGO', 'Дюбели'],
        tools: ['Перфоратор', 'Отвертка', 'Стремянка'],
        reasoning: 'Монтаж люстры: установка крепежа, сборка, подключение, проверка.',
        priority: 10,
        isActive: true,
    },
    {
        pattern: 'плитк*',
        keywords: ['плитка', 'кафель', 'tile'],
        hoursPerUnit: 1.5,
        defaultUnits: 1,
        unitName: 'м²',
        unitRegex: '(\\d+)\\s*(м2|м²|кв\\.?\\s*м|квадрат)',
        materials: ['Плиточный клей', 'Затирка', 'Крестики'],
        tools: ['Плиткорез', 'Уровень', 'Шпатель зубчатый'],
        reasoning: 'Укладка плитки: подготовка основания, разметка, укладка, затирка швов.',
        priority: 10,
        isActive: true,
    },
    {
        pattern: 'покрас*',
        keywords: ['покраска', 'красить', 'paint'],
        hoursPerUnit: 0.5,
        defaultUnits: 1,
        unitName: 'м²',
        unitRegex: '(\\d+)\\s*(м2|м²|кв\\.?\\s*м|квадрат)',
        materials: ['Краска', 'Грунтовка', 'Валик', 'Кисть'],
        tools: ['Кювета', 'Стремянка', 'Малярный скотч'],
        reasoning: 'Покраска включает: подготовку поверхности, грунтовку, нанесение 2 слоёв краски.',
        priority: 10,
        isActive: true,
    },
];
