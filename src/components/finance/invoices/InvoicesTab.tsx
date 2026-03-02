import React, { useState } from 'react';
import {
    Box, Card, CardContent, Typography, Button, FormControl,
    Select, MenuItem, Stack
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import FlashOnIcon from '@mui/icons-material/FlashOn';
import { useInvoices } from '../../../hooks/finance/useInvoices';
import { InvoiceTable } from './InvoiceTable';
import { CreateInvoiceDialog } from './CreateInvoiceDialog';
import { GenerateFromTimeDialog } from './GenerateFromTimeDialog';

export const InvoicesTab: React.FC = () => {
    const { invoices, loading, analytics, createInvoice, updateInvoiceStatus, addPayment, deleteInvoice } = useInvoices();
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isGenerateOpen, setIsGenerateOpen] = useState(false);

    const filteredInvoices = invoices.filter(inv => {
        if (filterStatus === 'all') return true;
        return inv.status === filterStatus;
    });

    return (
        <Box sx={{ mt: 3 }}>
            {/* Metric Cards */}
            <Box sx={{ display: 'flex', gap: 3, mb: 4, flexWrap: 'wrap' }}>
                <Box sx={{ flex: 1, minWidth: 200 }}>
                    <Card sx={{ bgcolor: '#ffffff', height: '100%', borderLeft: '4px solid #2196f3' }}>
                        <CardContent>
                            <Typography color="textSecondary" variant="body2">Total Revenue</Typography>
                            <Typography variant="h4" fontWeight="bold">${analytics.totalRevenue.toLocaleString()}</Typography>
                        </CardContent>
                    </Card>
                </Box>
                <Box sx={{ flex: 1, minWidth: 200 }}>
                    <Card sx={{ bgcolor: '#fff3e0', height: '100%', borderLeft: '4px solid #ff9800' }}>
                        <CardContent>
                            <Typography color="textSecondary" variant="body2">Outstanding</Typography>
                            <Typography variant="h4" fontWeight="bold" color="warning.main">${analytics.outstanding.toLocaleString()}</Typography>
                        </CardContent>
                    </Card>
                </Box>
                <Box sx={{ flex: 1, minWidth: 200 }}>
                    <Card sx={{ bgcolor: '#e8f5e9', height: '100%', borderLeft: '4px solid #4caf50' }}>
                        <CardContent>
                            <Typography color="textSecondary" variant="body2">Paid This Month</Typography>
                            <Typography variant="h4" fontWeight="bold" color="success.main">${analytics.paidThisMonth.toLocaleString()}</Typography>
                        </CardContent>
                    </Card>
                </Box>
                <Box sx={{ flex: 1, minWidth: 200 }}>
                    <Card sx={{ bgcolor: '#ffebee', height: '100%', borderLeft: '4px solid #f44336' }}>
                        <CardContent>
                            <Typography color="textSecondary" variant="body2">Overdue</Typography>
                            <Typography variant="h4" fontWeight="bold" color="error.main">${analytics.overdue.toLocaleString()}</Typography>
                        </CardContent>
                    </Card>
                </Box>
            </Box>

            {/* Toolbar */}
            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
                <Stack direction="row" spacing={2}>
                    <Button
                        variant="contained"
                        startIcon={<AddIcon />}
                        onClick={() => setIsCreateOpen(true)}
                    >
                        Create Invoice
                    </Button>
                    <Button
                        variant="outlined"
                        color="secondary"
                        startIcon={<FlashOnIcon />}
                        onClick={() => setIsGenerateOpen(true)}
                    >
                        Generate from Time Tracking
                    </Button>
                </Stack>
                <FormControl size="small" sx={{ minWidth: 150 }}>
                    <Select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        displayEmpty
                    >
                        <MenuItem value="all">All Statuses</MenuItem>
                        <MenuItem value="draft">Draft</MenuItem>
                        <MenuItem value="sent">Sent</MenuItem>
                        <MenuItem value="paid">Paid</MenuItem>
                        <MenuItem value="overdue">Overdue</MenuItem>
                    </Select>
                </FormControl>
            </Stack>

            {/* Invoice Table */}
            <InvoiceTable
                invoices={filteredInvoices}
                loading={loading}
                onUpdateStatus={updateInvoiceStatus}
                onAddPayment={addPayment}
                onDelete={deleteInvoice}
            />

            <CreateInvoiceDialog
                open={isCreateOpen}
                onClose={() => setIsCreateOpen(false)}
                onCreate={createInvoice}
            />

            <GenerateFromTimeDialog
                open={isGenerateOpen}
                onClose={() => setIsGenerateOpen(false)}
                onCreate={createInvoice}
            />
        </Box>
    );
};
