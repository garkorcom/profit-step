/**
 * @fileoverview AI Auto-Categorization for Bank Transactions
 * 
 * Uses Gemini to suggest categories for uncategorized transactions.
 * Learns from vendor rules + previously categorized transactions.
 * Returns suggestions only — does NOT write to Firestore.
 * 
 * @module callable/finance/categorizeBankTransactions
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GEMINI_API_KEY } from '../../config';
// Types matching frontend TaxCategory
type TaxCategory =
    | 'zelle_income' | 'deposit' | 'check' | 'cash_income' | 'client_payment'
    | 'zelle_expense' | 'cash_expense' | 'atm_debit'
    | 'office_rent' | 'apps_work' | 'advertising' | 'materials' | 'car_repair' | 'fees'
    | 'subcontractor' | 'payroll' | 'payroll_taxes' | 'permits_licenses'
    | 'business_services' | 'insurance' | 'fuel' | 'parking' | 'software'
    | 'meals' | 'office_supplies' | 'business_expense' | 'hotels' | 'office_equipment'
    | 'internal_transfer' | 'paypal_transfer'
    | 'uncategorized' | 'private';

const VALID_CATEGORIES: TaxCategory[] = [
    'zelle_income', 'deposit', 'check', 'cash_income', 'client_payment',
    'zelle_expense', 'cash_expense', 'atm_debit',
    'office_rent', 'apps_work', 'advertising', 'materials', 'car_repair', 'fees',
    'subcontractor', 'payroll', 'payroll_taxes', 'permits_licenses',
    'business_services', 'insurance', 'fuel', 'parking', 'software',
    'meals', 'office_supplies', 'business_expense', 'hotels', 'office_equipment',
    'internal_transfer', 'paypal_transfer', 'private',
];

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
    zelle_income: 'Zelle incoming payments (income)',
    deposit: 'Bank deposits (income)',
    check: 'Check deposits (income)',
    cash_income: 'Cash deposits (income)',
    client_payment: 'Client payments (income)',
    zelle_expense: 'Zelle outgoing payments (expense)',
    cash_expense: 'Cash withdrawals (expense)',
    atm_debit: 'ATM & Debit Card withdrawals',
    office_rent: 'Office rent payments',
    apps_work: 'Work apps & subscriptions (Dropbox, etc.)',
    advertising: 'Advertising & marketing (Instagram, Facebook, Google Ads)',
    materials: 'Tools & construction materials (Home Depot, Lowes, hardware stores)',
    car_repair: 'Car repair & maintenance',
    fees: 'Bank fees & service charges',
    subcontractor: 'Subcontractor payments (1099)',
    payroll: 'Payroll & salary payments',
    payroll_taxes: 'Payroll taxes',
    permits_licenses: 'Permits & licenses',
    business_services: 'Business services',
    insurance: 'Insurance payments',
    fuel: 'Gas, fuel & charging stations',
    parking: 'Parking fees',
    software: 'Software & subscriptions (Google, Apple, etc.)',
    meals: 'Business meals & restaurants',
    office_supplies: 'Office supplies & miscellaneous',
    business_expense: 'General business expenses',
    hotels: 'Hotels & accommodation',
    office_equipment: 'Office equipment (Amazon, Best Buy)',
    internal_transfer: 'Internal bank transfers (NOT tax deductible)',
    paypal_transfer: 'PayPal transfers (NOT tax deductible)',
    private: 'Personal/private transactions (EXCLUDE from reports)',
};

interface CategorizationRequest {
    year: number;
    month?: number;
}

interface AISuggestion {
    txId: string;
    vendor: string;
    description: string;
    amount: number;
    suggestedCategory: TaxCategory;
    confidence: number;
    reasoning: string;
}

interface CategorizationResponse {
    success: boolean;
    suggestions: AISuggestion[];
    stats: {
        total: number;
        highConf: number;
        medConf: number;
        lowConf: number;
    };
    error?: string;
}

/**
 * Build the Gemini prompt with context from vendor rules and categorized examples
 */
function buildPrompt(
    vendorRules: Array<{ pattern: string; category: string }>,
    examples: Array<{ vendor: string; category: string; amount: number }>,
    uncategorized: Array<{ id: string; vendor: string; description: string; amount: number }>
): string {
    // Category reference
    const categoryRef = Object.entries(CATEGORY_DESCRIPTIONS)
        .map(([key, desc]) => `  - "${key}": ${desc}`)
        .join('\n');

    // Vendor rules context
    const rulesContext = vendorRules.length > 0
        ? vendorRules.map(r => `  - "${r.pattern}" → ${r.category}`).join('\n')
        : '  (no rules yet)';

    // Examples from previously categorized transactions
    const examplesContext = examples.length > 0
        ? examples.slice(0, 50).map(e =>
            `  - vendor="${e.vendor}", amount=$${Math.abs(e.amount).toFixed(2)} → ${e.category}`
        ).join('\n')
        : '  (no examples yet)';

    // Transactions to categorize
    const txList = uncategorized.map((tx, i) =>
        `  ${i + 1}. id="${tx.id}", vendor="${tx.vendor}", description="${tx.description}", amount=$${Math.abs(tx.amount).toFixed(2)} (${tx.amount < 0 ? 'debit' : 'credit'})`
    ).join('\n');

    return `You are a financial AI assistant for a construction/contracting business (Garkor Corp).
Your task is to categorize uncategorized bank transactions.

## Available Categories
${categoryRef}

## Key Rules
- Incoming money (credits, deposits, Zelle FROM) = income categories
- Outgoing money (debits, payments, Zelle TO) = expense categories
- Internal transfers between own accounts = internal_transfer or paypal_transfer
- Personal transactions not related to business = private
- Consider the AMOUNT: large amounts ($1000+) are likely materials/subcontractor/rent, small ($5-50) are likely meals/parking/fuel
- Consider VENDOR NAME and DESCRIPTION together
- If the description contains "ZELLE FROM" it's zelle_income, "ZELLE TO/PAYMENT TO" is zelle_expense
- "TRANSFER" or "PAYMENT THANK YOU" = internal_transfer
- Hardware stores (Home Depot, Lowes, Ace) = materials

## Known Vendor Rules (highest priority - follow these exactly)
${rulesContext}

## Previously Categorized Examples (learn from these patterns)
${examplesContext}

## Transactions to Categorize
${txList}

## Response Format
Return ONLY a valid JSON array. For each transaction:
{
  "id": "<transaction id>",
  "category": "<one of the valid category keys>",
  "confidence": <0.0 to 1.0>,
  "reasoning": "<brief explanation why this category>"
}

Rules for confidence:
- 1.0: Matches a known vendor rule exactly
- 0.9-0.99: Very clear match (e.g., "HOME DEPOT" = materials)
- 0.7-0.89: Likely match based on description/amount patterns
- 0.5-0.69: Uncertain, best guess
- <0.5: Very uncertain

Return the JSON array only, no other text.`;
}

export const categorizeBankTransactions = functions
    .runWith({ memory: '512MB', timeoutSeconds: 120, secrets: [GEMINI_API_KEY] })
    .https.onCall(async (data: CategorizationRequest, context): Promise<CategorizationResponse> => {
        // Auth check
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
        }

        const { year, month } = data;
        if (!year) {
            throw new functions.https.HttpsError('invalid-argument', 'Year is required');
        }

        const apiKey = GEMINI_API_KEY.value();
        if (!apiKey) {
            throw new functions.https.HttpsError('failed-precondition',
                'GEMINI_API_KEY not configured');
        }

        const db = admin.firestore();

        try {
            // 1. Load vendor rules
            const rulesSnapshot = await db.collection('vendor_rules').get();
            const vendorRules = rulesSnapshot.docs.map(doc => ({
                pattern: (doc.data().pattern || '').toLowerCase(),
                category: doc.data().category as string,
            }));
            console.log(`📋 Loaded ${vendorRules.length} vendor rules`);

            // 2. Load categorized transactions as examples (up to 100, diverse vendors)
            let examplesQuery = db.collection('bank_transactions')
                .where('year', '==', year)
                .where('category', '!=', 'uncategorized')
                .orderBy('category')
                .limit(200);

            const examplesSnapshot = await examplesQuery.get();

            // Deduplicate by vendor to get diverse examples
            const seenVendors = new Set<string>();
            const examples: Array<{ vendor: string; category: string; amount: number }> = [];
            examplesSnapshot.docs.forEach(doc => {
                const d = doc.data();
                const vendorKey = (d.vendor || '').toLowerCase();
                if (!seenVendors.has(vendorKey) && d.category !== 'private') {
                    seenVendors.add(vendorKey);
                    examples.push({
                        vendor: d.vendor,
                        category: d.category,
                        amount: d.amount,
                    });
                }
            });
            console.log(`📚 Loaded ${examples.length} categorized examples`);

            // 3. Load uncategorized transactions
            let uncatQuery: admin.firestore.Query = db.collection('bank_transactions')
                .where('year', '==', year)
                .where('category', '==', 'uncategorized');

            const uncatSnapshot = await uncatQuery.get();

            // Filter by month client-side if specified
            let uncategorized = uncatSnapshot.docs.map(doc => {
                const d = doc.data();
                return {
                    id: doc.id,
                    vendor: d.vendor || '',
                    description: d.rawDescription || '',
                    amount: d.amount || 0,
                    date: d.date,
                };
            });

            if (month) {
                uncategorized = uncategorized.filter(tx => {
                    if (tx.date && tx.date.toDate) {
                        const txMonth = tx.date.toDate().getMonth() + 1;
                        return txMonth === month;
                    }
                    return true;
                });
            }

            console.log(`❓ Found ${uncategorized.length} uncategorized transactions`);

            if (uncategorized.length === 0) {
                return {
                    success: true,
                    suggestions: [],
                    stats: { total: 0, highConf: 0, medConf: 0, lowConf: 0 },
                };
            }

            // 4. Process in batches of 30
            const allSuggestions: AISuggestion[] = [];
            const BATCH_SIZE = 30;
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({
                model: 'gemini-2.0-flash',
                generationConfig: {
                    responseMimeType: 'application/json',
                    temperature: 0.2,
                },
            });

            for (let i = 0; i < uncategorized.length; i += BATCH_SIZE) {
                const batch = uncategorized.slice(i, i + BATCH_SIZE);
                const prompt = buildPrompt(vendorRules, examples, batch);

                console.log(`🤖 Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(uncategorized.length / BATCH_SIZE)} (${batch.length} transactions)`);

                try {
                    const result = await model.generateContent(prompt);
                    const responseText = result.response.text();

                    // Parse JSON response
                    let parsed: Array<{
                        id: string;
                        category: string;
                        confidence: number;
                        reasoning: string;
                    }>;

                    try {
                        const cleanText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
                        parsed = JSON.parse(cleanText);
                    } catch (parseErr) {
                        // Try to extract JSON array
                        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
                        if (jsonMatch) {
                            parsed = JSON.parse(jsonMatch[0]);
                        } else {
                            console.error('Failed to parse AI response:', responseText.substring(0, 200));
                            continue;
                        }
                    }

                    // Map AI results back to transactions
                    for (const aiResult of parsed) {
                        const tx = batch.find(t => t.id === aiResult.id);
                        if (!tx) continue;

                        // Validate category
                        const category = VALID_CATEGORIES.includes(aiResult.category as TaxCategory)
                            ? aiResult.category as TaxCategory
                            : 'uncategorized';

                        if (category === 'uncategorized') continue;

                        // Clamp confidence
                        const confidence = Math.max(0, Math.min(1, aiResult.confidence || 0.5));

                        allSuggestions.push({
                            txId: tx.id,
                            vendor: tx.vendor,
                            description: tx.description,
                            amount: tx.amount,
                            suggestedCategory: category,
                            confidence,
                            reasoning: aiResult.reasoning || '',
                        });
                    }
                } catch (batchErr: any) {
                    console.error(`❌ Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, batchErr.message);
                    // Continue with next batch
                }
            }

            // 5. Calculate stats
            const stats = {
                total: allSuggestions.length,
                highConf: allSuggestions.filter(s => s.confidence >= 0.9).length,
                medConf: allSuggestions.filter(s => s.confidence >= 0.7 && s.confidence < 0.9).length,
                lowConf: allSuggestions.filter(s => s.confidence < 0.7).length,
            };

            console.log(`✅ AI categorization complete: ${stats.total} suggestions (🟢${stats.highConf} 🟡${stats.medConf} 🔴${stats.lowConf})`);

            return {
                success: true,
                suggestions: allSuggestions,
                stats,
            };

        } catch (error: any) {
            console.error('❌ AI categorization failed:', error);
            return {
                success: false,
                suggestions: [],
                stats: { total: 0, highConf: 0, medConf: 0, lowConf: 0 },
                error: error.message || 'Unknown error',
            };
        }
    });
