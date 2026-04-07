/**
 * @fileoverview Bank Statements Page
 * 
 * Standalone tax sorting module for bank statement uploads.
 * Parses PDF/CSV files, categorizes transactions for tax purposes.
 * 
 * All types, constants, business logic, and export utilities are extracted to:
 *   - bankStatements.types.ts  (types & constants)
 *   - BankExportUtils.ts       (CSV/PDF export functions)
 *   - useBankStatements.ts     (state management & mutations)
 * 
 * @module pages/crm/BankStatementsPage
 */

import React from 'react';
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

// ─── Bank Statements Module ─────────────────────────────────
import {
    TaxCategory,
    BankTransaction,
    DROPDOWN_CATEGORIES,
    CATEGORY_COLORS,
    CATEGORY_LABELS,
    MONTH_NAMES,
    DEFAULT_DEDUCTIBILITY,
    SCHEDULE_C_MAP,
    AMBIGUOUS_VENDORS,
} from '../../components/bank-statements/bankStatements.types';
import { useBankStatements } from '../../components/bank-statements/useBankStatements';
import { BankSummaryCards } from '../../components/bank-statements/BankSummaryCards';
import { BankReportPreview } from '../../components/bank-statements/BankReportPreview';
import { BankAccountingReport } from '../../components/bank-statements/BankAccountingReport';
import { BankAiPreview } from '../../components/bank-statements/BankAiPreview';
import { BankSplitDialog } from '../../components/bank-statements/BankSplitDialog';
import { BankReceiptViewer } from '../../components/bank-statements/BankReceiptViewer';
import {
    exportCSV as doExportCSV,
    exportPDF as doExportPDF,
    exportDetailedCSV as doExportDetailedCSV,
    exportCategorySummaryCSV as doExportCategorySummaryCSV,
    exportReportPDF as doExportReportPDF,
    downloadScheduleC as doDownloadScheduleC,
} from '../../components/bank-statements/BankExportUtils';

export const BankStatementsPage: React.FC = () => {
    // ─── Hook: all state, mutations, computed values ─────────
    const hook = useBankStatements();

    // ─── Export wrappers (connect hook data → pure utils) ────
    const exportCSV = () => doExportCSV(hook.transactions, hook.filterCategory, hook.selectedYear);
    const exportPDF = () => doExportPDF(hook.transactions, hook.filterCategory, hook.selectedYear);
    const exportDetailedCSV = () => doExportDetailedCSV(hook.monthFilteredTransactions, hook.selectedYear, hook.selectedMonth);
    const exportCategorySummaryCSV = () => {
        const fileName = doExportCategorySummaryCSV(hook.monthFilteredTransactions, hook.selectedYear, hook.selectedMonth);
        hook.setNotification({ open: true, message: `✅ Отчёт "${fileName}" успешно сформирован и скачан!`, severity: 'success' });
    };
    const exportReportPDF = () => {
        if (!hook.inlineReportData) return;
        const fileName = doExportReportPDF(hook.inlineReportData);
        hook.setNotification({ open: true, message: `✅ PDF отчёт "${fileName}" скачан!`, severity: 'success' });
    };
    const downloadScheduleC = () => {
        doDownloadScheduleC(hook.monthFilteredTransactions, hook.selectedYear, hook.selectedMonth);
        hook.setNotification({ open: true, message: '📋 Schedule C Draft PDF downloaded!', severity: 'success' });
    };

    // ─── Destructure hook for concise JSX access ─────────────
    const {
        transactions, statements, loading, uploading,
        selectedYear, setSelectedYear,
        selectedMonth, setSelectedMonth,
        filterCategory, setFilterCategory,
        activeTab, setActiveTab,
        vendorRules,
        fileInputRef, isDragOver,
        handleFileUpload, handleDragOver, handleDragLeave, handleDrop,
        confirmDeleteStatement, deleteConfirm, setDeleteConfirm, executeDeleteStatement, clearAll,
        updateCategory, updateDeductibility,
        selectedTxIds, setSelectedTxIds, bulkCategory, setBulkCategory,
        toggleTxSelection, toggleSelectAll, applyBulkCategory, bulkMarkPrivate,
        splitTx, setSplitTx, splitParts, setSplitParts, executeSplit,
        showRulesDialog, setShowRulesDialog,
        newRulePattern, setNewRulePattern, newRuleCategory, setNewRuleCategory,
        addVendorRule, deleteVendorRule,
        vendorSearch, setVendorSearch,
        showChart, setShowChart, chartData,
        editingTx, setEditingTx, saveEditingTx,
        receiptViewer, setReceiptViewer, receiptInputRef, uploadingReceipt, handleReceiptUpload,
        ruleSuggestion, setRuleSuggestion, createRuleFromSuggestion,
        notification, setNotification,
        showReport, setShowReport, reportData,
        showPeriodConfirm, setShowPeriodConfirm, handlePeriodConfirm,
        pendingUpload,
        showFinalReportConfirm, setShowFinalReportConfirm,
        showInlineReport, setShowInlineReport, inlineReportData, generateReportPreview,
        aiSuggestions, showAiPreview, setShowAiPreview, aiLoading,
        selectedSuggestions, aiApplying,
        triggerAiCategorization, applyAiSuggestions, toggleSuggestion, toggleAllSuggestions,
        monthFilteredTransactions, withRefundFlags, totals,
        reviewNeededTransactions, searchFilteredTransactions, recurringVendors,
    } = hook;
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
            <BankSummaryCards
                totals={totals}
                filterCategory={filterCategory}
                setFilterCategory={setFilterCategory}
            />

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
                <BankReportPreview
                    data={inlineReportData}
                    onExportPDF={exportReportPDF}
                    onClose={() => setShowInlineReport(false)}
                />
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
                        onClick={createRuleFromSuggestion}
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
                        onClick={saveEditingTx}
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
            <BankAccountingReport
                open={showReport}
                onClose={() => setShowReport(false)}
                reportData={reportData}
                selectedMonth={typeof selectedMonth === 'number' ? selectedMonth : new Date().getMonth() + 1}
                selectedYear={selectedYear}
                onExportCSVSummary={exportCategorySummaryCSV}
                onExportCSVDetailed={exportDetailedCSV}
                onExportPDF={exportPDF}
            />

            {/* AI Categorization Preview Dialog */}
            <BankAiPreview
                open={showAiPreview}
                onClose={() => setShowAiPreview(false)}
                aiSuggestions={aiSuggestions}
                selectedSuggestions={selectedSuggestions}
                aiApplying={aiApplying}
                toggleSuggestion={toggleSuggestion}
                toggleAllSuggestions={toggleAllSuggestions}
                applyAiSuggestions={applyAiSuggestions}
            />

            {/* Split Transaction Dialog */}
            <BankSplitDialog
                splitTx={splitTx}
                splitParts={splitParts}
                onClose={() => setSplitTx(null)}
                onUpdateParts={setSplitParts}
                onExecuteSplit={executeSplit}
            />

            {/* Receipt Viewer Dialog */}
            <BankReceiptViewer
                receiptViewer={receiptViewer}
                onClose={() => setReceiptViewer({ open: false, url: '', vendor: '' })}
            />
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
