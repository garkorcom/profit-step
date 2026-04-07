/**
 * @fileoverview Inline report preview showing financial summary with export options.
 * @module components/bank-statements/BankReportPreview
 */

import React from 'react';
import {
    Box,
    Typography,
    Paper,
    Button,
    Card,
    CardContent,
    Stack,
    Alert,
} from '@mui/material';
import {
    TaxCategory,
    INCOME_CATEGORIES,
    TRANSFER_CATEGORIES,
    CATEGORY_LABELS,
    InlineReportData,
} from './bankStatements.types';

interface BankReportPreviewProps {
    data: InlineReportData;
    onExportPDF: () => void;
    onClose: () => void;
}

export const BankReportPreview: React.FC<BankReportPreviewProps> = ({
    data,
    onExportPDF,
    onClose,
}) => (
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
                    Garkor Corp • {data.period}
                </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                    variant="contained"
                    color="error"
                    onClick={onExportPDF}
                    startIcon={<span>📥</span>}
                    sx={{ fontWeight: 600 }}
                >
                    Скачать PDF
                </Button>
                <Button
                    variant="outlined"
                    onClick={onClose}
                >
                    Закрыть
                </Button>
            </Box>
        </Box>

        {/* Uncategorized Warning */}
        {data.uncategorizedCount > 0 && (
            <Alert severity="warning" sx={{ mb: 2 }}>
                ⚠️ {data.uncategorizedCount} некатегоризованных транзакций. Заполните категории перед финальным отчётом!
            </Alert>
        )}

        {/* Summary Cards Row */}
        <Stack direction="row" spacing={2} sx={{ mb: 3, flexWrap: 'wrap', gap: 1 }}>
            <Card sx={{ minWidth: 180, bgcolor: '#E8F5E9', flex: 1 }}>
                <CardContent>
                    <Typography variant="overline" color="text.secondary">💰 Income</Typography>
                    <Typography variant="h4" sx={{ color: '#2E7D32', fontWeight: 700 }}>
                        ${data.income.toFixed(2)}
                    </Typography>
                </CardContent>
            </Card>
            <Card sx={{ minWidth: 180, bgcolor: '#FFEBEE', flex: 1 }}>
                <CardContent>
                    <Typography variant="overline" color="text.secondary">💸 Expenses</Typography>
                    <Typography variant="h4" sx={{ color: '#C62828', fontWeight: 700 }}>
                        ${data.expenses.toFixed(2)}
                    </Typography>
                </CardContent>
            </Card>
            <Card sx={{ minWidth: 180, bgcolor: '#E3F2FD', flex: 1 }}>
                <CardContent>
                    <Typography variant="overline" color="text.secondary">👷 Subcontract</Typography>
                    <Typography variant="h4" sx={{ color: '#1565C0', fontWeight: 700 }}>
                        ${data.subcontract.toFixed(2)}
                    </Typography>
                </CardContent>
            </Card>
            <Card sx={{ minWidth: 180, bgcolor: data.net >= 0 ? '#E8F5E9' : '#FFEBEE', flex: 1 }}>
                <CardContent>
                    <Typography variant="overline" color="text.secondary">📈 Net Profit</Typography>
                    <Typography variant="h4" sx={{
                        color: data.net >= 0 ? '#2E7D32' : '#C62828',
                        fontWeight: 700
                    }}>
                        ${data.net.toFixed(2)}
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
            {Object.entries(data.categories)
                .filter(([cat, amount]) =>
                    !INCOME_CATEGORIES.has(cat as TaxCategory) &&
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
        {data.transfers > 0 && (
            <Alert severity="info" sx={{ mb: 2 }}>
                🔄 Internal Transfers (Not Tax Deductible): <strong>${data.transfers.toFixed(2)}</strong>
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
                Transactions: {data.transactionCount}
            </Typography>
            <Typography variant="caption">
                Generated: {new Date().toLocaleDateString()}
            </Typography>
        </Box>
    </Paper>
);

export default BankReportPreview;
