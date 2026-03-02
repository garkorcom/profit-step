import React from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, Button,
    TextField, Grid, IconButton, Typography, Box, MenuItem, Divider
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { Timestamp } from 'firebase/firestore';
import { InvoiceStatus, InvoiceLineItem } from '../../../types/invoice.types';
import { useClients } from '../../../features/shopping/hooks/useClients';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';

interface CreateInvoiceFormParams {
    clientId: string;
    issueDate: Date | null;
    dueDate: Date | null;
    lineItems: Omit<InvoiceLineItem, 'id'>[];
    taxRate: number;
    notes: string;
}

interface CreateInvoiceDialogProps {
    open: boolean;
    onClose: () => void;
    onCreate: (data: any) => Promise<any>;
}

export const CreateInvoiceDialog: React.FC<CreateInvoiceDialogProps> = ({ open, onClose, onCreate }) => {
    const { clients, loading: clientsLoading } = useClients();

    const { control, handleSubmit, watch, reset, formState: { isSubmitting } } = useForm<CreateInvoiceFormParams>({
        defaultValues: {
            clientId: '',
            issueDate: new Date(),
            dueDate: new Date(new Date().setDate(new Date().getDate() + 14)), // Default +14 days
            lineItems: [{ description: '', quantity: 1, rate: 0, amount: 0 }],
            taxRate: 0,
            notes: ''
        }
    });

    const { fields, append, remove } = useFieldArray({
        control,
        name: "lineItems"
    });

    const lineItems = watch("lineItems");
    const taxRate = watch("taxRate");



    const subtotal = lineItems.reduce((acc, curr) => acc + (Number(curr.quantity || 0) * Number(curr.rate || 0)), 0);
    const taxAmount = subtotal * ((Number(taxRate) || 0) / 100);
    const total = subtotal + taxAmount;

    const onSubmit = async (data: CreateInvoiceFormParams) => {
        const client = clients.find(c => c.id === data.clientId);
        if (!client) return;

        const payload = {
            clientId: client.id,
            clientName: client.name,
            date: data.issueDate ? Timestamp.fromDate(data.issueDate) : Timestamp.now(),
            dueDate: data.dueDate ? Timestamp.fromDate(data.dueDate) : Timestamp.now(),
            status: 'draft' as InvoiceStatus,
            lineItems: data.lineItems.map(item => ({
                ...item,
                amount: Number(item.quantity || 0) * Number(item.rate || 0),
                id: Math.random().toString(36).substring(2, 9)
            })),
            subtotal,
            taxRate: Number(data.taxRate) || 0,
            taxAmount,
            total,
            notes: data.notes
        };

        try {
            await onCreate(payload);
            reset();
            onClose();
        } catch (error) {
            console.error(error);
            alert("Failed to create invoice");
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle>Create New Invoice</DialogTitle>
            <form onSubmit={handleSubmit(onSubmit)}>
                <DialogContent dividers>
                    <Grid container spacing={3}>
                        <Grid size={{ xs: 12, md: 6 }}>
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
                                        disabled={clientsLoading}
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
                                    name="issueDate"
                                    control={control}
                                    render={({ field }) => (
                                        <DatePicker
                                            {...field}
                                            label="Issue Date"
                                            slotProps={{ textField: { size: 'small', fullWidth: true } }}
                                        />
                                    )}
                                />
                            </LocalizationProvider>
                        </Grid>
                        <Grid size={{ xs: 12, md: 3 }}>
                            <LocalizationProvider dateAdapter={AdapterDateFns}>
                                <Controller
                                    name="dueDate"
                                    control={control}
                                    render={({ field }) => (
                                        <DatePicker
                                            {...field}
                                            label="Due Date"
                                            slotProps={{ textField: { size: 'small', fullWidth: true } }}
                                        />
                                    )}
                                />
                            </LocalizationProvider>
                        </Grid>

                        <Grid size={{ xs: 12 }}>
                            <Typography variant="subtitle2" sx={{ mb: 1, mt: 2 }}>Line Items</Typography>
                            {fields.map((item, index) => (
                                <Box key={item.id} sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center' }}>
                                    <Controller
                                        name={`lineItems.${index}.description`}
                                        control={control}
                                        rules={{ required: true }}
                                        render={({ field }) => (
                                            <TextField {...field} label="Description" size="small" sx={{ flex: 3 }} required />
                                        )}
                                    />
                                    <Controller
                                        name={`lineItems.${index}.quantity`}
                                        control={control}
                                        render={({ field }) => (
                                            <TextField {...field} type="number" label="Qty" size="small" sx={{ flex: 1 }} />
                                        )}
                                    />
                                    <Controller
                                        name={`lineItems.${index}.rate`}
                                        control={control}
                                        render={({ field }) => (
                                            <TextField {...field} type="number" label="Rate ($)" size="small" sx={{ flex: 1 }} />
                                        )}
                                    />
                                    <Typography sx={{ width: 80, textAlign: 'right', fontWeight: 'bold' }}>
                                        ${(Number(lineItems[index]?.quantity || 0) * Number(lineItems[index]?.rate || 0)).toFixed(2)}
                                    </Typography>
                                    <IconButton color="error" onClick={() => remove(index)} disabled={fields.length === 1}>
                                        <DeleteIcon />
                                    </IconButton>
                                </Box>
                            ))}
                            <Button startIcon={<AddIcon />} onClick={() => append({ description: '', quantity: 1, rate: 0, amount: 0 })}>
                                Add Item
                            </Button>
                        </Grid>

                        <Grid size={{ xs: 12 }}>
                            <Divider sx={{ my: 2 }} />
                            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
                                <Box sx={{ width: 300 }}>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                                        <Typography>Subtotal:</Typography>
                                        <Typography>${subtotal.toFixed(2)}</Typography>
                                    </Box>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                        <Typography>Tax Rate (%):</Typography>
                                        <Controller
                                            name="taxRate"
                                            control={control}
                                            render={({ field }) => (
                                                <TextField {...field} type="number" size="small" sx={{ width: 80 }} />
                                            )}
                                        />
                                    </Box>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                                        <Typography>Tax Amount:</Typography>
                                        <Typography>${taxAmount.toFixed(2)}</Typography>
                                    </Box>
                                    <Divider sx={{ mb: 1 }} />
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <Typography fontWeight="bold" variant="h6">Total:</Typography>
                                        <Typography fontWeight="bold" variant="h6">${total.toFixed(2)}</Typography>
                                    </Box>
                                </Box>
                            </Box>
                        </Grid>

                        <Grid size={{ xs: 12 }}>
                            <Controller
                                name="notes"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        label="Notes / Terms"
                                        multiline
                                        rows={3}
                                        fullWidth
                                        size="small"
                                    />
                                )}
                            />
                        </Grid>
                    </Grid>
                </DialogContent>
                <DialogActions>
                    <Button onClick={onClose}>Cancel</Button>
                    <Button type="submit" variant="contained" disabled={isSubmitting}>
                        Create Invoice
                    </Button>
                </DialogActions>
            </form>
        </Dialog>
    );
};
