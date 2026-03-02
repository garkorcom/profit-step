import React from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, Button,
    TextField, Grid, MenuItem
} from '@mui/material';
import { useForm, Controller } from 'react-hook-form';
import { Timestamp } from 'firebase/firestore';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';

interface PaymentFormParams {
    amount: number;
    date: Date | null;
    method: string;
    notes: string;
}

interface AddPaymentDialogProps {
    open: boolean;
    onClose: () => void;
    onAdd: (data: any) => Promise<any>;
    invoiceId: string | null;
    currentTotal: number;
    paidAmount: number;
}

export const AddPaymentDialog: React.FC<AddPaymentDialogProps> = ({ open, onClose, onAdd, invoiceId, currentTotal, paidAmount }) => {

    // Automatically suggest the remaining balance
    const remaining = currentTotal - paidAmount;

    const { control, handleSubmit, reset, formState: { isSubmitting } } = useForm<PaymentFormParams>({
        defaultValues: {
            amount: remaining > 0 ? remaining : 0,
            date: new Date(),
            method: 'bank_transfer',
            notes: ''
        }
    });

    const onSubmit = async (data: PaymentFormParams) => {
        if (!invoiceId) return;

        const payload = {
            amount: Number(data.amount),
            date: data.date ? Timestamp.fromDate(data.date) : Timestamp.now(),
            method: data.method,
            notes: data.notes || ''
        };

        try {
            await onAdd(payload);
            reset();
            onClose();
        } catch (error) {
            console.error(error);
            alert("Failed to record payment");
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Record Payment</DialogTitle>
            <form onSubmit={handleSubmit(onSubmit)}>
                <DialogContent dividers>
                    <Grid container spacing={3}>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <Controller
                                name="amount"
                                control={control}
                                rules={{ required: true, min: 0.01 }}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        label="Amount ($)"
                                        type="number"
                                        fullWidth
                                        required
                                        inputProps={{ step: "0.01" }}
                                    />
                                )}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <LocalizationProvider dateAdapter={AdapterDateFns}>
                                <Controller
                                    name="date"
                                    control={control}
                                    rules={{ required: true }}
                                    render={({ field }) => (
                                        <DatePicker
                                            {...field}
                                            label="Payment Date"
                                            slotProps={{ textField: { fullWidth: true, required: true } }}
                                        />
                                    )}
                                />
                            </LocalizationProvider>
                        </Grid>
                        <Grid size={{ xs: 12 }}>
                            <Controller
                                name="method"
                                control={control}
                                rules={{ required: true }}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        select
                                        fullWidth
                                        label="Payment Method"
                                        required
                                    >
                                        <MenuItem value="bank_transfer">Bank Transfer</MenuItem>
                                        <MenuItem value="credit_card">Credit Card</MenuItem>
                                        <MenuItem value="cash">Cash</MenuItem>
                                        <MenuItem value="check">Check</MenuItem>
                                        <MenuItem value="other">Other</MenuItem>
                                    </TextField>
                                )}
                            />
                        </Grid>
                        <Grid size={{ xs: 12 }}>
                            <Controller
                                name="notes"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        label="Reference Notes"
                                        multiline
                                        rows={2}
                                        fullWidth
                                    />
                                )}
                            />
                        </Grid>
                    </Grid>
                </DialogContent>
                <DialogActions>
                    <Button onClick={onClose} disabled={isSubmitting}>Cancel</Button>
                    <Button type="submit" variant="contained" color="success" disabled={isSubmitting}>
                        Receive Payment
                    </Button>
                </DialogActions>
            </form>
        </Dialog>
    );
};
