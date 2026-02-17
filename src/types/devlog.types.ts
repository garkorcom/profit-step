import { Timestamp } from 'firebase/firestore';

// ==================== DevLog Core v2 ====================

// ---- Feature (Module Documentation) ----

export type FeatureStatus = 'planned' | 'in-progress' | 'stable' | 'deprecated';

export interface RoadmapItem {
    id: string;
    title: string;
    isCompleted: boolean;
}

/**
 * Модуль продукта (коллекция `features`)
 */
export interface DevFeature {
    id: string;
    title: string;
    slug: string;                    // URL-friendly: "auth-module"
    shortDescription: string;        // Для карточек
    fullDocumentation: string;       // Markdown, обновляется ИИ при публикации
    techStack: string[];
    status: FeatureStatus;
    version: string;                 // SemVer: "1.2.0"
    lastUpdated: Timestamp;
    roadmap: RoadmapItem[];
    createdAt: Timestamp;
}

// ---- DevLog (Blog Post) ----

export type DevLogType = 'feature' | 'bugfix' | 'refactor' | 'infrastructure';

export interface RawInput {
    notes: string;                   // Сырые заметки / поток сознания
    codeDiff: string;                // Git diff или куски кода
    images: string[];                // URL скриншотов
    timeSpentMinutes: number;        // Минуты (точнее чем часы)
}

export interface DevLogContent {
    title: string;                   // SEO-friendly заголовок
    slug: string;                    // URL-friendly
    emoji: string;                   // Для визуала: "🚀", "🐛"
    tldr: string;                    // Tweet-style краткая выжимка
    storyMarkdown: string;           // Основной текст (сторителлинг)
    technicalMarkdown: string;       // Техническая часть (для гиков)
    keyTakeaways: string[];          // "Чему мы научились"
}

export interface DevLogSEO {
    metaDescription: string;
    keywords: string[];
}

/**
 * Пост блога разработки (коллекция `dev_logs`)
 */
export interface DevLog {
    id: string;
    featureId: string;
    featureTitle?: string;           // Денормализованное
    authorId: string;
    type: DevLogType;
    rawInput: RawInput;
    content: DevLogContent;
    seo: DevLogSEO;
    isPublished: boolean;
    createdAt: Timestamp;
    publishedAt: Timestamp | null;
    updatedAt?: Timestamp;
}

// ---- Form Data ----

export type TonePreference = 'neutral' | 'fun' | 'serious';

export interface DevLogFormData {
    featureId: string;
    type: DevLogType;
    notes: string;
    codeDiff: string;
    images: string[];
    timeSpentMinutes: number;
    tone: TonePreference;
}

// ---- AI Generation Result (returned by mock / Cloud Function) ----

export interface AIGenerationResult {
    content: DevLogContent;
    seo: DevLogSEO;
    detectedType: DevLogType;        // ИИ может предложить тип
}
