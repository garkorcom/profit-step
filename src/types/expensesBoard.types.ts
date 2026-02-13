/**
 * @fileoverview Smart Expenses Board — Data Schema
 * 
 * Shared types for the masonry-based expenses board module.
 * Reuses existing Firestore collections: bank_transactions, vendor_rules, bank_statements.
 * 
 * @module types/expensesBoard
 */

// ============================================
// TAX CATEGORY TAXONOMY (IRS Schedule C aligned)
// ============================================

export type TaxCategory =
    // ── Income ──
    | 'zelle_income'
    | 'deposit'
    | 'check'
    | 'cash_income'
    | 'client_payment'
    // ── Expense ──
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
    // ── Transfer (non-taxable) ──
    | 'internal_transfer'
    | 'paypal_transfer'
    // ── Other ──
    | 'uncategorized'
    | 'private';

// ============================================
// TRANSACTION TYPE (high-level classification)
// ============================================

export type TransactionType = 'income' | 'expense' | 'transfer';

// ============================================
// CORE TRANSACTION (Firestore: bank_transactions)
// ============================================

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
    month?: number;
    companyId?: string;

    // ── Transfer Detection ──
    /** True if this is an internal transfer (Chase Card Payment, PayPal, etc.) */
    isTransfer: boolean;
    /** [P2] ID of the paired transfer (debit ↔ credit across accounts/months) */
    linkedTransferId?: string;

    // ── Tax Deductibility ──
    /** Percentage of deductibility (0-100). Meals=50%, Insurance=50%, Private=0% */
    deductibilityPercent: number;
    /** [P0] True = tax year is closed, category changes show warning */
    taxYearLocked?: boolean;

    // ── Re-categorization Audit Trail ──
    /** [P1] History of category changes for audit purposes */
    categoryHistory?: CategoryChangeEntry[];

    // ── Split Transaction Support ──
    /** ID of the parent transaction (if this is a child split) */
    parentId?: string;
    /** True if this transaction has been split into children */
    isSplit?: boolean;
    /** Child split entries (computed, not stored in Firestore) */
    splitChildren?: SplitEntry[];

    // ── Receipt Attachment ──
    /** Firebase Storage URL for attached receipt */
    receiptUrl?: string;

    // ── Refund Handling ──
    /** True = contra-expense (reduces category total, NOT income) */
    isRefund?: boolean;
    /** [P1] Links refund to original transaction */
    refundTargetId?: string;
    /** [P1] Links refund to a specific split portion of the original tx */
    refundTargetSplitId?: string;

    // ── Currency (P3: international projects) ──
    /** Currency code, defaults to 'USD' */
    currency?: string;
    /** Original amount in foreign currency before conversion */
    originalAmount?: number;
    /** Original currency code (e.g., 'EUR', 'UAH') */
    originalCurrency?: string;
    /** Bank's foreign transaction fee */
    foreignTransactionFee?: number;
}

// ============================================
// CATEGORY CHANGE ENTRY (audit trail)
// ============================================

export interface CategoryChangeEntry {
    from: TaxCategory;
    to: TaxCategory;
    changedAt: { seconds: number };
    changedBy: string;  // userId
}

// ============================================
// SPLIT ENTRY (for dividing one transaction)
// ============================================

export interface SplitEntry {
    id: string;
    /** Parent transaction this split belongs to */
    parentId: string;
    /** Allocated amount for this split portion */
    amount: number;
    /** Category assigned to this split */
    category: TaxCategory;
    /** "Business" or "Personal" */
    purpose: 'business' | 'personal';
    /** Notes for this split entry */
    notes?: string;
}

// ============================================
// SMART TRANSACTION (enriched for UI display)
// ============================================

/** Extended transaction with computed fields for the masonry board */
export interface SmartTransaction extends BankTransaction {
    /** Computed: income / expense / transfer */
    type: TransactionType;
    /** IRS Schedule C line reference (e.g., "Line 22 – Supplies") */
    scheduleCLine?: string;
    /** True if vendor is ambiguous and needs manual review (Amazon, Walmart, etc.) */
    isAmbiguous: boolean;
    /** Human-readable category label with emoji */
    categoryLabel: string;
    /** Category chip color (hex) */
    categoryColor: string;
    /** Formatted amount string (e.g., "$1,234.56") */
    formattedAmount: string;
    /** Formatted date string (e.g., "Jan 15, 2025") */
    formattedDate: string;
}

// ============================================
// VENDOR RULE (Firestore: vendor_rules)
// ============================================

export interface VendorRule {
    id: string;
    /** Pattern to match against vendor name (case-insensitive) */
    pattern: string;
    /** Target category to auto-assign */
    category: TaxCategory;
    /** Auto-created from manual override */
    isAutoLearned?: boolean;
    companyId?: string;
    createdAt?: { seconds: number };
    updatedAt?: { seconds: number };
}

// ============================================
// BANK STATEMENT (Firestore: bank_statements)
// ============================================

export interface BankStatement {
    id: string;
    fileName: string;
    uploadedAt: { seconds: number };
    transactionCount: number;
    duplicateCount?: number;
    year: number;
    month?: number;
    companyId?: string;
}

// ============================================
// BOARD STATS (computed aggregates for header)
// ============================================

export interface BoardStats {
    totalIncome: number;
    totalExpenses: number;
    totalTransfers: number;
    netProfit: number;
    taxDeductible: number;
    uncategorizedCount: number;
    transactionCount: number;
}

// ============================================
// FILTER & SORT STATE
// ============================================

export type SortField = 'date' | 'amount';
export type SortDirection = 'asc' | 'desc';

export interface BoardFilters {
    year: number;
    month: number | 'all';
    category: TaxCategory | 'all';
    type: TransactionType | 'all';
    needsReview: boolean;     // uncategorized only
    searchQuery: string;
}

export interface BoardSort {
    field: SortField;
    direction: SortDirection;
}

// ============================================
// CONSTANTS — Category Classification
// ============================================

export const INCOME_CATEGORIES: TaxCategory[] = [
    'zelle_income', 'deposit', 'check', 'cash_income', 'client_payment',
];

export const EXPENSE_CATEGORIES: TaxCategory[] = [
    'zelle_expense', 'cash_expense', 'atm_debit',
    'office_rent', 'apps_work', 'advertising', 'materials', 'car_repair', 'fees',
    'subcontractor', 'payroll', 'payroll_taxes', 'permits_licenses', 'business_services',
    'insurance', 'fuel', 'parking', 'software', 'meals', 'office_supplies',
    'business_expense', 'hotels', 'office_equipment',
];

export const TRANSFER_CATEGORIES: TaxCategory[] = [
    'internal_transfer', 'paypal_transfer',
];

export const SUBCONTRACT_CATEGORIES: TaxCategory[] = ['subcontractor'];

// Categories excluded from manual dropdown selection
export const SYSTEM_ONLY_CATEGORIES: TaxCategory[] = ['uncategorized', 'client_payment', 'subcontractor'];

export const DROPDOWN_CATEGORIES: TaxCategory[] = [
    // Income
    'zelle_income', 'deposit', 'check', 'cash_income',
    // Cash-related expenses
    'zelle_expense', 'cash_expense', 'atm_debit',
    // Expenses
    'office_rent', 'apps_work', 'advertising', 'materials', 'car_repair', 'fees',
    'payroll', 'payroll_taxes', 'permits_licenses', 'business_services', 'insurance',
    'fuel', 'parking', 'software', 'meals', 'office_supplies',
    'business_expense', 'hotels', 'office_equipment',
    // Transfers
    'internal_transfer', 'paypal_transfer',
    // Private
    'private',
];

// ============================================
// CONSTANTS — Visual Styling
// ============================================

export const CATEGORY_COLORS: Record<TaxCategory, string> = {
    // Income (green)
    zelle_income: '#4CAF50',
    deposit: '#66BB6A',
    check: '#81C784',
    cash_income: '#A5D6A7',
    client_payment: '#2E7D32',
    // Expense (red/warm)
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
    // Transfer (blue)
    internal_transfer: '#90CAF9',
    paypal_transfer: '#64B5F6',
    // Other
    uncategorized: '#F44336',
    private: '#9E9E9E',
};

export const CATEGORY_LABELS: Record<TaxCategory, string> = {
    zelle_income: '💵 Zelle - Income',
    deposit: '💵 Deposit - Income',
    check: '💵 Check - Income',
    cash_income: '💵 Cash - Income',
    client_payment: '💵 Client Payments - Income',
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
    internal_transfer: '🔁 Internal Transfers',
    paypal_transfer: '🔁 PayPal Transfers',
    uncategorized: '❓ Uncategorized',
    private: '🔒 Private (Exclude)',
};

// ============================================
// CONSTANTS — IRS Schedule C Mapping
// ============================================

export const SCHEDULE_C_MAP: Partial<Record<TaxCategory, string>> = {
    advertising: 'Line 8 – Advertising',
    car_repair: 'Line 9 – Car/Truck Expenses',
    fuel: 'Line 9 – Car/Truck Expenses',
    parking: 'Line 9 – Car/Truck Expenses',
    subcontractor: 'Line 11 – Contract Labor',
    office_equipment: 'Line 13 – Depreciation',
    insurance: 'Line 15 – Insurance',
    business_services: 'Line 17 – Legal/Prof Services',
    office_rent: 'Line 20b – Rent (Business)',
    office_supplies: 'Line 22 – Supplies',
    materials: 'Line 22 – Supplies',
    payroll_taxes: 'Line 23 – Taxes/Licenses',
    hotels: 'Line 24a – Travel',
    meals: 'Line 24b – Meals (50%)',
    payroll: 'Line 26 – Wages',
    software: 'Line 27a – Other Expenses',
    apps_work: 'Line 27a – Other Expenses',
    permits_licenses: 'Line 27a – Other Expenses',
    fees: 'Line 27a – Other Expenses',
};

// ============================================
// CONSTANTS — Deductibility Defaults
// ============================================

export const DEFAULT_DEDUCTIBILITY: Partial<Record<TaxCategory, number>> = {
    // 50% deductible
    meals: 50,
    hotels: 50,
    car_repair: 50,
    fuel: 50,
    parking: 50,
    // Not deductible
    private: 0,
    internal_transfer: 0,
    paypal_transfer: 0,
};

// ============================================
// CONSTANTS — Ambiguous Vendors (need review)
// ============================================

export const AMBIGUOUS_VENDORS = [
    'AMAZON', 'WALMART', 'TARGET', 'COSTCO',
    'PAYPAL', 'VENMO', 'EBAY',
    'HOME DEPOT', 'LOWES',
];

// ============================================
// HELPER — Type Classification
// ============================================

export const getTransactionType = (category: TaxCategory): TransactionType => {
    if (INCOME_CATEGORIES.includes(category)) return 'income';
    if (TRANSFER_CATEGORIES.includes(category)) return 'transfer';
    return 'expense';
};

/** Border color for card left edge based on transaction type */
export const TYPE_BORDER_COLORS: Record<TransactionType, string> = {
    income: '#4CAF50',    // Green
    expense: '#F44336',   // Red
    transfer: '#90CAF9',  // Light blue
};
