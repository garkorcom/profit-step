import React from 'react';
import {
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    Paper, Chip, IconButton, Tooltip, CircularProgress, Box, Typography, Stack
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import SendIcon from '@mui/icons-material/Send';
import DeleteIcon from '@mui/icons-material/Delete';
import PaymentIcon from '@mui/icons-material/Payment';
import { Invoice, InvoiceStatus, InvoicePayment } from '../../../types/invoice.types';
import { format } from 'date-fns';
import { AddPaymentDialog } from './AddPaymentDialog';

interface InvoiceTableProps {
    invoices: Invoice[];
    loading: boolean;
    onUpdateStatus: (id: string, status: InvoiceStatus) => Promise<void>;
    onAddPayment: (id: string, data: Omit<InvoicePayment, 'id'>) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
}

export const InvoiceTable: React.FC<InvoiceTableProps> = ({ invoices, loading, onUpdateStatus, onAddPayment, onDelete }) => {
    const [paymentInvoice, setPaymentInvoice] = React.useState<Invoice | null>(null);

    const getStatusChip = (status: InvoiceStatus) => {
        const statusMap: Record<InvoiceStatus, { label: string, color: "default" | "primary" | "secondary" | "error" | "info" | "success" | "warning" }> = {
            draft: { label: 'Draft', color: 'default' },
            sent: { label: 'Sent', color: 'info' },
            paid: { label: 'Paid', color: 'success' },
            overdue: { label: 'Overdue', color: 'error' },
            cancelled: { label: 'Cancelled', color: 'default' }
        };

        const mapped = statusMap[status];

        return <Chip label={mapped.label} color={mapped.color} size="small" />;
    };

    if (loading) {
        return (
            <Box display="flex" justifyContent="center" p={4}>
                <CircularProgress />
            </Box>
        );
    }

    if (invoices.length === 0) {
        return (
            <Paper sx={{ p: 4, textAlign: 'center' }}>
                <Typography color="textSecondary">No invoices found.</Typography>
            </Paper>
        );
    }

    return (
        <>
            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>Invoice #</TableCell>
                            <TableCell>Client</TableCell>
                            <TableCell>Issue Date</TableCell>
                            <TableCell>Due Date</TableCell>
                            <TableCell align="right">Amount</TableCell>
                            <TableCell align="center">Status</TableCell>
                            <TableCell align="right">Actions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {invoices.map((inv) => (
                            <TableRow key={inv.id} hover>
                                <TableCell sx={{ fontWeight: 'bold' }}>{inv.invoiceNumber}</TableCell>
                                <TableCell>{inv.clientName}</TableCell>
                                <TableCell>{inv.date ? format(inv.date.toDate(), 'MMM d, yyyy') : '-'}</TableCell>
                                <TableCell>{inv.dueDate ? format(inv.dueDate.toDate(), 'MMM d, yyyy') : '-'}</TableCell>
                                <TableCell align="right">${inv.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                <TableCell align="center">{getStatusChip(inv.status)}</TableCell>
                                <TableCell align="right">
                                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                                        {inv.status === 'draft' && (
                                            <Tooltip title="Edit">
                                                <IconButton size="small"><EditIcon fontSize="small" /></IconButton>
                                            </Tooltip>
                                        )}
                                        {inv.status === 'draft' && (
                                            <Tooltip title="Mark as Sent">
                                                <IconButton size="small" color="info" onClick={() => onUpdateStatus(inv.id, 'sent')}>
                                                    <SendIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        )}
                                        {(inv.status === 'sent' || inv.status === 'overdue') && (
                                            <Tooltip title="Add Payment">
                                                <IconButton size="small" color="success" onClick={() => setPaymentInvoice(inv)}>
                                                    <PaymentIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        )}
                                        <Tooltip title="Delete">
                                            <IconButton size="small" color="error" onClick={() => { if (window.confirm('Are you sure?')) onDelete(inv.id); }}>
                                                <DeleteIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                    </Stack>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>

            {paymentInvoice && (
                <AddPaymentDialog
                    open={!!paymentInvoice}
                    onClose={() => setPaymentInvoice(null)}
                    onAdd={(data) => onAddPayment(paymentInvoice.id, data).then(() => setPaymentInvoice(null))}
                    invoiceId={paymentInvoice.id}
                    currentTotal={paymentInvoice.total}
                    paidAmount={paymentInvoice.payments?.reduce((sum, p) => sum + p.amount, 0) || 0}
                />
            )}
        </>
    );
};
