/**
 * @fileoverview AI Smart Input Parser Cloud Function
 * 
 * Analyzes task description to extract:
 * - Task type (buy, check, fix, etc.)
 * - Date/time from natural language
 * - Duplicate detection against existing tasks
 */

import * as functions from 'firebase-functions';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GEMINI_API_KEY } from '../../config';
// ══════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════

export interface SmartInputRequest {
    /** Task description from user input */
    description: string;
    /** List of existing task titles for duplicate detection */
    existingTasks?: string[];
    /** List of client names for matching */
    clientNames?: string[];
}

export interface SmartInputResponse {
    /** Detected task type */
    suggestedType?: 'buy' | 'bring' | 'pickup' | 'move' | 'check' | 'handover' | 'fix' | 'meet' | 'install' | 'setup' | 'discuss' | 'other';
    /** Confidence score 0-1 */
    typeConfidence: number;

    /** Extracted date (ISO format YYYY-MM-DD) */
    suggestedDate?: string;
    /** Extracted time (HH:MM format) */
    suggestedTime?: string;
    /** Original date/time phrase found in text */
    datePhrase?: string;

    /** Suggested client name from description */
    suggestedClientName?: string;

    /** Suggested priority based on urgency keywords */
    suggestedPriority?: 'low' | 'medium' | 'high';
    /** Original priority phrase found in text */
    priorityPhrase?: string;

    /** Similar existing tasks */
    possibleDuplicates?: Array<{
        taskTitle: string;
        similarity: number;
    }>;
}

// ══════════════════════════════════════════════════════════════
// SYSTEM PROMPT
// ══════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `Ты помощник для анализа описания задачи в строительной/ремонтной сфере.

## Твоя задача
Проанализировать текст описания задачи и вернуть структурированный JSON.

## Инструкции

### 1. Определи тип задачи (taskType)
Выбери ОДИН из типов:
- buy: купить, приобрести, заказать материалы
- bring: привезти, доставить на объект
- pickup: забрать, получить, заехать за чем-то
- move: переместить, перенести, переставить
- check: проверить, осмотреть, провести аудит
- handover: сдать, передать, показать результат
- fix: исправить, починить, отремонтировать
- meet: встретиться, встреча, созвониться
- install: установить, смонтировать
- setup: настроить, подготовить
- discuss: обсудить, обговорить
- other: если не подходит ни один тип

### 2. Извлеки дату/время (если есть)
Распознай фразы типа:
- "завтра", "послезавтра" → дата
- "в понедельник", "в пятницу" → ближайший такой день
- "через 2 дня", "на следующей неделе"
- "утром", "в 10:00", "после обеда" → время

### 3. Определи приоритет (priority)
Распознай ключевые слова:
- high: "срочно", "ASAP", "немедленно", "сегодня", "критично", "важно"
- medium: "желательно", "скоро", "приоритет"
- low: "когда будет время", "не срочно", "при возможности"
Если ничего не найдено - не включай это поле.

### 4. Найди клиента (clientName)
Если в списке клиентов есть похожее имя на упомянутое в описании:
- "объект Смирнова" → ищи "Смирнов" в списке
- "дом Иванова" → ищи "Иванов"
- "у Петровой" → ищи "Петрова"
Верни ТОЧНОЕ имя из списка (не придумывай).

### 5. Проверь дубликаты (если есть список existingTasks)
Найди задачи со схожим смыслом.

## Формат ответа (ТОЛЬКО JSON)
{
  "taskType": "buy",
  "typeConfidence": 0.95,
  "suggestedDate": "2026-02-03",
  "suggestedTime": "09:00",
  "datePhrase": "завтра утром",
  "priority": "high",
  "priorityPhrase": "срочно",
  "clientName": "Смирнов",
  "duplicates": []
}

## Правила
- Возвращай ТОЛЬКО валидный JSON
- typeConfidence: 0.0-1.0
- Если поле не найдено - НЕ включай его в ответ
- clientName должен ТОЧНО совпадать с именем из списка
- Все даты в формате YYYY-MM-DD
- Все время в формате HH:MM`;

// ══════════════════════════════════════════════════════════════
// GEMINI CALL
// ══════════════════════════════════════════════════════════════

async function callGemini(prompt: string): Promise<string> {
    const apiKey = GEMINI_API_KEY.value();

    if (!apiKey) {
        throw new functions.https.HttpsError('failed-precondition',
            'GEMINI_API_KEY not configured');
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    // Use fast model for quick parsing
    const models = ['gemini-2.0-flash', 'gemini-1.5-flash-latest'];
    const errors: string[] = [];

    for (const modelName of models) {
        console.log(`🤖 Smart Input: Trying ${modelName}...`);
        try {
            const model = genAI.getGenerativeModel({
                model: modelName,
                generationConfig: {
                    responseMimeType: 'application/json',
                    temperature: 0.1, // Low temperature for consistent parsing
                }
            });

            const result = await model.generateContent([
                { text: SYSTEM_PROMPT },
                { text: prompt }
            ]);

            const text = result.response.text();
            if (text) {
                console.log(`✅ Smart Input: Success with ${modelName}`);
                return text;
            }
        } catch (error: any) {
            const errMsg = `[${modelName}] Failed: ${error.message}`;
            console.warn(errMsg);
            errors.push(errMsg);
        }
    }

    throw new functions.https.HttpsError('unavailable',
        `AI service unavailable. Last error: ${errors[errors.length - 1]}`);
}

// ══════════════════════════════════════════════════════════════
// DATE CALCULATION (today reference)
// ══════════════════════════════════════════════════════════════

function getTodayInfo(): string {
    const now = new Date();
    const days = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
    const dayName = days[now.getDay()];
    const dateStr = now.toISOString().split('T')[0];
    return `Сегодня: ${dateStr} (${dayName})`;
}

// ══════════════════════════════════════════════════════════════
// CLOUD FUNCTION
// ══════════════════════════════════════════════════════════════

export const parseSmartInput = functions
    .runWith({
        memory: '256MB',
        timeoutSeconds: 30,
        secrets: [GEMINI_API_KEY],
    })
    .https.onCall(async (data: SmartInputRequest, context): Promise<SmartInputResponse> => {
        // Verify authentication
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
        }

        // Validate input
        const description = data.description?.trim();
        if (!description || description.length < 3) {
            return {
                typeConfidence: 0,
            };
        }

        console.log(`🎯 Smart Input: Analyzing "${description.substring(0, 50)}..."`);

        // Build prompt with context
        const existingTasksList = data.existingTasks?.length
            ? `\n\nСуществующие задачи:\n${data.existingTasks.slice(0, 20).map(t => `- ${t}`).join('\n')}`
            : '';

        const clientNamesList = data.clientNames?.length
            ? `\n\nСписок клиентов:\n${data.clientNames.slice(0, 30).map(n => `- ${n}`).join('\n')}`
            : '';

        const userPrompt = `${getTodayInfo()}

Описание задачи: "${description}"${existingTasksList}${clientNamesList}

Проанализируй и верни JSON.`;

        try {
            const responseText = await callGemini(userPrompt);

            // Parse response
            const cleanText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            const aiResponse = JSON.parse(cleanText);

            // Build response
            const response: SmartInputResponse = {
                suggestedType: aiResponse.taskType,
                typeConfidence: aiResponse.typeConfidence || 0,
            };

            // Add date/time if found
            if (aiResponse.suggestedDate) {
                response.suggestedDate = aiResponse.suggestedDate;
            }
            if (aiResponse.suggestedTime) {
                response.suggestedTime = aiResponse.suggestedTime;
            }
            if (aiResponse.datePhrase) {
                response.datePhrase = aiResponse.datePhrase;
            }

            // Add client suggestion if found
            if (aiResponse.clientName) {
                response.suggestedClientName = aiResponse.clientName;
            }

            // Add priority if found
            if (aiResponse.priority) {
                response.suggestedPriority = aiResponse.priority;
            }
            if (aiResponse.priorityPhrase) {
                response.priorityPhrase = aiResponse.priorityPhrase;
            }

            // Add duplicates if found
            if (aiResponse.duplicates?.length > 0) {
                response.possibleDuplicates = aiResponse.duplicates.map((d: any) => ({
                    taskTitle: d.title,
                    similarity: d.similarity || 0.5,
                }));
            }

            console.log(`✅ Smart Input: Type=${response.suggestedType}, Client=${response.suggestedClientName || 'none'}, Priority=${response.suggestedPriority || 'none'}`);

            return response;

        } catch (error: any) {
            console.error('❌ Smart Input failed:', error);

            // Return empty response on error (graceful degradation)
            return {
                typeConfidence: 0,
            };
        }
    });
