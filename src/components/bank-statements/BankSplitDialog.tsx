/**
 * @fileoverview Split transaction dialog allowing users to divide
 * a single transaction into multiple categorized parts.
 * @module components/bank-statements/BankSplitDialog
 */

import React from 'react';
import {
    Box,
    Typography,
    Button,
    TextField,
    Select,
    MenuItem,
    IconButton,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
} from '@mui/material';
import { Delete as DeleteIcon } from '@mui/icons-material';
import {
    TaxCategory,
    BankTransaction,
    DROPDOWN_CATEGORIES,
    CATEGORY_LABELS,
} from './bankStatements.types';

interface SplitPart {
    amount: string;
    category: TaxCategory;
}

interface BankSplitDialogProps {
    splitTx: BankTransaction | null;
    splitParts: SplitPart[];
    onClose: () => void;
    onUpdateParts: (parts: SplitPart[]) => void;
    onExecuteSplit: () => void;
}

export const BankSplitDialog: React.FC<BankSplitDialogProps> = ({
    splitTx,
    splitParts,
    onClose,
    onUpdateParts,
    onExecuteSplit,
}) => {
    const partsSum = splitParts.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
    const totalAmount = splitTx ? Math.abs(splitTx.amount) : 0;
    const hasMismatch = Math.abs(partsSum - totalAmount) > 0.01;

    return (
        <Dialog open={!!splitTx} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>✂️ Split Transaction</DialogTitle>
            <DialogContent>
                {splitTx && (
                    <Box>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            {splitTx.vendor} — ${totalAmount.toFixed(2)}
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
                                        onUpdateParts(updated);
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
                                        onUpdateParts(updated);
                                    }}
                                    sx={{ flex: 1 }}
                                >
                                    {DROPDOWN_CATEGORIES.map(cat => (
                                        <MenuItem key={cat} value={cat}>{CATEGORY_LABELS[cat]}</MenuItem>
                                    ))}
                                </Select>
                                {splitParts.length > 2 && (
                                    <IconButton size="small" onClick={() => onUpdateParts(splitParts.filter((_, j) => j !== i))}>
                                        <DeleteIcon fontSize="small" />
                                    </IconButton>
                                )}
                            </Box>
                        ))}
                        <Button
                            size="small"
                            variant="text"
                            onClick={() => onUpdateParts([...splitParts, { amount: '', category: 'business_expense' }])}
                        >
                            + Add Part
                        </Button>
                        <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                            Sum: ${partsSum.toFixed(2)} / ${totalAmount.toFixed(2)}
                            {hasMismatch && (
                                <span style={{ color: 'red', marginLeft: 8 }}>⚠ Mismatch</span>
                            )}
                        </Typography>
                    </Box>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" onClick={onExecuteSplit}>Split</Button>
            </DialogActions>
        </Dialog>
    );
};

export default BankSplitDialog;
