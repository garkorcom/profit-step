import {
    collection,
    doc,
    getDocs,
    addDoc,
    updateDoc,
    query,
    where,
    orderBy,
    serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase/firebase';
import type {
    DevFeature,
    DevLog,
    DevLogFormData,
    DevLogContent,
    DevLogSEO,
    DevLogType,
    AIGenerationResult,
    TonePreference,
} from '../types/devlog.types';

// ==================== HELPERS ====================

const slugify = (text: string): string =>
    text
        .toLowerCase()
        .replace(/[^a-zа-яё0-9\s-]/gi, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 80);

// ==================== FEATURES ====================

export const getFeatures = async (): Promise<DevFeature[]> => {
    const snapshot = await getDocs(
        query(collection(db, 'features'), orderBy('title'))
    );
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as DevFeature));
};

export const createFeature = async (
    data: Omit<DevFeature, 'id' | 'createdAt' | 'lastUpdated'>
): Promise<string> => {
    const docRef = await addDoc(collection(db, 'features'), {
        ...data,
        createdAt: serverTimestamp(),
        lastUpdated: serverTimestamp(),
    });
    return docRef.id;
};

// ==================== DEV LOGS ====================

export const getPublishedDevLogs = async (): Promise<DevLog[]> => {
    const snapshot = await getDocs(
        query(
            collection(db, 'dev_logs'),
            where('isPublished', '==', true),
            orderBy('createdAt', 'desc')
        )
    );
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as DevLog));
};

export const getAllDevLogs = async (): Promise<DevLog[]> => {
    const snapshot = await getDocs(
        query(collection(db, 'dev_logs'), orderBy('createdAt', 'desc'))
    );
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as DevLog));
};

export const saveDevLog = async (
    formData: DevLogFormData,
    aiResult: AIGenerationResult,
    featureTitle: string,
    authorId: string,
    publish: boolean = false
): Promise<string> => {
    const docRef = await addDoc(collection(db, 'dev_logs'), {
        featureId: formData.featureId,
        featureTitle,
        authorId,
        type: formData.type || aiResult.detectedType,
        rawInput: {
            notes: formData.notes,
            codeDiff: formData.codeDiff,
            images: formData.images,
            timeSpentMinutes: formData.timeSpentMinutes,
        },
        content: aiResult.content,
        seo: aiResult.seo,
        isPublished: publish,
        publishedAt: publish ? serverTimestamp() : null,
        createdAt: serverTimestamp(),
    });
    return docRef.id;
};

export const togglePublishDevLog = async (
    logId: string,
    isPublished: boolean
): Promise<void> => {
    await updateDoc(doc(db, 'dev_logs', logId), {
        isPublished,
        publishedAt: isPublished ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
    });
};

// ==================== MOCK AI GENERATOR (v2) ====================

/**
 * Автодетект типа по ключевым словам в заметках
 */
const detectType = (notes: string): DevLogType => {
    const lower = notes.toLowerCase();
    if (/баг|bug|fix|исправ|ошибк|crash|broken/.test(lower)) return 'bugfix';
    if (/рефактор|refactor|clean|restructur|переписа/.test(lower)) return 'refactor';
    if (/инфра|devops|ci|cd|deploy|docker|pipeline|настрой/.test(lower)) return 'infrastructure';
    return 'feature';
};

const TYPE_EMOJI: Record<DevLogType, string> = {
    feature: '🚀',
    bugfix: '🐛',
    refactor: '♻️',
    infrastructure: '🔧',
};

const TONE_MODIFIERS: Record<TonePreference, { storyStyle: string; emoji: boolean }> = {
    neutral: { storyStyle: 'professional and clear', emoji: true },
    fun: { storyStyle: 'exciting, dramatic, with humor and lots of emoji', emoji: true },
    serious: { storyStyle: 'dry, concise, purely factual', emoji: false },
};

/**
 * Мок-функция v2 ИИ-генератора.
 * Имитирует Cloud Function `generateLogDraft`.
 * 
 * Улучшения v2:
 * - Автодетект типа изменений
 * - TLDR генерация (tweet-style)
 * - SEO мета-теги
 * - keyTakeaways
 * - Slug генерация
 * - Tone support (fun/serious/neutral)
 * - Feature context awareness
 */
export const mockGenerateLogDraft = async (
    formData: DevLogFormData,
    featureTitle: string,
    _featureContext?: string     // fullDocumentation — для контекста (будущее)
): Promise<AIGenerationResult> => {
    // Симуляция задержки API
    await new Promise(resolve => setTimeout(resolve, 2000));

    const { notes, codeDiff, timeSpentMinutes, tone } = formData;
    const detectedType = detectType(notes);
    const emoji = TYPE_EMOJI[detectedType];
    const toneConfig = TONE_MODIFIERS[tone];
    const hours = (timeSpentMinutes / 60).toFixed(1);
    const firstLine = notes.split('\n')[0].slice(0, 60) || 'Обновление платформы';
    const hasCode = codeDiff.trim().length > 0;

    // Generate title based on type
    const titleMap: Record<DevLogType, string> = {
        feature: `${emoji} Новая фича: ${firstLine}`,
        bugfix: `${emoji} Починили: ${firstLine}`,
        refactor: `${emoji} Рефакторинг: ${firstLine}`,
        infrastructure: `${emoji} Инфра: ${firstLine}`,
    };

    const title = titleMap[detectedType];
    const slug = slugify(firstLine);

    // TLDR — tweet-style
    const tldrMap: Record<DevLogType, string> = {
        feature: `✅ Добавили ${firstLine.toLowerCase()} за ${hours}ч. Модуль ${featureTitle} стал лучше!`,
        bugfix: `🔥 Нашли и пофиксили баг в ${featureTitle}. Проблема: ${firstLine.toLowerCase()}. Время: ${hours}ч.`,
        refactor: `🧹 Отрефакторили ${featureTitle}. Стало чище: ${firstLine.toLowerCase()}. ${hours}ч.`,
        infrastructure: `⚙️ Обновили инфраструктуру: ${firstLine.toLowerCase()}. Заняло ${hours}ч.`,
    };

    // Story — storytelling mode
    const storyIntro: Record<DevLogType, string> = {
        feature: toneConfig.emoji
            ? `## 🎉 Что нового?\n\nСегодня в модуле **${featureTitle}** появилась новая возможность!`
            : `## Что нового\n\nВ модуле ${featureTitle} реализована новая функциональность.`,
        bugfix: toneConfig.emoji
            ? `## 🔥 Драма дня\n\nМы обнаружили коварный баг в **${featureTitle}**. Вот как мы с ним справились.`
            : `## Исправление ошибки\n\nОбнаружена и устранена ошибка в модуле ${featureTitle}.`,
        refactor: toneConfig.emoji
            ? `## 🧹 Чистим код\n\nСегодня был день уборки в **${featureTitle}**. Код стал чище и понятнее.`
            : `## Рефакторинг\n\nПроведена реструктуризация кода модуля ${featureTitle}.`,
        infrastructure: toneConfig.emoji
            ? `## ⚙️ Под капотом\n\nОбновили инфраструктуру для **${featureTitle}**. Незаметно, но критически важно.`
            : `## Инфраструктура\n\nОбновлена инфраструктурная часть модуля ${featureTitle}.`,
    };

    const storyMarkdown = `${storyIntro[detectedType]}\n\n` +
        `### Контекст\n` +
        `${notes.slice(0, 300)}${notes.length > 300 ? '...' : ''}\n\n` +
        `### Результат\n` +
        `${toneConfig.emoji ? '✅' : '-'} Задача решена и протестирована\n` +
        `${toneConfig.emoji ? '⏱️' : '-'} Затраченное время: **${hours} часов**\n` +
        `${toneConfig.emoji ? '🔧' : '-'} Модуль: **${featureTitle}**\n\n` +
        (toneConfig.emoji ? `> _Build in Public — делимся процессом разработки!_` : '');

    const technicalMarkdown = `## Техническое описание\n\n` +
        `**Модуль:** ${featureTitle}\n` +
        `**Тип:** ${detectedType}\n` +
        `**Время:** ${hours}ч\n\n` +
        `### Заметки разработчика\n\n${notes}\n\n` +
        (hasCode
            ? `### Код\n\n\`\`\`typescript\n${codeDiff}\n\`\`\`\n\n`
            : '') +
        `### Решение\n\nВнесены изменения в модуль ${featureTitle}. ` +
        `Подход — минимальные изменения с максимальным покрытием.`;

    // Key Takeaways
    const keyTakeaways = [
        `Тип изменения: ${detectedType}`,
        `Затронутый модуль: ${featureTitle}`,
        timeSpentMinutes > 120
            ? `Сложная задача — потребовала ${hours} часов работы`
            : `Быстрое изменение — ${hours} часов`,
    ];
    if (hasCode) keyTakeaways.push('Включает изменения кода');

    // SEO
    const keywords = [
        featureTitle.toLowerCase(),
        detectedType,
        'devlog',
        'profit-step',
        ...featureTitle.split(/\s+/).map(w => w.toLowerCase()),
    ].filter((v, i, a) => a.indexOf(v) === i);

    const content: DevLogContent = {
        title,
        slug,
        emoji,
        tldr: tldrMap[detectedType],
        storyMarkdown,
        technicalMarkdown,
        keyTakeaways,
    };

    const seo: DevLogSEO = {
        metaDescription: `${featureTitle}: ${firstLine}. DevLog за ${hours}ч разработки.`,
        keywords,
    };

    return { content, seo, detectedType };
};
