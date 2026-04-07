/**
 * @fileoverview Bank Statements types, constants and taxonomy.
 * Single source of truth for the entire bank-statements module.
 */

// ─── Core Types ──────────────────────────────────────────────

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
    | 'apps_work'
    | 'advertising'
    | 'materials'
    | 'car_repair'
    | 'fees'
    | 'subcontractor'
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
    // Transfer
    | 'internal_transfer'
    | 'paypal_transfer'
    // Other
    | 'uncategorized'
    | 'private';

export interface BankTransaction {
    id: string;
    statementId: string;
    date: { seconds: number };
    rawDescription: string;
    vendor: string;
    city?: string;
    state?: string;
    amount: number;
    category: TaxCategory;
    isDeductible: boolean;
    notes?: string;
    year: number;
    parentId?: string;
    isSplit?: boolean;
    deductibilityPercent?: number;
    receiptUrl?: string;
    isRefund?: boolean;
}

export interface BankStatement {
    id: string;
    fileName: string;
    uploadedAt: { seconds: number };
    transactionCount: number;
    duplicateCount?: number;
    year: number;
}

export interface VendorRule {
    id: string;
    pattern: string;
    category: TaxCategory;
    createdAt?: { seconds: number };
}

export interface AISuggestion {
    txId: string;
    vendor: string;
    description: string;
    amount: number;
    suggestedCategory: TaxCategory;
    confidence: number;
    reasoning: string;
}

export interface InlineReportData {
    income: number;
    expenses: number;
    subcontract: number;
    transfers: number;
    net: number;
    categories: Record<string, number>;
    period: string;
    transactionCount: number;
    uncategorizedCount: number;
}

export interface ReportData {
    income: number;
    expenses: number;
    transfers: number;
    net: number;
    categories: Record<string, number>;
    newCount: number;
    duplicateCount: number;
}

export interface NotificationState {
    open: boolean;
    message: string;
    severity: 'success' | 'error' | 'info';
}

// ─── Category Classification Sets ───────────────────────────

export const INCOME_CATEGORIES: Set<TaxCategory> = new Set([
    'zelle_income', 'deposit', 'check', 'cash_income', 'client_payment',
]);

export const SUBCONTRACT_CATEGORIES: Set<TaxCategory> = new Set(['subcontractor']);

export const TRANSFER_CATEGORIES: TaxCategory[] = ['internal_transfer', 'paypal_transfer'];

export const DROPDOWN_CATEGORIES: TaxCategory[] = [
    // Income
    'zelle_income', 'deposit', 'check', 'cash_income',
    // Cash-related expenses
    'zelle_expense', 'cash_expense', 'atm_debit',
    // Expense
    'office_rent', 'apps_work', 'advertising', 'materials', 'car_repair', 'fees',
    'payroll', 'payroll_taxes', 'permits_licenses', 'business_services', 'insurance',
    'fuel', 'parking', 'software', 'meals', 'office_supplies',
    'business_expense', 'hotels', 'office_equipment',
    // Transfers
    'internal_transfer', 'paypal_transfer',
    // Private
    'private',
];

export const EXPENSE_CATEGORIES: TaxCategory[] = [
    'zelle_expense', 'cash_expense', 'atm_debit',
    'office_rent', 'apps_work', 'advertising', 'materials', 'car_repair', 'fees',
    'payroll', 'payroll_taxes', 'permits_licenses', 'business_services', 'insurance',
    'fuel', 'parking', 'software', 'meals', 'office_supplies',
    'business_expense', 'hotels', 'office_equipment',
];

// ─── Visual Mapping ─────────────────────────────────────────

export const CATEGORY_COLORS: Record<TaxCategory, string> = {
    // Income (green tones)
    zelle_income: '#4CAF50',
    deposit: '#66BB6A',
    check: '#81C784',
    cash_income: '#A5D6A7',
    client_payment: '#2E7D32',
    // Expense (red/orange tones)
    zelle_expense: '#E57373',
    cash_expense: '#EF5350',
    atm_debit: '#78909C',
    office_rent: '#F44336',
    apps_work: '#2196F3',
    advertising: '#9C27B0',
    materials: '#8BC34A',
    car_repair: '#FF5722',
    fees: '#E91E63',
    subcontractor: '#FF7043',
    payroll: '#D32F2F',
    payroll_taxes: '#7B1FA2',
    permits_licenses: '#673AB7',
    business_services: '#00BCD4',
    insurance: '#5C6BC0',
    fuel: '#FF9800',
    parking: '#9E9E9E',
    software: '#03A9F4',
    meals: '#FFC107',
    office_supplies: '#607D8B',
    business_expense: '#FF7043',
    hotels: '#795548',
    office_equipment: '#3F51B5',
    // Transfer (blue tones)
    internal_transfer: '#90CAF9',
    paypal_transfer: '#64B5F6',
    // Other
    uncategorized: '#F44336',
    private: '#9E9E9E',
};

export const CATEGORY_LABELS: Record<TaxCategory, string> = {
    // Income
    zelle_income: '💵 Zelle - Income',
    deposit: '💵 Deposit - Income',
    check: '💵 Check - Income',
    cash_income: '💵 Cash - Income',
    client_payment: '💵 Client Payments - Income',
    // Expense
    zelle_expense: '💸 Zelle - Expense',
    cash_expense: '💸 Cash - Expense',
    atm_debit: '💸 ATM & Debit Card - Expense',
    office_rent: '🏢 Office Rent - Expense',
    apps_work: '💻 Apps for Work - Expense',
    advertising: '📢 Advertising - Expense',
    materials: '🧰 Tools & Materials - Expense',
    car_repair: '🚗 Car Repair - Expense',
    fees: '🏦 Bank Fees - Expense',
    subcontractor: '👷 Subcontractors (1099) - Expense',
    payroll: '💼 Payroll - Expense',
    payroll_taxes: '💼 Payroll Taxes - Expense',
    permits_licenses: '📋 Permits & Licenses - Expense',
    business_services: '🏢 Business Services - Expense',
    insurance: '🛡️ Insurance - Expense',
    fuel: '⛽ Auto / Fuel - Expense',
    parking: '🅿️ Parking - Expense',
    software: '💿 Software - Expense',
    meals: '🍽️ Business Meals - Expense',
    office_supplies: '📦 Office / Misc - Expense',
    business_expense: '💼 Business Expense',
    hotels: '🏨 Hotels - Expense',
    office_equipment: '🖥️ Office Equipment - Expense',
    // Transfer
    internal_transfer: '🔁 Internal Transfers - Not Tax Deductible',
    paypal_transfer: '🔁 PayPal Transfers',
    // Other
    uncategorized: '❓ Uncategorized',
    private: '🔒 Private (Exclude)',
};

export const MONTH_NAMES = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// ─── Schedule C (IRS Form 1040) ─────────────────────────────

export const SCHEDULE_C_MAP: Partial<Record<TaxCategory, string>> = {
    advertising: 'Line 8 – Advertising',
    car_repair: 'Line 9 – Car/Truck Expenses',
    insurance: 'Line 15 – Insurance',
    office_rent: 'Line 20b – Rent (Business)',
    office_supplies: 'Line 22 – Supplies',
    materials: 'Line 22 – Supplies',
    office_equipment: 'Line 13 – Depreciation',
    fuel: 'Line 9 – Car/Truck Expenses',
    parking: 'Line 9 – Car/Truck Expenses',
    meals: 'Line 24b – Meals (50%)',
    software: 'Line 27a – Other Expenses',
    apps_work: 'Line 27a – Other Expenses',
    business_services: 'Line 17 – Legal/Prof Services',
    permits_licenses: 'Line 27a – Other Expenses',
    payroll: 'Line 26 – Wages',
    payroll_taxes: 'Line 23 – Taxes/Licenses',
    fees: 'Line 27a – Other Expenses',
    subcontractor: 'Line 11 – Contract Labor',
    hotels: 'Line 24a – Travel',
};

// ─── Business Logic Constants ───────────────────────────────

export const AMBIGUOUS_VENDORS = [
    'AMAZON', 'WALMART', 'TARGET', 'COSTCO', 'PAYPAL',
    'VENMO', 'EBAY', 'HOME DEPOT', 'LOWES',
];

export const DEFAULT_DEDUCTIBILITY: Partial<Record<TaxCategory, number>> = {
    meals: 50,
    hotels: 50,
    car_repair: 50,
    fuel: 50,
    parking: 50,
    private: 0,
    internal_transfer: 0,
    paypal_transfer: 0,
};

// ─── Helpers ────────────────────────────────────────────────

export const getConfidenceColor = (confidence: number): 'success' | 'warning' | 'error' => {
    if (confidence >= 0.9) return 'success';
    if (confidence >= 0.7) return 'warning';
    return 'error';
};

export const getConfidenceLabel = (confidence: number): string => {
    if (confidence >= 0.9) return '🟢 High';
    if (confidence >= 0.7) return '🟡 Medium';
    return '🔴 Low';
};
