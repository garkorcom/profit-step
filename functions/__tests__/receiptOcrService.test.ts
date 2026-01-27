/**
 * @fileoverview Unit tests for Receipt OCR Service
 * 
 * Tests the pattern matching logic for extracting amounts from receipt text.
 */

// Create mock functions that we can control
const mockTextDetection = jest.fn();
const mockGetProjectId = jest.fn().mockResolvedValue('test-project');

// Mock the Vision API client
jest.mock('@google-cloud/vision', () => ({
    ImageAnnotatorClient: jest.fn().mockImplementation(() => ({
        textDetection: mockTextDetection,
        getProjectId: mockGetProjectId,
    })),
}));

// Import after mocking
import { extractAmountFromReceipt, checkVisionApiAvailability } from '../src/services/receiptOcrService';

describe('Receipt OCR Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetProjectId.mockResolvedValue('test-project');
    });

    describe('extractAmountFromReceipt', () => {

        it('should extract amount from English TOTAL pattern', async () => {
            mockTextDetection.mockResolvedValue([{
                fullTextAnnotation: {
                    text: `
                        RECEIPT
                        Item 1         $10.00
                        Item 2         $25.50
                        -----------------
                        TOTAL: $35.50
                    `
                }
            }]);

            const result = await extractAmountFromReceipt('https://example.com/receipt.jpg');

            expect(result.success).toBe(true);
            expect(result.amount).toBe(35.50);
            expect(result.confidence).toBe('high');
        });

        it('should extract amount from Russian ИТОГО pattern', async () => {
            mockTextDetection.mockResolvedValue([{
                fullTextAnnotation: {
                    text: `
                        ЧЕК
                        Краска         1500.00
                        Кисти          350.00
                        -----------------
                        ИТОГО: 1850.00
                    `
                }
            }]);

            const result = await extractAmountFromReceipt('https://example.com/receipt.jpg');

            expect(result.success).toBe(true);
            expect(result.amount).toBe(1850.00);
            expect(result.confidence).toBe('high');
        });

        it('should extract amount from GRAND TOTAL pattern', async () => {
            mockTextDetection.mockResolvedValue([{
                fullTextAnnotation: {
                    text: `
                        HOME DEPOT
                        Items: 3
                        Tax: $7.20
                        GRAND TOTAL: $97.19
                        Thank you!
                    `
                }
            }]);

            const result = await extractAmountFromReceipt('https://example.com/receipt.jpg');

            expect(result.success).toBe(true);
            expect(result.amount).toBe(97.19);
            expect(result.confidence).toBe('high');
        });

        it('should extract amount from Russian СУММА pattern', async () => {
            mockTextDetection.mockResolvedValue([{
                fullTextAnnotation: {
                    text: `
                        Магазин Стройматериалы
                        Гвозди 100шт    250.00
                        Шурупы         180.00
                        СУММА: 430.00
                    `
                }
            }]);

            const result = await extractAmountFromReceipt('https://example.com/receipt.jpg');

            expect(result.success).toBe(true);
            expect(result.amount).toBe(430.00);
            expect(result.confidence).toBe('medium');
        });

        it('should handle comma as decimal separator', async () => {
            mockTextDetection.mockResolvedValue([{
                fullTextAnnotation: {
                    text: `
                        ЧЕCK
                        TOTAL: 142,50
                    `
                }
            }]);

            const result = await extractAmountFromReceipt('https://example.com/receipt.jpg');

            expect(result.success).toBe(true);
            expect(result.amount).toBe(142.50);
        });

        it('should return failure when no text found', async () => {
            mockTextDetection.mockResolvedValue([{
                fullTextAnnotation: null
            }]);

            const result = await extractAmountFromReceipt('https://example.com/blank.jpg');

            expect(result.success).toBe(false);
            expect(result.amount).toBeNull();
            expect(result.confidence).toBe('none');
        });

        it('should return failure when no amount pattern matched', async () => {
            mockTextDetection.mockResolvedValue([{
                fullTextAnnotation: {
                    text: `
                        Some random text
                        Without any amounts
                        Just words here
                    `
                }
            }]);

            const result = await extractAmountFromReceipt('https://example.com/receipt.jpg');

            expect(result.success).toBe(false);
            expect(result.amount).toBeNull();
        });

        it('should reject unreasonably small amounts (cents)', async () => {
            mockTextDetection.mockResolvedValue([{
                fullTextAnnotation: {
                    text: `TOTAL: $0.05`
                }
            }]);

            const result = await extractAmountFromReceipt('https://example.com/receipt.jpg');

            expect(result.success).toBe(false);
        });

        it('should reject unreasonably large amounts (millions)', async () => {
            mockTextDetection.mockResolvedValue([{
                fullTextAnnotation: {
                    text: `TOTAL: $1000000.00`
                }
            }]);

            const result = await extractAmountFromReceipt('https://example.com/receipt.jpg');

            expect(result.success).toBe(false);
        });

        it('should handle Vision API errors gracefully', async () => {
            mockTextDetection.mockRejectedValue(
                new Error('API quota exceeded')
            );

            const result = await extractAmountFromReceipt('https://example.com/receipt.jpg');

            expect(result.success).toBe(false);
            expect(result.confidence).toBe('none');
        });
    });

    describe('checkVisionApiAvailability', () => {
        it('should return true when API is available', async () => {
            const result = await checkVisionApiAvailability();
            expect(result).toBe(true);
        });

        it('should return false when API is unavailable', async () => {
            mockGetProjectId.mockRejectedValue(
                new Error('Invalid credentials')
            );

            const result = await checkVisionApiAvailability();
            expect(result).toBe(false);
        });
    });
});

describe('Amount Pattern Matching', () => {
    // Test individual regex patterns without Vision API
    const AMOUNT_PATTERNS = [
        /TOTAL[:\s]*\$?\s*(\d+[.,]\d{2})/i,
        /ИТОГО[:\s]*(\d+[.,]\d{2})/i,
        /СУММА[:\s]*(\d+[.,]\d{2})/i,
    ];

    const testCases = [
        { text: 'TOTAL: $142.50', expected: 142.50 },
        { text: 'Total $99.99', expected: 99.99 },
        { text: 'ИТОГО: 1500.00', expected: 1500.00 },
        { text: 'Итого 250,50', expected: 250.50 },
        { text: 'СУММА: 999.99', expected: 999.99 },
        { text: 'Сумма  450.00', expected: 450.00 },
    ];

    testCases.forEach(({ text, expected }) => {
        it(`should match "${text}" -> ${expected}`, () => {
            let matched = false;
            for (const pattern of AMOUNT_PATTERNS) {
                const match = text.match(pattern);
                if (match && match[1]) {
                    const amount = parseFloat(match[1].replace(',', '.'));
                    expect(amount).toBe(expected);
                    matched = true;
                    break;
                }
            }
            expect(matched).toBe(true);
        });
    });
});
