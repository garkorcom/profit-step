import React, { useState } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, Button,
    TextField, Grid, Typography, Box, MenuItem, CircularProgress, Alert, Paper
} from '@mui/material';
import { useForm, Controller } from 'react-hook-form';
import { Timestamp } from 'firebase/firestore';
import { InvoiceStatus } from '../../../types/invoice.types';
import { useClients } from '../../../features/shopping/hooks/useClients';
import { useInvoiceGenerator } from '../../../hooks/finance/useInvoiceGenerator';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { subMonths, startOfMonth, endOfMonth } from 'date-fns';

interface GenerateInvoiceFormParams {
    clientId: string;
    startDate: Date | null;
    endDate: Date | null;
    dueDate: Date | null;
}

interface GenerateFromTimeDialogProps {
    open: boolean;
    onClose: () => void;
    onCreate: (data: any) => Promise<any>;
}

export const GenerateFromTimeDialog: React.FC<GenerateFromTimeDialogProps> = ({ open, onClose, onCreate }) => {
    const { clients, loading: clientsLoading } = useClients();
    const { generateFromTimeTracking, generating, error: genError } = useInvoiceGenerator();

    const [previewData, setPreviewData] = useState<any>(null);
    const [saving, setSaving] = useState(false);

    const now = new Date();
    const { control, handleSubmit, watch, reset } = useForm<GenerateInvoiceFormParams>({
        defaultValues: {
            clientId: '',
            startDate: startOfMonth(subMonths(now, 1)), // Default to last month
            endDate: endOfMonth(subMonths(now, 1)),
            dueDate: new Date(new Date().setDate(now.getDate() + 14)), // Default +14 days
        }
    });

    const dueDateWatch = watch('dueDate');

    const onPreview = async (data: GenerateInvoiceFormParams) => {
        if (!data.startDate || !data.endDate) return;
        const client = clients.find(c => c.id === data.clientId);
        if (!client) return;

        try {
            const preview = await generateFromTimeTracking(
                client.id,
                client.name,
                data.startDate,
                data.endDate,
                true // Apply client rates
            );
            setPreviewData(preview);
        } catch (e) {
            setPreviewData(null);
            // Error is handled by useInvoiceGenerator and displayed via genError
        }
    };

    const handleConfirm = async () => {
        if (!previewData) return;
        setSaving(true);
        try {
            const payload = {
                ...previewData,
                date: Timestamp.now(),
                dueDate: dueDateWatch ? Timestamp.fromDate(dueDateWatch) : Timestamp.now(),
                status: 'draft' as InvoiceStatus,
                notes: `Auto-generated for period ${watch('startDate')?.toLocaleDateString()} to ${watch('endDate')?.toLocaleDateString()}`
            };
            await onCreate(payload);

            // Success
            reset();
            setPreviewData(null);
            onClose();
        } catch (err) {
            console.error("Failed to save generated invoice:", err);
            alert("Failed to save invoice");
        } finally {
            setSaving(false);
        }
    };

    const handleCloseModal = () => {
        setPreviewData(null);
        reset();
        onClose();
    };

    return (
        <Dialog open={open} onClose={handleCloseModal} maxWidth="md" fullWidth>
            <DialogTitle>Generate Invoice from Time Tracking</DialogTitle>
            <DialogContent dividers>
                <form id="generate-form" onSubmit={handleSubmit(onPreview)}>
                    <Grid container spacing={3}>
                        <Grid size={{ xs: 12, md: 4 }}>
                            <Controller
                                name="clientId"
                                control={control}
                                rules={{ required: true }}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        select
                                        fullWidth
                                        label="Select Client"
                                        size="small"
                                        disabled={clientsLoading || generating}
                                        required
                                    >
                                        {clients.map(c => (
                                            <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                                        ))}
                                    </TextField>
                                )}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, md: 3 }}>
                            <LocalizationProvider dateAdapter={AdapterDateFns}>
                                <Controller
                                    name="startDate"
                                    control={control}
                                    rules={{ required: true }}
                                    render={({ field }) => (
                                        <DatePicker
                                            {...field}
                                            label="Start Date"
                                            slotProps={{ textField: { size: 'small', fullWidth: true, required: true } }}
                                            disabled={generating}
                                        />
                                    )}
                                />
                            </LocalizationProvider>
                        </Grid>
                        <Grid size={{ xs: 12, md: 3 }}>
                            <LocalizationProvider dateAdapter={AdapterDateFns}>
                                <Controller
                                    name="endDate"
                                    control={control}
                                    rules={{ required: true }}
                                    render={({ field }) => (
                                        <DatePicker
                                            {...field}
                                            label="End Date"
                                            slotProps={{ textField: { size: 'small', fullWidth: true, required: true } }}
                                            disabled={generating}
                                        />
                                    )}
                                />
                            </LocalizationProvider>
                        </Grid>
                        <Grid size={{ xs: 12, md: 2 }}>
                            <Button
                                type="submit"
                                variant="contained"
                                color="secondary"
                                fullWidth
                                disabled={generating}
                                sx={{ height: 40 }}
                            >
                                {generating ? <CircularProgress size={24} /> : "Preview"}
                            </Button>
                        </Grid>

                        <Grid size={{ xs: 12, md: 4 }}>
                            <LocalizationProvider dateAdapter={AdapterDateFns}>
                                <Controller
                                    name="dueDate"
                                    control={control}
                                    rules={{ required: true }}
                                    render={({ field }) => (
                                        <DatePicker
                                            {...field}
                                            label="Invoice Due Date"
                                            slotProps={{ textField: { size: 'small', fullWidth: true, required: true } }}
                                        />
                                    )}
                                />
                            </LocalizationProvider>
                        </Grid>
                    </Grid>
                </form>

                {genError && (
                    <Alert severity="error" sx={{ mt: 3 }}>
                        {genError.message}
                    </Alert>
                )}

                {previewData && !generating && (
                    <Box sx={{ mt: 4 }}>
                        <Typography variant="h6" gutterBottom>Invoice Preview</Typography>
                        <Paper variant="outlined" sx={{ p: 2 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                                <Typography fontWeight="bold">Client: {previewData.clientName}</Typography>
                                <Typography fontWeight="bold">Total: ${previewData.total.toFixed(2)}</Typography>
                            </Box>

                            <Box sx={{ mb: 1, px: 2, display: 'flex', bgcolor: '#f5f5f5', py: 1 }}>
                                <Typography sx={{ flex: 3, fontWeight: 'bold' }}>Description</Typography>
                                <Typography sx={{ flex: 1, fontWeight: 'bold' }}>Qty</Typography>
                                <Typography sx={{ flex: 1, fontWeight: 'bold' }}>Rate</Typography>
                                <Typography sx={{ width: 80, textAlign: 'right', fontWeight: 'bold' }}>Amount</Typography>
                            </Box>

                            {previewData.lineItems.map((item: any, idx: number) => (
                                <Box key={idx} sx={{ display: 'flex', px: 2, py: 1, borderBottom: '1px solid #eee' }}>
                                    <Typography sx={{ flex: 3 }}>{item.description}</Typography>
                                    <Typography sx={{ flex: 1 }}>{item.quantity.toFixed(2)}h</Typography>
                                    <Typography sx={{ flex: 1 }}>${item.rate.toFixed(2)}</Typography>
                                    <Typography sx={{ width: 80, textAlign: 'right' }}>${item.amount.toFixed(2)}</Typography>
                                </Box>
                            ))}
                        </Paper>
                    </Box>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={handleCloseModal}>Cancel</Button>
                <Button
                    variant="contained"
                    color="primary"
                    onClick={handleConfirm}
                    disabled={!previewData || saving}
                >
                    {saving ? <CircularProgress size={24} color="inherit" /> : "Save Invoice"}
                </Button>
            </DialogActions>
        </Dialog>
    );
};
