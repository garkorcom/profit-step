/**
 * @fileoverview Receipt viewer dialog showing image or PDF receipt.
 * @module components/bank-statements/BankReceiptViewer
 */

import React from 'react';
import {
    Box,
    Typography,
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
} from '@mui/material';

interface ReceiptViewerState {
    open: boolean;
    url: string;
    vendor: string;
}

interface BankReceiptViewerProps {
    receiptViewer: ReceiptViewerState;
    onClose: () => void;
}

export const BankReceiptViewer: React.FC<BankReceiptViewerProps> = ({
    receiptViewer,
    onClose,
}) => (
    <Dialog open={receiptViewer.open} onClose={onClose} maxWidth="md" fullWidth>
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
            <Button onClick={onClose}>Close</Button>
            <Button href={receiptViewer.url} target="_blank" rel="noopener">Open in New Tab</Button>
        </DialogActions>
    </Dialog>
);

export default BankReceiptViewer;
