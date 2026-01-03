import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    Box,
    Typography,
    Button,
    CircularProgress,
    Alert,
    Container,
    Tabs,
    Tab,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Chip,
    IconButton,
    TextField,
    Stack,
    Divider
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import VisibilityIcon from '@mui/icons-material/Visibility';

import { crmApi } from '../../api/crmApi';
import { estimatesApi } from '../../api/estimatesApi';
import { Client } from '../../types/crm.types';
import { Estimate } from '../../types/estimate.types';
import { useAuth } from '../../auth/AuthContext';

interface TabPanelProps {
    children?: React.ReactNode;
    index: number;
    value: number;
}

function TabPanel(props: TabPanelProps) {
    const { children, value, index, ...other } = props;

    return (
        <div
            role="tabpanel"
            hidden={value !== index}
            id={`simple-tabpanel-${index}`}
            aria-labelledby={`simple-tab-${index}`}
            {...other}
        >
            {value === index && (
                <Box sx={{ p: 3 }}>
                    {children}
                </Box>
            )}
        </div>
    );
}

const ClientDetailsPage: React.FC = () => {
    console.log('ClientDetailsPage v2.1 loaded');
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { userProfile } = useAuth();

    const [client, setClient] = useState<Client | null>(null);
    const [estimates, setEstimates] = useState<Estimate[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tabValue, setTabValue] = useState(0);

    // Services State
    const [newService, setNewService] = useState('');
    const [addingService, setAddingService] = useState(false);

    useEffect(() => {
        const fetchData = async () => {
            if (!id || !userProfile?.companyId) {
                setLoading(false);
                return;
            }
            setLoading(true);

            try {
                // Fetch Client
                const clientData = await crmApi.getClientById(id);
                if (clientData) {
                    setClient(clientData);
                } else {
                    setError('Client not found');
                    setLoading(false);
                    return;
                }

                // Fetch Estimates (separately to not block client loading)
                try {
                    const estimatesData = await estimatesApi.getClientEstimates(userProfile.companyId, id);
                    setEstimates(estimatesData);
                } catch (estErr: any) {
                    console.error('Error loading estimates:', estErr);
                    // Check for index error
                    if (estErr.code === 'failed-precondition' && estErr.message?.includes('index')) {
                        console.warn('Missing index for estimates query. Check console for link.');
                        alert('Missing Firestore Index. Open console to get the creation link.');
                    }
                }

            } catch (err: any) {
                console.error('Error loading client:', err);
                setError(`Failed to load client: ${err.message}`);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [id, userProfile?.companyId]);

    const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
        setTabValue(newValue);
    };

    const handleAddService = async () => {
        if (!client || !newService.trim()) return;
        setAddingService(true);
        try {
            const updatedServices = [...(client.services || []), newService.trim()];
            await crmApi.updateClient(client.id, { services: updatedServices });
            setClient({ ...client, services: updatedServices });
            setNewService('');
        } catch (error) {
            console.error('Error adding service:', error);
            setError('Failed to add service');
        } finally {
            setAddingService(false);
        }
    };

    const handleRemoveService = async (serviceToRemove: string) => {
        if (!client) return;
        try {
            const updatedServices = (client.services || []).filter(s => s !== serviceToRemove);
            await crmApi.updateClient(client.id, { services: updatedServices });
            setClient({ ...client, services: updatedServices });
        } catch (error) {
            console.error('Error removing service:', error);
            setError('Failed to remove service');
        }
    };

    if (loading) {
        return (
            <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
                <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                    <CircularProgress />
                </Box>
            </Container>
        );
    }

    if (error || !client) {
        return (
            <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
                <Alert severity="error">{error || 'Client not found'}</Alert>
                <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/crm/clients')} sx={{ mt: 2 }}>
                    Back to Clients
                </Button>
            </Container>
        );
    }

    return (
        <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
            <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/crm/clients')} sx={{ mb: 2 }}>
                Back to Clients
            </Button>

            <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Typography variant="h4">
                    {client.name}
                </Typography>
                <Chip label={client.status} color={client.status === 'customer' ? 'success' : 'default'} />
            </Box>

            <Paper sx={{ width: '100%', mb: 2 }}>
                <Tabs value={tabValue} onChange={handleTabChange} aria-label="client tabs">
                    <Tab label="Details" />
                    <Tab label={`Estimates (${estimates.length})`} />
                    <Tab label="Tasks" disabled />
                </Tabs>
            </Paper>

            <TabPanel value={tabValue} index={0}>
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" gutterBottom>Client Information</Typography>
                    <Typography><strong>Type:</strong> {client.type}</Typography>
                    <Typography><strong>Email:</strong> {client.email || 'N/A'}</Typography>
                    <Typography><strong>Phone:</strong> {client.phone || 'N/A'}</Typography>
                    <Typography><strong>Address:</strong> {client.address || 'N/A'}</Typography>
                    <Typography><strong>Address:</strong> {client.address || 'N/A'}</Typography>

                    <Divider sx={{ my: 3 }} />

                    <Typography variant="h6" gutterBottom>Services / Job Types</Typography>
                    <Box sx={{ mb: 2 }}>
                        {client.services && client.services.length > 0 ? (
                            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                {client.services.map((service, index) => (
                                    <Chip
                                        key={index}
                                        label={service}
                                        onDelete={() => handleRemoveService(service)}
                                        color="primary"
                                        variant="outlined"
                                    />
                                ))}
                            </Stack>
                        ) : (
                            <Typography color="textSecondary" variant="body2">No services configured.</Typography>
                        )}
                    </Box>

                    <Box display="flex" gap={1} alignItems="flex-start" maxWidth="400px">
                        <TextField
                            label="New Service (e.g. Plumbing)"
                            variant="outlined"
                            size="small"
                            fullWidth
                            value={newService}
                            onChange={(e) => setNewService(e.target.value)}
                            onKeyPress={(e) => {
                                if (e.key === 'Enter') {
                                    handleAddService();
                                }
                            }}
                        />
                        <Button
                            variant="contained"
                            disabled={!newService.trim() || addingService}
                            onClick={handleAddService}
                        >
                            Add
                        </Button>
                    </Box>
                </Paper>
            </TabPanel>

            <TabPanel value={tabValue} index={1}>
                <Box display="flex" justifyContent="flex-end" mb={2}>
                    <Button
                        variant="contained"
                        startIcon={<AddIcon />}
                        onClick={() => navigate('/estimates/new')}
                    >
                        Create Estimate
                    </Button>
                </Box>

                <TableContainer component={Paper}>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell>Number</TableCell>
                                <TableCell>Date</TableCell>
                                <TableCell align="right">Total</TableCell>
                                <TableCell align="center">Status</TableCell>
                                <TableCell align="right">Actions</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {estimates.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} align="center">No estimates found</TableCell>
                                </TableRow>
                            ) : (
                                estimates.map((est) => (
                                    <TableRow key={est.id} hover>
                                        <TableCell>{est.number}</TableCell>
                                        <TableCell>{est.createdAt?.toDate().toLocaleDateString()}</TableCell>
                                        <TableCell align="right">${est.total.toFixed(2)}</TableCell>
                                        <TableCell align="center">
                                            <Chip label={est.status} size="small" />
                                        </TableCell>
                                        <TableCell align="right">
                                            <IconButton size="small" onClick={() => navigate(`/estimates/${est.id}`)}>
                                                <VisibilityIcon />
                                            </IconButton>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </TableContainer>
            </TabPanel>
        </Container>
    );
};

export default ClientDetailsPage;
