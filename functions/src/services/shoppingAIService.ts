/**
 * @fileoverview Shopping AI Service
 * 
 * AI-powered parsing of shopping inputs (text, voice, images)
 * using Google Gemini.
 */

import { logger } from 'firebase-functions';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import { safeConfig } from '../utils/safeConfig';

// Get API key
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || safeConfig().gemini?.api_key;

const MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash-latest', 'gemini-1.5-pro-latest', 'gemini-pro'];

// Parsed item structure
export interface ParsedShoppingItem {
    name: string;
    quantity: number;
    unit: string;
    isUrgent: boolean;
}

// System prompt for shopping item extraction
const SHOPPING_SYSTEM_PROMPT = `You are a construction procurement assistant for a Russian-speaking team.
I will give you raw text (from voice transcription, chat, or image OCR).
Extract a list of items to buy.

For each item, identify:
- name: Clean product name in Russian. Fix typos, normalize names.
- quantity: Number (default to 1 if not specified)
- unit: Unit of measure (шт, кг, л, м, упак, мешок, рулон). Infer from context if obvious (cement → мешок, paint → л or банка)
- isUrgent: Boolean. True if user said "срочно", "ASAP", "urgent", "!", or emphasized importance.

Common construction items to recognize:
- Профиль 60x27, Профиль 27x28 (гипсокартонные)
- Подвесы прямые, Краб (соединитель)
- Ротбанд, Кнауф (штукатурки)
- Саморезы, Дюбели
- Краска, Грунтовка
- Кабель, Провод
- Мешки для мусора

Output ONLY a valid JSON array, no markdown, no explanation:
[{ "name": "...", "quantity": 1, "unit": "шт", "isUrgent": false }]

If you cannot extract any items, return empty array: []`;

/**
 * Initialize Gemini client
 */
function getGeminiClient() {
    if (!GEMINI_API_KEY) {
        logger.error('GEMINI_API_KEY not configured');
        throw new Error('GEMINI_API_KEY not configured');
    }
    return new GoogleGenerativeAI(GEMINI_API_KEY);
}



/**
 * Helper to generate content with retry across models
 */
async function generateContentWithRetry(
    parts: any[],
    systemPrompt: string
): Promise<string | null> {
    const genAI = getGeminiClient();
    const errors: string[] = [];

    for (const modelName of MODELS) {
        try {
            const model = genAI.getGenerativeModel({
                model: modelName,
                generationConfig: { responseMimeType: 'application/json' }
            });

            // Prepend system prompt to user parts if not supported via systemInstruction (depends on SDK version)
            // But simpler: just add system prompt as first text part if needed, or rely on prompt engineering.
            // In SDK 0.24+, systemInstruction is supported in getGenerativeModel, but let's stick to simple prompting
            // or pass separate system instruction if needed.
            // For now, we mix system prompt into the first text part or separate parts in generateContent.
            // Wait, previous code mixed it. Let's keep mixing or use properly.

            // Actually, let's just use the `contents` format.

            const result = await model.generateContent({
                contents: [{ role: 'user', parts: [{ text: systemPrompt }, ...parts] }]
            });

            const response = await result.response;
            const text = response.text();

            if (text) return text;

        } catch (error: any) {
            logger.warn(`ShoppingAI: Model ${modelName} failed`, { error: error.message });
            errors.push(`${modelName}: ${error.message}`);
        }
    }

    logger.error('ShoppingAI: All models failed', { errors });
    return null;
}

/**
 * Parse text input into shopping items
 */
export async function parseTextInput(text: string, currentDraft: ParsedShoppingItem[] = []): Promise<ParsedShoppingItem[]> {
    try {
        let content = [{ text: `User input:\n${text}` }];

        if (currentDraft && currentDraft.length > 0) {
            const draftDesc = currentDraft.map(i => `- ${i.name} (${i.quantity} ${i.unit})`).join('\n');
            content = [{ text: `CURRENT DRAFT LIST:\n${draftDesc}\n\nUSER INPUT:\n${text}\n\nINSTRUCTION:\nUpdate the draft based on the user input.\n- If adding items, merge with existing if names match.\n- If "remove X", remove it.\n- If irrelevant, return draft unchanged.\n- Output the COMPLETE updated list as JSON.` }];
        }

        const responseText = await generateContentWithRetry(
            content,
            SHOPPING_SYSTEM_PROMPT
        );

        if (!responseText) return [];
        return parseJSONResponse(responseText);
    } catch (error) {
        logger.error('Error parsing text input', error);
        return [];
    }
}

/**
 * Parse voice input (audio buffer) into shopping items
 */
export async function parseVoiceInput(
    audioBuffer: Buffer,
    mimeType: string = 'audio/ogg',
    currentDraft: ParsedShoppingItem[] = []
): Promise<ParsedShoppingItem[]> {
    try {
        const audioBase64 = audioBuffer.toString('base64');
        let promptText = "Transcribe the audio and extract shopping items.";

        if (currentDraft && currentDraft.length > 0) {
            const draftDesc = currentDraft.map(i => `- ${i.name} (${i.quantity} ${i.unit})`).join('\n');
            promptText = `CURRENT DRAFT:\n${draftDesc}\n\nAUDIO INSTRUCTION:\nTranscribe audio and update the draft.\n- Merge duplicates.\n- Output COMPLETE updated list.`;
        }

        const responseText = await generateContentWithRetry(
            [
                {
                    inlineData: {
                        mimeType: mimeType,
                        data: audioBase64
                    }
                },
                { text: promptText }
            ],
            SHOPPING_SYSTEM_PROMPT
        );

        if (!responseText) return [];
        return parseJSONResponse(responseText);
    } catch (error) {
        logger.error('Error parsing voice input', error);
        return [];
    }
}

/**
 * Parse image input into shopping items
 */
export async function parseImageInput(
    imageBuffer: Buffer,
    mimeType: string = 'image/jpeg'
): Promise<ParsedShoppingItem[]> {
    try {
        const imageBase64 = imageBuffer.toString('base64');

        const responseText = await generateContentWithRetry(
            [
                {
                    inlineData: {
                        mimeType: mimeType,
                        data: imageBase64
                    }
                },
                { text: "Extract shopping items from this image. It may be a handwritten list, a photo of materials, or a screenshot." }
            ],
            SHOPPING_SYSTEM_PROMPT
        );

        if (!responseText) return [];
        return parseJSONResponse(responseText);
    } catch (error) {
        logger.error('Error parsing image input', error);
        return [];
    }
}

/**
 * Parse JSON response from Gemini, handling edge cases
 */
function parseJSONResponse(response: string): ParsedShoppingItem[] {
    try {
        // Clean response - remove markdown code blocks if present
        let cleaned = response.trim();
        if (cleaned.startsWith('```json')) {
            cleaned = cleaned.replace(/^```json\n?/, '').replace(/\n?```$/, '');
        } else if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```\n?/, '').replace(/\n?```$/, '');
        }

        const parsed = JSON.parse(cleaned);

        if (!Array.isArray(parsed)) {
            logger.error('Response is not an array', { parsed });
            return [];
        }

        // Validate and normalize items
        return parsed.map((item: any) => ({
            name: String(item.name || 'Неизвестный товар'),
            quantity: Number(item.quantity) || 1,
            unit: String(item.unit || 'шт'),
            isUrgent: Boolean(item.isUrgent),
        })).filter((item: ParsedShoppingItem) => item.name && item.name !== 'Неизвестный товар');

    } catch (error) {
        logger.error('Error parsing JSON response', { error, response });
        return [];
    }
}

/**
 * Download file from Telegram
 */
export async function downloadTelegramFile(
    fileId: string,
    botToken: string
): Promise<Buffer> {
    // Get file path
    const fileResponse = await axios.get(
        `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`
    );
    const filePath = fileResponse.data.result.file_path;

    // Download file
    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });

    return Buffer.from(response.data);
}

/**
 * Build confirmation message for draft items
 */
export function buildDraftMessage(
    items: ParsedShoppingItem[],
    clientName: string
): string {
    if (items.length === 0) {
        return '❌ Не удалось распознать товары. Попробуй ещё раз.';
    }

    let message = `📋 *Проверь список для ${clientName}:*\n\n`;

    items.forEach((item, idx) => {
        const urgent = item.isUrgent ? ' ❗️' : '';
        message += `${idx + 1}. ${item.name} (${item.quantity} ${item.unit})${urgent}\n`;
    });

    return message;
}

/**
 * Build inline keyboard for draft confirmation
 */
export function buildDraftKeyboard(
    items: ParsedShoppingItem[],
    listId: string
): any[][] {
    const keyboard: any[][] = [];

    // Delete buttons for each item
    items.forEach((_, idx) => {
        keyboard.push([{
            text: `🗑 Удалить #${idx + 1}`,
            callback_data: `draft:del:${idx}`,
        }]);
    });

    // Action buttons
    if (items.length > 0) {
        keyboard.push([{
            text: `✅ Сохранить (${items.length})`,
            callback_data: `draft:save:${listId}`,
        }]);
    }

    keyboard.push([
        { text: '➕ Добавить ещё', callback_data: `draft:more:${listId}` },
        { text: '🔄 Очистить', callback_data: 'draft:clear' },
    ]);

    keyboard.push([{
        text: '⬅️ Назад к списку',
        callback_data: `shop:list:${listId}`,
    }]);

    return keyboard;
}
