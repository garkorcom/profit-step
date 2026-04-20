/**
 * @fileoverview Costs AI Service
 * 
 * AI-powered receipt parsing using Google Gemini Vision.
 * Extracts amount, store name, and suggests category from receipt photos.
 */

import { logger } from 'firebase-functions';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GEMINI_API_KEY } from '../config';

const MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash-latest', 'gemini-1.5-pro-latest'];

// Parsed receipt structure
export interface ParsedReceipt {
    storeName: string | null;
    amount: number | null;
    currency: string;
    suggestedCategory: string | null;
    confidence: 'high' | 'medium' | 'low';
}

// System prompt for receipt OCR
const RECEIPT_SYSTEM_PROMPT = `You are a receipt OCR assistant for a construction company expense tracking system.
Analyze the receipt image and extract:

1. Store/merchant name (look for logo, header, or business name)
2. Total amount (find the FINAL TOTAL, not subtotal or tax)
3. Currency (default to USD if not visible)
4. Suggest expense category based on store type

Category mapping:
- Home Depot, Lowe's, Menards, hardware stores → "materials"
- Tool stores, rental equipment → "tools"
- Shell, Chevron, BP, Exxon, gas stations → "fuel"
- McDonald's, Subway, restaurants, cafes → "food"
- Hotels, motels, Airbnb receipts → "housing"
- Permit offices, government fees → "permit"
- Everything else → "other"

Confidence levels:
- "high": Clear receipt, amount and store clearly visible
- "medium": Some parts unclear but main info readable
- "low": Poor quality, guessing from context

Return ONLY valid JSON, no markdown:
{"storeName": "Store Name", "amount": 123.45, "currency": "USD", "category": "materials", "confidence": "high"}

If cannot read at all:
{"storeName": null, "amount": null, "currency": "USD", "category": null, "confidence": "low"}`;

/**
 * Initialize Gemini client
 */
function getGeminiClient() {
    const apiKey = GEMINI_API_KEY.value();
    if (!apiKey) {
        logger.error('GEMINI_API_KEY not configured');
        throw new Error('GEMINI_API_KEY not configured');
    }
    return new GoogleGenerativeAI(apiKey);
}

/**
 * Parse receipt image using Gemini Vision
 */
export async function parseReceiptImage(imageBuffer: Buffer, mimeType: string = 'image/jpeg'): Promise<ParsedReceipt | null> {
    const genAI = getGeminiClient();
    const imageBase64 = imageBuffer.toString('base64');

    for (const modelName of MODELS) {
        try {
            const model = genAI.getGenerativeModel({
                model: modelName,
                generationConfig: { responseMimeType: 'application/json' }
            });

            const result = await model.generateContent({
                contents: [{
                    role: 'user',
                    parts: [
                        { text: RECEIPT_SYSTEM_PROMPT },
                        {
                            inlineData: {
                                mimeType: mimeType,
                                data: imageBase64
                            }
                        },
                        { text: 'Analyze this receipt and extract the information as specified.' }
                    ]
                }]
            });

            const response = await result.response;
            const text = response.text();

            if (text) {
                return parseJSONResponse(text);
            }
        } catch (error: any) {
            logger.warn(`CostsAI: Model ${modelName} failed`, { error: error.message });
        }
    }

    logger.error('CostsAI: All models failed');
    return null;
}

/**
 * Parse JSON response from Gemini
 */
function parseJSONResponse(response: string): ParsedReceipt | null {
    try {
        // Clean response - remove markdown if present
        let cleaned = response.trim();
        if (cleaned.startsWith('```json')) {
            cleaned = cleaned.replace(/^```json\n?/, '').replace(/\n?```$/, '');
        } else if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```\n?/, '').replace(/\n?```$/, '');
        }

        const parsed = JSON.parse(cleaned);

        return {
            storeName: parsed.storeName || null,
            amount: typeof parsed.amount === 'number' ? parsed.amount : null,
            currency: parsed.currency || 'USD',
            suggestedCategory: parsed.category || null,
            confidence: parsed.confidence || 'low'
        };
    } catch (error) {
        logger.error('Error parsing receipt JSON', { error, response });
        return null;
    }
}

/**
 * Build confirmation message for parsed receipt
 */
export function buildReceiptConfirmMessage(receipt: ParsedReceipt): string {
    if (receipt.amount === null && receipt.storeName === null) {
        return '📸 Фото загружено!\n\n❌ Не удалось распознать чек. Введите сумму вручную:';
    }

    let message = '📸 *Чек распознан!*\n\n';

    if (receipt.storeName) {
        message += `🏪 Магазин: ${receipt.storeName}\n`;
    }

    if (receipt.amount !== null) {
        message += `💵 Сумма: $${receipt.amount.toFixed(2)}\n`;
    }

    if (receipt.confidence === 'low') {
        message += '\n⚠️ _Низкая уверенность — проверьте данные_';
    }

    return message;
}

/**
 * Check if receipt was successfully parsed
 */
export function isReceiptParsed(receipt: ParsedReceipt | null): boolean {
    return receipt !== null && receipt.amount !== null;
}

/**
 * Transcribe voice message using Gemini
 */
export async function transcribeVoice(audioBuffer: Buffer, mimeType: string = 'audio/ogg'): Promise<string | null> {
    const genAI = getGeminiClient();
    const audioBase64 = audioBuffer.toString('base64');

    const TRANSCRIPTION_PROMPT = `Transcribe this audio message. 
The speaker is a construction worker describing an expense or purchase.
Output ONLY the transcribed text in the original language (likely Russian).
If you cannot transcribe, return empty string.`;

    for (const modelName of MODELS) {
        try {
            const model = genAI.getGenerativeModel({ model: modelName });

            const result = await model.generateContent({
                contents: [{
                    role: 'user',
                    parts: [
                        { text: TRANSCRIPTION_PROMPT },
                        {
                            inlineData: {
                                mimeType: mimeType,
                                data: audioBase64
                            }
                        }
                    ]
                }]
            });

            const response = await result.response;
            const text = response.text()?.trim();

            if (text && text.length > 0) {
                return text;
            }
        } catch (error: any) {
            logger.warn(`CostsAI transcribe: Model ${modelName} failed`, { error: error.message });
        }
    }

    logger.error('CostsAI: Voice transcription failed on all models');
    return null;
}

/**
 * Download file from Telegram
 */
export async function downloadTelegramFile(
    fileId: string,
    botToken: string
): Promise<Buffer> {
    const axios = require('axios');

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
