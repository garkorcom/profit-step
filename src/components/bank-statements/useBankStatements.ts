/**
 * @fileoverview Custom hook encapsulating all bank statements state,
 * data loading, mutations, and computed values.
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
    collection, query, where, orderBy, getDocs,
    updateDoc, doc, deleteDoc, writeBatch, addDoc, serverTimestamp,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db, storage } from '../../firebase/firebase';
import {
    BankTransaction,
    BankStatement,
    VendorRule,
    AISuggestion,
    TaxCategory,
    InlineReportData,
    ReportData,
    NotificationState,
    INCOME_CATEGORIES,
    SUBCONTRACT_CATEGORIES,
    TRANSFER_CATEGORIES,
    DEFAULT_DEDUCTIBILITY,
    CATEGORY_LABELS,
    CATEGORY_COLORS,
    MONTH_NAMES,
    AMBIGUOUS_VENDORS,
} from './bankStatements.types';
import { errorMessage } from '../../utils/errorMessage';

export function useBankStatements() {
    // ─── Core State ──────────────────────────────────────────
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

    // Drag & drop
    const [isDragOver, setIsDragOver] = useState(false);

    // Bulk selection
    const [selectedTxIds, setSelectedTxIds] = useState<Set<string>>(new Set());
    const [bulkCategory, setBulkCategory] = useState<TaxCategory>('business_expense');

    // Split transaction
    const [splitTx, setSplitTx] = useState<BankTransaction | null>(null);
    const [splitParts, setSplitParts] = useState<Array<{ amount: string; category: TaxCategory }>>([
        { amount: '', category: 'business_expense' },
        { amount: '', category: 'private' },
    ]);

    // Chart
    const [showChart, setShowChart] = useState(true);

    // Vendor search
    const [vendorSearch, setVendorSearch] = useState('');

    // Receipt viewer
    const [receiptViewer, setReceiptViewer] = useState<{ open: boolean; url: string; vendor: string }>({ open: false, url: '', vendor: '' });
    const receiptInputRef = useRef<HTMLInputElement>(null);
    const [uploadingReceipt, setUploadingReceipt] = useState<string | null>(null);

    // Auto-rule suggestion
    const [ruleSuggestion, setRuleSuggestion] = useState<{ vendor: string; category: TaxCategory; count: number } | null>(null);

    // Notification
    const [notification, setNotification] = useState<NotificationState>({
        open: false, message: '', severity: 'success',
    });

    // Report dialog
    const [showReport, setShowReport] = useState(false);
    const [reportData, setReportData] = useState<ReportData | null>(null);

    // Period confirmation
    const [showPeriodConfirm, setShowPeriodConfirm] = useState(false);
    const [pendingUpload, setPendingUpload] = useState<{
        detectedYear: number;
        detectedMonth: number;
        totalNew: number;
        totalDuplicates: number;
    } | null>(null);

    // Final report confirmation
    const [showFinalReportConfirm, setShowFinalReportConfirm] = useState(false);

    // Inline report preview
    const [showInlineReport, setShowInlineReport] = useState(false);
    const [inlineReportData, setInlineReportData] = useState<InlineReportData | null>(null);

    // AI categorization
    const [aiSuggestions, setAiSuggestions] = useState<AISuggestion[]>([]);
    const [showAiPreview, setShowAiPreview] = useState(false);
    const [aiLoading, setAiLoading] = useState(false);
    const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());
    const [aiApplying, setAiApplying] = useState(false);

    // Delete confirmation
    const [deleteConfirm, setDeleteConfirm] = useState<{ show: boolean; statementId: string | null; fileName: string }>({
        show: false, statementId: null, fileName: '',
    });

    // ─── Data Loading ────────────────────────────────────────

    useEffect(() => {
        loadTransactions();
        loadStatements();
        loadVendorRules();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedYear]);

    const loadTransactions = async () => {
        setLoading(true);
        try {
            const q = query(collection(db, 'bank_transactions'), orderBy('date', 'desc'));
            const snapshot = await getDocs(q);
            const txs = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as BankTransaction[];
            setTransactions(txs);
        } catch (error) {
            console.error('Error loading transactions:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadStatements = async () => {
        try {
            const q = query(collection(db, 'bank_statements'), orderBy('uploadedAt', 'desc'));
            const snapshot = await getDocs(q);
            const stmts = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as BankStatement[];
            setStatements(stmts);
        } catch (error) {
            console.error('Error loading statements:', error);
        }
    };

    const loadVendorRules = async () => {
        try {
            const snapshot = await getDocs(collection(db, 'vendor_rules'));
            const rules = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as VendorRule[];
            setVendorRules(rules);
        } catch (error) {
            console.error('Error loading vendor rules:', error);
        }
    };

    // ─── Vendor Rules ────────────────────────────────────────

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

    const deleteVendorRule = async (ruleId: string) => {
        try {
            await deleteDoc(doc(db, 'vendor_rules', ruleId));
            loadVendorRules();
        } catch (error) {
            console.error('Error deleting rule:', error);
        }
    };

    // ─── Statement Deletion ──────────────────────────────────

    const confirmDeleteStatement = (statementId: string, fileName: string) => {
        setDeleteConfirm({ show: true, statementId, fileName });
    };

    const executeDeleteStatement = async () => {
        if (!deleteConfirm.statementId) return;
        const statementId = deleteConfirm.statementId;
        setDeleteConfirm({ show: false, statementId: null, fileName: '' });

        try {
            const txQuery = query(collection(db, 'bank_transactions'), where('statementId', '==', statementId));
            const txSnapshot = await getDocs(txQuery);
            const batch = writeBatch(db);
            txSnapshot.docs.forEach(txDoc => batch.delete(txDoc.ref));
            batch.delete(doc(db, 'bank_statements', statementId));
            await batch.commit();

            setNotification({ open: true, message: `✅ Файл и ${txSnapshot.docs.length} транзакций удалены`, severity: 'success' });
            loadTransactions();
            loadStatements();
        } catch (error) {
            console.error('Error deleting statement:', error);
            setNotification({ open: true, message: '❌ Ошибка при удалении файла', severity: 'error' });
        }
    };

    const clearAll = async () => {
        if (!window.confirm(`Delete ALL transactions and files for ${selectedYear}?`)) return;

        try {
            setLoading(true);
            const txQuery = query(collection(db, 'bank_transactions'), where('year', '==', selectedYear));
            const txSnapshot = await getDocs(txQuery);
            const batch1 = writeBatch(db);
            txSnapshot.docs.forEach(txDoc => batch1.delete(txDoc.ref));
            await batch1.commit();

            const stQuery = query(collection(db, 'bank_statements'), where('year', '==', selectedYear));
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

    // ─── File Upload ─────────────────────────────────────────

    const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        setUploading(true);
        let totalNew = 0;
        let totalDuplicates = 0;
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
                    error?: string;
                };

                if (data.success) {
                    totalNew += data.transactionCount || 0;
                    totalDuplicates += data.duplicateCount || 0;
                    if (data.detectedYear && data.detectedMonth) {
                        detectedPeriod = { year: data.detectedYear, month: data.detectedMonth };
                    }
                }
            } catch (error) {
                console.error('Upload error:', file.name, error);
            }
        }

        setUploading(false);

        // Auto-redirect on period mismatch
        if (detectedPeriod) {
            const periodMismatch = detectedPeriod.year !== selectedYear ||
                (selectedMonth !== 'all' && detectedPeriod.month !== selectedMonth);

            if (periodMismatch) {
                setSelectedYear(detectedPeriod.year);
                setSelectedMonth(detectedPeriod.month);
                setNotification({
                    open: true,
                    message: `✅ Выписка за ${MONTH_NAMES[detectedPeriod.month - 1]} ${detectedPeriod.year} загружена! ${totalNew} новых транзакций${totalDuplicates > 0 ? `, ${totalDuplicates} дубликатов пропущено` : ''}. Фильтр переключён автоматически.`,
                    severity: 'success',
                });
                await loadTransactions();
                await loadStatements();
                if (fileInputRef.current) fileInputRef.current.value = '';
                return;
            }
        }

        await loadTransactions();
        await loadStatements();

        if (totalNew > 0 || totalDuplicates > 0) {
            const periodInfo = detectedPeriod
                ? ` за ${MONTH_NAMES[detectedPeriod.month - 1]} ${detectedPeriod.year}`
                : '';
            setNotification({
                open: true,
                message: `✅ Выписка${periodInfo} загружена! ${totalNew} новых транзакций${totalDuplicates > 0 ? `, ${totalDuplicates} дубликатов пропущено` : ''}`,
                severity: 'success',
            });

            // Generate report data after reload
            setTimeout(() => {
                const q = query(
                    collection(db, 'bank_transactions'),
                    where('date', '>=', new Date(selectedYear, 0, 1)),
                    orderBy('date', 'desc')
                );
                getDocs(q).then(snapshot => {
                    const txList = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as BankTransaction[];
                    const filtered = detectedPeriod
                        ? txList.filter(tx => {
                            const txDate = new Date(tx.date.seconds * 1000);
                            return txDate.getMonth() + 1 === detectedPeriod!.month && txDate.getFullYear() === detectedPeriod!.year;
                        })
                        : txList;

                    let income = 0;
                    let expenses = 0;
                    let transfers = 0;
                    const categories: Record<string, number> = {};

                    filtered.forEach(tx => {
                        const amount = Math.abs(tx.amount);
                        categories[tx.category] = (categories[tx.category] || 0) + amount;
                        if (INCOME_CATEGORIES.has(tx.category)) income += amount;
                        else if (TRANSFER_CATEGORIES.includes(tx.category)) transfers += amount;
                        else if (tx.category !== 'private') expenses += amount;
                    });

                    setReportData({
                        income, expenses, transfers, net: income - expenses,
                        categories, newCount: totalNew, duplicateCount: totalDuplicates,
                    });
                    setShowReport(true);
                });
            }, 500);
        }

        if (fileInputRef.current) fileInputRef.current.value = '';
    }, [selectedYear, selectedMonth]);

    // ─── Period Confirmation ─────────────────────────────────

    const handlePeriodConfirm = async () => {
        if (!pendingUpload) return;
        setSelectedYear(pendingUpload.detectedYear);
        setSelectedMonth(pendingUpload.detectedMonth);
        setShowPeriodConfirm(false);
        await loadTransactions();
        await loadStatements();
        setNotification({
            open: true,
            message: `✅ Выписка за ${MONTH_NAMES[pendingUpload.detectedMonth - 1]} ${pendingUpload.detectedYear} загружена! ${pendingUpload.totalNew} новых транзакций${pendingUpload.totalDuplicates > 0 ? `, ${pendingUpload.totalDuplicates} дубликатов пропущено` : ''}`,
            severity: 'success',
        });
        setPendingUpload(null);
    };

    // ─── Category Update ─────────────────────────────────────

    const updateCategory = async (txId: string, newCategory: TaxCategory) => {
        try {
            const tx = transactions.find(t => t.id === txId);
            if (!tx) return;

            await updateDoc(doc(db, 'bank_transactions', txId), {
                category: newCategory,
                isDeductible: ['materials', 'fuel', 'software', 'office', 'vehicle', 'housing'].includes(newCategory),
            });

            // Auto-learn vendor rule
            if (newCategory !== 'uncategorized' && tx.vendor) {
                const vendorKey = tx.vendor.toUpperCase().trim();
                const existingRule = vendorRules.find(r => r.pattern.toUpperCase() === vendorKey);

                if (existingRule) {
                    await updateDoc(doc(db, 'vendor_rules', existingRule.id), {
                        category: newCategory, updatedAt: new Date(),
                    });
                } else {
                    await addDoc(collection(db, 'vendor_rules'), {
                        pattern: vendorKey, category: newCategory,
                        isAutoLearned: true, createdAt: new Date(),
                    });
                }

                loadVendorRules();
                setNotification({
                    open: true,
                    message: `✅ Правило сохранено: "${tx.vendor}" → ${CATEGORY_LABELS[newCategory]}`,
                    severity: 'success',
                });
            }

            loadTransactions();
        } catch (error) {
            console.error('Error updating category:', error);
        }
    };

    // ─── AI Categorization ───────────────────────────────────

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
                const preSelected = new Set<string>(
                    data.suggestions.filter(s => s.confidence >= 0.9).map(s => s.txId)
                );
                setSelectedSuggestions(preSelected);
                setShowAiPreview(true);
            } else if (data.suggestions.length === 0) {
                setNotification({ open: true, message: '✅ Нет некатегоризованных транзакций для обработки', severity: 'info' });
            } else {
                setNotification({ open: true, message: `❌ Ошибка AI: ${data.error || 'Unknown error'}`, severity: 'error' });
            }
        } catch (error: unknown) {
            console.error('AI categorization error:', error);
            setNotification({ open: true, message: `❌ Ошибка AI категоризации: ${errorMessage(error)}`, severity: 'error' });
        } finally {
            setAiLoading(false);
        }
    };

    const applyAiSuggestions = async () => {
        const toApply = aiSuggestions.filter(s => selectedSuggestions.has(s.txId));
        if (toApply.length === 0) return;

        setAiApplying(true);
        try {
            for (const suggestion of toApply) {
                await updateDoc(doc(db, 'bank_transactions', suggestion.txId), {
                    category: suggestion.suggestedCategory,
                    isDeductible: ['materials', 'fuel', 'software', 'office_supplies', 'office_equipment'].includes(suggestion.suggestedCategory),
                });

                if (suggestion.confidence >= 0.85 && suggestion.vendor) {
                    const vendorKey = suggestion.vendor.toUpperCase().trim();
                    const existingRule = vendorRules.find(r => r.pattern.toUpperCase() === vendorKey);
                    if (!existingRule) {
                        await addDoc(collection(db, 'vendor_rules'), {
                            pattern: vendorKey, category: suggestion.suggestedCategory,
                            isAutoLearned: true, isAiGenerated: true,
                            confidence: suggestion.confidence, createdAt: new Date(),
                        });
                    }
                }
            }

            setNotification({
                open: true,
                message: `✅ Применено ${toApply.length} AI категорий! ${toApply.filter(s => s.confidence >= 0.85).length} новых правил создано.`,
                severity: 'success',
            });

            loadTransactions();
            loadVendorRules();
            setShowAiPreview(false);
            setAiSuggestions([]);
            setSelectedSuggestions(new Set());
        } catch (error: unknown) {
            console.error('Error applying AI suggestions:', error);
            setNotification({ open: true, message: `❌ Ошибка при применении: ${errorMessage(error)}`, severity: 'error' });
        } finally {
            setAiApplying(false);
        }
    };

    const toggleSuggestion = (txId: string) => {
        setSelectedSuggestions(prev => {
            const next = new Set(prev);
            if (next.has(txId)) next.delete(txId);
            else next.add(txId);
            return next;
        });
    };

    const toggleAllSuggestions = () => {
        if (selectedSuggestions.size === aiSuggestions.length) {
            setSelectedSuggestions(new Set());
        } else {
            setSelectedSuggestions(new Set(aiSuggestions.map(s => s.txId)));
        }
    };

    // ─── Inline Report Preview ───────────────────────────────

    const generateReportPreview = () => {
        const filtered = monthFilteredTransactions.filter(tx => tx.category !== 'private');
        let income = 0, expenses = 0, subcontract = 0, transfers = 0;
        const categories: Record<string, number> = {};

        filtered.forEach(tx => {
            const amount = Math.abs(tx.amount);
            categories[tx.category] = (categories[tx.category] || 0) + amount;
            if (INCOME_CATEGORIES.has(tx.category)) income += amount;
            else if (SUBCONTRACT_CATEGORIES.has(tx.category)) subcontract += amount;
            else if (TRANSFER_CATEGORIES.includes(tx.category)) transfers += amount;
            else expenses += amount;
        });

        const periodStr = selectedMonth === 'all'
            ? `${selectedYear} (Все месяцы)`
            : `${MONTH_NAMES[(selectedMonth as number) - 1]} ${selectedYear}`;

        setInlineReportData({
            income, expenses, subcontract, transfers,
            net: income - (expenses + subcontract),
            categories, period: periodStr,
            transactionCount: filtered.length,
            uncategorizedCount: filtered.filter(tx => tx.category === 'uncategorized').length,
        });
        setShowInlineReport(true);
    };

    // ─── Deductibility ───────────────────────────────────────

    const updateDeductibility = async (txId: string, percent: number) => {
        try {
            await updateDoc(doc(db, 'bank_transactions', txId), { deductibilityPercent: percent });
            loadTransactions();
        } catch (error) {
            console.error('Error updating deductibility:', error);
        }
    };

    // ─── Receipt Upload ──────────────────────────────────────

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

    // ─── Drag & Drop ─────────────────────────────────────────

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
            const dataTransfer = new DataTransfer();
            for (let i = 0; i < files.length; i++) {
                dataTransfer.items.add(files[i]);
            }
            fileInputRef.current.files = dataTransfer.files;
            fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }, []);

    // ─── Bulk Actions ────────────────────────────────────────

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

    // ─── Split Transaction ───────────────────────────────────

    const executeSplit = async () => {
        if (!splitTx) return;
        const totalSplit = splitParts.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
        if (Math.abs(totalSplit - Math.abs(splitTx.amount)) > 0.01) {
            setNotification({ open: true, message: `⚠️ Сумма частей ($${totalSplit.toFixed(2)}) не совпадает с оригиналом ($${Math.abs(splitTx.amount).toFixed(2)})`, severity: 'error' });
            return;
        }
        try {
            const batch = writeBatch(db);
            batch.update(doc(db, 'bank_transactions', splitTx.id), { isSplit: true });
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

    // ─── Computed Values ─────────────────────────────────────

    const yearFilteredTransactions = transactions.filter(tx => {
        if (tx.isSplit) return false;
        const txDate = new Date(tx.date.seconds * 1000);
        return txDate.getFullYear() === selectedYear;
    });

    const monthFilteredTransactions = selectedMonth === 'all'
        ? yearFilteredTransactions
        : yearFilteredTransactions.filter(tx => {
            const txDate = new Date(tx.date.seconds * 1000);
            return txDate.getMonth() + 1 === selectedMonth;
        });

    const withRefundFlags = monthFilteredTransactions.map(tx => {
        if (tx.amount > 0 && !INCOME_CATEGORIES.has(tx.category) && !TRANSFER_CATEGORIES.includes(tx.category) && tx.category !== 'private' && tx.category !== 'uncategorized') {
            return { ...tx, isRefund: true };
        }
        return tx;
    });

    const totals = withRefundFlags.reduce((acc, tx) => {
        if (tx.category !== 'uncategorized') {
            const amount = Math.abs(tx.amount);
            acc[tx.category] = (acc[tx.category] || 0) + (tx.isRefund ? 0 : amount);
        }
        if (INCOME_CATEGORIES.has(tx.category)) {
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

    const chartData = useMemo(() => {
        return Object.entries(totals)
            .filter(([cat]) =>
                !['income', 'expenses', 'transfers', 'total', 'uncategorized', 'private'].includes(cat) &&
                !INCOME_CATEGORIES.has(cat as TaxCategory) &&
                !TRANSFER_CATEGORIES.includes(cat as TaxCategory)
            )
            .map(([cat, amount]) => ({
                name: (CATEGORY_LABELS[cat as TaxCategory] || cat).replace(/ - Expense$/, '').replace(/^[^\s]+ /, ''),
                amount: Math.round(amount),
                color: CATEGORY_COLORS[cat as TaxCategory] || '#999',
            }))
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 10);
    }, [totals]);

    const reviewNeededTransactions = withRefundFlags.filter(tx =>
        AMBIGUOUS_VENDORS.some(v => (tx.vendor || '').toUpperCase().includes(v)) ||
        tx.category === 'uncategorized'
    );

    const categoryFiltered = filterCategory === 'all'
        ? withRefundFlags
        : withRefundFlags.filter(tx => tx.category === filterCategory);

    const filteredTransactions = activeTab === 'private'
        ? categoryFiltered.filter(tx => tx.category === 'private')
        : activeTab === 'review'
            ? reviewNeededTransactions
            : categoryFiltered.filter(tx => tx.category !== 'private');

    const searchFilteredTransactions = vendorSearch
        ? filteredTransactions.filter(tx =>
            tx.vendor.toLowerCase().includes(vendorSearch.toLowerCase()) ||
            tx.rawDescription.toLowerCase().includes(vendorSearch.toLowerCase()))
        : filteredTransactions;

    // Recurring vendors
    const recurringVendors = useMemo(() => {
        const vendorMonths: Record<string, Set<number>> = {};
        yearFilteredTransactions.forEach(tx => {
            const month = new Date(tx.date.seconds * 1000).getMonth();
            const key = (tx.vendor || '').toUpperCase().trim();
            if (!vendorMonths[key]) vendorMonths[key] = new Set();
            vendorMonths[key].add(month);
        });
        const result = new Set<string>();
        Object.entries(vendorMonths).forEach(([vendor, months]) => {
            if (months.size >= 3) result.add(vendor);
        });
        return result;
    }, [yearFilteredTransactions]);

    // Auto-rule suggestion
    useMemo(() => {
        const vendorCatCount: Record<string, Record<string, number>> = {};
        transactions.forEach(tx => {
            if (tx.category === 'uncategorized') return;
            const key = (tx.vendor || '').toUpperCase().trim();
            if (!vendorCatCount[key]) vendorCatCount[key] = {};
            vendorCatCount[key][tx.category] = (vendorCatCount[key][tx.category] || 0) + 1;
        });

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

    // ─── Edit Transaction Notes ──────────────────────────────
    const saveEditingTx = async () => {
        if (!editingTx) return;
        try {
            await updateDoc(doc(db, 'bank_transactions', editingTx.id), {
                notes: editingTx.notes,
            });
            loadTransactions();
            setEditingTx(null);
        } catch (error) {
            console.error('Error saving transaction notes:', error);
        }
    };

    // ─── Create Rule from Suggestion Banner ──────────────────
    const createRuleFromSuggestion = async () => {
        if (!ruleSuggestion) return;
        try {
            await addDoc(collection(db, 'vendor_rules'), {
                pattern: ruleSuggestion.vendor.toLowerCase(),
                category: ruleSuggestion.category,
                createdAt: serverTimestamp(),
            });
            setNotification({ open: true, message: `✅ Rule created for ${ruleSuggestion.vendor}`, severity: 'success' });
            setRuleSuggestion(null);
            loadTransactions();
        } catch (error) {
            console.error('Error creating rule from suggestion:', error);
        }
    };

    // ─── Return ──────────────────────────────────────────────

    return {
        // Core state
        transactions,
        statements,
        loading,
        uploading,
        selectedYear, setSelectedYear,
        selectedMonth, setSelectedMonth,
        filterCategory, setFilterCategory,
        activeTab, setActiveTab,
        vendorRules,

        // Upload
        fileInputRef,
        isDragOver,
        handleFileUpload,
        handleDragOver,
        handleDragLeave,
        handleDrop,

        // Statements
        confirmDeleteStatement,
        deleteConfirm, setDeleteConfirm,
        executeDeleteStatement,
        clearAll,

        // Categories
        updateCategory,
        updateDeductibility,

        // Bulk
        selectedTxIds, setSelectedTxIds,
        bulkCategory, setBulkCategory,
        toggleTxSelection,
        toggleSelectAll,
        applyBulkCategory,
        bulkMarkPrivate,

        // Split
        splitTx, setSplitTx,
        splitParts, setSplitParts,
        executeSplit,

        // Vendor rules
        showRulesDialog, setShowRulesDialog,
        newRulePattern, setNewRulePattern,
        newRuleCategory, setNewRuleCategory,
        addVendorRule,
        deleteVendorRule,

        // Vendor search
        vendorSearch, setVendorSearch,

        // Chart
        showChart, setShowChart,
        chartData,

        // Editing
        editingTx, setEditingTx,
        saveEditingTx,

        // Receipt
        receiptViewer, setReceiptViewer,
        receiptInputRef,
        uploadingReceipt,
        handleReceiptUpload,

        // Rule suggestion
        ruleSuggestion, setRuleSuggestion,
        createRuleFromSuggestion,

        // Notification
        notification, setNotification,

        // Report dialog
        showReport, setShowReport,
        reportData,

        // Period confirm
        showPeriodConfirm, setShowPeriodConfirm,
        pendingUpload,
        handlePeriodConfirm,

        // Final report confirm
        showFinalReportConfirm, setShowFinalReportConfirm,

        // Inline report
        showInlineReport, setShowInlineReport,
        inlineReportData,
        generateReportPreview,

        // AI
        aiSuggestions,
        showAiPreview, setShowAiPreview,
        aiLoading,
        selectedSuggestions,
        aiApplying,
        triggerAiCategorization,
        applyAiSuggestions,
        toggleSuggestion,
        toggleAllSuggestions,

        // Computed
        monthFilteredTransactions,
        yearFilteredTransactions,
        withRefundFlags,
        totals,
        reviewNeededTransactions,
        filteredTransactions,
        searchFilteredTransactions,
        recurringVendors,

        // Reload
        loadTransactions,
        loadVendorRules,
    };
}
