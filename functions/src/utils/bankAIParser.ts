/**
 * @fileoverview Bank Statement AI Parser
 * 
 * Uses Gemini to parse bank statement PDFs/images and categorize transactions.
 * 
 * @module utils/bankAIParser
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import * as functions from 'firebase-functions';

const genAI = new GoogleGenerativeAI(functions.config().gemini?.api_key || process.env.GEMINI_API_KEY || '');

export interface ParsedTransaction {
    date: string;           // MM/DD format
    rawDescription: string;
    vendor: string;
    city?: string;
    state?: string;
    amount: number;
    category: TaxCategory;
}

export type TaxCategory =
    // Income
    | 'zelle_income'
    | 'deposit'
    | 'check'
    | 'cash_income'
    | 'client_payment'
    // Expense
    | 'zelle_expense'
    | 'cash_expense'
    | 'atm_debit'
    | 'office_rent'
    | 'apps_work'         // Dropbox, apps for work
    | 'advertising'       // Instagram, marketing ads
    | 'materials'         // Tools & Materials
    | 'car_repair'        // BMW, car repairs
    | 'fees'              // Bank fees
    | 'subcontractor'     // 1099 contractors
    | 'payroll'
    | 'payroll_taxes'
    | 'permits_licenses'
    | 'business_services'
    | 'insurance'
    | 'fuel'
    | 'parking'
    | 'software'
    | 'meals'
    | 'office_supplies'
    | 'business_expense'
    | 'hotels'
    | 'office_equipment'
    // Transfer (Internal, not tax deductible)
    | 'internal_transfer'
    | 'paypal_transfer'
    // Other
    | 'uncategorized'
    | 'private'  // EXCLUDE from reports
    | 'skip';

// Vendor patterns for auto-categorization (based on user's classification rules)
const CATEGORY_PATTERNS: Record<string, TaxCategory> = {
    // Zelle - detect FROM (income) vs TO/PAYMENT (expense)
    'ZELLE FROM': 'zelle_income',           // Incoming Zelle = income
    'ZELLE PAYMENT TO': 'zelle_expense',    // Outgoing Zelle = expense
    'ZELLE TO': 'zelle_expense',            // Outgoing Zelle = expense
    'ZELLE SENT': 'zelle_expense',          // Outgoing Zelle = expense

    // Cash - detect FROM (income) vs TO/WITHDRAWAL (expense)
    'CASH DEPOSIT': 'cash_income',          // Cash deposit = income
    'CASH FROM': 'cash_income',             // Cash from = income
    'CASH WITHDRAWAL': 'cash_expense',      // Cash withdrawal = expense
    'CASH TO': 'cash_expense',              // Cash to = expense
    'ATM WITHDRAWAL': 'atm_debit',          // ATM = expense
    'ATM': 'atm_debit',

    // Check & Deposit - income
    'DEPOSIT': 'deposit',
    'CHECK DEPOSIT': 'check',
    'CHECK': 'check',

    // Private - EXCLUDE from reports
    'UKRMAMA': 'private',
    'UKRMAMA LLC': 'private',

    // Office Rent
    'CHECK #': 'office_rent',

    // Payroll
    'INTUIT PAYROLL': 'payroll',
    'PAYROLL': 'payroll',

    // Payroll Taxes
    'INTUIT TAX': 'payroll_taxes',

    // Permits & Licenses
    'PERMIT': 'permits_licenses',
    'LICENSE': 'permits_licenses',

    // Subcontractors / Contractors (1099)
    'STEPA USA': 'subcontractor',
    'RIZVAN': 'subcontractor',
    'ROMA': 'subcontractor',
    'OLYA': 'subcontractor',
    'KOLYA': 'subcontractor',

    // Insurance
    'BMW VITALITY': 'insurance',
    'PROGRESSIVE': 'insurance',
    'INSURANCE': 'insurance',

    // Auto Expense / Fuel / Parking
    'PARKING': 'fuel',
    'SHELL': 'fuel',
    'WAWA': 'fuel',
    'CHEVRON': 'fuel',
    'EXXON': 'fuel',
    'BP ': 'fuel',
    'TESLA SUPERCHARGER': 'fuel',
    'CHARGEPOINT': 'fuel',

    // Materials / Tools / Supplies
    'HOME DEPOT': 'materials',
    'LOWES': 'materials',
    'ACE HARDWARE': 'materials',
    'MENARDS': 'materials',

    // Apps for Work (💻)
    'DROPBOX': 'apps_work',

    // Advertising (📢)
    'INSTAGRAM': 'advertising',
    'FACEBOOK': 'advertising',
    'GOOGLE ADS': 'advertising',

    // Car Repair (🚗)
    'BMW NEW VET': 'car_repair',
    'BMW': 'car_repair',
    'CAR REPAIR': 'car_repair',
    'AUTO REPAIR': 'car_repair',

    // Software / Subscriptions
    'GOOGLE': 'software',
    'APPLE': 'software',
    'CURSOR': 'software',
    'OPENAI': 'software',
    'GITHUB': 'software',
    'ANTHROPIC': 'software',

    // Business Meals
    'RESTAURANT': 'meals',
    'PUBLIX': 'meals',
    'STARBUCKS': 'meals',
    'WAFFLE HOUSE': 'meals',
    'MCDONALDS': 'meals',
    'CHIPOTLE': 'meals',

    // Office / Miscellaneous
    'OFFICE DEPOT': 'office_supplies',
    'STAPLES': 'office_supplies',

    // Office Equipment
    'AMAZON': 'office_equipment',
    'BEST BUY': 'office_equipment',

    // Hotels
    'HOTEL': 'hotels',
    'INN': 'hotels',
    'MARRIOTT': 'hotels',
    'HILTON': 'hotels',

    // Bank Fees
    'BANK FEE': 'fees',
    'SERVICE FEE': 'fees',
    'MONTHLY FEE': 'fees',

    // Internal Transfers (NOT Tax Deductible)
    'CHASE CARD PAYMENT': 'internal_transfer',
    'CHASE CC PAYMENT': 'internal_transfer',
    'PAYMENT THANK YOU': 'internal_transfer',
    'PAYPAL TRANSFER': 'paypal_transfer',
    'PAYPAL': 'paypal_transfer',
    'TRANSFER': 'internal_transfer',
    'AUTOPAY': 'skip',
};

/**
 * Parse bank statement image/PDF using Gemini Vision
 */
export async function parseBankStatementImage(
    imageBase64: string,
    mimeType: string = 'image/png'
): Promise<{ transactions: ParsedTransaction[]; statementMonth?: number; statementYear?: number }> {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-001' });

    const prompt = `Analyze this bank statement image. Extract the STATEMENT PERIOD and ALL transaction lines.

FIRST: Find the statement period header like "November 01, 2025 through November 28, 2025" or similar.
Extract the MONTH and YEAR of the statement period.

SECOND: For each transaction, extract:
- date: The date in MM/DD/YYYY format (use the year from the statement period)
- rawDescription: The full original text (e.g., "THE HOME DEPOT #6310 HOLLYWOOD FL")
- vendor: Clean vendor name (e.g., "Home Depot")
- city: City if visible in description
- state: State abbreviation (FL, CA, etc.)
- amount: The dollar amount (negative for expenses, positive for credits)

Return ONLY a valid JSON object with this structure:
{
  "statementMonth": 11,
  "statementYear": 2025,
  "transactions": [
    {"date": "11/13/2025", "rawDescription": "THE HOME DEPOT #6310 HOLLYWOOD FL", "vendor": "Home Depot", "city": "Hollywood", "state": "FL", "amount": -149.75},
    ...
  ]
}

IMPORTANT:
- statementMonth is 1-12 (January=1, November=11, December=12)
- Look for period text like "November 01, 2025 through November 28, 2025" to determine the month
- Skip any header rows, subtotals, or summary lines. Only include actual transactions.`;

    try {
        const result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    mimeType,
                    data: imageBase64,
                },
            },
        ]);

        const response = result.response.text();

        // Extract JSON from response - now expecting an object with statementMonth, statementYear, transactions
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.error('No JSON object found in response:', response);
            return { transactions: [] };
        }

        const parsed = JSON.parse(jsonMatch[0]);
        const transactions: ParsedTransaction[] = (parsed.transactions || []).map((tx: ParsedTransaction) => ({
            ...tx,
            category: categorizeTransaction(tx.rawDescription),
        }));

        return {
            transactions,
            statementMonth: parsed.statementMonth,
            statementYear: parsed.statementYear,
        };

    } catch (error) {
        console.error('Error parsing bank statement:', error);
        throw error;
    }
}

/**
 * Parse CSV content from Chase bank export
 */
export function parseChaseCSV(csvContent: string): ParsedTransaction[] {
    const lines = csvContent.trim().split('\n');
    const transactions: ParsedTransaction[] = [];

    // Skip header row
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        // Chase CSV format: "Transaction Date","Post Date","Description","Category","Type","Amount","Memo"
        const parts = parseCSVLine(line);
        if (parts.length < 6) continue;

        const dateStr = parts[0].replace(/"/g, '');
        const rawDescription = parts[2].replace(/"/g, '');
        const amount = parseFloat(parts[5].replace(/"/g, ''));

        if (isNaN(amount)) continue;

        // Parse vendor, city, state from description
        const { vendor, city, state } = parseDescription(rawDescription);

        transactions.push({
            date: formatDate(dateStr),
            rawDescription,
            vendor,
            city,
            state,
            amount,
            category: categorizeTransaction(rawDescription),
        });
    }

    return transactions;
}

/**
 * Categorize transaction based on description
 */
export function categorizeTransaction(description: string): TaxCategory {
    const upperDesc = description.toUpperCase();

    // First check specific vendor patterns (most specific wins)
    for (const [pattern, category] of Object.entries(CATEGORY_PATTERNS)) {
        if (upperDesc.includes(pattern)) {
            return category;
        }
    }

    // Universal FROM/TO logic for all other transactions:
    // FROM = money coming in = income
    // TO = money going out = expense

    // Check for income indicators (FROM patterns)
    if (upperDesc.includes(' FROM ') ||
        upperDesc.includes('FROM ') ||
        upperDesc.includes('RECEIVED FROM') ||
        upperDesc.includes('PAYMENT FROM') ||
        upperDesc.includes('CREDIT FROM')) {
        return 'deposit';  // Generic income
    }

    // Check for expense indicators (TO patterns)
    if (upperDesc.includes(' TO ') ||
        upperDesc.includes('PAYMENT TO') ||
        upperDesc.includes('SENT TO') ||
        upperDesc.includes('TRANSFER TO') ||
        upperDesc.includes('TO ')) {
        return 'uncategorized';  // Expense - needs manual categorization
    }

    return 'uncategorized';
}

/**
 * Parse description to extract vendor, city, state
 */
function parseDescription(description: string): { vendor: string; city?: string; state?: string } {
    // Common pattern: "VENDOR NAME #STORE CITY STATE"
    // Example: "THE HOME DEPOT #6310 HOLLYWOOD FL"

    // State pattern (2 letter code at end)
    const stateMatch = description.match(/\s([A-Z]{2})$/);
    const state = stateMatch ? stateMatch[1] : undefined;

    // Remove state from end
    let remaining = state ? description.slice(0, -3).trim() : description;

    // Try to find city (word before state, after store number)
    const storeNumMatch = remaining.match(/#\d+\s+(.+)/);
    const city = storeNumMatch ? storeNumMatch[1].trim() : undefined;

    // Clean vendor name
    let vendor = remaining;

    // Remove store number and everything after
    const storeIdx = vendor.indexOf('#');
    if (storeIdx > 0) {
        vendor = vendor.substring(0, storeIdx).trim();
    }

    // Clean up "THE" prefix
    if (vendor.startsWith('THE ')) {
        vendor = vendor.substring(4);
    }

    // Title case
    vendor = vendor.split(' ')
        .map(word => word.charAt(0) + word.slice(1).toLowerCase())
        .join(' ');

    return { vendor, city, state };
}

/**
 * Parse CSV line handling quoted values
 */
function parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (const char of line) {
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current);

    return result;
}

/**
 * Format date from various formats to MM/DD
 */
function formatDate(dateStr: string): string {
    // Handle MM/DD/YYYY or MM/DD/YY
    const parts = dateStr.split('/');
    if (parts.length >= 2) {
        return `${parts[0].padStart(2, '0')}/${parts[1].padStart(2, '0')}`;
    }
    return dateStr;
}
