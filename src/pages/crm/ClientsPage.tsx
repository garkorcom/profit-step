import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Box,
    Button,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Typography,
    Chip,
    IconButton,
    CircularProgress,
    Alert,
    Container,
    Tooltip
} from '@mui/material';
import {
    Add as AddIcon,
    Edit as EditIcon,
    Visibility as VisibilityIcon
} from '@mui/icons-material';
import { useAuth } from '../../auth/AuthContext';
import { crmApi } from '../../api/crmApi';
import { Client } from '../../types/crm.types';

const ClientsPage: React.FC = () => {
    const navigate = useNavigate();
    const { userProfile } = useAuth();
    const [clients, setClients] = useState<Client[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchClients = async () => {
            if (!userProfile?.companyId) {
                setLoading(false);
                return;
            }

            try {
                setLoading(true);
                const data = await crmApi.getClients(userProfile.companyId);
                setClients(data);
            } catch (err) {
                console.error('Error loading clients:', err);
                setError('Failed to load clients');
            } finally {
                setLoading(false);
            }
        };

        fetchClients();
    }, [userProfile?.companyId]);

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'new': return 'info';
            case 'contacted': return 'warning';
            case 'qualified': return 'primary';
            case 'customer': return 'success';
            case 'churned': return 'error';
            default: return 'default';
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

    return (
        <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Typography variant="h4" component="h1">
                    Clients
                </Typography>
                <Button
                    variant="contained"
                    color="primary"
                    startIcon={<AddIcon />}
                    onClick={() => navigate('/crm/clients/new')}
                >
                    Add Client
                </Button>
            </Box>

            {error && (
                <Alert severity="error" sx={{ mb: 3 }}>
                    {error}
                </Alert>
            )}

            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>Name</TableCell>
                            <TableCell>Type</TableCell>
                            <TableCell>Contact</TableCell>
                            <TableCell>Status</TableCell>
                            <TableCell>Actions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {clients.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={5} align="center">
                                    <Typography variant="body1" sx={{ py: 3, color: 'text.secondary' }}>
                                        No clients found. Create your first client!
                                    </Typography>
                                </TableCell>
                            </TableRow>
                        ) : (
                            clients.map((client) => (
                                <TableRow key={client.id} hover>
                                    <TableCell>
                                        <Tooltip title={client.name}>
                                            <Typography variant="subtitle2" noWrap sx={{ maxWidth: 200 }}>
                                                {client.name}
                                            </Typography>
                                        </Tooltip>
                                        {client.industry && (
                                            <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 200, display: 'block' }}>
                                                {client.industry}
                                            </Typography>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Chip
                                            label={client.type}
                                            size="small"
                                            variant="outlined"
                                            sx={{ textTransform: 'capitalize' }}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        {client.email && (
                                            <Tooltip title={client.email}>
                                                <Typography variant="body2" display="block" noWrap sx={{ maxWidth: 200 }}>
                                                    {client.email}
                                                </Typography>
                                            </Tooltip>
                                        )}
                                        {client.phone && (
                                            <Typography variant="body2" color="text.secondary">
                                                {client.phone}
                                            </Typography>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Chip
                                            label={client.status}
                                            color={getStatusColor(client.status) as any}
                                            size="small"
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <IconButton
                                            size="small"
                                            onClick={() => navigate(`/crm/clients/${client.id}`)}
                                            title="View Details"
                                        >
                                            <VisibilityIcon />
                                        </IconButton>
                                        <IconButton
                                            size="small"
                                            onClick={() => navigate(`/crm/clients/${client.id}/edit`)}
                                            title="Edit"
                                        >
                                            <EditIcon />
                                        </IconButton>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </TableContainer>
        </Container>
    );
};

export default ClientsPage;
