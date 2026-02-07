/**
 * @fileoverview Upload Bank Statement
 * 
 * Callable function to upload and parse bank statements.
 * Supports PDF images and CSV files.
 * Features: duplicate detection, multi-file support
 * 
 * @module callable/finance/uploadBankStatement
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { parseBankStatementImage, parseChaseCSV, ParsedTransaction } from '../../utils/bankAIParser';
import * as crypto from 'crypto';

interface UploadRequest {
    /** Base64 encoded file content */
    fileContent: string;
    /** Original filename */
    fileName: string;
    /** MIME type (image/png, image/jpeg, text/csv) */
    mimeType: string;
    /** Year for grouping (default: current year) */
    year?: number;
}

interface UploadResponse {
    success: boolean;
    statementId?: string;
    transactionCount?: number;
    skippedCount?: number;
    duplicateCount?: number;
    /** Detected year from transaction dates */
    detectedYear?: number;
    /** Detected month from transaction dates (1-12) */
    detectedMonth?: number;
    error?: string;
}

/**
 * Generate unique hash for transaction to detect duplicates
 */
function generateTxHash(tx: ParsedTransaction, year: number): string {
    const str = `${tx.rawDescription}|${tx.amount}|${tx.date}|${year}`;
    return crypto.createHash('md5').update(str).digest('hex');
}

export const uploadBankStatement = functions
    .runWith({ memory: '512MB', timeoutSeconds: 120 })
    .https.onCall(async (data: UploadRequest, context): Promise<UploadResponse> => {
        // Auth check
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
        }

        const { fileContent, fileName, mimeType, year } = data;

        if (!fileContent || !fileName) {
            throw new functions.https.HttpsError('invalid-argument', 'Missing file content or name');
        }

        const db = admin.firestore();
        const userId = context.auth.uid;
        const statementYear = year || new Date().getFullYear();

        try {
            // Get user's company
            const userDoc = await db.collection('users').doc(userId).get();
            const companyId = userDoc.data()?.companyId || 'default';

            // Parse transactions based on file type
            let transactions: ParsedTransaction[] = [];
            let aiDetectedMonth: number | undefined;
            let aiDetectedYear: number | undefined;

            if (mimeType === 'text/csv' || fileName.endsWith('.csv')) {
                // CSV file
                const csvContent = Buffer.from(fileContent, 'base64').toString('utf-8');
                transactions = parseChaseCSV(csvContent);
            } else if (mimeType.startsWith('image/') || fileName.endsWith('.pdf')) {
                // Image or PDF - use Gemini Vision
                const aiResult = await parseBankStatementImage(fileContent, mimeType);
                transactions = aiResult.transactions;
                aiDetectedMonth = aiResult.statementMonth;
                aiDetectedYear = aiResult.statementYear;
            } else {
                throw new functions.https.HttpsError(
                    'invalid-argument',
                    'Unsupported file type. Use CSV, PNG, JPG, or PDF.'
                );
            }

            if (transactions.length === 0) {
                return {
                    success: false,
                    error: 'No transactions found in file',
                };
            }

            // Filter out 'skip' category (payments, transfers)
            const validTransactions = transactions.filter(tx => tx.category !== 'skip');
            const skippedCount = transactions.length - validTransactions.length;

            // Load vendor rules for auto-categorization
            const rulesSnapshot = await db.collection('vendor_rules').get();
            const vendorRules = rulesSnapshot.docs.map(doc => ({
                pattern: (doc.data().pattern || '').toLowerCase(),
                category: doc.data().category,
            }));

            // Apply vendor rules (override AI category)
            for (const tx of validTransactions) {
                const vendorLower = tx.vendor.toLowerCase();
                const matchedRule = vendorRules.find(rule =>
                    vendorLower.includes(rule.pattern) || rule.pattern.includes(vendorLower)
                );
                if (matchedRule) {
                    tx.category = matchedRule.category;
                }
            }

            // Get existing transaction hashes to detect duplicates
            const existingTxs = await db.collection('bank_transactions')
                .where('year', '==', statementYear)
                .where('companyId', '==', companyId)
                .select('txHash')
                .get();

            const existingHashes = new Set(existingTxs.docs.map(doc => doc.data().txHash));

            // Filter out duplicates
            const newTransactions = validTransactions.filter(tx => {
                const hash = generateTxHash(tx, statementYear);
                return !existingHashes.has(hash);
            });

            const duplicateCount = validTransactions.length - newTransactions.length;

            if (newTransactions.length === 0) {
                return {
                    success: true,
                    transactionCount: 0,
                    skippedCount,
                    duplicateCount,
                    error: duplicateCount > 0 ? 'All transactions already exist' : undefined,
                };
            }

            // Create statement document
            const statementRef = db.collection('bank_statements').doc();
            await statementRef.set({
                id: statementRef.id,
                fileName,
                mimeType,
                uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
                uploadedBy: userId,
                companyId,
                year: statementYear,
                transactionCount: newTransactions.length,
                skippedCount,
                duplicateCount,
            });

            // Batch write transactions (max 500 per batch)
            const batches: admin.firestore.WriteBatch[] = [];
            let currentBatch = db.batch();
            let batchCount = 0;

            // Use AI-detected period if available, otherwise track from first transaction
            let detectedYear = aiDetectedYear || statementYear;
            let detectedMonth = aiDetectedMonth || new Date().getMonth() + 1;
            let firstTxParsed = aiDetectedMonth !== undefined; // Skip auto-detect if AI provided period

            for (const tx of newTransactions) {
                const txRef = db.collection('bank_transactions').doc();
                const parsed = parseTransactionDate(tx.date, statementYear);

                // Use first transaction's year/month as fallback if AI didn't detect period
                if (!firstTxParsed) {
                    detectedYear = parsed.year;
                    detectedMonth = parsed.month;
                    firstTxParsed = true;
                }

                const txHash = generateTxHash(tx, parsed.year);

                currentBatch.set(txRef, {
                    id: txRef.id,
                    statementId: statementRef.id,
                    txHash, // For duplicate detection
                    date: parsed.timestamp,
                    rawDescription: tx.rawDescription,
                    vendor: tx.vendor,
                    city: tx.city || null,
                    state: tx.state || null,
                    amount: tx.amount,
                    category: tx.category,
                    isDeductible: isDeductibleCategory(tx.category),
                    notes: null,
                    year: parsed.year, // Use actual year from date
                    month: parsed.month, // Store month for filtering
                    companyId,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                });

                batchCount++;
                if (batchCount === 450) {
                    batches.push(currentBatch);
                    currentBatch = db.batch();
                    batchCount = 0;
                }
            }

            if (batchCount > 0) {
                batches.push(currentBatch);
            }

            // Update statement with detected year/month
            await statementRef.update({
                year: detectedYear,
                month: detectedMonth,
            });

            // Commit all batches
            await Promise.all(batches.map(batch => batch.commit()));

            console.log(`✅ Uploaded ${fileName}: ${newTransactions.length} new, ${duplicateCount} duplicates skipped`);

            return {
                success: true,
                statementId: statementRef.id,
                transactionCount: newTransactions.length,
                skippedCount,
                duplicateCount,
                detectedYear,
                detectedMonth,
            };

        } catch (error) {
            console.error('❌ Error uploading bank statement:', error);

            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    });

/**
 * Parse transaction date to Firestore Timestamp
 * Supports both MM/DD and MM/DD/YYYY formats
 * Returns { timestamp, year, month }
 */
function parseTransactionDate(dateStr: string, fallbackYear: number): {
    timestamp: admin.firestore.Timestamp;
    year: number;
    month: number;
} {
    const parts = dateStr.split('/').map(Number);

    let month: number, day: number, year: number;

    if (parts.length === 3) {
        // MM/DD/YYYY format
        [month, day, year] = parts;
    } else if (parts.length === 2) {
        // MM/DD format - use fallback year
        [month, day] = parts;
        year = fallbackYear;
    } else {
        // Invalid format - use today's date
        const today = new Date();
        month = today.getMonth() + 1;
        day = today.getDate();
        year = fallbackYear;
    }

    const date = new Date(year, month - 1, day);

    return {
        timestamp: admin.firestore.Timestamp.fromDate(date),
        year,
        month,
    };
}

/**
 * Check if category is tax deductible
 */
function isDeductibleCategory(category: string): boolean {
    const deductible = ['materials', 'fuel', 'software', 'office', 'vehicle', 'housing'];
    return deductible.includes(category);
}
