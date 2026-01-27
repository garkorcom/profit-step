/**
 * @fileoverview Receipt OCR Service
 * 
 * Uses Google Cloud Vision API to extract total amount from receipt images.
 * Provides fallback patterns for different receipt formats (EN/RU).
 */

import * as vision from '@google-cloud/vision';

// Initialize Vision client (uses default Firebase credentials)
const visionClient = new vision.ImageAnnotatorClient();

// Patterns to find total amount on receipts
const AMOUNT_PATTERNS = [
    // English patterns
    /TOTAL[:\s]*\$?\s*(\d+[.,]\d{2})/i,
    /GRAND\s*TOTAL[:\s]*\$?\s*(\d+[.,]\d{2})/i,
    /AMOUNT\s*DUE[:\s]*\$?\s*(\d+[.,]\d{2})/i,
    /BALANCE\s*DUE[:\s]*\$?\s*(\d+[.,]\d{2})/i,
    /SUBTOTAL[:\s]*\$?\s*(\d+[.,]\d{2})/i,

    // Russian patterns
    /ИТОГО[:\s]*(\d+[.,]\d{2})/i,
    /СУММА[:\s]*(\d+[.,]\d{2})/i,
    /ВСЕГО[:\s]*(\d+[.,]\d{2})/i,
    /К\s*ОПЛАТЕ[:\s]*(\d+[.,]\d{2})/i,

    // Generic: Last dollar amount in text (often the total)
    /\$\s*(\d+[.,]\d{2})\s*$/m,

    // Large amounts at end of lines (likely totals)
    /(\d{2,}[.,]\d{2})\s*$/m,
];

export interface OcrResult {
    success: boolean;
    amount: number | null;
    confidence: 'high' | 'medium' | 'low' | 'none';
    rawText?: string;
    matchedPattern?: string;
}

/**
 * Extract total amount from receipt image using OCR.
 * 
 * @param imageUrl - URL of the receipt image (Firebase Storage or Telegram CDN)
 * @returns OCR result with extracted amount and confidence level
 */
export async function extractAmountFromReceipt(imageUrl: string): Promise<OcrResult> {
    try {
        console.log(`🔍 OCR: Analyzing receipt image: ${imageUrl.substring(0, 50)}...`);

        // Call Vision API for text detection
        const [result] = await visionClient.textDetection(imageUrl);

        if (!result.fullTextAnnotation?.text) {
            console.log('⚠️ OCR: No text found in image');
            return {
                success: false,
                amount: null,
                confidence: 'none',
            };
        }

        const text = result.fullTextAnnotation.text;
        console.log(`📝 OCR: Extracted ${text.length} characters of text`);

        // Try each pattern to find amount
        for (const pattern of AMOUNT_PATTERNS) {
            const match = text.match(pattern);
            if (match && match[1]) {
                const amount = parseFloat(match[1].replace(',', '.'));

                // Validate: reasonable amount (not cents, not millions)
                if (amount >= 1 && amount < 100000) {
                    const patternName = pattern.source.substring(0, 20);
                    console.log(`✅ OCR: Found amount $${amount} using pattern: ${patternName}...`);

                    // Determine confidence based on pattern specificity
                    const confidence = getConfidenceLevel(pattern, amount);

                    return {
                        success: true,
                        amount,
                        confidence,
                        rawText: text.substring(0, 500), // First 500 chars for debugging
                        matchedPattern: patternName,
                    };
                }
            }
        }

        // No amount found
        console.log('⚠️ OCR: Could not find total amount in text');
        return {
            success: false,
            amount: null,
            confidence: 'none',
            rawText: text.substring(0, 500),
        };

    } catch (error: any) {
        console.error('❌ OCR Error:', error.message);

        // Return graceful failure
        return {
            success: false,
            amount: null,
            confidence: 'none',
        };
    }
}

/**
 * Determine confidence level based on pattern type and amount
 */
function getConfidenceLevel(pattern: RegExp, amount: number): 'high' | 'medium' | 'low' {
    const patternStr = pattern.source.toLowerCase();

    // High confidence: explicit TOTAL/ИТОГО patterns
    if (patternStr.includes('total') || patternStr.includes('итого') || patternStr.includes('всего')) {
        return 'high';
    }

    // Medium confidence: AMOUNT/СУММА patterns
    if (patternStr.includes('amount') || patternStr.includes('сумма') || patternStr.includes('balance')) {
        return 'medium';
    }

    // Low confidence: generic patterns
    return 'low';
}

/**
 * Quick health check for Vision API availability
 */
export async function checkVisionApiAvailability(): Promise<boolean> {
    try {
        // Simple test - this will fail fast if credentials are wrong
        await visionClient.getProjectId();
        return true;
    } catch {
        return false;
    }
}
