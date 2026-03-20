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
    Timestamp,
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

// ==================== AUTO-GATHER DAILY ACCOMPLISHMENTS ====================

export const getTodayAccomplishments = async (userId: string): Promise<{ notes: string, totalMinutes: number }> => {
    // 1. Determine today's boundaries
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const startTimestamp = Timestamp.fromDate(startOfDay);
    const endTimestamp = Timestamp.fromDate(endOfDay);

    let totalMinutes = 0;
    const notesLines: string[] = [];

    // 2. Query work_sessions ended today
    try {
        const sessionsQuery = query(
            collection(db, 'work_sessions'),
            where('employeeId', '==', userId),
            where('endTime', '>=', startTimestamp),
            where('endTime', '<=', endTimestamp)
        );
        const sessionsSnapshot = await getDocs(sessionsQuery);
        const sessions = sessionsSnapshot.docs.map(d => d.data());

        if (sessions.length > 0) {
            notesLines.push('**Рабочие сессии за сегодня:**');
            sessions.forEach(session => {
                const title = session.relatedTaskTitle || session.description || session.plannedTaskSummary || 'Сессия без описания';
                const duration = session.durationMinutes || 0;
                totalMinutes += duration;

                let details = '';
                if (session.resultSummary) {
                    details = ` - *Результат:* ${session.resultSummary}`;
                }
                notesLines.push(`- ⏱️ ${title} (${duration} мин)${details}`);
            });
            notesLines.push(''); // empty line
        }
    } catch (e) {
        console.error('Error fetching work_sessions:', e);
    }

    // 3. Query gtd_tasks completed today
    try {
        const tasksQuery = query(
            collection(db, 'gtd_tasks'),
            where('ownerId', '==', userId),
            where('status', '==', 'done'),
            where('completedAt', '>=', startTimestamp),
            where('completedAt', '<=', endTimestamp)
        );
        const tasksSnapshot = await getDocs(tasksQuery);
        const tasks = tasksSnapshot.docs.map(d => d.data());

        // Also check tasks where the user is an assignee
        const assigneeTasksQuery = query(
            collection(db, 'gtd_tasks'),
            where('assigneeId', '==', userId),
            where('status', '==', 'done'),
            where('completedAt', '>=', startTimestamp),
            where('completedAt', '<=', endTimestamp)
        );
        const assigneeTasksSnapshot = await getDocs(assigneeTasksQuery);
        const assigneeTasks = assigneeTasksSnapshot.docs.map(d => d.data());

        // Merge and deduplicate just in case
        const allTasksMap = new Map();
        tasks.forEach(t => allTasksMap.set(t.id, t));
        assigneeTasks.forEach(t => allTasksMap.set(t.id, t));
        // V6 Fix: Filter out subtasks to prevent devlog noise
        const allCompletedTasks = Array.from(allTasksMap.values())
            .filter(t => !t.parentTaskId && !t.isSubtask);

        if (allCompletedTasks.length > 0) {
            notesLines.push('**Завершенные задачи за сегодня:**');
            allCompletedTasks.forEach(task => {
                const duration = task.actualDurationMinutes || task.estimatedDurationMinutes || 0;
                // We do NOT add to totalMinutes here to avoid double-counting if work_sessions correctly mapped to gtd_tasks logic.
                // However, if the user works without tracking sessions, we might want to sum. For now, tracking relies heavily on sessions or manual logging.
                // Let's add it only if there are no related sessions for this task in the day.
                // Simple approach: add task actual duration if provided and totalMinutes is still low. (Adjust as needed)
                if (totalMinutes === 0) {
                    totalMinutes += duration;
                }

                notesLines.push(`- ✅ ${task.title} (${duration > 0 ? duration + ' мин' : 'время не указано'})`);
            });
        }
    } catch (e) {
        console.error('Error fetching gtd_tasks:', e);
    }

    // 4. Fallback if nothing found
    if (notesLines.length === 0) {
        notesLines.push('Система не нашла завершенных задач или затреканного времени (work_sessions) за сегодня. Запишите вручную!');
    }

    return {
        notes: notesLines.join('\n'),
        totalMinutes
    };
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
