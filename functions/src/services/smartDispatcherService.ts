/**
 * @fileoverview Smart Dispatcher Service — AI Entity Matching
 * 
 * Распознавание исполнителей и клиентов из текста с использованием:
 * - RAG: Загрузка базы знаний (users + clients + aliases)
 * - AI: Gemini для entity matching
 * 
 * @module services/smartDispatcherService
 */

import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';
import { GoogleGenerativeAI } from '@google/generative-ai';
if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// ═══════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════

export interface EntityMatchResult {
    title: string;
    assigneeId?: string;
    assigneeName?: string;
    clientId?: string;
    clientName?: string;
    dueDate?: admin.firestore.Timestamp;
    priority?: 'low' | 'medium' | 'high';
    confidence: 'high' | 'low';
}

interface KnowledgeBase {
    users: Array<{ id: string; name: string; aliases: string[] }>;
    clients: Array<{ id: string; name: string; aliases: string[] }>;
    usersContext: string;
    clientsContext: string;
}

// ═══════════════════════════════════════════════════════════
// CACHE
// ═══════════════════════════════════════════════════════════

let cachedKB: KnowledgeBase | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ═══════════════════════════════════════════════════════════
// MAIN EXPORT
// ═══════════════════════════════════════════════════════════

/**
 * Parse voice transcription and extract entities
 * Main entry point for voice task processing
 */
export async function parseVoiceTask(
    transcription: string,
    ownerId: string,
    ownerName?: string
): Promise<EntityMatchResult> {
    try {
        // 1. Load knowledge base (cached)
        const kb = await getKnowledgeBase();

        // 2. Try fuzzy matching first (fast, no AI)
        const fuzzyResult = fuzzyMatch(transcription, kb);

        // 3. If fuzzy found both, return early
        if (fuzzyResult.assigneeId && fuzzyResult.clientId) {
            logger.info('Fuzzy match success', fuzzyResult);
            return {
                title: extractTitle(transcription),
                ...fuzzyResult,
                confidence: 'high'
            };
        }

        // 4. AI matching for remaining entities
        const aiResult = await aiMatch(transcription, kb, ownerId, ownerName);

        // 5. Merge results (fuzzy takes priority)
        return {
            title: aiResult.title || extractTitle(transcription),
            assigneeId: fuzzyResult.assigneeId || aiResult.assigneeId,
            assigneeName: fuzzyResult.assigneeName || aiResult.assigneeName,
            clientId: fuzzyResult.clientId || aiResult.clientId,
            clientName: fuzzyResult.clientName || aiResult.clientName,
            dueDate: aiResult.dueDate,
            priority: aiResult.priority,
            confidence: (fuzzyResult.assigneeId || fuzzyResult.clientId) ? 'high' : aiResult.confidence
        };

    } catch (error) {
        logger.error('Smart Dispatcher failed', error);
        return {
            title: extractTitle(transcription),
            confidence: 'low'
        };
    }
}

// ═══════════════════════════════════════════════════════════
// KNOWLEDGE BASE
// ═══════════════════════════════════════════════════════════

/**
 * Load knowledge base with caching
 */
async function getKnowledgeBase(): Promise<KnowledgeBase> {
    if (cachedKB && Date.now() - cacheTime < CACHE_TTL) {
        return cachedKB;
    }

    cachedKB = await loadKnowledgeBase();
    cacheTime = Date.now();
    return cachedKB;
}

/**
 * Load users and clients from Firestore
 */
async function loadKnowledgeBase(): Promise<KnowledgeBase> {
    // Load active users
    const usersSnap = await db.collection('users')
        .where('status', '==', 'active')
        .limit(50)
        .get();

    const users = usersSnap.docs.map(d => {
        const data = d.data();
        return {
            id: d.id,
            name: data.displayName || '',
            aliases: data.aliases || []
        };
    });

    // Load active clients
    const clientsSnap = await db.collection('clients')
        .where('status', '!=', 'archived')
        .limit(100)
        .get();

    const clients = clientsSnap.docs.map(d => {
        const data = d.data();
        return {
            id: d.id,
            name: data.name || '',
            aliases: data.aliases || []
        };
    });

    // Build context strings for AI
    const usersContext = users.map(u => {
        const aliases = u.aliases.length ? `, aliases: [${u.aliases.map((a: string) => `"${a}"`).join(', ')}]` : '';
        return `{ id: "${u.id}", name: "${u.name}"${aliases} }`;
    }).join('\n');

    const clientsContext = clients.map(c => {
        const aliases = c.aliases.length ? `, aliases: [${c.aliases.map((a: string) => `"${a}"`).join(', ')}]` : '';
        return `{ id: "${c.id}", name: "${c.name}"${aliases} }`;
    }).join('\n');

    logger.info(`Knowledge base loaded: ${users.length} users, ${clients.length} clients`);

    return { users, clients, usersContext, clientsContext };
}

// ═══════════════════════════════════════════════════════════
// FUZZY MATCHING (Fast, no AI)
// ═══════════════════════════════════════════════════════════

interface FuzzyResult {
    assigneeId?: string;
    assigneeName?: string;
    clientId?: string;
    clientName?: string;
}

/**
 * Quick fuzzy matching without AI
 * Searches for exact alias matches in text
 */
function fuzzyMatch(text: string, kb: KnowledgeBase): FuzzyResult {
    const normalized = text.toLowerCase();
    const result: FuzzyResult = {};

    // Match users
    for (const user of kb.users) {
        const allNames = [user.name, ...user.aliases];
        for (const name of allNames) {
            if (name && normalized.includes(name.toLowerCase())) {
                result.assigneeId = user.id;
                result.assigneeName = user.name;
                break;
            }
        }
        if (result.assigneeId) break;
    }

    // Match clients
    for (const client of kb.clients) {
        const allNames = [client.name, ...client.aliases];
        for (const name of allNames) {
            if (name && normalized.includes(name.toLowerCase())) {
                result.clientId = client.id;
                result.clientName = client.name;
                break;
            }
        }
        if (result.clientId) break;
    }

    return result;
}

// ═══════════════════════════════════════════════════════════
// AI MATCHING (Gemini)
// ═══════════════════════════════════════════════════════════

const SMART_DISPATCHER_PROMPT = `Ты — умный диспетчер строительной компании.
Проанализируй сообщение и извлеки структурированные данные.

СЕГОДНЯ: {todayDate} ({dayOfWeek})

═══════════════════════════════════════════════════════════
📁 СПРАВОЧНИК КЛИЕНТОВ/ПРОЕКТОВ:
{clientsContext}

👥 СПРАВОЧНИК СОТРУДНИКОВ:
{usersContext}
═══════════════════════════════════════════════════════════

📝 СООБЩЕНИЕ от {ownerName}:
"{transcription}"

═══════════════════════════════════════════════════════════
ИНСТРУКЦИИ:
1. КЛИЕНТ: Если упоминается клиент/проект из списка (по имени или alias), верни его ТОЧНЫЙ ID.
2. ИСПОЛНИТЕЛЬ: Если упоминается человек для назначения задачи, верни его ID.
   - Фразы типа "на Аркадия", "Лёше", "для Антона" = назначить исполнителя
   - Используй aliases для сопоставления
3. ДЕДЛАЙН: Извлеки дату и время отдельно:
   - deadlineDate: "сегодня", "завтра", "понедельник", "15 февраля" и т.д.
   - deadlineTime: "7:00", "09:30", "утром" (=08:00), "днём" (=14:00), "вечером" (=18:00)
   - Примеры: "завтра в 7 утра" → date:"завтра", time:"07:00"
              "в понедельник после обеда" → date:"понедельник", time:"14:00"
4. ПРИОРИТЕТ: "срочно", "важно" = high, "не срочно" = low

ВАЖНО: Возвращай ТОЛЬКО валидный JSON!
═══════════════════════════════════════════════════════════

{
  "title": "Краткий заголовок задачи",
  "assigneeId": "точный_id_пользователя" | null,
  "assigneeName": "Имя" | null,
  "clientId": "точный_id_клиента" | null,
  "clientName": "Название" | null,
  "deadlineDate": "завтра" | "понедельник" | "15 февраля" | null,
  "deadlineTime": "07:00" | "14:00" | null,
  "priority": "low" | "medium" | "high",
  "confidence": "high" | "low"
}`;

/**
 * AI-based entity matching using Gemini
 */
async function aiMatch(
    transcription: string,
    kb: KnowledgeBase,
    ownerId: string,
    ownerName?: string
): Promise<EntityMatchResult> {
    if (!GEMINI_API_KEY) {
        logger.warn('GEMINI_API_KEY not configured');
        return { title: extractTitle(transcription), confidence: 'low' };
    }

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    // Build today's date context for AI
    const now = new Date();
    const todayDate = now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    const dayOfWeek = now.toLocaleDateString('ru-RU', { weekday: 'long' });

    const prompt = SMART_DISPATCHER_PROMPT
        .replace('{todayDate}', todayDate)
        .replace('{dayOfWeek}', dayOfWeek)
        .replace('{clientsContext}', kb.clientsContext || '(Нет клиентов)')
        .replace('{usersContext}', kb.usersContext || '(Нет пользователей)')
        .replace('{ownerName}', ownerName || 'Unknown')
        .replace('{transcription}', transcription);

    try {
        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }]
        });

        const responseText = result.response.text().trim();
        const jsonText = responseText
            .replace(/```json\n?/g, '')
            .replace(/```\n?/g, '')
            .trim();

        const parsed = JSON.parse(jsonText);

        logger.info('AI match result', {
            assigneeId: parsed.assigneeId,
            clientId: parsed.clientId,
            deadlineDate: parsed.deadlineDate,
            deadlineTime: parsed.deadlineTime
        });

        return {
            title: parsed.title || extractTitle(transcription),
            assigneeId: parsed.assigneeId || undefined,
            assigneeName: parsed.assigneeName || undefined,
            clientId: parsed.clientId || undefined,
            clientName: parsed.clientName || undefined,
            dueDate: parseDeadline(parsed.deadlineDate, parsed.deadlineTime),
            priority: parsed.priority || 'medium',
            confidence: parsed.confidence || 'low'
        };

    } catch (error) {
        logger.warn('AI matching failed', error);
        return { title: extractTitle(transcription), confidence: 'low' };
    }
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

/**
 * Extract title from transcription
 */
function extractTitle(text: string): string {
    if (text.length <= 100) return text;
    return text.substring(0, 97) + '...';
}

/**
 * Parse deadline date and time to Firestore Timestamp
 * Handles: "завтра" + "07:00" → tomorrow at 7am
 */
function parseDeadline(
    dateHint?: string | null,
    timeHint?: string | null
): admin.firestore.Timestamp | undefined {
    if (!dateHint) return undefined;

    const now = new Date();
    const result = new Date();
    const dateLower = dateHint.toLowerCase();

    // Parse date part
    if (dateLower.includes('сегодня') || dateLower.includes('today')) {
        // Keep current date
    } else if (dateLower.includes('завтра') || dateLower.includes('tomorrow')) {
        result.setDate(now.getDate() + 1);
    } else if (dateLower.includes('послезавтра')) {
        result.setDate(now.getDate() + 2);
    } else if (dateLower.includes('понедельник') || dateLower.includes('monday')) {
        result.setDate(now.getDate() + ((1 - now.getDay() + 7) % 7 || 7));
    } else if (dateLower.includes('вторник') || dateLower.includes('tuesday')) {
        result.setDate(now.getDate() + ((2 - now.getDay() + 7) % 7 || 7));
    } else if (dateLower.includes('сред') || dateLower.includes('wednesday')) {
        result.setDate(now.getDate() + ((3 - now.getDay() + 7) % 7 || 7));
    } else if (dateLower.includes('четверг') || dateLower.includes('thursday')) {
        result.setDate(now.getDate() + ((4 - now.getDay() + 7) % 7 || 7));
    } else if (dateLower.includes('пятниц') || dateLower.includes('friday')) {
        result.setDate(now.getDate() + ((5 - now.getDay() + 7) % 7 || 7));
    } else if (dateLower.includes('суббот') || dateLower.includes('saturday')) {
        result.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7 || 7));
    } else if (dateLower.includes('воскресень') || dateLower.includes('sunday')) {
        result.setDate(now.getDate() + ((0 - now.getDay() + 7) % 7 || 7));
    } else if (dateLower.includes('недел') || dateLower.includes('week')) {
        result.setDate(now.getDate() + 7);
    }

    // Parse time part
    let hours = 18; // Default: 6pm
    let minutes = 0;

    if (timeHint) {
        const timeLower = timeHint.toLowerCase();

        // Check for word-based times first
        if (timeLower.includes('утр') || timeLower.includes('morning')) {
            hours = 8;
        } else if (timeLower.includes('днём') || timeLower.includes('днем') || timeLower.includes('обед') || timeLower.includes('noon') || timeLower.includes('afternoon')) {
            hours = 14;
        } else if (timeLower.includes('вечер') || timeLower.includes('evening')) {
            hours = 18;
        } else if (timeLower.includes('ночь') || timeLower.includes('night')) {
            hours = 21;
        } else {
            // Try to parse HH:MM or H:MM format
            const timeMatch = timeHint.match(/(\d{1,2})[:.]?(\d{2})?/);
            if (timeMatch) {
                hours = parseInt(timeMatch[1], 10);
                minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;

                // Handle 12-hour format hints
                if (hours < 12 && (timeLower.includes('вечер') || timeLower.includes('pm'))) {
                    hours += 12;
                }
            }
        }
    }

    result.setHours(hours, minutes, 0, 0);

    logger.info(`Deadline parsed: ${dateHint} ${timeHint} → ${result.toISOString()}`);

    return admin.firestore.Timestamp.fromDate(result);
}
