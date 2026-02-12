/**
 * @fileoverview Bank Statements Page
 * 
 * Standalone tax sorting module for bank statement uploads.
 * Parses PDF/CSV files, categorizes transactions for tax purposes.
 * 
 * @module pages/crm/BankStatementsPage
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
    Box,
    Typography,
    Paper,
    Button,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Chip,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    IconButton,
    Tooltip,
    Card,
    CardContent,
    CircularProgress,
    TextField,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Stack,
    Snackbar,
    Alert,
    Tabs,
    Tab,
    Checkbox,
    Badge,
    LinearProgress,
} from '@mui/material';
import {
    CloudUpload as UploadIcon,
    Download as DownloadIcon,
    Edit as EditIcon,
    Delete as DeleteIcon,
    DeleteSweep as ClearIcon,
    PictureAsPdf as PdfIcon,
    AutoFixHigh as RuleIcon,
    ContentCut as SplitIcon,
    BarChart as ChartIcon,
    Search as SearchIcon,
    Receipt as ReceiptIcon,
    Repeat as RepeatIcon,
    LightbulbOutlined as SuggestIcon,
    AttachFile as AttachIcon,
} from '@mui/icons-material';
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Cell } from 'recharts';
import { collection, query, where, orderBy, getDocs, updateDoc, doc, deleteDoc, writeBatch, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, storage } from '../../firebase/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getFunctions, httpsCallable } from 'firebase/functions';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

// Types
interface BankTransaction {
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
    // Split transaction support
    parentId?: string;
    isSplit?: boolean;
    // Tax deductibility percentage
    deductibilityPercent?: number;
    // Receipt attachment
    receiptUrl?: string;
    // Refund flag
    isRefund?: boolean;
}

interface BankStatement {
    id: string;
    fileName: string;
    uploadedAt: { seconds: number };
    transactionCount: number;
    duplicateCount?: number;
    year: number;
}

type TaxCategory =
    // Income
    | 'zelle_income'
    | 'deposit'
    | 'check'
    | 'cash_income'
    | 'client_payment'      // For final report only, not in dropdown
    // Expense
    | 'zelle_expense'
    | 'cash_expense'
    | 'atm_debit'           // ATM & Debit Card - under cash
    | 'office_rent'
    | 'apps_work'           // Dropbox, apps for work
    | 'advertising'         // Instagram, marketing ads
    | 'materials'           // Tools & Materials
    | 'car_repair'          // BMW, car repairs
    | 'fees'                // Bank fees
    | 'subcontractor'       // 1099 contractors - for final report only
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
    | 'internal_transfer'   // Internal Transfers - Not Tax Deductible
    | 'paypal_transfer'     // PayPal Transfers
    // Other
    | 'uncategorized'
    | 'private';  // EXCLUDE from reports

interface VendorRule {
    id: string;
    pattern: string;
    category: TaxCategory;
    createdAt?: { seconds: number };
}


// Category type classification (matching report template)
const INCOME_CATEGORIES: TaxCategory[] = ['zelle_income', 'deposit', 'check', 'cash_income', 'client_payment'];
const SUBCONTRACT_CATEGORIES: TaxCategory[] = ['subcontractor'];
const TRANSFER_CATEGORIES: TaxCategory[] = ['internal_transfer', 'paypal_transfer'];
// Categories to show in dropdown (all except: uncategorized, client_payment, subcontractor)
const DROPDOWN_CATEGORIES: TaxCategory[] = [
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
    'private'
];
// Expense categories for report (in accountant report order)
const EXPENSE_CATEGORIES: TaxCategory[] = [
    'zelle_expense', 'cash_expense', 'atm_debit',
    'office_rent', 'apps_work', 'advertising', 'materials', 'car_repair', 'fees',
    'payroll', 'payroll_taxes', 'permits_licenses', 'business_services', 'insurance',
    'fuel', 'parking', 'software', 'meals', 'office_supplies',
    'business_expense', 'hotels', 'office_equipment'
];

const CATEGORY_COLORS: Record<TaxCategory, string> = {
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
    uncategorized: '#F44336',  // RED - needs attention!
    private: '#9E9E9E',  // EXCLUDE from reports
};

const CATEGORY_LABELS: Record<TaxCategory, string> = {
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
    // Transfer (Internal, not tax deductible)
    internal_transfer: '🔁 Internal Transfers - Not Tax Deductible',
    paypal_transfer: '🔁 PayPal Transfers',
    // Other
    uncategorized: '❓ Uncategorized',
    private: '🔒 Private (Exclude)',
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Schedule C (IRS Form 1040) line mapping
const SCHEDULE_C_MAP: Partial<Record<TaxCategory, string>> = {
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

// Ambiguous vendors that always need manual review
const AMBIGUOUS_VENDORS = ['AMAZON', 'WALMART', 'TARGET', 'COSTCO', 'PAYPAL', 'VENMO', 'EBAY', 'HOME DEPOT', 'LOWES'];

// Default deductibility percentages by category
const DEFAULT_DEDUCTIBILITY: Partial<Record<TaxCategory, number>> = {
    meals: 50,
    hotels: 50,
    car_repair: 50,
    fuel: 50,
    parking: 50,
    private: 0,
    internal_transfer: 0,
    paypal_transfer: 0,
};

export const BankStatementsPage: React.FC = () => {
    const [transactions, setTransactions] = useState<BankTransaction[]>([]);
    const [statements, setStatements] = useState<BankStatement[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [selectedMonth, setSelectedMonth] = useState<number | 'all'>(new Date().getMonth() + 1);
    const [filterCategory, setFilterCategory] = useState<TaxCategory | 'all'>('all');
    const [editingTx, setEditingTx] = useState<BankTransaction | null>(null);
    const [vendorRules, setVendorRules] = useState<VendorRule[]>([]);
    const [showRulesDialog, setShowRulesDialog] = useState(false);
    const [newRulePattern, setNewRulePattern] = useState('');
    const [newRuleCategory, setNewRuleCategory] = useState<TaxCategory>('business_expense');
    const [activeTab, setActiveTab] = useState<'business' | 'private' | 'review'>('business');
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Drag & drop state
    const [isDragOver, setIsDragOver] = useState(false);

    // Bulk selection state
    const [selectedTxIds, setSelectedTxIds] = useState<Set<string>>(new Set());
    const [bulkCategory, setBulkCategory] = useState<TaxCategory>('business_expense');

    // Split transaction state
    const [splitTx, setSplitTx] = useState<BankTransaction | null>(null);
    const [splitParts, setSplitParts] = useState<Array<{ amount: string; category: TaxCategory }>>([
        { amount: '', category: 'business_expense' },
        { amount: '', category: 'private' },
    ]);

    // Chart visibility
    const [showChart, setShowChart] = useState(true);

    // Vendor search filter
    const [vendorSearch, setVendorSearch] = useState('');

    // Receipt viewer
    const [receiptViewer, setReceiptViewer] = useState<{ open: boolean; url: string; vendor: string }>({ open: false, url: '', vendor: '' });
    const receiptInputRef = useRef<HTMLInputElement>(null);
    const [uploadingReceipt, setUploadingReceipt] = useState<string | null>(null);

    // Auto-rule suggestion
    const [ruleSuggestion, setRuleSuggestion] = useState<{ vendor: string; category: TaxCategory; count: number } | null>(null);

    // Notification state
    const [notification, setNotification] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({
        open: false, message: '', severity: 'success'
    });

    // Upload report dialog
    const [showReport, setShowReport] = useState(false);
    const [reportData, setReportData] = useState<{
        income: number;
        expenses: number;
        transfers: number;
        net: number;
        categories: Record<string, number>;
        newCount: number;
        duplicateCount: number;
    } | null>(null);

    // Period confirmation dialog (when detected period differs from filter)
    const [showPeriodConfirm, setShowPeriodConfirm] = useState(false);
    const [pendingUpload, setPendingUpload] = useState<{
        detectedYear: number;
        detectedMonth: number;
        totalNew: number;
        totalDuplicates: number;
    } | null>(null);

    // Final report confirmation dialog
    const [showFinalReportConfirm, setShowFinalReportConfirm] = useState(false);

    // Inline Report Preview state
    const [showInlineReport, setShowInlineReport] = useState(false);
    const [inlineReportData, setInlineReportData] = useState<{
        income: number;
        expenses: number;
        subcontract: number;
        transfers: number;
        net: number;
        categories: Record<string, number>;
        period: string;
        transactionCount: number;
        uncategorizedCount: number;
    } | null>(null);

    // AI Categorization state
    interface AISuggestion {
        txId: string;
        vendor: string;
        description: string;
        amount: number;
        suggestedCategory: TaxCategory;
        confidence: number;
        reasoning: string;
    }
    const [aiSuggestions, setAiSuggestions] = useState<AISuggestion[]>([]);
    const [showAiPreview, setShowAiPreview] = useState(false);
    const [aiLoading, setAiLoading] = useState(false);
    const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());
    const [aiApplying, setAiApplying] = useState(false);

    // Delete confirmation dialog
    const [deleteConfirm, setDeleteConfirm] = useState<{ show: boolean; statementId: string | null; fileName: string }>({
        show: false, statementId: null, fileName: ''
    });

    // Load transactions and statements
    useEffect(() => {
        loadTransactions();
        loadStatements();
        loadVendorRules();
    }, [selectedYear]);

    const loadTransactions = async () => {
        setLoading(true);
        try {
            // Load all transactions, filter by year/month client-side using date
            const q = query(
                collection(db, 'bank_transactions'),
                orderBy('date', 'desc')
            );
            const snapshot = await getDocs(q);
            const txs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as BankTransaction[];
            setTransactions(txs);
        } catch (error) {
            console.error('Error loading transactions:', error);
        } finally {
            setLoading(false);
        }
    };

    // Load uploaded statements
    const loadStatements = async () => {
        try {
            // Load all statements, filter client-side if needed
            const q = query(
                collection(db, 'bank_statements'),
                orderBy('uploadedAt', 'desc')
            );
            const snapshot = await getDocs(q);
            const stmts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as BankStatement[];
            setStatements(stmts);
        } catch (error) {
            console.error('Error loading statements:', error);
        }
    };

    // Load vendor rules
    const loadVendorRules = async () => {
        try {
            const snapshot = await getDocs(collection(db, 'vendor_rules'));
            const rules = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as VendorRule[];
            setVendorRules(rules);
        } catch (error) {
            console.error('Error loading vendor rules:', error);
        }
    };

    // Add vendor rule
    const addVendorRule = async () => {
        if (!newRulePattern.trim()) return;

        try {
            await addDoc(collection(db, 'vendor_rules'), {
                pattern: newRulePattern.trim().toLowerCase(),
                category: newRuleCategory,
                createdAt: serverTimestamp(),
            });
            setNewRulePattern('');
            loadVendorRules();
        } catch (error) {
            console.error('Error adding rule:', error);
        }
    };

    // Delete vendor rule
    const deleteVendorRule = async (ruleId: string) => {
        try {
            await deleteDoc(doc(db, 'vendor_rules', ruleId));
            loadVendorRules();
        } catch (error) {
            console.error('Error deleting rule:', error);
        }
    };

    // Create rule from transaction
    const createRuleFromTransaction = (tx: BankTransaction) => {
        setNewRulePattern(tx.vendor);
        setNewRuleCategory(tx.category !== 'uncategorized' ? tx.category : 'materials');
        setShowRulesDialog(true);
    };

    // Delete a statement and its transactions - show confirmation first
    const confirmDeleteStatement = (statementId: string, fileName: string) => {
        setDeleteConfirm({ show: true, statementId, fileName });
    };

    // Execute the actual deletion after confirmation
    const executeDeleteStatement = async () => {
        if (!deleteConfirm.statementId) return;

        const statementId = deleteConfirm.statementId;
        setDeleteConfirm({ show: false, statementId: null, fileName: '' });

        try {
            // Delete transactions
            const txQuery = query(
                collection(db, 'bank_transactions'),
                where('statementId', '==', statementId)
            );
            const txSnapshot = await getDocs(txQuery);
            const batch = writeBatch(db);
            txSnapshot.docs.forEach(txDoc => batch.delete(txDoc.ref));

            // Delete statement
            batch.delete(doc(db, 'bank_statements', statementId));
            await batch.commit();

            setNotification({
                open: true,
                message: `✅ Файл и ${txSnapshot.docs.length} транзакций удалены`,
                severity: 'success'
            });

            loadTransactions();
            loadStatements();
        } catch (error) {
            console.error('Error deleting statement:', error);
            setNotification({
                open: true,
                message: '❌ Ошибка при удалении файла',
                severity: 'error'
            });
        }
    };

    // Clear all transactions for the year
    const clearAll = async () => {
        if (!window.confirm(`Delete ALL transactions and files for ${selectedYear}?`)) return;

        try {
            setLoading(true);

            // Delete all transactions
            const txQuery = query(
                collection(db, 'bank_transactions'),
                where('year', '==', selectedYear)
            );
            const txSnapshot = await getDocs(txQuery);
            const batch1 = writeBatch(db);
            txSnapshot.docs.forEach(txDoc => batch1.delete(txDoc.ref));
            await batch1.commit();

            // Delete all statements
            const stQuery = query(
                collection(db, 'bank_statements'),
                where('year', '==', selectedYear)
            );
            const stSnapshot = await getDocs(stQuery);
            const batch2 = writeBatch(db);
            stSnapshot.docs.forEach(stDoc => batch2.delete(stDoc.ref));
            await batch2.commit();

            loadTransactions();
            loadStatements();
        } catch (error) {
            console.error('Error clearing all:', error);
        }
    };

    // File upload handler - supports multiple files
    const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        setUploading(true);
        let totalNew = 0;
        let totalDuplicates = 0;
        const fileNames: string[] = [];
        let detectedPeriod: { year: number; month: number } | null = null;

        const functions = getFunctions();
        const uploadFn = httpsCallable(functions, 'uploadBankStatement');

        for (let i = 0; i < files.length; i++) {
            const file = files[i];

            try {
                const base64 = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve((reader.result as string).split(',')[1]);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });

                const result = await uploadFn({
                    fileContent: base64,
                    fileName: file.name,
                    mimeType: file.type,
                    year: selectedYear,
                });

                const data = result.data as {
                    success: boolean;
                    transactionCount?: number;
                    duplicateCount?: number;
                    detectedYear?: number;
                    detectedMonth?: number;
                    error?: string
                };

                if (data.success) {
                    totalNew += data.transactionCount || 0;
                    totalDuplicates += data.duplicateCount || 0;
                    fileNames.push(file.name);

                    // Track detected period for auto-switching filters
                    if (data.detectedYear && data.detectedMonth) {
                        detectedPeriod = { year: data.detectedYear, month: data.detectedMonth };
                    }
                }
            } catch (error) {
                console.error('Upload error:', file.name, error);
            }
        }

        setUploading(false);

        // Check if detected period differs from selected filter
        if (detectedPeriod) {
            const periodMismatch = detectedPeriod.year !== selectedYear ||
                (selectedMonth !== 'all' && detectedPeriod.month !== selectedMonth);

            if (periodMismatch) {
                // Show confirmation dialog to redirect to correct period
                setPendingUpload({
                    detectedYear: detectedPeriod.year,
                    detectedMonth: detectedPeriod.month,
                    totalNew,
                    totalDuplicates
                });
                setShowPeriodConfirm(true);

                // Reset input
                if (fileInputRef.current) {
                    fileInputRef.current.value = '';
                }
                return;
            }
        }

        // No mismatch - reload and show success
        await loadTransactions();
        await loadStatements();

        if (totalNew > 0 || totalDuplicates > 0) {
            const periodInfo = detectedPeriod
                ? ` за ${MONTH_NAMES[detectedPeriod.month - 1]} ${detectedPeriod.year}`
                : '';
            setNotification({
                open: true,
                message: `✅ Выписка${periodInfo} загружена! ${totalNew} новых транзакций${totalDuplicates > 0 ? `, ${totalDuplicates} дубликатов пропущено` : ''}`,
                severity: 'success'
            });

            // Generate report data after reload to show accountant report
            // We need to wait for loadTransactions to complete, then calculate from monthFilteredTransactions
            // Since state updates are async, we'll use a callback pattern
            setTimeout(() => {
                // Get fresh transactions from state
                const q = query(
                    collection(db, 'bank_transactions'),
                    where('date', '>=', new Date(selectedYear, 0, 1)),
                    orderBy('date', 'desc')
                );
                getDocs(q).then(snapshot => {
                    const txList = snapshot.docs.map(d => ({
                        id: d.id,
                        ...d.data()
                    })) as BankTransaction[];

                    // Filter by month
                    const filtered = detectedPeriod
                        ? txList.filter(tx => {
                            const txDate = new Date(tx.date.seconds * 1000);
                            return txDate.getMonth() + 1 === detectedPeriod!.month && txDate.getFullYear() === detectedPeriod!.year;
                        })
                        : txList;

                    // Calculate totals
                    let income = 0;
                    let expenses = 0;
                    let transfers = 0;
                    const categories: Record<string, number> = {};

                    filtered.forEach(tx => {
                        const amount = Math.abs(tx.amount);
                        categories[tx.category] = (categories[tx.category] || 0) + amount;

                        if (INCOME_CATEGORIES.includes(tx.category)) {
                            income += amount;
                        } else if (TRANSFER_CATEGORIES.includes(tx.category)) {
                            transfers += amount;
                        } else if (tx.category !== 'private') {
                            expenses += amount;
                        }
                    });

                    setReportData({
                        income,
                        expenses,
                        transfers,
                        net: income - expenses,
                        categories,
                        newCount: totalNew,
                        duplicateCount: totalDuplicates
                    });
                    setShowReport(true);
                });
            }, 500);
        }

        // Reset input
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }, [selectedYear, selectedMonth]);

    // Handle period confirmation - switch filters to detected period
    const handlePeriodConfirm = async () => {
        if (!pendingUpload) return;

        // Switch filters to detected period
        setSelectedYear(pendingUpload.detectedYear);
        setSelectedMonth(pendingUpload.detectedMonth);

        // Close dialog
        setShowPeriodConfirm(false);

        // Reload data
        await loadTransactions();
        await loadStatements();

        // Show success notification
        setNotification({
            open: true,
            message: `✅ Выписка за ${MONTH_NAMES[pendingUpload.detectedMonth - 1]} ${pendingUpload.detectedYear} загружена! ${pendingUpload.totalNew} новых транзакций${pendingUpload.totalDuplicates > 0 ? `, ${pendingUpload.totalDuplicates} дубликатов пропущено` : ''}`,
            severity: 'success'
        });

        setPendingUpload(null);
    };

    // Update transaction category AND auto-learn vendor rule
    const updateCategory = async (txId: string, newCategory: TaxCategory) => {
        try {
            // Find the transaction to get vendor name
            const tx = transactions.find(t => t.id === txId);
            if (!tx) return;

            // Update the transaction
            await updateDoc(doc(db, 'bank_transactions', txId), {
                category: newCategory,
                isDeductible: ['materials', 'fuel', 'software', 'office', 'vehicle', 'housing'].includes(newCategory),
            });

            // Auto-learn: Save vendor rule if category != uncategorized
            if (newCategory !== 'uncategorized' && tx.vendor) {
                const vendorKey = tx.vendor.toUpperCase().trim();

                // Check if rule already exists
                const existingRule = vendorRules.find(r => r.pattern.toUpperCase() === vendorKey);

                if (existingRule) {
                    // Update existing rule
                    await updateDoc(doc(db, 'vendor_rules', existingRule.id), {
                        category: newCategory,
                        updatedAt: new Date()
                    });
                } else {
                    // Create new rule
                    await addDoc(collection(db, 'vendor_rules'), {
                        pattern: vendorKey,
                        category: newCategory,
                        isAutoLearned: true,
                        createdAt: new Date()
                    });
                }

                // Reload vendor rules
                loadVendorRules();

                // Show notification about learned rule
                setNotification({
                    open: true,
                    message: `✅ Правило сохранено: "${tx.vendor}" → ${CATEGORY_LABELS[newCategory]}`,
                    severity: 'success'
                });
            }

            loadTransactions();
        } catch (error) {
            console.error('Error updating category:', error);
        }
    };

    // Export to CSV
    const exportCSV = () => {
        const filtered = filterCategory === 'all'
            ? transactions
            : transactions.filter(tx => tx.category === filterCategory);

        const headers = ['Date', 'Vendor', 'City', 'State', 'Category', 'Amount', 'Deductible', 'Notes'];
        const rows = filtered.map(tx => [
            new Date(tx.date.seconds * 1000).toLocaleDateString(),
            tx.vendor,
            tx.city || '',
            tx.state || '',
            tx.category,
            tx.amount.toFixed(2),
            tx.isDeductible ? 'Yes' : 'No',
            tx.notes || '',
        ]);

        const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bank_statements_${selectedYear}.csv`;
        a.click();
    };

    // Export to PDF
    const exportPDF = () => {
        const filtered = filterCategory === 'all'
            ? transactions
            : transactions.filter(tx => tx.category === filterCategory);

        const doc = new jsPDF();

        // Title
        doc.setFontSize(18);
        doc.text(`Bank Statements ${selectedYear}`, 14, 22);

        // Summary
        doc.setFontSize(10);
        doc.text(`Total Transactions: ${filtered.length}`, 14, 32);
        doc.text(`Total Amount: $${Math.abs(filtered.reduce((sum, tx) => sum + tx.amount, 0)).toFixed(2)}`, 14, 38);

        // Table
        const tableData = filtered.map(tx => [
            new Date(tx.date.seconds * 1000).toLocaleDateString(),
            tx.vendor.substring(0, 25),
            tx.category,
            `$${Math.abs(tx.amount).toFixed(2)}`,
        ]);

        (doc as any).autoTable({
            startY: 45,
            head: [['Date', 'Vendor', 'Category', 'Amount']],
            body: tableData,
            theme: 'striped',
            headStyles: { fillColor: [66, 66, 66] },
            styles: { fontSize: 8 },
        });

        doc.save(`bank_statements_${selectedYear}.pdf`);
    };

    // Export Detailed CSV (matches user's template: Date, Type, Category, Description, Counterparty, Amount, Tax_Deductible, Notes)
    const exportDetailedCSV = () => {
        const filtered = monthFilteredTransactions.filter(tx => tx.category !== 'private');

        // Helper to determine Type based on category
        const getType = (category: TaxCategory): string => {
            if (INCOME_CATEGORIES.includes(category)) return 'Income';
            if (SUBCONTRACT_CATEGORIES.includes(category)) return 'Subcontract';
            if (TRANSFER_CATEGORIES.includes(category)) return 'Internal Transfer (Not Tax Deductible)';
            return 'Expense';
        };

        // Helper to determine Tax_Deductible status
        const getTaxDeductible = (category: TaxCategory): string => {
            if (TRANSFER_CATEGORIES.includes(category)) return 'No';
            if (category === 'insurance') return 'Partially';
            if (category === 'private') return 'No';
            return 'Yes';
        };

        // CSV header
        const header = 'Date,Type,Category,Description,Counterparty,Amount_USD,Tax_Deductible,Notes';

        // CSV rows
        const rows = filtered.map(tx => {
            const date = new Date(tx.date.seconds * 1000).toISOString().split('T')[0]; // YYYY-MM-DD
            const type = getType(tx.category);
            const category = CATEGORY_LABELS[tx.category];
            const description = tx.rawDescription.replace(/,/g, ' ').replace(/"/g, "'");
            const counterparty = tx.vendor.replace(/,/g, ' ').replace(/"/g, "'");
            const amount = Math.abs(tx.amount).toFixed(2);
            const taxDeductible = getTaxDeductible(tx.category);
            const notes = tx.notes?.replace(/,/g, ' ').replace(/"/g, "'") || '';

            return `${date},"${type}","${category}","${description}","${counterparty}",${amount},${taxDeductible},"${notes}"`;
        });

        const csv = [header, ...rows].join('\n');
        const monthStr = selectedMonth === 'all' ? 'ALL' : String(selectedMonth).padStart(2, '0');
        const fileName = `Detailed_Export_${selectedYear}_${monthStr}.csv`;

        // Download
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = fileName;
        link.click();
    };

    // Export Category Summary CSV (matches November 2025 template)
    const exportCategorySummaryCSV = () => {
        const filtered = monthFilteredTransactions.filter(tx => tx.category !== 'private');

        // Calculate totals by category
        const categoryTotals: Record<string, number> = {};
        let totalIncome = 0;
        let totalExpenses = 0;  // Regular business expenses
        let totalTransfers = 0;
        let totalSubcontract = 0;

        filtered.forEach(tx => {
            const amount = Math.abs(tx.amount);
            categoryTotals[tx.category] = (categoryTotals[tx.category] || 0) + amount;

            if (INCOME_CATEGORIES.includes(tx.category)) totalIncome += amount;
            else if (SUBCONTRACT_CATEGORIES.includes(tx.category)) totalSubcontract += amount;
            else if (TRANSFER_CATEGORIES.includes(tx.category)) totalTransfers += amount;
            else totalExpenses += amount;
        });

        // CSV header matching November 2025 template
        let csv = 'Type,Category,Amount_USD\n';

        // Income - Client Payments (net of internal transfers)
        csv += `Income,Client Payments (net of internal transfers),${totalIncome.toFixed(2)}\n`;

        // Expenses - matching November template order
        const expenseRows = [
            { cat: 'office_rent', label: 'Rent (Office / Home office portion)' },
            { cat: 'apps_work', label: 'Apps for Work (Dropbox)' },
            { cat: 'advertising', label: 'Advertising (Instagram)' },
            { cat: 'materials', label: 'Tools & Materials' },
            { cat: 'car_repair', label: 'Car Repair' },
            { cat: 'fees', label: 'Bank Fees (PayPal + International Wire Fee)' },
            // Additional expense categories
            { cat: 'fuel', label: 'Auto Expense / Fuel' },
            { cat: 'software', label: 'Software / Subscriptions' },
            { cat: 'meals', label: 'Business Meals' },
            { cat: 'office_supplies', label: 'Office / Miscellaneous' },
            { cat: 'payroll', label: 'Payroll (Salary)' },
            { cat: 'payroll_taxes', label: 'Payroll Taxes' },
            { cat: 'permits_licenses', label: 'Permits & Licenses' },
            { cat: 'business_services', label: 'Business Services' },
            { cat: 'insurance', label: 'Insurance' },
            { cat: 'hotels', label: 'Hotels' },
            { cat: 'office_equipment', label: 'Office Equipment' },
            { cat: 'atm_debit', label: 'ATM & Debit Card' },
            { cat: 'zelle_expense', label: 'Zelle - Expense' },
            { cat: 'cash_expense', label: 'Cash - Expense' },
        ];

        expenseRows.forEach(row => {
            const amount = categoryTotals[row.cat] || 0;
            if (amount > 0) {
                csv += `Expense,${row.label},${amount.toFixed(2)}\n`;
            }
        });

        // Subcontract (separate category per November template)
        csv += `Subcontract,Subcontract Expenses (Zelle to contractors),${totalSubcontract.toFixed(2)}\n`;

        // Internal Transfers (NOT Tax Deductible)
        csv += `Internal Transfer (Not Tax Deductible),Business credit card payments + PayPal transfers,${totalTransfers.toFixed(2)}\n`;

        // TOTALS matching November template
        csv += `TOTAL_INCOME,Total Income (Business),${totalIncome.toFixed(2)}\n`;

        // TOTAL_EXPENSE = regular expenses + subcontract (but NOT transfers)
        const totalBusinessExpenses = totalExpenses + totalSubcontract;
        csv += `TOTAL_EXPENSE,Total Business Expenses (excluding Internal Transfers),${totalBusinessExpenses.toFixed(2)}\n`;

        // NET_PROFIT = Income - Expenses
        const netProfit = totalIncome - totalBusinessExpenses;
        csv += `NET_PROFIT,Net Profit / Loss (Income - Expenses),${netProfit.toFixed(2)}\n`;

        const monthStr = selectedMonth === 'all' ? 'ALL' : String(selectedMonth).padStart(2, '0');
        const fileName = `${MONTH_NAMES[(selectedMonth as number) - 1] || 'All'}_${selectedYear}_with_Totals.csv`;

        // Download
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = fileName;
        link.click();

        // Show success notification
        setNotification({
            open: true,
            message: `✅ Отчёт "${fileName}" успешно сформирован и скачан!`,
            severity: 'success'
        });
    };

    // Generate Report Preview (for inline display)
    const generateReportPreview = () => {
        const filtered = monthFilteredTransactions.filter(tx => tx.category !== 'private');

        let income = 0;
        let expenses = 0;
        let subcontract = 0;
        let transfers = 0;
        const categories: Record<string, number> = {};

        filtered.forEach(tx => {
            const amount = Math.abs(tx.amount);
            categories[tx.category] = (categories[tx.category] || 0) + amount;

            if (INCOME_CATEGORIES.includes(tx.category)) {
                income += amount;
            } else if (SUBCONTRACT_CATEGORIES.includes(tx.category)) {
                subcontract += amount;
            } else if (TRANSFER_CATEGORIES.includes(tx.category)) {
                transfers += amount;
            } else {
                expenses += amount;
            }
        });

        const periodStr = selectedMonth === 'all'
            ? `${selectedYear} (Все месяцы)`
            : `${MONTH_NAMES[(selectedMonth as number) - 1]} ${selectedYear}`;

        setInlineReportData({
            income,
            expenses,
            subcontract,
            transfers,
            net: income - (expenses + subcontract),
            categories,
            period: periodStr,
            transactionCount: filtered.length,
            uncategorizedCount: filtered.filter(tx => tx.category === 'uncategorized').length,
        });
        setShowInlineReport(true);
    };

    // AI Auto-Categorization
    const triggerAiCategorization = async () => {
        setAiLoading(true);
        try {
            const functions = getFunctions();
            const categorizeFn = httpsCallable(functions, 'categorizeBankTransactions');
            const result = await categorizeFn({
                year: selectedYear,
                month: selectedMonth === 'all' ? undefined : selectedMonth,
            });

            const data = result.data as {
                success: boolean;
                suggestions: AISuggestion[];
                stats: { total: number; highConf: number; medConf: number; lowConf: number };
                error?: string;
            };

            if (data.success && data.suggestions.length > 0) {
                setAiSuggestions(data.suggestions);
                // Pre-select high confidence suggestions
                const preSelected = new Set<string>(
                    data.suggestions
                        .filter(s => s.confidence >= 0.9)
                        .map(s => s.txId)
                );
                setSelectedSuggestions(preSelected);
                setShowAiPreview(true);
            } else if (data.suggestions.length === 0) {
                setNotification({
                    open: true,
                    message: '✅ Нет некатегоризованных транзакций для обработки',
                    severity: 'info'
                });
            } else {
                setNotification({
                    open: true,
                    message: `❌ Ошибка AI: ${data.error || 'Unknown error'}`,
                    severity: 'error'
                });
            }
        } catch (error: any) {
            console.error('AI categorization error:', error);
            setNotification({
                open: true,
                message: `❌ Ошибка AI категоризации: ${error.message}`,
                severity: 'error'
            });
        } finally {
            setAiLoading(false);
        }
    };

    // Apply selected AI suggestions
    const applyAiSuggestions = async () => {
        const toApply = aiSuggestions.filter(s => selectedSuggestions.has(s.txId));
        if (toApply.length === 0) return;

        setAiApplying(true);
        try {
            // Update transactions in Firestore
            for (const suggestion of toApply) {
                await updateDoc(doc(db, 'bank_transactions', suggestion.txId), {
                    category: suggestion.suggestedCategory,
                    isDeductible: ['materials', 'fuel', 'software', 'office_supplies', 'office_equipment'].includes(suggestion.suggestedCategory),
                });

                // Auto-create vendor rule for high-confidence suggestions
                if (suggestion.confidence >= 0.85 && suggestion.vendor) {
                    const vendorKey = suggestion.vendor.toUpperCase().trim();
                    const existingRule = vendorRules.find(r => r.pattern.toUpperCase() === vendorKey);

                    if (!existingRule) {
                        await addDoc(collection(db, 'vendor_rules'), {
                            pattern: vendorKey,
                            category: suggestion.suggestedCategory,
                            isAutoLearned: true,
                            isAiGenerated: true,
                            confidence: suggestion.confidence,
                            createdAt: new Date()
                        });
                    }
                }
            }

            setNotification({
                open: true,
                message: `✅ Применено ${toApply.length} AI категорий! ${toApply.filter(s => s.confidence >= 0.85).length} новых правил создано.`,
                severity: 'success'
            });

            // Reload data
            loadTransactions();
            loadVendorRules();
            setShowAiPreview(false);
            setAiSuggestions([]);
            setSelectedSuggestions(new Set());
        } catch (error: any) {
            console.error('Error applying AI suggestions:', error);
            setNotification({
                open: true,
                message: `❌ Ошибка при применении: ${error.message}`,
                severity: 'error'
            });
        } finally {
            setAiApplying(false);
        }
    };

    // Toggle suggestion selection
    const toggleSuggestion = (txId: string) => {
        setSelectedSuggestions(prev => {
            const next = new Set(prev);
            if (next.has(txId)) next.delete(txId);
            else next.add(txId);
            return next;
        });
    };

    // Select/deselect all suggestions
    const toggleAllSuggestions = () => {
        if (selectedSuggestions.size === aiSuggestions.length) {
            setSelectedSuggestions(new Set());
        } else {
            setSelectedSuggestions(new Set(aiSuggestions.map(s => s.txId)));
        }
    };

    // Get confidence color
    const getConfidenceColor = (confidence: number): 'success' | 'warning' | 'error' => {
        if (confidence >= 0.9) return 'success';
        if (confidence >= 0.7) return 'warning';
        return 'error';
    };

    const getConfidenceLabel = (confidence: number): string => {
        if (confidence >= 0.9) return '🟢 High';
        if (confidence >= 0.7) return '🟡 Medium';
        return '🔴 Low';
    };

    // Export enhanced PDF Report
    const exportReportPDF = () => {
        if (!inlineReportData) return;

        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.getWidth();

        // Header
        doc.setFillColor(52, 73, 94);
        doc.rect(0, 0, pageWidth, 35, 'F');

        doc.setTextColor(255, 255, 255);
        doc.setFontSize(20);
        doc.setFont('helvetica', 'bold');
        doc.text('Garkor Corp', 14, 18);

        doc.setFontSize(12);
        doc.setFont('helvetica', 'normal');
        doc.text(`Bank Statement Report - ${inlineReportData.period}`, 14, 28);

        // Reset colors
        doc.setTextColor(0, 0, 0);

        let yPos = 45;

        // Summary Section
        doc.setFillColor(46, 125, 50);
        doc.rect(14, yPos, 85, 25, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(10);
        doc.text('TOTAL INCOME', 18, yPos + 8);
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text(`$${inlineReportData.income.toFixed(2)}`, 18, yPos + 20);

        doc.setFillColor(198, 40, 40);
        doc.rect(105, yPos, 85, 25, 'F');
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text('TOTAL EXPENSES', 109, yPos + 8);
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text(`$${(inlineReportData.expenses + inlineReportData.subcontract).toFixed(2)}`, 109, yPos + 20);

        yPos += 35;

        doc.setTextColor(0, 0, 0);
        doc.setFillColor(240, 240, 240);
        doc.rect(14, yPos, pageWidth - 28, 15, 'F');
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        const netProfit = inlineReportData.net;
        doc.text(`NET PROFIT: $${netProfit.toFixed(2)}`, 18, yPos + 10);

        yPos += 25;

        // Expense Categories Table
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Expense Breakdown', 14, yPos);
        yPos += 8;

        const expenseData: string[][] = [];
        Object.entries(inlineReportData.categories).forEach(([cat, amount]) => {
            if (!INCOME_CATEGORIES.includes(cat as TaxCategory) &&
                !TRANSFER_CATEGORIES.includes(cat as TaxCategory) &&
                cat !== 'private' && amount > 0) {
                expenseData.push([
                    CATEGORY_LABELS[cat as TaxCategory] || cat,
                    `$${amount.toFixed(2)}`
                ]);
            }
        });

        if (expenseData.length > 0) {
            (doc as any).autoTable({
                startY: yPos,
                head: [['Category', 'Amount']],
                body: expenseData,
                theme: 'striped',
                headStyles: { fillColor: [66, 66, 66] },
                styles: { fontSize: 9 },
                columnStyles: {
                    0: { cellWidth: 120 },
                    1: { cellWidth: 40, halign: 'right' }
                }
            });
            yPos = (doc as any).lastAutoTable.finalY + 10;
        }

        // Transfers section
        if (inlineReportData.transfers > 0) {
            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(100, 100, 100);
            doc.text(`Internal Transfers (Not Deductible): $${inlineReportData.transfers.toFixed(2)}`, 14, yPos);
            yPos += 10;
        }

        // Footer
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text(`Generated: ${new Date().toLocaleDateString()} | Transactions: ${inlineReportData.transactionCount}`, 14, 280);

        const fileName = `BankReport_${inlineReportData.period.replace(/\s+/g, '_')}.pdf`;
        doc.save(fileName);

        setNotification({
            open: true,
            message: `✅ PDF отчёт "${fileName}" скачан!`,
            severity: 'success'
        });
    };

    // Filter by year first, then by month (exclude split parents)
    const yearFilteredTransactions = transactions.filter(tx => {
        if (tx.isSplit) return false; // hide split parents, show children instead
        const txDate = new Date(tx.date.seconds * 1000);
        return txDate.getFullYear() === selectedYear;
    });

    const monthFilteredTransactions = selectedMonth === 'all'
        ? yearFilteredTransactions
        : yearFilteredTransactions.filter(tx => {
            const txDate = new Date(tx.date.seconds * 1000);
            return txDate.getMonth() + 1 === selectedMonth;
        });

    // Auto-detect refunds: positive amounts in expense categories
    const withRefundFlags = monthFilteredTransactions.map(tx => {
        if (tx.amount > 0 && !INCOME_CATEGORIES.includes(tx.category) && !TRANSFER_CATEGORIES.includes(tx.category) && tx.category !== 'private' && tx.category !== 'uncategorized') {
            return { ...tx, isRefund: true };
        }
        return tx;
    });

    // Calculate totals (on month-filtered data)
    const totals = withRefundFlags.reduce((acc, tx) => {
        if (tx.category !== 'uncategorized') {
            const amount = Math.abs(tx.amount);
            acc[tx.category] = (acc[tx.category] || 0) + (tx.isRefund ? 0 : amount);
        }
        // Group by type
        if (INCOME_CATEGORIES.includes(tx.category)) {
            acc.income = (acc.income || 0) + Math.abs(tx.amount);
        } else if (TRANSFER_CATEGORIES.includes(tx.category)) {
            acc.transfers = (acc.transfers || 0) + Math.abs(tx.amount);
        } else if (tx.category !== 'uncategorized') {
            if (tx.isRefund) {
                acc.expenses = (acc.expenses || 0) - Math.abs(tx.amount);
            } else {
                acc.expenses = (acc.expenses || 0) + Math.abs(tx.amount);
            }
        }
        acc.total = (acc.total || 0) + Math.abs(tx.amount);
        return acc;
    }, {} as Record<string, number>);

    // Chart data: top 10 expense categories
    const chartData = useMemo(() => {
        const expenseEntries = Object.entries(totals)
            .filter(([cat]) =>
                !['income', 'expenses', 'transfers', 'total', 'uncategorized', 'private'].includes(cat) &&
                !INCOME_CATEGORIES.includes(cat as TaxCategory) &&
                !TRANSFER_CATEGORIES.includes(cat as TaxCategory)
            )
            .map(([cat, amount]) => ({
                name: (CATEGORY_LABELS[cat as TaxCategory] || cat).replace(/ - Expense$/, '').replace(/^[^\s]+ /, ''),
                amount: Math.round(amount),
                color: CATEGORY_COLORS[cat as TaxCategory] || '#999',
            }))
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 10);
        return expenseEntries;
    }, [totals]);

    // Review needed: transactions from ambiguous vendors
    const reviewNeededTransactions = withRefundFlags.filter(tx =>
        AMBIGUOUS_VENDORS.some(v => tx.vendor.toUpperCase().includes(v)) ||
        tx.category === 'uncategorized'
    );

    // Then filter by category
    const categoryFiltered = filterCategory === 'all'
        ? withRefundFlags
        : withRefundFlags.filter(tx => tx.category === filterCategory);

    // Filter by tab (business vs private vs review)
    const filteredTransactions = activeTab === 'private'
        ? categoryFiltered.filter(tx => tx.category === 'private')
        : activeTab === 'review'
            ? reviewNeededTransactions
            : categoryFiltered.filter(tx => tx.category !== 'private');

    // --- Drag & Drop handlers ---
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);

        const files = e.dataTransfer.files;
        if (files && files.length > 0 && fileInputRef.current) {
            // Create a synthetic event-like approach by setting files on input
            const dataTransfer = new DataTransfer();
            for (let i = 0; i < files.length; i++) {
                dataTransfer.items.add(files[i]);
            }
            fileInputRef.current.files = dataTransfer.files;
            fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }, []);

    // --- Bulk Actions ---
    const toggleTxSelection = (txId: string) => {
        setSelectedTxIds(prev => {
            const next = new Set(prev);
            if (next.has(txId)) next.delete(txId);
            else next.add(txId);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectedTxIds.size === searchFilteredTransactions.length) {
            setSelectedTxIds(new Set());
        } else {
            setSelectedTxIds(new Set(searchFilteredTransactions.map(tx => tx.id)));
        }
    };

    const applyBulkCategory = async () => {
        if (selectedTxIds.size === 0) return;
        try {
            const batch = writeBatch(db);
            selectedTxIds.forEach(txId => {
                batch.update(doc(db, 'bank_transactions', txId), {
                    category: bulkCategory,
                    isDeductible: !TRANSFER_CATEGORIES.includes(bulkCategory) && bulkCategory !== 'private',
                    deductibilityPercent: DEFAULT_DEDUCTIBILITY[bulkCategory] ?? 100,
                });
            });
            await batch.commit();
            setSelectedTxIds(new Set());
            setNotification({ open: true, message: `✅ ${selectedTxIds.size} транзакций обновлено → ${CATEGORY_LABELS[bulkCategory]}`, severity: 'success' });
            loadTransactions();
        } catch (error) {
            console.error('Bulk update error:', error);
        }
    };

    const bulkMarkPrivate = async () => {
        if (selectedTxIds.size === 0) return;
        try {
            const batch = writeBatch(db);
            selectedTxIds.forEach(txId => {
                batch.update(doc(db, 'bank_transactions', txId), { category: 'private', isDeductible: false, deductibilityPercent: 0 });
            });
            await batch.commit();
            setSelectedTxIds(new Set());
            setNotification({ open: true, message: `✅ ${selectedTxIds.size} транзакций → Private`, severity: 'success' });
            loadTransactions();
        } catch (error) {
            console.error('Bulk mark private error:', error);
        }
    };

    // --- Split Transaction ---
    const executeSplit = async () => {
        if (!splitTx) return;
        const totalSplit = splitParts.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
        if (Math.abs(totalSplit - Math.abs(splitTx.amount)) > 0.01) {
            setNotification({ open: true, message: `⚠️ Сумма частей ($${totalSplit.toFixed(2)}) не совпадает с оригиналом ($${Math.abs(splitTx.amount).toFixed(2)})`, severity: 'error' });
            return;
        }
        try {
            const batch = writeBatch(db);
            // Mark parent as split
            batch.update(doc(db, 'bank_transactions', splitTx.id), { isSplit: true });
            // Create children
            for (const part of splitParts) {
                const childRef = doc(collection(db, 'bank_transactions'));
                batch.set(childRef, {
                    parentId: splitTx.id,
                    statementId: splitTx.statementId,
                    date: splitTx.date,
                    rawDescription: splitTx.rawDescription,
                    vendor: splitTx.vendor,
                    city: splitTx.city || '',
                    state: splitTx.state || '',
                    amount: splitTx.amount < 0 ? -parseFloat(part.amount) : parseFloat(part.amount),
                    category: part.category,
                    isDeductible: !TRANSFER_CATEGORIES.includes(part.category) && part.category !== 'private',
                    deductibilityPercent: DEFAULT_DEDUCTIBILITY[part.category] ?? 100,
                    year: splitTx.year,
                    notes: `Split from ${splitTx.vendor}`,
                });
            }
            await batch.commit();
            setSplitTx(null);
            setSplitParts([{ amount: '', category: 'business_expense' }, { amount: '', category: 'private' }]);
            setNotification({ open: true, message: `✅ Транзакция ${splitTx.vendor} разделена на ${splitParts.length} частей`, severity: 'success' });
            loadTransactions();
        } catch (error) {
            console.error('Split error:', error);
        }
    };

    // --- Update deductibility percentage ---
    const updateDeductibility = async (txId: string, percent: number) => {
        try {
            await updateDoc(doc(db, 'bank_transactions', txId), { deductibilityPercent: percent });
            loadTransactions();
        } catch (error) {
            console.error('Error updating deductibility:', error);
        }
    };

    // --- Receipt Upload ---
    const handleReceiptUpload = async (txId: string, file: File) => {
        setUploadingReceipt(txId);
        try {
            const storageRef = ref(storage, `receipts/${txId}/${file.name}`);
            await uploadBytes(storageRef, file);
            const downloadUrl = await getDownloadURL(storageRef);
            await updateDoc(doc(db, 'bank_transactions', txId), { receiptUrl: downloadUrl });
            setNotification({ open: true, message: '📎 Receipt attached!', severity: 'success' });
            loadTransactions();
        } catch (error) {
            console.error('Receipt upload error:', error);
            setNotification({ open: true, message: 'Failed to upload receipt', severity: 'error' });
        } finally {
            setUploadingReceipt(null);
        }
    };

    // --- Schedule C Export PDF ---
    const downloadScheduleC = () => {
        const doc_pdf = new jsPDF();
        const pageWidth = doc_pdf.internal.pageSize.getWidth();

        // Header
        doc_pdf.setFillColor(25, 118, 210);
        doc_pdf.rect(0, 0, pageWidth, 35, 'F');
        doc_pdf.setTextColor(255, 255, 255);
        doc_pdf.setFontSize(18);
        doc_pdf.setFont('helvetica', 'bold');
        doc_pdf.text('Schedule C — Profit or Loss from Business', 14, 18);
        doc_pdf.setFontSize(10);
        doc_pdf.setFont('helvetica', 'normal');
        const periodLabel = selectedMonth === 'all'
            ? `Year ${selectedYear}`
            : `${MONTH_NAMES[(selectedMonth as number) - 1]} ${selectedYear}`;
        doc_pdf.text(`Garkor Corp — ${periodLabel}`, 14, 28);

        doc_pdf.setTextColor(0, 0, 0);
        let yPos = 45;

        // Build Schedule C data from all business transactions for the period
        const scheduleCData: Record<string, { line: string; amount: number; deductible: number }> = {};

        monthFilteredTransactions.forEach(tx => {
            if (tx.category === 'private' || tx.category === 'uncategorized') return;
            if (INCOME_CATEGORIES.includes(tx.category)) return;
            if (TRANSFER_CATEGORIES.includes(tx.category)) return;

            const lineItem = SCHEDULE_C_MAP[tx.category] || 'Other Expenses';
            const amount = Math.abs(tx.amount);
            const pct = tx.deductibilityPercent ?? (DEFAULT_DEDUCTIBILITY[tx.category] ?? 100);
            const deductible = amount * (pct / 100);

            if (!scheduleCData[lineItem]) {
                scheduleCData[lineItem] = { line: lineItem, amount: 0, deductible: 0 };
            }
            scheduleCData[lineItem].amount += amount;
            scheduleCData[lineItem].deductible += deductible;
        });

        const tableData = Object.values(scheduleCData)
            .sort((a, b) => b.deductible - a.deductible)
            .map(row => [
                row.line,
                `$${row.amount.toFixed(2)}`,
                `$${row.deductible.toFixed(2)}`,
            ]);

        const totalAmount = Object.values(scheduleCData).reduce((s, r) => s + r.amount, 0);
        const totalDeductible = Object.values(scheduleCData).reduce((s, r) => s + r.deductible, 0);

        if (tableData.length > 0) {
            (doc_pdf as any).autoTable({
                startY: yPos,
                head: [['IRS Line Item', 'Gross Amount', 'Tax Deductible']],
                body: tableData,
                foot: [['TOTAL', `$${totalAmount.toFixed(2)}`, `$${totalDeductible.toFixed(2)}`]],
                theme: 'grid',
                headStyles: { fillColor: [25, 118, 210] },
                footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
                styles: { fontSize: 9 },
                columnStyles: {
                    0: { cellWidth: 90 },
                    1: { cellWidth: 40, halign: 'right' },
                    2: { cellWidth: 40, halign: 'right' },
                },
            });
            yPos = (doc_pdf as any).lastAutoTable.finalY + 15;
        }

        // Income summary
        const totalIncome = monthFilteredTransactions
            .filter(tx => INCOME_CATEGORIES.includes(tx.category))
            .reduce((s, tx) => s + Math.abs(tx.amount), 0);

        doc_pdf.setFontSize(12);
        doc_pdf.setFont('helvetica', 'bold');
        doc_pdf.text(`Gross Income (Line 1): $${totalIncome.toFixed(2)}`, 14, yPos);
        yPos += 8;
        doc_pdf.text(`Total Deductions: $${totalDeductible.toFixed(2)}`, 14, yPos);
        yPos += 8;
        doc_pdf.setFontSize(14);
        const netProfit = totalIncome - totalDeductible;
        doc_pdf.text(`Net Profit (Line 31): $${netProfit.toFixed(2)}`, 14, yPos);

        // Footer
        doc_pdf.setFontSize(7);
        doc_pdf.setFont('helvetica', 'normal');
        doc_pdf.setTextColor(150, 150, 150);
        doc_pdf.text(`Generated: ${new Date().toLocaleString()} | This is a draft — consult your CPA`, 14, 285);

        doc_pdf.save(`ScheduleC_Draft_${periodLabel.replace(/\s+/g, '_')}.pdf`);
        setNotification({ open: true, message: '📋 Schedule C Draft PDF downloaded!', severity: 'success' });
    };

    // --- Recurring Transaction Detection ---
    const recurringVendors = useMemo(() => {
        // Group transactions by vendor across the full year
        const vendorMonths: Record<string, Set<number>> = {};
        yearFilteredTransactions.forEach(tx => {
            const month = new Date(tx.date.seconds * 1000).getMonth();
            const key = tx.vendor.toUpperCase().trim();
            if (!vendorMonths[key]) vendorMonths[key] = new Set();
            vendorMonths[key].add(month);
        });
        // Vendors appearing in 3+ months are recurring
        const result = new Set<string>();
        Object.entries(vendorMonths).forEach(([vendor, months]) => {
            if (months.size >= 3) result.add(vendor);
        });
        return result;
    }, [yearFilteredTransactions]);

    // --- Auto-Rule Suggestion ---
    // Detect when user manually categorized same vendor 3+ times
    useMemo(() => {
        const vendorCatCount: Record<string, Record<string, number>> = {};
        transactions.forEach(tx => {
            if (tx.category === 'uncategorized') return;
            const key = tx.vendor.toUpperCase().trim();
            if (!vendorCatCount[key]) vendorCatCount[key] = {};
            vendorCatCount[key][tx.category] = (vendorCatCount[key][tx.category] || 0) + 1;
        });

        // Find vendor with highest repeated manual category that doesn't have a rule
        let bestSuggestion: { vendor: string; category: TaxCategory; count: number } | null = null;
        Object.entries(vendorCatCount).forEach(([vendor, cats]) => {
            const hasRule = vendorRules.some(r => vendor.includes(r.pattern.toUpperCase()));
            if (hasRule) return;
            Object.entries(cats).forEach(([cat, count]) => {
                if (count >= 3 && (!bestSuggestion || count > bestSuggestion.count)) {
                    bestSuggestion = { vendor, category: cat as TaxCategory, count };
                }
            });
        });
        setRuleSuggestion(bestSuggestion);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [transactions, vendorRules]);

    // --- Apply vendor search filter to filteredTransactions ---
    const searchFilteredTransactions = vendorSearch
        ? filteredTransactions.filter(tx =>
            tx.vendor.toLowerCase().includes(vendorSearch.toLowerCase()) ||
            tx.rawDescription.toLowerCase().includes(vendorSearch.toLowerCase()))
        : filteredTransactions;

    return (
        <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>
            {/* Header */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h4" sx={{ fontWeight: 600 }}>
                    🏦 Bank Statements
                </Typography>
                <Box sx={{ display: 'flex', gap: 2 }}>
                    <Button
                        variant="outlined"
                        startIcon={<DownloadIcon />}
                        onClick={exportCSV}
                        disabled={transactions.length === 0}
                    >
                        Export CSV
                    </Button>
                    <Button
                        variant="outlined"
                        color="secondary"
                        startIcon={<PdfIcon />}
                        onClick={exportPDF}
                        disabled={transactions.length === 0}
                    >
                        Export PDF
                    </Button>
                    <Button
                        variant="outlined"
                        color="info"
                        startIcon={<PdfIcon />}
                        onClick={downloadScheduleC}
                        disabled={transactions.length === 0}
                    >
                        📋 Schedule C
                    </Button>
                    <Button
                        variant="outlined"
                        startIcon={<RuleIcon />}
                        onClick={() => setShowRulesDialog(true)}
                    >
                        Rules ({vendorRules.length})
                    </Button>
                    <Button
                        variant="outlined"
                        color="error"
                        startIcon={<ClearIcon />}
                        onClick={clearAll}
                        disabled={transactions.length === 0}
                    >
                        Clear All
                    </Button>
                </Box>
            </Box>

            {/* Year/Month Filter */}
            <Paper sx={{ p: 2, mb: 2 }}>
                <Stack direction="row" spacing={2} alignItems="center">
                    <FormControl size="small" sx={{ minWidth: 100 }}>
                        <InputLabel>Year</InputLabel>
                        <Select
                            value={selectedYear}
                            label="Year"
                            onChange={(e) => setSelectedYear(Number(e.target.value))}
                        >
                            {[2024, 2025, 2026].map(year => (
                                <MenuItem key={year} value={year}>{year}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ minWidth: 120 }}>
                        <InputLabel>Month</InputLabel>
                        <Select
                            value={selectedMonth}
                            label="Month"
                            onChange={(e) => setSelectedMonth(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                        >
                            <MenuItem value="all">All Months</MenuItem>
                            {MONTH_NAMES.map((month, idx) => (
                                <MenuItem key={month} value={idx + 1}>{month}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </Stack>
            </Paper>

            {/* Upload Area with Drag & Drop */}
            <Paper
                sx={{
                    p: 4,
                    mb: 3,
                    textAlign: 'center',
                    border: '2px dashed',
                    borderColor: isDragOver ? 'primary.main' : 'divider',
                    bgcolor: isDragOver ? 'action.selected' : 'background.paper',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    transform: isDragOver ? 'scale(1.01)' : 'none',
                    '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
                }}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                <input
                    type="file"
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    accept=".csv,.png,.jpg,.jpeg,.pdf"
                    multiple
                    onChange={handleFileUpload}
                />
                {uploading ? (
                    <CircularProgress />
                ) : isDragOver ? (
                    <>
                        <UploadIcon sx={{ fontSize: 56, color: 'primary.main', mb: 1 }} />
                        <Typography variant="h6" color="primary">
                            Drop files here!
                        </Typography>
                    </>
                ) : (
                    <>
                        <UploadIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
                        <Typography variant="h6" color="text.secondary">
                            Upload Bank Statement
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            Drag & drop or click — CSV, PNG, JPG, PDF from Chase
                        </Typography>
                    </>
                )}
            </Paper>

            {/* Uploaded Files List */}
            {statements.length > 0 && (
                <Paper sx={{ p: 2, mb: 3 }}>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>📁 Uploaded Files ({statements.length})</Typography>
                    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                        {statements.map(stmt => (
                            <Chip
                                key={stmt.id}
                                label={`${stmt.fileName} (${stmt.transactionCount}${stmt.duplicateCount ? ` / ${stmt.duplicateCount} dup` : ''})`}
                                onDelete={() => confirmDeleteStatement(stmt.id, stmt.fileName)}
                                deleteIcon={<DeleteIcon />}
                                variant="outlined"
                                size="small"
                            />
                        ))}
                    </Stack>

                    {/* Expense Bar Chart */}
                    {chartData.length > 0 && showChart && (
                        <Paper sx={{ p: 2, mb: 3 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                <Typography variant="subtitle2">📊 Top Expense Categories</Typography>
                                <IconButton size="small" onClick={() => setShowChart(false)}>
                                    <ChartIcon fontSize="small" />
                                </IconButton>
                            </Box>
                            <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 36)}>
                                <BarChart data={chartData} layout="vertical" margin={{ left: 140, right: 20, top: 5, bottom: 5 }}>
                                    <XAxis type="number" tickFormatter={(v: number) => `$${v.toLocaleString()}`} />
                                    <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12 }} />
                                    <RechartsTooltip formatter={(value: number) => `$${value.toLocaleString()}`} />
                                    <Bar dataKey="amount" radius={[0, 4, 4, 0]}>
                                        {chartData.map((entry, index) => (
                                            <Cell key={index} fill={entry.color} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </Paper>
                    )}
                    {!showChart && chartData.length > 0 && (
                        <Box sx={{ mb: 2 }}>
                            <Button size="small" startIcon={<ChartIcon />} onClick={() => setShowChart(true)} variant="text">Show Chart</Button>
                        </Box>
                    )}
                </Paper>
            )}

            {/* Summary Cards */}
            <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
                {/* Main totals: Income, Expense, Transfer */}
                <Card sx={{ minWidth: 140, bgcolor: '#E8F5E9' }}>
                    <CardContent sx={{ textAlign: 'center', py: 1.5 }}>
                        <Typography variant="caption" color="text.secondary">💰 Income</Typography>
                        <Typography variant="h5" sx={{ color: '#2E7D32', fontWeight: 600 }}>
                            ${(totals.income || 0).toFixed(0)}
                        </Typography>
                    </CardContent>
                </Card>
                <Card sx={{ minWidth: 140, bgcolor: '#FFEBEE' }}>
                    <CardContent sx={{ textAlign: 'center', py: 1.5 }}>
                        <Typography variant="caption" color="text.secondary">💸 Expenses</Typography>
                        <Typography variant="h5" sx={{ color: '#C62828', fontWeight: 600 }}>
                            ${(totals.expenses || 0).toFixed(0)}
                        </Typography>
                    </CardContent>
                </Card>
                <Card sx={{ minWidth: 140, bgcolor: '#E3F2FD' }}>
                    <CardContent sx={{ textAlign: 'center', py: 1.5 }}>
                        <Typography variant="caption" color="text.secondary">🔄 Transfers</Typography>
                        <Typography variant="h5" sx={{ color: '#1565C0', fontWeight: 600 }}>
                            ${(totals.transfers || 0).toFixed(0)}
                        </Typography>
                    </CardContent>
                </Card>
                <Card sx={{ minWidth: 140 }}>
                    <CardContent sx={{ textAlign: 'center', py: 1.5 }}>
                        <Typography variant="caption" color="text.secondary">📊 Net</Typography>
                        <Typography variant="h5" sx={{
                            color: (totals.income || 0) - (totals.expenses || 0) >= 0 ? '#2E7D32' : '#C62828',
                            fontWeight: 600
                        }}>
                            ${((totals.income || 0) - (totals.expenses || 0)).toFixed(0)}
                        </Typography>
                    </CardContent>
                </Card>
            </Stack>

            {/* Category breakdown cards */}
            <Stack direction="row" spacing={1} sx={{ mb: 3, flexWrap: 'wrap', gap: 1, overflowX: 'auto' }}>
                {Object.entries(CATEGORY_LABELS).map(([cat, label]) => {
                    const amount = totals[cat] || 0;
                    if (amount === 0) return null;
                    return (
                        <Card
                            key={cat}
                            sx={{
                                minWidth: 100,
                                cursor: 'pointer',
                                border: filterCategory === cat ? 2 : 0,
                                borderColor: CATEGORY_COLORS[cat as TaxCategory],
                            }}
                            onClick={() => setFilterCategory(filterCategory === cat ? 'all' : cat as TaxCategory)}
                        >
                            <CardContent sx={{ textAlign: 'center', py: 1, px: 1 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                                    {label}
                                </Typography>
                                <Typography variant="body1" sx={{ color: CATEGORY_COLORS[cat as TaxCategory], fontWeight: 500 }}>
                                    ${amount.toFixed(0)}
                                </Typography>
                            </CardContent>
                        </Card>
                    );
                })}
            </Stack>

            {/* Action Buttons */}
            <Box sx={{ mb: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                <Badge
                    badgeContent={monthFilteredTransactions.filter(tx => tx.category === 'uncategorized').length}
                    color="warning"
                    max={999}
                >
                    <Button
                        variant="contained"
                        color="secondary"
                        size="large"
                        onClick={triggerAiCategorization}
                        disabled={aiLoading || monthFilteredTransactions.filter(tx => tx.category === 'uncategorized').length === 0}
                        sx={{ fontWeight: 600 }}
                        startIcon={aiLoading ? <CircularProgress size={20} color="inherit" /> : <span>🤖</span>}
                    >
                        {aiLoading ? 'AI анализирует...' : 'AI Категоризация'}
                    </Button>
                </Badge>
                <Button
                    variant="contained"
                    color="primary"
                    size="large"
                    onClick={generateReportPreview}
                    disabled={monthFilteredTransactions.length === 0}
                    sx={{ fontWeight: 600 }}
                >
                    📊 Предварительный просмотр отчёта
                </Button>
                <Button
                    variant="outlined"
                    color="success"
                    size="large"
                    onClick={() => setShowFinalReportConfirm(true)}
                    disabled={monthFilteredTransactions.length === 0}
                    sx={{ fontWeight: 600 }}
                >
                    📋 CSV для бухгалтера
                </Button>
                {monthFilteredTransactions.filter(tx => tx.category === 'uncategorized').length > 0 && (
                    <Alert severity="warning" sx={{ py: 0 }}>
                        ⚠️ {monthFilteredTransactions.filter(tx => tx.category === 'uncategorized').length} некатегоризованных транзакций
                    </Alert>
                )}
            </Box>

            {/* AI Loading Progress */}
            {aiLoading && (
                <Box sx={{ mb: 2 }}>
                    <LinearProgress color="secondary" />
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                        🤖 AI анализирует транзакции... Это может занять 10-30 секунд.
                    </Typography>
                </Box>
            )}

            {/* Inline Report Preview Section */}
            {showInlineReport && inlineReportData && (
                <Paper
                    id="report-preview"
                    sx={{
                        p: 3,
                        mb: 3,
                        bgcolor: '#fafafa',
                        border: '2px solid #e0e0e0',
                        borderRadius: 2,
                    }}
                >
                    {/* Report Header */}
                    <Box sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        mb: 3,
                        pb: 2,
                        borderBottom: '1px solid #e0e0e0'
                    }}>
                        <Box>
                            <Typography variant="h5" sx={{ fontWeight: 700, color: '#34495e' }}>
                                📊 Bank Statement Report
                            </Typography>
                            <Typography variant="subtitle1" color="text.secondary">
                                Garkor Corp • {inlineReportData.period}
                            </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                            <Button
                                variant="contained"
                                color="error"
                                onClick={exportReportPDF}
                                startIcon={<span>📥</span>}
                                sx={{ fontWeight: 600 }}
                            >
                                Скачать PDF
                            </Button>
                            <Button
                                variant="outlined"
                                onClick={() => setShowInlineReport(false)}
                            >
                                Закрыть
                            </Button>
                        </Box>
                    </Box>

                    {/* Uncategorized Warning */}
                    {inlineReportData.uncategorizedCount > 0 && (
                        <Alert severity="warning" sx={{ mb: 2 }}>
                            ⚠️ {inlineReportData.uncategorizedCount} некатегоризованных транзакций. Заполните категории перед финальным отчётом!
                        </Alert>
                    )}

                    {/* Summary Cards Row */}
                    <Stack direction="row" spacing={2} sx={{ mb: 3, flexWrap: 'wrap', gap: 1 }}>
                        <Card sx={{ minWidth: 180, bgcolor: '#E8F5E9', flex: 1 }}>
                            <CardContent>
                                <Typography variant="overline" color="text.secondary">💰 Income</Typography>
                                <Typography variant="h4" sx={{ color: '#2E7D32', fontWeight: 700 }}>
                                    ${inlineReportData.income.toFixed(2)}
                                </Typography>
                            </CardContent>
                        </Card>
                        <Card sx={{ minWidth: 180, bgcolor: '#FFEBEE', flex: 1 }}>
                            <CardContent>
                                <Typography variant="overline" color="text.secondary">💸 Expenses</Typography>
                                <Typography variant="h4" sx={{ color: '#C62828', fontWeight: 700 }}>
                                    ${inlineReportData.expenses.toFixed(2)}
                                </Typography>
                            </CardContent>
                        </Card>
                        <Card sx={{ minWidth: 180, bgcolor: '#E3F2FD', flex: 1 }}>
                            <CardContent>
                                <Typography variant="overline" color="text.secondary">👷 Subcontract</Typography>
                                <Typography variant="h4" sx={{ color: '#1565C0', fontWeight: 700 }}>
                                    ${inlineReportData.subcontract.toFixed(2)}
                                </Typography>
                            </CardContent>
                        </Card>
                        <Card sx={{ minWidth: 180, bgcolor: inlineReportData.net >= 0 ? '#E8F5E9' : '#FFEBEE', flex: 1 }}>
                            <CardContent>
                                <Typography variant="overline" color="text.secondary">📈 Net Profit</Typography>
                                <Typography variant="h4" sx={{
                                    color: inlineReportData.net >= 0 ? '#2E7D32' : '#C62828',
                                    fontWeight: 700
                                }}>
                                    ${inlineReportData.net.toFixed(2)}
                                </Typography>
                            </CardContent>
                        </Card>
                    </Stack>

                    {/* Expense Breakdown Table */}
                    <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
                        Expense Breakdown by Category
                    </Typography>
                    <Box sx={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
                        gap: 1,
                        mb: 3
                    }}>
                        {Object.entries(inlineReportData.categories)
                            .filter(([cat, amount]) =>
                                !INCOME_CATEGORIES.includes(cat as TaxCategory) &&
                                !TRANSFER_CATEGORIES.includes(cat as TaxCategory) &&
                                cat !== 'private' &&
                                amount > 0
                            )
                            .sort((a, b) => b[1] - a[1])
                            .map(([cat, amount]) => (
                                <Paper
                                    key={cat}
                                    sx={{
                                        p: 1.5,
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        bgcolor: 'white'
                                    }}
                                >
                                    <Typography variant="body2">
                                        {CATEGORY_LABELS[cat as TaxCategory] || cat}
                                    </Typography>
                                    <Typography variant="body1" sx={{ fontWeight: 600 }}>
                                        ${amount.toFixed(2)}
                                    </Typography>
                                </Paper>
                            ))
                        }
                    </Box>

                    {/* Transfers Note */}
                    {inlineReportData.transfers > 0 && (
                        <Alert severity="info" sx={{ mb: 2 }}>
                            🔄 Internal Transfers (Not Tax Deductible): <strong>${inlineReportData.transfers.toFixed(2)}</strong>
                        </Alert>
                    )}

                    {/* Footer */}
                    <Box sx={{
                        mt: 2,
                        pt: 2,
                        borderTop: '1px solid #e0e0e0',
                        display: 'flex',
                        justifyContent: 'space-between',
                        color: 'text.secondary'
                    }}>
                        <Typography variant="caption">
                            Transactions: {inlineReportData.transactionCount}
                        </Typography>
                        <Typography variant="caption">
                            Generated: {new Date().toLocaleDateString()}
                        </Typography>
                    </Box>
                </Paper>
            )}

            {/* Filter Chips */}
            <Box sx={{ mb: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Chip
                    label="All"
                    variant={filterCategory === 'all' ? 'filled' : 'outlined'}
                    onClick={() => setFilterCategory('all')}
                />
                {Object.entries(CATEGORY_LABELS).map(([cat, label]) => (
                    <Chip
                        key={cat}
                        label={label}
                        variant={filterCategory === cat ? 'filled' : 'outlined'}
                        onClick={() => setFilterCategory(cat as TaxCategory)}
                        sx={{
                            bgcolor: filterCategory === cat ? CATEGORY_COLORS[cat as TaxCategory] : undefined,
                            color: filterCategory === cat ? 'white' : undefined,
                        }}
                    />
                ))}
            </Box>

            {/* Vendor Search + Auto-Rule Suggestion */}
            <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center' }}>
                <TextField
                    size="small"
                    placeholder="🔍 Search vendor or description..."
                    value={vendorSearch}
                    onChange={(e) => setVendorSearch(e.target.value)}
                    sx={{ flex: 1, maxWidth: 400 }}
                    InputProps={{
                        startAdornment: <SearchIcon sx={{ color: 'text.secondary', mr: 1 }} fontSize="small" />,
                    }}
                />
                {vendorSearch && (
                    <Chip
                        label={`${searchFilteredTransactions.length} results`}
                        size="small"
                        onDelete={() => setVendorSearch('')}
                    />
                )}
            </Box>

            {/* Auto-Rule Suggestion Banner */}
            {ruleSuggestion && (
                <Paper sx={{ p: 1.5, mb: 2, bgcolor: '#FFF3E0', border: '1px solid #FFB74D', display: 'flex', alignItems: 'center', gap: 2 }}>
                    <SuggestIcon color="warning" />
                    <Typography variant="body2" sx={{ flex: 1 }}>
                        💡 <strong>{ruleSuggestion.vendor}</strong> was categorized as <strong>{CATEGORY_LABELS[ruleSuggestion.category]}</strong> {ruleSuggestion.count}× — create an auto-rule?
                    </Typography>
                    <Button
                        size="small"
                        variant="contained"
                        color="warning"
                        onClick={async () => {
                            await addDoc(collection(db, 'vendor_rules'), {
                                pattern: ruleSuggestion.vendor.toLowerCase(),
                                category: ruleSuggestion.category,
                                createdAt: serverTimestamp(),
                            });
                            setNotification({ open: true, message: `✅ Rule created for ${ruleSuggestion.vendor}`, severity: 'success' });
                            setRuleSuggestion(null);
                            loadTransactions();
                        }}
                    >
                        Create Rule
                    </Button>
                    <Button size="small" onClick={() => setRuleSuggestion(null)}>Dismiss</Button>
                </Paper>
            )}

            {/* Hidden receipt file input */}
            <input
                type="file"
                ref={receiptInputRef}
                style={{ display: 'none' }}
                accept="image/*,.pdf"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    const txId = receiptInputRef.current?.dataset.txid;
                    if (file && txId) handleReceiptUpload(txId, file);
                    e.target.value = '';
                }}
            />

            {/* Tabs for Business / Private / Review transactions */}
            <Paper sx={{ mb: 2 }}>
                <Tabs
                    value={activeTab}
                    onChange={(_, newValue) => { setActiveTab(newValue); setSelectedTxIds(new Set()); }}
                    indicatorColor="primary"
                    textColor="primary"
                >
                    <Tab
                        value="business"
                        label={`💼 Business (${withRefundFlags.filter(tx => tx.category !== 'private').length})`}
                    />
                    <Tab
                        value="private"
                        label={`🔒 Private (${withRefundFlags.filter(tx => tx.category === 'private').length})`}
                        sx={{ color: '#9E9E9E' }}
                    />
                    <Tab
                        value="review"
                        label={
                            <Badge badgeContent={reviewNeededTransactions.length} color="warning" max={999}>
                                <span>⚠️ Review Needed</span>
                            </Badge>
                        }
                    />
                </Tabs>
            </Paper>

            {/* Bulk Actions Bar */}
            {selectedTxIds.size > 0 && (
                <Paper sx={{ p: 1.5, mb: 2, display: 'flex', gap: 2, alignItems: 'center', bgcolor: '#e3f2fd', borderLeft: '4px solid #1976d2' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        ✅ {selectedTxIds.size} selected
                    </Typography>
                    <FormControl size="small" sx={{ minWidth: 180 }}>
                        <Select value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value as TaxCategory)}>
                            {DROPDOWN_CATEGORIES.map(cat => (
                                <MenuItem key={cat} value={cat}>{CATEGORY_LABELS[cat]}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <Button variant="contained" size="small" onClick={applyBulkCategory}>Apply Category</Button>
                    <Button variant="outlined" size="small" color="secondary" onClick={bulkMarkPrivate}>🔒 Mark Private</Button>
                    <Button variant="text" size="small" onClick={() => setSelectedTxIds(new Set())}>✕ Clear</Button>
                </Paper>
            )}

            {/* Transactions Table */}
            <TableContainer component={Paper}>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell padding="checkbox">
                                <Checkbox
                                    checked={selectedTxIds.size === searchFilteredTransactions.length && searchFilteredTransactions.length > 0}
                                    indeterminate={selectedTxIds.size > 0 && selectedTxIds.size < searchFilteredTransactions.length}
                                    onChange={toggleSelectAll}
                                />
                            </TableCell>
                            <TableCell>Date</TableCell>
                            <TableCell>Vendor</TableCell>
                            <TableCell>Category</TableCell>
                            <TableCell align="center">Tax %</TableCell>
                            <TableCell align="right">Amount</TableCell>
                            <TableCell>Actions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={8} align="center">
                                    <CircularProgress size={24} />
                                </TableCell>
                            </TableRow>
                        ) : searchFilteredTransactions.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={8} align="center">
                                    {activeTab === 'review'
                                        ? 'No transactions need review! 🎉'
                                        : 'No transactions. Upload a bank statement to get started.'}
                                </TableCell>
                            </TableRow>
                        ) : (
                            searchFilteredTransactions.map((tx) => (
                                <TableRow
                                    key={tx.id}
                                    hover
                                    selected={selectedTxIds.has(tx.id)}
                                    sx={{
                                        ...(tx.isRefund ? { bgcolor: '#FFF9C4' } : {}),
                                        ...(tx.parentId ? { borderLeft: '3px solid #90CAF9' } : {}),
                                    }}
                                >
                                    <TableCell padding="checkbox">
                                        <Checkbox
                                            checked={selectedTxIds.has(tx.id)}
                                            onChange={() => toggleTxSelection(tx.id)}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        {new Date(tx.date.seconds * 1000).toLocaleDateString()}
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant="body2" fontWeight={500}>
                                            {tx.isRefund && '🔄 '}{recurringVendors.has(tx.vendor.toUpperCase().trim()) && <Chip icon={<RepeatIcon />} label="recurring" size="small" variant="outlined" color="primary" sx={{ ml: 0.5, height: 18, fontSize: '0.6rem' }} />}{' '}{tx.vendor}
                                            {tx.parentId && <Chip label="split" size="small" sx={{ ml: 0.5, height: 18, fontSize: '0.65rem' }} />}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {tx.rawDescription}
                                        </Typography>
                                        {AMBIGUOUS_VENDORS.some(v => tx.vendor.toUpperCase().includes(v)) && (
                                            <Chip label="⚠️ Review" size="small" color="warning" variant="outlined" sx={{ ml: 0.5, height: 18, fontSize: '0.6rem' }} />
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Tooltip title={SCHEDULE_C_MAP[tx.category] || ''} placement="right">
                                            <Select
                                                size="small"
                                                value={tx.category}
                                                onChange={(e) => updateCategory(tx.id, e.target.value as TaxCategory)}
                                                sx={{
                                                    minWidth: 120,
                                                    '& .MuiSelect-select': {
                                                        bgcolor: CATEGORY_COLORS[tx.category],
                                                        color: 'white',
                                                        borderRadius: 1,
                                                    }
                                                }}
                                            >
                                                {DROPDOWN_CATEGORIES.map(cat => (
                                                    <MenuItem key={cat} value={cat}>
                                                        {CATEGORY_LABELS[cat]}
                                                        {SCHEDULE_C_MAP[cat] && (
                                                            <Typography variant="caption" sx={{ ml: 1, color: 'text.secondary', fontSize: '0.6rem' }}>
                                                                {SCHEDULE_C_MAP[cat]}
                                                            </Typography>
                                                        )}
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                        </Tooltip>
                                    </TableCell>
                                    <TableCell align="center">
                                        <Select
                                            size="small"
                                            value={tx.deductibilityPercent ?? (DEFAULT_DEDUCTIBILITY[tx.category] ?? 100)}
                                            onChange={(e) => updateDeductibility(tx.id, Number(e.target.value))}
                                            sx={{ minWidth: 70, fontSize: '0.8rem' }}
                                        >
                                            <MenuItem value={0}>0%</MenuItem>
                                            <MenuItem value={25}>25%</MenuItem>
                                            <MenuItem value={50}>50%</MenuItem>
                                            <MenuItem value={75}>75%</MenuItem>
                                            <MenuItem value={100}>100%</MenuItem>
                                        </Select>
                                    </TableCell>
                                    <TableCell align="right">
                                        <Typography
                                            variant="body2"
                                            sx={{
                                                color: tx.isRefund ? '#E65100' : tx.amount < 0 ? 'error.main' : 'success.main',
                                                fontWeight: tx.isRefund ? 700 : 400,
                                            }}
                                        >
                                            {tx.isRefund && '↩ '}${Math.abs(tx.amount).toFixed(2)}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>
                                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                                            <Tooltip title="Edit notes">
                                                <IconButton size="small" onClick={() => setEditingTx(tx)}>
                                                    <EditIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                            <Tooltip title="Split transaction">
                                                <IconButton size="small" onClick={() => {
                                                    setSplitTx(tx);
                                                    setSplitParts([
                                                        { amount: (Math.abs(tx.amount) / 2).toFixed(2), category: tx.category },
                                                        { amount: (Math.abs(tx.amount) / 2).toFixed(2), category: 'private' },
                                                    ]);
                                                }}>
                                                    <SplitIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                            <Tooltip title={tx.receiptUrl ? 'View receipt' : 'Attach receipt'}>
                                                <IconButton
                                                    size="small"
                                                    color={tx.receiptUrl ? 'success' : 'default'}
                                                    onClick={() => {
                                                        if (tx.receiptUrl) {
                                                            setReceiptViewer({ open: true, url: tx.receiptUrl, vendor: tx.vendor });
                                                        } else {
                                                            if (receiptInputRef.current) {
                                                                receiptInputRef.current.dataset.txid = tx.id;
                                                                receiptInputRef.current.click();
                                                            }
                                                        }
                                                    }}
                                                >
                                                    {uploadingReceipt === tx.id ? <CircularProgress size={16} /> : tx.receiptUrl ? <ReceiptIcon fontSize="small" /> : <AttachIcon fontSize="small" />}
                                                </IconButton>
                                            </Tooltip>
                                        </Box>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </TableContainer>

            {/* Edit Dialog */}
            <Dialog open={!!editingTx} onClose={() => setEditingTx(null)} maxWidth="sm" fullWidth>
                <DialogTitle>Edit Transaction</DialogTitle>
                <DialogContent>
                    {editingTx && (
                        <Box sx={{ pt: 2 }}>
                            <Typography variant="subtitle2" gutterBottom>
                                {editingTx.vendor} — ${Math.abs(editingTx.amount).toFixed(2)}
                            </Typography>
                            <TextField
                                fullWidth
                                multiline
                                rows={3}
                                label="Notes"
                                defaultValue={editingTx.notes || ''}
                                onChange={(e) => setEditingTx({ ...editingTx, notes: e.target.value })}
                            />
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setEditingTx(null)}>Cancel</Button>
                    <Button
                        variant="contained"
                        onClick={async () => {
                            if (editingTx) {
                                await updateDoc(doc(db, 'bank_transactions', editingTx.id), {
                                    notes: editingTx.notes,
                                });
                                loadTransactions();
                                setEditingTx(null);
                            }
                        }}
                    >
                        Save
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Rules Dialog */}
            <Dialog open={showRulesDialog} onClose={() => setShowRulesDialog(false)} maxWidth="sm" fullWidth>
                <DialogTitle>🔧 Vendor Rules</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Auto-categorize transactions by vendor name
                    </Typography>

                    {/* Add new rule */}
                    <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
                        <TextField
                            size="small"
                            label="Vendor pattern"
                            value={newRulePattern}
                            onChange={(e) => setNewRulePattern(e.target.value)}
                            placeholder="e.g., Home Depot"
                            sx={{ flex: 1 }}
                        />
                        <FormControl size="small" sx={{ minWidth: 120 }}>
                            <Select
                                value={newRuleCategory}
                                onChange={(e) => setNewRuleCategory(e.target.value as TaxCategory)}
                            >
                                {Object.entries(CATEGORY_LABELS).map(([cat, label]) => (
                                    <MenuItem key={cat} value={cat}>{label}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <Button
                            variant="contained"
                            onClick={addVendorRule}
                            disabled={!newRulePattern.trim()}
                        >
                            Add
                        </Button>
                    </Stack>

                    {/* Existing rules */}
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>Active Rules ({vendorRules.length})</Typography>
                    <Stack spacing={1}>
                        {vendorRules.map(rule => (
                            <Chip
                                key={rule.id}
                                label={`"${rule.pattern}" → ${CATEGORY_LABELS[rule.category]}`}
                                onDelete={() => deleteVendorRule(rule.id)}
                                variant="outlined"
                                sx={{ justifyContent: 'space-between' }}
                            />
                        ))}
                        {vendorRules.length === 0 && (
                            <Typography variant="body2" color="text.secondary">
                                No rules yet. Add one above!
                            </Typography>
                        )}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowRulesDialog(false)}>Close</Button>
                </DialogActions>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <Dialog open={deleteConfirm.show} onClose={() => setDeleteConfirm({ show: false, statementId: null, fileName: '' })} maxWidth="sm">
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    🗑️ Удалить файл?
                </DialogTitle>
                <DialogContent>
                    <Alert severity="warning" sx={{ mb: 2 }}>
                        Файл <strong>{deleteConfirm.fileName}</strong> и все его транзакции будут удалены безвозвратно.
                    </Alert>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteConfirm({ show: false, statementId: null, fileName: '' })} color="inherit">
                        Отмена
                    </Button>
                    <Button
                        onClick={executeDeleteStatement}
                        variant="contained"
                        color="error"
                    >
                        🗑️ Удалить
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Period Confirmation Dialog */}
            <Dialog open={showPeriodConfirm} onClose={() => setShowPeriodConfirm(false)} maxWidth="sm" fullWidth>
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    📅 Период выписки не совпадает
                </DialogTitle>
                <DialogContent>
                    {pendingUpload && (
                        <Box sx={{ pt: 1 }}>
                            <Alert severity="warning" sx={{ mb: 2 }}>
                                Загруженная выписка за <strong>{MONTH_NAMES[pendingUpload.detectedMonth - 1]} {pendingUpload.detectedYear}</strong>,
                                но в фильтре выбран <strong>{selectedMonth === 'all' ? 'Все месяцы' : MONTH_NAMES[(selectedMonth as number) - 1]} {selectedYear}</strong>.
                            </Alert>
                            <Typography variant="body1" sx={{ mb: 2 }}>
                                Выписка содержит <strong>{pendingUpload.totalNew}</strong> новых транзакций
                                {pendingUpload.totalDuplicates > 0 && <>, <strong>{pendingUpload.totalDuplicates}</strong> дубликатов пропущено</>}.
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                Отправить выписку в правильный период?
                            </Typography>
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowPeriodConfirm(false)} color="inherit">
                        Отмена
                    </Button>
                    <Button
                        onClick={handlePeriodConfirm}
                        variant="contained"
                        color="primary"
                    >
                        ✅ Отправить в {pendingUpload ? `${MONTH_NAMES[pendingUpload.detectedMonth - 1]} ${pendingUpload.detectedYear}` : ''}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Final Report Confirmation Dialog */}
            <Dialog open={showFinalReportConfirm} onClose={() => setShowFinalReportConfirm(false)} maxWidth="sm" fullWidth>
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    ✅ Подтверждение итогового отчёта
                </DialogTitle>
                <DialogContent>
                    <Box sx={{ pt: 1 }}>
                        <Alert severity="info" sx={{ mb: 2 }}>
                            Период: <strong>{selectedMonth === 'all' ? 'Все месяцы' : MONTH_NAMES[(selectedMonth as number) - 1]} {selectedYear}</strong>
                        </Alert>
                        <Typography variant="body1" sx={{ mb: 2 }}>
                            Транзакций: <strong>{monthFilteredTransactions.filter(tx => tx.category !== 'private').length}</strong>
                        </Typography>
                        <Typography variant="body1" sx={{ mb: 2, color: 'warning.main' }}>
                            Некатегоризованных: <strong>{monthFilteredTransactions.filter(tx => tx.category === 'uncategorized').length}</strong>
                        </Typography>
                        <Typography variant="h6" sx={{ mt: 2 }}>
                            Вы проверили все позиции?
                        </Typography>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowFinalReportConfirm(false)} color="inherit">
                        Вернуться к проверке
                    </Button>
                    <Button
                        onClick={() => {
                            setShowFinalReportConfirm(false);
                            exportCategorySummaryCSV();
                        }}
                        variant="contained"
                        color="success"
                        disabled={monthFilteredTransactions.filter(tx => tx.category === 'uncategorized').length > 0}
                    >
                        📋 Да, сформировать итоговый отчёт
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Auto Report Dialog - Accountant Format */}
            <Dialog open={showReport} onClose={() => setShowReport(false)} maxWidth="md" fullWidth>
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, bgcolor: '#f5f5f5' }}>
                    📊 Бухгалтерский отчёт за период
                </DialogTitle>
                <DialogContent>
                    {reportData && (
                        <Box sx={{ pt: 2 }}>
                            {/* Company Header */}
                            <Box sx={{ mb: 3, p: 2, bgcolor: '#f8f9fa', borderRadius: 1 }}>
                                <Typography variant="h6" sx={{ fontWeight: 700 }}>Company: Garkor Corp</Typography>
                                <Typography variant="body2" color="text.secondary">Account: Chase Business Complete Checking</Typography>
                                <Typography variant="body2" color="text.secondary">
                                    Period: {MONTH_NAMES[typeof selectedMonth === 'number' ? selectedMonth - 1 : new Date().getMonth()]} {selectedYear}
                                </Typography>
                            </Box>

                            {/* Check for uncategorized */}
                            {(reportData.categories['uncategorized'] || 0) > 0 && (
                                <Alert severity="warning" sx={{ mb: 2 }}>
                                    ⚠️ Заполните uncategorized транзакции перед формированием отчёта!
                                </Alert>
                            )}

                            {/* INCOME Section */}
                            <Box sx={{ mb: 3 }}>
                                <Typography variant="h6" sx={{ color: '#2E7D32', fontWeight: 700, mb: 1 }}>
                                    🟢 INCOME (Business only)
                                </Typography>
                                <Paper sx={{ p: 2, bgcolor: '#E8F5E9' }}>
                                    <Typography variant="h4" sx={{ fontWeight: 700, color: '#2E7D32' }}>
                                        Total Income: ${reportData.income.toFixed(2)}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        (Все поступления из блока Deposits & Additions учтены как бизнес-доход)
                                    </Typography>
                                </Paper>
                            </Box>

                            {/* EXPENSES Section */}
                            <Box sx={{ mb: 3 }}>
                                <Typography variant="h6" sx={{ color: '#C62828', fontWeight: 700, mb: 1 }}>
                                    🔴 EXPENSES
                                </Typography>
                                <Stack spacing={1}>
                                    {/* Office Rent */}
                                    {(reportData.categories['office_rent'] || 0) > 0 && (
                                        <Paper sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography>🏢 Office Rent</Typography>
                                            <Typography sx={{ fontWeight: 600 }}>${(reportData.categories['office_rent'] || 0).toFixed(2)}</Typography>
                                        </Paper>
                                    )}
                                    {/* Apps for Work */}
                                    {(reportData.categories['apps_work'] || 0) > 0 && (
                                        <Paper sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography>💻 Apps for Work</Typography>
                                            <Typography sx={{ fontWeight: 600 }}>${(reportData.categories['apps_work'] || 0).toFixed(2)}</Typography>
                                        </Paper>
                                    )}
                                    {/* Advertising */}
                                    {(reportData.categories['advertising'] || 0) > 0 && (
                                        <Paper sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography>📢 Advertising</Typography>
                                            <Typography sx={{ fontWeight: 600 }}>${(reportData.categories['advertising'] || 0).toFixed(2)}</Typography>
                                        </Paper>
                                    )}
                                    {/* Tools & Materials */}
                                    {(reportData.categories['materials'] || 0) > 0 && (
                                        <Paper sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography>🧰 Tools & Materials</Typography>
                                            <Typography sx={{ fontWeight: 600 }}>${(reportData.categories['materials'] || 0).toFixed(2)}</Typography>
                                        </Paper>
                                    )}
                                    {/* Car Repair */}
                                    {(reportData.categories['car_repair'] || 0) > 0 && (
                                        <Paper sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography>🚗 Car Repair</Typography>
                                            <Typography sx={{ fontWeight: 600 }}>${(reportData.categories['car_repair'] || 0).toFixed(2)}</Typography>
                                        </Paper>
                                    )}
                                    {/* Bank Fees */}
                                    {(reportData.categories['fees'] || 0) > 0 && (
                                        <Paper sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography>🏦 Bank Fees</Typography>
                                            <Typography sx={{ fontWeight: 600 }}>${(reportData.categories['fees'] || 0).toFixed(2)}</Typography>
                                        </Paper>
                                    )}
                                    {/* Subcontractors */}
                                    {(reportData.categories['subcontractor'] || 0) > 0 && (
                                        <Paper sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between', bgcolor: '#FFF3E0' }}>
                                            <Typography>👷 Subcontractors / Contractors (1099)</Typography>
                                            <Typography sx={{ fontWeight: 600 }}>${(reportData.categories['subcontractor'] || 0).toFixed(2)}</Typography>
                                        </Paper>
                                    )}
                                </Stack>
                            </Box>

                            {/* INTERNAL TRANSFERS Section */}
                            <Box sx={{ mb: 3 }}>
                                <Typography variant="h6" sx={{ color: '#1565C0', fontWeight: 700, mb: 1 }}>
                                    🔁 INTERNAL TRANSFERS (Not Tax Deductible)
                                </Typography>
                                <Paper sx={{ p: 2, bgcolor: '#E3F2FD' }}>
                                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                                        (Не являются расходом, т.к. это переводы на кредитные карты и PayPal)
                                    </Typography>
                                    <Typography variant="h5" sx={{ fontWeight: 600, color: '#1565C0' }}>
                                        Business credit card payments + PayPal transfers — ${reportData.transfers.toFixed(2)}
                                    </Typography>
                                </Paper>
                            </Box>

                            {/* TOTALS FOR ACCOUNTANT */}
                            <Paper sx={{ p: 2, bgcolor: '#424242', color: 'white' }}>
                                <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
                                    ✅ TOTALS FOR ACCOUNTANT
                                </Typography>
                                <Stack spacing={1}>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <Typography>Income:</Typography>
                                        <Typography sx={{ fontWeight: 700, color: '#81C784' }}>${reportData.income.toFixed(2)}</Typography>
                                    </Box>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <Typography>Total Business Expenses (excluding Internal Transfers):</Typography>
                                        <Typography sx={{ fontWeight: 700, color: '#EF5350' }}>${reportData.expenses.toFixed(2)}</Typography>
                                    </Box>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <Typography>Internal Transfers (Not Deductible):</Typography>
                                        <Typography sx={{ fontWeight: 700, color: '#64B5F6' }}>${reportData.transfers.toFixed(2)}</Typography>
                                    </Box>
                                </Stack>
                            </Paper>

                            {/* Completion message */}
                            {(reportData.categories['uncategorized'] || 0) === 0 && (
                                <Alert severity="success" sx={{ mt: 2 }}>
                                    ✅ Бухгалтерский отчет за период сформирован!
                                </Alert>
                            )}
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowReport(false)}>Закрыть</Button>
                    <Button
                        variant="outlined"
                        color="primary"
                        onClick={() => { exportCategorySummaryCSV(); }}
                        startIcon={<span>📊</span>}
                    >
                        CSV Summary
                    </Button>
                    <Button
                        variant="outlined"
                        color="secondary"
                        onClick={() => { exportDetailedCSV(); }}
                        startIcon={<span>📋</span>}
                    >
                        CSV Detailed
                    </Button>
                    <Button variant="contained" color="primary" onClick={() => { setShowReport(false); exportPDF(); }}>
                        Экспорт PDF
                    </Button>
                </DialogActions>
            </Dialog>

            {/* AI Categorization Preview Dialog */}
            <Dialog
                open={showAiPreview}
                onClose={() => !aiApplying && setShowAiPreview(false)}
                maxWidth="lg"
                fullWidth
                PaperProps={{ sx: { maxHeight: '90vh' } }}
            >
                <DialogTitle sx={{ pb: 1 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="h6" sx={{ fontWeight: 700 }}>
                            🤖 AI Категоризация — Предпросмотр
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                            <Chip
                                label={`🟢 ${aiSuggestions.filter(s => s.confidence >= 0.9).length}`}
                                color="success"
                                size="small"
                                variant="outlined"
                            />
                            <Chip
                                label={`🟡 ${aiSuggestions.filter(s => s.confidence >= 0.7 && s.confidence < 0.9).length}`}
                                color="warning"
                                size="small"
                                variant="outlined"
                            />
                            <Chip
                                label={`🔴 ${aiSuggestions.filter(s => s.confidence < 0.7).length}`}
                                color="error"
                                size="small"
                                variant="outlined"
                            />
                        </Box>
                    </Box>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        Выбрано {selectedSuggestions.size} из {aiSuggestions.length} предложений.
                        Зелёные (High) предвыбраны автоматически.
                    </Typography>
                    {aiApplying && <LinearProgress color="secondary" sx={{ mt: 1 }} />}
                </DialogTitle>
                <DialogContent dividers>
                    <TableContainer>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell padding="checkbox">
                                        <Checkbox
                                            checked={selectedSuggestions.size === aiSuggestions.length}
                                            indeterminate={selectedSuggestions.size > 0 && selectedSuggestions.size < aiSuggestions.length}
                                            onChange={toggleAllSuggestions}
                                        />
                                    </TableCell>
                                    <TableCell>Vendor</TableCell>
                                    <TableCell>Description</TableCell>
                                    <TableCell align="right">Amount</TableCell>
                                    <TableCell>→ AI Suggestion</TableCell>
                                    <TableCell>Confidence</TableCell>
                                    <TableCell>Reasoning</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {aiSuggestions
                                    .sort((a, b) => b.confidence - a.confidence)
                                    .map((suggestion) => (
                                        <TableRow
                                            key={suggestion.txId}
                                            hover
                                            sx={{
                                                bgcolor: selectedSuggestions.has(suggestion.txId)
                                                    ? suggestion.confidence >= 0.9 ? '#E8F5E9'
                                                        : suggestion.confidence >= 0.7 ? '#FFF8E1'
                                                            : '#FFEBEE'
                                                    : undefined,
                                                opacity: selectedSuggestions.has(suggestion.txId) ? 1 : 0.6,
                                            }}
                                        >
                                            <TableCell padding="checkbox">
                                                <Checkbox
                                                    checked={selectedSuggestions.has(suggestion.txId)}
                                                    onChange={() => toggleSuggestion(suggestion.txId)}
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <Typography variant="body2" fontWeight={500}>
                                                    {suggestion.vendor}
                                                </Typography>
                                            </TableCell>
                                            <TableCell>
                                                <Typography variant="caption" color="text.secondary" sx={{
                                                    maxWidth: 200,
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                    display: 'block'
                                                }}>
                                                    {suggestion.description}
                                                </Typography>
                                            </TableCell>
                                            <TableCell align="right">
                                                <Typography variant="body2" sx={{
                                                    color: suggestion.amount < 0 ? 'error.main' : 'success.main',
                                                    fontWeight: 500
                                                }}>
                                                    ${Math.abs(suggestion.amount).toFixed(2)}
                                                </Typography>
                                            </TableCell>
                                            <TableCell>
                                                <Chip
                                                    label={CATEGORY_LABELS[suggestion.suggestedCategory] || suggestion.suggestedCategory}
                                                    size="small"
                                                    sx={{
                                                        bgcolor: CATEGORY_COLORS[suggestion.suggestedCategory],
                                                        color: 'white',
                                                        fontWeight: 500,
                                                        maxWidth: 200,
                                                    }}
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <Chip
                                                    label={`${(suggestion.confidence * 100).toFixed(0)}%`}
                                                    size="small"
                                                    color={getConfidenceColor(suggestion.confidence)}
                                                    variant="outlined"
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <Typography variant="caption" color="text.secondary" sx={{
                                                    maxWidth: 180,
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                    display: 'block'
                                                }}>
                                                    {suggestion.reasoning}
                                                </Typography>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </DialogContent>
                <DialogActions sx={{ px: 3, py: 2, justifyContent: 'space-between' }}>
                    <Button
                        onClick={() => setShowAiPreview(false)}
                        disabled={aiApplying}
                    >
                        Отмена
                    </Button>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <Button
                            variant="outlined"
                            color="primary"
                            onClick={toggleAllSuggestions}
                        >
                            {selectedSuggestions.size === aiSuggestions.length ? 'Снять все' : '✅ Выбрать все'}
                        </Button>
                        <Button
                            variant="contained"
                            color="success"
                            onClick={applyAiSuggestions}
                            disabled={selectedSuggestions.size === 0 || aiApplying}
                            startIcon={aiApplying ? <CircularProgress size={18} color="inherit" /> : <span>✅</span>}
                        >
                            {aiApplying
                                ? 'Применяю...'
                                : `Принять выбранные (${selectedSuggestions.size})`}
                        </Button>
                    </Box>
                </DialogActions>
            </Dialog>

            {/* Split Transaction Dialog */}
            <Dialog open={!!splitTx} onClose={() => setSplitTx(null)} maxWidth="sm" fullWidth>
                <DialogTitle>✂️ Split Transaction</DialogTitle>
                <DialogContent>
                    {splitTx && (
                        <Box>
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                {splitTx.vendor} — ${Math.abs(splitTx.amount).toFixed(2)}
                            </Typography>
                            {splitParts.map((part, i) => (
                                <Box key={i} sx={{ display: 'flex', gap: 1, mb: 1.5, alignItems: 'center' }}>
                                    <TextField
                                        label={`Part ${i + 1}`}
                                        type="number"
                                        size="small"
                                        value={part.amount}
                                        onChange={(e) => {
                                            const updated = [...splitParts];
                                            updated[i] = { ...updated[i], amount: e.target.value };
                                            setSplitParts(updated);
                                        }}
                                        sx={{ width: 120 }}
                                        InputProps={{ startAdornment: <Typography sx={{ mr: 0.5 }}>$</Typography> }}
                                    />
                                    <Select
                                        size="small"
                                        value={part.category}
                                        onChange={(e) => {
                                            const updated = [...splitParts];
                                            updated[i] = { ...updated[i], category: e.target.value as TaxCategory };
                                            setSplitParts(updated);
                                        }}
                                        sx={{ flex: 1 }}
                                    >
                                        {DROPDOWN_CATEGORIES.map(cat => (
                                            <MenuItem key={cat} value={cat}>{CATEGORY_LABELS[cat]}</MenuItem>
                                        ))}
                                    </Select>
                                    {splitParts.length > 2 && (
                                        <IconButton size="small" onClick={() => setSplitParts(splitParts.filter((_, j) => j !== i))}>
                                            <DeleteIcon fontSize="small" />
                                        </IconButton>
                                    )}
                                </Box>
                            ))}
                            <Button
                                size="small"
                                variant="text"
                                onClick={() => setSplitParts([...splitParts, { amount: '', category: 'business_expense' }])}
                            >
                                + Add Part
                            </Button>
                            {splitTx && (
                                <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                                    Sum: ${splitParts.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0).toFixed(2)} / ${Math.abs(splitTx.amount).toFixed(2)}
                                    {Math.abs(splitParts.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0) - Math.abs(splitTx.amount)) > 0.01 && (
                                        <span style={{ color: 'red', marginLeft: 8 }}>⚠ Mismatch</span>
                                    )}
                                </Typography>
                            )}
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setSplitTx(null)}>Cancel</Button>
                    <Button variant="contained" onClick={executeSplit}>Split</Button>
                </DialogActions>
            </Dialog>

            {/* Receipt Viewer Dialog */}
            <Dialog open={receiptViewer.open} onClose={() => setReceiptViewer({ open: false, url: '', vendor: '' })} maxWidth="md" fullWidth>
                <DialogTitle>🧾 Receipt — {receiptViewer.vendor}</DialogTitle>
                <DialogContent>
                    {receiptViewer.url && (
                        receiptViewer.url.toLowerCase().includes('.pdf') ? (
                            <Box sx={{ textAlign: 'center', py: 3 }}>
                                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>PDF receipt attached</Typography>
                                <Button variant="contained" href={receiptViewer.url} target="_blank" rel="noopener">Open PDF</Button>
                            </Box>
                        ) : (
                            <Box sx={{ textAlign: 'center' }}>
                                <img src={receiptViewer.url} alt="Receipt" style={{ maxWidth: '100%', maxHeight: '70vh', borderRadius: 8 }} />
                            </Box>
                        )
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setReceiptViewer({ open: false, url: '', vendor: '' })}>Close</Button>
                    <Button href={receiptViewer.url} target="_blank" rel="noopener">Open in New Tab</Button>
                </DialogActions>
            </Dialog>
            <Snackbar
                open={notification.open}
                autoHideDuration={6000}
                onClose={() => setNotification({ ...notification, open: false })}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <Alert
                    onClose={() => setNotification({ ...notification, open: false })}
                    severity={notification.severity}
                    sx={{ width: '100%' }}
                >
                    {notification.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default BankStatementsPage;
