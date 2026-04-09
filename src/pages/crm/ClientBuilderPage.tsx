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
    CircularProgress,
    IconButton,
    Divider,
    Tooltip
} from '@mui/material';
import {
    Save as SaveIcon,
    ArrowBack as ArrowBackIcon,
    Add as AddIcon,
    Delete as DeleteIcon,
    MyLocation as MyLocationIcon
} from '@mui/icons-material';
import { useAuth } from '../../auth/AuthContext';
import { crmApi } from '../../api/crmApi';
import { Client, ClientType, ClientStatus, ClientContact } from '../../types/crm.types';
import LocationPicker from '../../components/common/LocationPicker';
import { geocodeAddress } from '../../services/geocodingService';

const MAX_CONTACTS = 5;

// Generate unique ID for contacts
const generateContactId = () => `contact_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const emptyContact = (): ClientContact => ({
    id: generateContactId(),
    name: '',
    position: '',
    phone: '',
    email: ''
});

const ClientBuilderPage: React.FC = () => {
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();
    const { userProfile } = useAuth();
    const isEditMode = !!id;

    const [loading, setLoading] = useState(false);
    const [geocoding, setGeocoding] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [formData, setFormData] = useState<Partial<Client>>({
        name: '',
        type: 'person',
        status: 'new',
        email: '',
        phone: '',
        address: '',
        contacts: []
    });

    useEffect(() => {
        const fetchClient = async () => {
            if (!isEditMode || !id) return;
            try {
                setLoading(true);
                const client = await crmApi.getClientById(id);
                if (client) {
                    // Ensure contacts have IDs
                    const contacts = (client.contacts || []).map(c => ({
                        ...c,
                        id: c.id || generateContactId()
                    }));
                    setFormData({ ...client, contacts });
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

    // --- Contact Handlers ---
    const handleAddContact = () => {
        if ((formData.contacts?.length || 0) >= MAX_CONTACTS) return;
        setFormData(prev => ({
            ...prev,
            contacts: [...(prev.contacts || []), emptyContact()]
        }));
    };

    const handleRemoveContact = (contactId: string) => {
        setFormData(prev => ({
            ...prev,
            contacts: (prev.contacts || []).filter(c => c.id !== contactId)
        }));
    };

    const handleContactChange = (contactId: string, field: keyof ClientContact, value: string) => {
        setFormData(prev => ({
            ...prev,
            contacts: (prev.contacts || []).map(c =>
                c.id === contactId ? { ...c, [field]: value } : c
            )
        }));
    };

    // --- Geocoding Handler ---
    const handleAutoGeocode = async () => {
        if (!formData.address) {
            setError('Please enter an address first');
            return;
        }

        setGeocoding(true);
        setError(null);

        try {
            const result = await geocodeAddress(formData.address);
            if (result) {
                setFormData(prev => ({
                    ...prev,
                    workLocation: {
                        latitude: result.lat,
                        longitude: result.lng,
                        radius: prev.workLocation?.radius || 5,
                        address: formData.address
                    }
                }));
            } else {
                setError('Could not find location for this address. Try a more specific address.');
            }
        } catch (err) {
            console.error('Geocoding error:', err);
            setError('Geocoding failed. Please try again.');
        } finally {
            setGeocoding(false);
        }
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
                } as Omit<Client, 'id' | 'createdAt' | 'updatedAt'>);
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

    const contacts = formData.contacts || [];

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
                        onClose={() => setError(null)}
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

                        {/* Contact Persons Section */}
                        <Grid size={{ xs: 12 }}>
                            <Divider sx={{ my: 2 }} />
                            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                                <Typography variant="subtitle1" fontWeight="medium">
                                    📞 Contact Persons ({contacts.length}/{MAX_CONTACTS})
                                </Typography>
                                <Button
                                    size="small"
                                    startIcon={<AddIcon />}
                                    onClick={handleAddContact}
                                    disabled={contacts.length >= MAX_CONTACTS}
                                >
                                    Add Contact
                                </Button>
                            </Box>

                            {contacts.length === 0 && (
                                <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontStyle: 'italic' }}>
                                    No contacts added. Click "Add Contact" to add one.
                                </Typography>
                            )}

                            {contacts.map((contact, index) => (
                                <Paper key={contact.id} variant="outlined" sx={{ p: 2, mb: 2 }}>
                                    <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={1}>
                                        <Typography variant="body2" color="text.secondary">
                                            Contact #{index + 1}
                                        </Typography>
                                        <Tooltip title="Remove contact">
                                            <IconButton
                                                size="small"
                                                color="error"
                                                onClick={() => handleRemoveContact(contact.id)}
                                            >
                                                <DeleteIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                    </Box>
                                    <Grid container spacing={2}>
                                        <Grid size={{ xs: 12, sm: 6 }}>
                                            <TextField
                                                fullWidth
                                                size="small"
                                                label="Name"
                                                value={contact.name}
                                                onChange={(e) => handleContactChange(contact.id, 'name', e.target.value)}
                                                placeholder="John Smith"
                                            />
                                        </Grid>
                                        <Grid size={{ xs: 12, sm: 6 }}>
                                            <TextField
                                                fullWidth
                                                size="small"
                                                label="Position"
                                                value={contact.position || ''}
                                                onChange={(e) => handleContactChange(contact.id, 'position', e.target.value)}
                                                placeholder="Project Manager"
                                            />
                                        </Grid>
                                        <Grid size={{ xs: 12, sm: 6 }}>
                                            <TextField
                                                fullWidth
                                                size="small"
                                                label="Phone"
                                                value={contact.phone}
                                                onChange={(e) => handleContactChange(contact.id, 'phone', e.target.value)}
                                                placeholder="+1 630 489 8580"
                                            />
                                        </Grid>
                                        <Grid size={{ xs: 12, sm: 6 }}>
                                            <TextField
                                                fullWidth
                                                size="small"
                                                label="Email"
                                                type="email"
                                                value={contact.email || ''}
                                                onChange={(e) => handleContactChange(contact.id, 'email', e.target.value)}
                                                placeholder="john@example.com"
                                            />
                                        </Grid>
                                    </Grid>
                                </Paper>
                            ))}
                            <Divider sx={{ my: 2 }} />
                        </Grid>

                        {/* Legacy Email/Phone (kept for compatibility) */}
                        <Grid size={{ xs: 12, sm: 6 }}>
                            <TextField
                                fullWidth
                                label="Primary Email"
                                name="email"
                                type="email"
                                value={formData.email || ''}
                                onChange={handleChange}
                                helperText="Legacy field"
                            />
                        </Grid>

                        <Grid size={{ xs: 12, sm: 6 }}>
                            <TextField
                                fullWidth
                                label="Primary Phone"
                                name="phone"
                                value={formData.phone || ''}
                                onChange={handleChange}
                                helperText="Legacy field"
                            />
                        </Grid>

                        {/* Address with Geocode button */}
                        <Grid size={{ xs: 12 }}>
                            <Box display="flex" gap={1} alignItems="flex-start">
                                <TextField
                                    fullWidth
                                    label="Address"
                                    name="address"
                                    multiline
                                    rows={2}
                                    value={formData.address || ''}
                                    onChange={handleChange}
                                />
                                <Tooltip title="Auto-detect location from address">
                                    <span>
                                        <Button
                                            variant="outlined"
                                            onClick={handleAutoGeocode}
                                            disabled={geocoding || !formData.address}
                                            sx={{ minWidth: 'auto', px: 2, height: 56 }}
                                        >
                                            {geocoding ? <CircularProgress size={20} /> : <MyLocationIcon />}
                                        </Button>
                                    </span>
                                </Tooltip>
                            </Box>
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

