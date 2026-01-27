import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    Box,
    Button,
    Container,
    Grid,
    Paper,
    TextField,
    Typography,
    MenuItem,
    Alert,
    CircularProgress
} from '@mui/material';
import { Save as SaveIcon, ArrowBack as ArrowBackIcon } from '@mui/icons-material';
import { useAuth } from '../../auth/AuthContext';
import { crmApi } from '../../api/crmApi';
import { Client, ClientType, ClientStatus } from '../../types/crm.types';
import LocationPicker from '../../components/common/LocationPicker';

const ClientBuilderPage: React.FC = () => {
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();
    const { userProfile } = useAuth();
    const isEditMode = !!id;

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [formData, setFormData] = useState<Partial<Client>>({
        name: '',
        type: 'person',
        status: 'new',
        email: '',
        phone: '',
        address: ''
    });

    useEffect(() => {
        const fetchClient = async () => {
            if (!isEditMode || !id) return;
            try {
                setLoading(true);
                const client = await crmApi.getClientById(id);
                if (client) {
                    setFormData(client);
                } else {
                    setError('Client not found');
                }
            } catch (err) {
                console.error('Error fetching client:', err);
                setError('Failed to load client');
            } finally {
                setLoading(false);
            }
        };

        fetchClient();
    }, [isEditMode, id]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!userProfile?.companyId) {
            setError('User profile is missing Company ID. Please contact support.');
            return;
        }

        if (!formData.name) {
            setError('Name is required');
            return;
        }

        try {
            setLoading(true);
            setError(null);

            if (isEditMode && id) {
                await crmApi.updateClient(id, formData);
                navigate(`/crm/clients/${id}`);
            } else {
                const newClientId = await crmApi.createClient({
                    ...formData,
                    companyId: userProfile.companyId,
                    name: formData.name!,
                    type: formData.type as ClientType || 'person',
                    status: formData.status as ClientStatus || 'new',
                } as any);
                navigate(`/crm/clients/${newClientId}`);
            }
        } catch (err) {
            console.error('Error saving client:', err);
            setError('Failed to save client');
        } finally {
            setLoading(false);
        }
    };

    if (loading && isEditMode) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
            <Button
                startIcon={<ArrowBackIcon />}
                onClick={() => navigate('/crm/clients')}
                sx={{ mb: 2 }}
            >
                Back to Clients
            </Button>

            <Paper sx={{ p: 4 }}>
                <Typography variant="h5" gutterBottom>
                    {isEditMode ? 'Edit Client' : 'New Client'}
                </Typography>

                {error && (
                    <Alert
                        severity="error"
                        sx={{ mb: 3 }}
                        action={
                            error.includes('Company ID') ? (
                                <Button color="inherit" size="small" onClick={async () => {
                                    if (!userProfile) return;
                                    try {
                                        const { doc, setDoc, getDoc } = await import('firebase/firestore');
                                        const { db } = await import('../../firebase/firebase');
                                        const userRef = doc(db, 'users', userProfile.id);
                                        await setDoc(userRef, {
                                            companyId: userProfile.id,
                                            role: 'admin'
                                        }, { merge: true });
                                        alert('Profile fixed! Reloading...');
                                        window.location.reload();
                                    } catch (e) {
                                        console.error(e);
                                        alert('Failed to fix profile');
                                    }
                                }}>
                                    FIX PROFILE
                                </Button>
                            ) : null
                        }
                    >
                        {error}
                    </Alert>
                )}

                <form onSubmit={handleSubmit}>
                    <Grid container spacing={3}>
                        <Grid size={{ xs: 12 }}>
                            <TextField
                                fullWidth
                                label="Client Name"
                                name="name"
                                value={formData.name}
                                onChange={handleChange}
                                required
                            />
                        </Grid>

                        <Grid size={{ xs: 12, sm: 6 }}>
                            <TextField
                                fullWidth
                                select
                                label="Type"
                                name="type"
                                value={formData.type}
                                onChange={handleChange}
                            >
                                <MenuItem value="person">Person</MenuItem>
                                <MenuItem value="company">Company</MenuItem>
                            </TextField>
                        </Grid>

                        <Grid size={{ xs: 12, sm: 6 }}>
                            <TextField
                                fullWidth
                                select
                                label="Status"
                                name="status"
                                value={formData.status}
                                onChange={handleChange}
                            >
                                <MenuItem value="new">New</MenuItem>
                                <MenuItem value="contacted">Contacted</MenuItem>
                                <MenuItem value="qualified">Qualified</MenuItem>
                                <MenuItem value="customer">Customer</MenuItem>
                                <MenuItem value="churned">Churned</MenuItem>
                                <MenuItem value="done">Done</MenuItem>
                            </TextField>
                        </Grid>

                        <Grid size={{ xs: 12, sm: 6 }}>
                            <TextField
                                fullWidth
                                label="Email"
                                name="email"
                                type="email"
                                value={formData.email || ''}
                                onChange={handleChange}
                            />
                        </Grid>

                        <Grid size={{ xs: 12, sm: 6 }}>
                            <TextField
                                fullWidth
                                label="Phone"
                                name="phone"
                                value={formData.phone || ''}
                                onChange={handleChange}
                            />
                        </Grid>

                        <Grid size={{ xs: 12 }}>
                            <TextField
                                fullWidth
                                label="Address"
                                name="address"
                                multiline
                                rows={2}
                                value={formData.address || ''}
                                onChange={handleChange}
                            />
                        </Grid>

                        <Grid size={{ xs: 12 }}>
                            <LocationPicker
                                value={formData.workLocation}
                                onChange={(val) => setFormData(prev => ({ ...prev, workLocation: val }))}
                                label="Project Location (Geofence)"
                            />
                        </Grid>

                        <Grid size={{ xs: 12 }}>
                            <Box display="flex" justifyContent="flex-end" gap={2}>
                                <Button
                                    variant="outlined"
                                    onClick={() => navigate('/crm/clients')}
                                    disabled={loading}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    variant="contained"
                                    startIcon={<SaveIcon />}
                                    disabled={loading}
                                >
                                    {loading ? 'Saving...' : 'Save Client'}
                                </Button>
                            </Box>
                        </Grid>
                    </Grid>
                </form>
            </Paper>
        </Container>
    );
};

export default ClientBuilderPage;
