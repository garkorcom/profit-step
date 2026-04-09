import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    Box,
    Typography,
    Button,
    Paper,
    TextField,
    IconButton,
    MenuItem,
    Container,
    CircularProgress,
    Divider
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import SaveIcon from '@mui/icons-material/Save';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ConstructionIcon from '@mui/icons-material/Construction';

import { useAuth } from '../../auth/AuthContext';
import { estimatesApi } from '../../api/estimatesApi';
import { crmApi } from '../../api/crmApi';
import { EstimateItem, EstimateStatus } from '../../types/estimate.types';
import { Client } from '../../types/crm.types';

const EstimateBuilderPage: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { userProfile } = useAuth();

    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [clients, setClients] = useState<Client[]>([]);

    // Form State
    const [clientId, setClientId] = useState('');
    const [items, setItems] = useState<EstimateItem[]>([
        { id: '1', description: '', quantity: 1, unitPrice: 0, total: 0, type: 'service' }
    ]);
    const [notes, setNotes] = useState('');
    const [taxRate, setTaxRate] = useState(0);
    const [status, setStatus] = useState<EstimateStatus | 'locked'>('draft');
    const [estimateNumber, setEstimateNumber] = useState('');

    // Load Clients on Mount
    useEffect(() => {
        const loadClients = async () => {
            if (!userProfile?.companyId) return;
            try {
                // Fetch all clients (simplified for now, ideally paginated search)
                const result = await crmApi.getClients(userProfile.companyId);
                setClients(result);
            } catch (error) {
                console.error('Error loading clients:', error);
            }
        };
        loadClients();
    }, [userProfile?.companyId]);

    // Load Estimate if ID is present
    useEffect(() => {
        const loadEstimate = async () => {
            if (!id || id === 'new') return;
            try {
                setLoading(true);
                const data = await estimatesApi.getEstimateById(id);
                if (data) {
                    setClientId(data.clientId);
                    setItems(data.items);
                    setNotes(data.notes || '');
                    setTaxRate(data.taxRate);
                    setStatus(data.status);
                    setEstimateNumber(data.number);
                }
            } catch (error) {
                console.error('Error loading estimate:', error);
            } finally {
                setLoading(false);
            }
        };
        loadEstimate();
    }, [id]);

    // Calculations
    const subtotal = items.reduce((sum, item) => sum + item.total, 0);
    const taxAmount = subtotal * (taxRate / 100);
    const total = subtotal + taxAmount;

    const handleItemChange = (index: number, field: keyof EstimateItem, value: EstimateItem[keyof EstimateItem]) => {
        const newItems = [...items];
        const item = { ...newItems[index], [field]: value };

        // Recalculate total if qty or price changes
        if (field === 'quantity' || field === 'unitPrice') {
            item.total = Number(item.quantity) * Number(item.unitPrice);
        }

        newItems[index] = item;
        setItems(newItems);
    };

    const addItem = () => {
        setItems([
            ...items,
            {
                id: Date.now().toString(),
                description: '',
                quantity: 1,
                unitPrice: 0,
                total: 0,
                type: 'service'
            }
        ]);
    };

    const removeItem = (index: number) => {
        const newItems = items.filter((_, i) => i !== index);
        setItems(newItems);
    };

    const handleSave = async () => {
        if (!userProfile?.companyId || !userProfile?.id || !clientId) return;

        setSaving(true);
        try {
            const client = clients.find(c => c.id === clientId);
            const data = {
                clientId,
                clientName: client?.name || 'Unknown Client',
                items,
                notes,
                taxRate
            };

            if (id && id !== 'new') {
                await estimatesApi.updateEstimate(id, { ...data, subtotal, taxAmount, total });
            } else {
                const newId = await estimatesApi.createEstimate(userProfile.companyId, userProfile.id, data);
                navigate(`/estimates/${newId}`, { replace: true });
            }
        } catch (error) {
            console.error('Error saving estimate:', error);
            alert('Failed to save estimate');
        } finally {
            setSaving(false);
        }
    };

    const handleApprove = async () => {
        if (!id || id === 'new') return;
        try {
            setSaving(true);
            await estimatesApi.updateStatus(id, 'approved');
            setStatus('approved');
        } catch (error) {
            console.error('Error approving estimate:', error);
        } finally {
            setSaving(false);
        }
    };

    const handleConvert = async () => {
        if (!id || id === 'new' || !userProfile?.companyId || !userProfile?.id) return;
        try {
            setSaving(true);
            const taskId = await estimatesApi.convertToTask(id, userProfile.companyId, userProfile.id);
            setStatus('converted');
            alert(`Estimate converted to Task! ID: ${taskId}`);
            // navigate(`/tasks/${taskId}`); // Uncomment when task route exists
        } catch (error) {
            console.error('Error converting estimate:', error);
            alert('Failed to convert estimate');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <Box p={4} display="flex" justifyContent="center"><CircularProgress /></Box>;
    }

    const isReadOnly = status === 'converted';

    return (
        <Container maxWidth="lg" sx={{ mt: 4, mb: 8 }}>
            {/* Header */}
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/estimates')}>
                    Back
                </Button>
                <Box>
                    {id !== 'new' && (
                        <Typography variant="subtitle1" component="span" sx={{ mr: 2, fontWeight: 'bold' }}>
                            {estimateNumber} ({status.toUpperCase()})
                        </Typography>
                    )}

                    {!isReadOnly && (
                        <Button
                            variant="contained"
                            startIcon={<SaveIcon />}
                            onClick={handleSave}
                            disabled={saving || !clientId}
                            sx={{ mr: 1 }}
                        >
                            Save
                        </Button>
                    )}

                    {status === 'draft' && id !== 'new' && (
                        <Button
                            variant="contained"
                            color="success"
                            startIcon={<CheckCircleIcon />}
                            onClick={handleApprove}
                            disabled={saving}
                            sx={{ mr: 1 }}
                        >
                            Approve
                        </Button>
                    )}

                    {status === 'approved' && (
                        <Button
                            variant="contained"
                            color="secondary"
                            startIcon={<ConstructionIcon />}
                            onClick={handleConvert}
                            disabled={saving}
                        >
                            Convert to Job
                        </Button>
                    )}
                </Box>
            </Box>

            {/* Main Form */}
            <Paper sx={{ p: 3, mb: 3 }}>
                <Box display="flex" gap={3} flexDirection={{ xs: 'column', md: 'row' }}>
                    <Box flex={1}>
                        <TextField
                            select
                            label="Client"
                            fullWidth
                            value={clientId}
                            onChange={(e) => setClientId(e.target.value)}
                            disabled={isReadOnly || (!!id && id !== 'new')} // Lock client after creation for simplicity
                        >
                            {clients.map((client) => (
                                <MenuItem key={client.id} value={client.id}>
                                    {client.name}
                                </MenuItem>
                            ))}
                        </TextField>
                    </Box>
                    <Box flex={1}>
                        <TextField
                            label="Tax Rate (%)"
                            type="number"
                            fullWidth
                            value={taxRate}
                            onChange={(e) => setTaxRate(Number(e.target.value))}
                            disabled={isReadOnly}
                        />
                    </Box>
                </Box>
            </Paper>

            {/* Items */}
            <Paper sx={{ p: 3, mb: 3 }}>
                <Typography variant="h6" gutterBottom>Items</Typography>
                {items.map((item, index) => (
                    <Box key={item.id} sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'flex-start' }}>
                        <TextField
                            label="Description"
                            fullWidth
                            value={item.description}
                            onChange={(e) => handleItemChange(index, 'description', e.target.value)}
                            disabled={isReadOnly}
                        />
                        <TextField
                            select
                            label="Type"
                            sx={{ width: 150 }}
                            value={item.type}
                            onChange={(e) => handleItemChange(index, 'type', e.target.value)}
                            disabled={isReadOnly}
                        >
                            <MenuItem value="labor">Labor</MenuItem>
                            <MenuItem value="material">Material</MenuItem>
                            <MenuItem value="service">Service</MenuItem>
                        </TextField>
                        <TextField
                            label="Qty"
                            type="number"
                            sx={{ width: 100 }}
                            value={item.quantity}
                            onChange={(e) => handleItemChange(index, 'quantity', Number(e.target.value))}
                            disabled={isReadOnly}
                        />
                        <TextField
                            label="Price"
                            type="number"
                            sx={{ width: 120 }}
                            value={item.unitPrice}
                            onChange={(e) => handleItemChange(index, 'unitPrice', Number(e.target.value))}
                            disabled={isReadOnly}
                        />
                        <TextField
                            label="Total"
                            value={item.total.toFixed(2)}
                            disabled
                            sx={{ width: 120 }}
                        />
                        {!isReadOnly && (
                            <IconButton color="error" onClick={() => removeItem(index)} sx={{ mt: 1 }}>
                                <DeleteIcon />
                            </IconButton>
                        )}
                    </Box>
                ))}

                {!isReadOnly && (
                    <Button startIcon={<AddIcon />} onClick={addItem}>
                        Add Item
                    </Button>
                )}
            </Paper>

            {/* Totals & Notes */}
            {/* Totals & Notes */}
            <Box display="flex" gap={3} flexDirection={{ xs: 'column', md: 'row' }}>
                <Box flex={2}>
                    <Paper sx={{ p: 3, height: '100%' }}>
                        <Typography variant="h6" gutterBottom>Notes</Typography>
                        <TextField
                            multiline
                            rows={4}
                            fullWidth
                            placeholder="Terms, conditions, or internal notes..."
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            disabled={isReadOnly}
                        />
                    </Paper>
                </Box>
                <Box flex={1}>
                    <Paper sx={{ p: 3, height: '100%' }}>
                        <Box display="flex" justifyContent="space-between" mb={1}>
                            <Typography>Subtotal:</Typography>
                            <Typography>${subtotal.toFixed(2)}</Typography>
                        </Box>
                        <Box display="flex" justifyContent="space-between" mb={1}>
                            <Typography>Tax ({taxRate}%):</Typography>
                            <Typography>${taxAmount.toFixed(2)}</Typography>
                        </Box>
                        <Divider sx={{ my: 2 }} />
                        <Box display="flex" justifyContent="space-between">
                            <Typography variant="h6">Total:</Typography>
                            <Typography variant="h6" color="primary">${total.toFixed(2)}</Typography>
                        </Box>
                    </Paper>
                </Box>
            </Box>
        </Container>
    );
};

export default EstimateBuilderPage;
