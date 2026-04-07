/**
 * @fileoverview Transactions table with inline category/deductibility editing,
 * split, receipt, and notes actions.
 * @module components/bank-statements/BankTransactionsTable
 */

import React from 'react';
import {
    Box,
    Typography,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Chip,
    Select,
    MenuItem,
    IconButton,
    Tooltip,
    CircularProgress,
    Checkbox,
} from '@mui/material';
import {
    Edit as EditIcon,
    ContentCut as SplitIcon,
    Receipt as ReceiptIcon,
    Repeat as RepeatIcon,
    AttachFile as AttachIcon,
} from '@mui/icons-material';
import {
    TaxCategory,
    BankTransaction,
    DROPDOWN_CATEGORIES,
    CATEGORY_COLORS,
    CATEGORY_LABELS,
    DEFAULT_DEDUCTIBILITY,
    SCHEDULE_C_MAP,
    AMBIGUOUS_VENDORS,
} from './bankStatements.types';

interface BankTransactionsTableProps {
    loading: boolean;
    transactions: (BankTransaction & { isRefund?: boolean })[];
    selectedTxIds: Set<string>;
    activeTab: string;
    recurringVendors: Set<string>;
    uploadingReceipt: string | null;
    toggleTxSelection: (txId: string) => void;
    toggleSelectAll: () => void;
    updateCategory: (txId: string, category: TaxCategory) => void;
    updateDeductibility: (txId: string, percent: number) => void;
    onEditTx: (tx: BankTransaction) => void;
    onSplitTx: (tx: BankTransaction) => void;
    onViewReceipt: (url: string, vendor: string) => void;
    onAttachReceipt: (txId: string) => void;
}

export const BankTransactionsTable: React.FC<BankTransactionsTableProps> = ({
    loading,
    transactions,
    selectedTxIds,
    activeTab,
    recurringVendors,
    uploadingReceipt,
    toggleTxSelection,
    toggleSelectAll,
    updateCategory,
    updateDeductibility,
    onEditTx,
    onSplitTx,
    onViewReceipt,
    onAttachReceipt,
}) => (
    <TableContainer component={Paper}>
        <Table size="small">
            <TableHead>
                <TableRow>
                    <TableCell padding="checkbox">
                        <Checkbox
                            checked={selectedTxIds.size === transactions.length && transactions.length > 0}
                            indeterminate={selectedTxIds.size > 0 && selectedTxIds.size < transactions.length}
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
                ) : transactions.length === 0 ? (
                    <TableRow>
                        <TableCell colSpan={8} align="center">
                            {activeTab === 'review'
                                ? 'No transactions need review! 🎉'
                                : 'No transactions. Upload a bank statement to get started.'}
                        </TableCell>
                    </TableRow>
                ) : (
                    transactions.map((tx) => (
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
                                {AMBIGUOUS_VENDORS.some((v: string) => tx.vendor.toUpperCase().includes(v)) && (
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
                                        <IconButton size="small" onClick={() => onEditTx(tx)}>
                                            <EditIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    <Tooltip title="Split transaction">
                                        <IconButton size="small" onClick={() => onSplitTx(tx)}>
                                            <SplitIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    <Tooltip title={tx.receiptUrl ? 'View receipt' : 'Attach receipt'}>
                                        <IconButton
                                            size="small"
                                            color={tx.receiptUrl ? 'success' : 'default'}
                                            onClick={() => {
                                                if (tx.receiptUrl) {
                                                    onViewReceipt(tx.receiptUrl, tx.vendor);
                                                } else {
                                                    onAttachReceipt(tx.id);
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
);

export default BankTransactionsTable;
