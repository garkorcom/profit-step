/**
 * @fileoverview Accountant-format report dialog showing income, 
 * expenses by category, transfers, and totals with export actions.
 * @module components/bank-statements/BankAccountingReport
 */

import React from 'react';
import {
    Box,
    Typography,
    Paper,
    Button,
    Stack,
    Alert,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
} from '@mui/material';
import { MONTH_NAMES, ReportData } from './bankStatements.types';

interface BankAccountingReportProps {
    open: boolean;
    onClose: () => void;
    reportData: ReportData | null;
    selectedMonth: number;
    selectedYear: number;
    onExportCSVSummary: () => void;
    onExportCSVDetailed: () => void;
    onExportPDF: () => void;
}

/**
 * Category row helper for the expense breakdown section.
 */
const ExpenseRow: React.FC<{ label: string; amount: number; bgcolor?: string }> = ({ label, amount, bgcolor }) => {
    if (amount <= 0) return null;
    return (
        <Paper sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between', ...(bgcolor ? { bgcolor } : {}) }}>
            <Typography>{label}</Typography>
            <Typography sx={{ fontWeight: 600 }}>${amount.toFixed(2)}</Typography>
        </Paper>
    );
};

export const BankAccountingReport: React.FC<BankAccountingReportProps> = ({
    open,
    onClose,
    reportData,
    selectedMonth,
    selectedYear,
    onExportCSVSummary,
    onExportCSVDetailed,
    onExportPDF,
}) => (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
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
                            <ExpenseRow label="🏢 Office Rent" amount={reportData.categories['office_rent'] || 0} />
                            <ExpenseRow label="💻 Apps for Work" amount={reportData.categories['apps_work'] || 0} />
                            <ExpenseRow label="📢 Advertising" amount={reportData.categories['advertising'] || 0} />
                            <ExpenseRow label="🧰 Tools & Materials" amount={reportData.categories['materials'] || 0} />
                            <ExpenseRow label="🚗 Car Repair" amount={reportData.categories['car_repair'] || 0} />
                            <ExpenseRow label="🏦 Bank Fees" amount={reportData.categories['fees'] || 0} />
                            <ExpenseRow label="👷 Subcontractors / Contractors (1099)" amount={reportData.categories['subcontractor'] || 0} bgcolor="#FFF3E0" />
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
            <Button onClick={onClose}>Закрыть</Button>
            <Button
                variant="outlined"
                color="primary"
                onClick={onExportCSVSummary}
                startIcon={<span>📊</span>}
            >
                CSV Summary
            </Button>
            <Button
                variant="outlined"
                color="secondary"
                onClick={onExportCSVDetailed}
                startIcon={<span>📋</span>}
            >
                CSV Detailed
            </Button>
            <Button variant="contained" color="primary" onClick={() => { onClose(); onExportPDF(); }}>
                Экспорт PDF
            </Button>
        </DialogActions>
    </Dialog>
);

export default BankAccountingReport;
