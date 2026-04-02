import { logger } from 'firebase-functions';
import { GoogleGenerativeAI, Schema, SchemaType } from '@google/generative-ai';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash-latest'];

interface SessionContext {
    status: 'none' | 'active' | 'paused';
    taskName?: string;
    startedAt?: Date;
    durationMinutes?: number;
}

interface AIResponse {
    intent: 'chat' | 'note';
    reply: string;
}

/**
 * Handle conversational / generic text messages using Gemini Structured Outputs
 */
export async function generateConversationalReply(
    userId: number,
    userName: string,
    messageText: string,
    sessionCtx: SessionContext
): Promise<AIResponse | null> {
    if (!GEMINI_API_KEY) {
        logger.error('GEMINI_API_KEY not configured for AI Assistant');
        return null;
    }

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

    // Context formatting
    let contextStr = `Имя: ${userName}\n`;
    if (sessionCtx.status === 'none') {
        contextStr += `Статус: Нет активной смены (Not working right now).\n`;
    } else {
        contextStr += `Статус: ${sessionCtx.status === 'active' ? 'Работает (Active)' : 'На паузе (Paused)'}\n`;
        if (sessionCtx.taskName) contextStr += `Объект/Задача: ${sessionCtx.taskName}\n`;
        if (sessionCtx.durationMinutes !== undefined) contextStr += `Отработано (без учета пауз): ${sessionCtx.durationMinutes} мин.\n`;
    }

    const systemPrompt = `Ты - дружелюбный AI-ассистент Profit Step, интегрированный в рабочий Telegram бот. Тебя зовут Ассистент. 
Ты общаешься с сотрудниками на стройке/ремонте.

КОНТЕКСТ РАБОТНИКА СЕЙЧАС:
${contextStr}

ТВОЯ ЗАДАЧА - классифицировать сообщение пользователя и дать краткий ответ.
У тебя есть ровно ДВА возможных "intent" (намерения):
1. "chat" - Пользователь задает вопросы, здоровается (привет, как дела), просит совета, спрашивает сколько времени он отработал, или просто общается.
   РЕАКЦИЯ: Ответь дружелюбно, опираясь на КОНТЕКСТ (если спрашивают про смену - скажи статус смены, если просто привет - поздоровайся и напомни, что поможешь с учетом).
   
2. "note" - Пользователь скидывает рабочую информацию по объекту: "сделал стену", "установил щиток", "надо купить гвозди", "купил краску", "помстить провода", или диктует список.
   РЕАКЦИЯ: Скажи, что всё понял и эта информация СОХРАНЕНА во Входящие (или в Рабочую заметку).

ФОРМАТ ОТВЕТА (строгий JSON):
Верни JSON объект с двумя полями:
- "intent": строго "chat" или "note"
- "reply": Твой короткий (1-2 предложения), вежливый текстовый ответ на языке пользователя. Используй emoji дозированно.

Пример (chat): {"intent": "chat", "reply": "Привет, Денис! 👋 У тебя сейчас нет активной смены. Нажми 'Start Work', чтобы начать."}
Пример (note): {"intent": "note", "reply": "Принято! 📝 Сохранил информацию по объекту в заметки."}`;

    const responseSchema: Schema = {
        type: SchemaType.OBJECT,
        properties: {
            intent: {
                type: SchemaType.STRING,
                description: 'Классификация сообщения пользователя. Строго "chat" или "note".'
            },
            reply: {
                type: SchemaType.STRING,
                description: 'Текстовый ответ бота пользователю, опираясь на контекст.'
            }
        },
        required: ['intent', 'reply']
    };

    for (const modelName of MODELS) {
        try {
            const model = genAI.getGenerativeModel({
                model: modelName,
                generationConfig: {
                    responseMimeType: 'application/json',
                    responseSchema: responseSchema,
                    temperature: 0.3
                }
            });

            const result = await model.generateContent({
                contents: [
                    { role: 'user', parts: [{ text: systemPrompt }] },
                    { role: 'user', parts: [{ text: `Сообщение от пользователя: "${messageText}"` }] }
                ]
            });

            const textResponse = await result.response.text();
            if (!textResponse) throw new Error('Empty text response');

            const parsed = JSON.parse(textResponse) as AIResponse;
            logger.info(`🤖 Telegram AI Assistant classification [${modelName}]:`, parsed);

            return parsed;
        } catch (error: any) {
            logger.warn(`🤖 Telegram AI Assistant model failed [${modelName}]:`, { error: error.message });
        }
    }

    logger.error('Telegram AI Assistant failed on all retry models');
    return null;
}
