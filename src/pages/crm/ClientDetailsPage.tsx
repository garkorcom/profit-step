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
    Chip,
    IconButton,
    TextField,
    Stack,
    Divider,
    List,
    ListItem,
    ListItemAvatar,
    ListItemText,
    Avatar,
    Grid,
} from '@mui/material';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import PersonIcon from '@mui/icons-material/Person';
import FolderIcon from '@mui/icons-material/Folder';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';

import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { crmApi } from '../../api/crmApi';
import { projectsApi } from '../../api/projectsApi';
import { Client } from '../../types/crm.types';
import { Contact } from '../../types/contact.types';
import { Project } from '../../types/project.types';
import { useAuth } from '../../auth/AuthContext';
import ProjectFinanceTab from '../../components/crm/ProjectFinanceTab';
import ClientEditDialog from '../../components/crm/ClientEditDialog';
import ClientTasksTab from '../../components/crm/ClientTasksTab';

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
    const [projects, setProjects] = useState<Project[]>([]);
    const [linkedContacts, setLinkedContacts] = useState<Contact[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tabValue, setTabValue] = useState(0);

    // Services State
    const [newService, setNewService] = useState('');
    const [addingService, setAddingService] = useState(false);

    // Edit Dialog State
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

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

                // Fetch Projects (unified — estimates + work)
                try {
                    const projectsData = await projectsApi.getProjectsByClient(id);
                    setProjects(projectsData);
                } catch (projErr: any) {
                    console.error('Error loading projects:', projErr);
                }

                // Fetch Linked Global Contacts
                try {
                    const contactsQ = query(collection(db, 'contacts'), where('linkedProjects', 'array-contains', id));
                    const contactsSnap = await getDocs(contactsQ);
                    setLinkedContacts(contactsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Contact)));
                } catch (cErr) {
                    console.error('Error loading linked contacts:', cErr);
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

const getStatusLabel = (status: string) => {
    switch (status) {
        case 'new': return 'Потенциальный';
        case 'contacted': return 'Потенциальный (В контакте)';
        case 'qualified': return 'Потенциальный (Квалифицирован)';
        case 'customer': return 'В работе';
        case 'done': return 'Закрыт';
        case 'churned': return 'Закрыт (Отказ)';
        default: return status;
    }
};

const getStatusColor = (status: string) => {
    switch (status) {
        case 'new': case 'contacted': case 'qualified': return 'primary';
        case 'customer': return 'success';
        case 'done': case 'churned': return 'default';
        default: return 'default';
    }
};

    return (
        <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
            <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/crm/clients')} sx={{ mb: 2 }}>
                Back to Clients
            </Button>

            <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Box display="flex" alignItems="center" gap={2}>
                    <Typography variant="h4">
                        {client.name}
                    </Typography>
                    <IconButton size="small" onClick={() => setIsEditDialogOpen(true)}>
                        <EditIcon fontSize="small" />
                    </IconButton>
                </Box>
                <Chip label={getStatusLabel(client.status)} color={getStatusColor(client.status) as any} />
            </Box>

            <Paper sx={{ width: '100%', mb: 2 }}>
                <Tabs value={tabValue} onChange={handleTabChange} aria-label="client tabs">
                    <Tab label="Details" />
                    <Tab label={`Проекты (${projects.length})`} />
                    <Tab label="💰 Finance" />
                    <Tab label="Tasks" />
                </Tabs>
            </Paper>

            <TabPanel value={tabValue} index={0}>
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" gutterBottom>Client Information</Typography>
                    <Typography><strong>Type:</strong> {client.type}</Typography>
                    <Typography>
                        <strong>Статус:</strong> <Chip size="small" label={getStatusLabel(client.status)} color={getStatusColor(client.status) as any} sx={{ ml: 1 }} />
                    </Typography>
                    {client.sourceType && (
                        <Typography>
                            <strong>Источник:</strong>{' '}
                            {client.sourceType === 'contact' ? `Контакт: ${client.sourceName}` :
                             client.sourceType === 'company' ? `Компания: ${client.sourceName}` :
                             client.source}
                        </Typography>
                    )}
                    <Typography><strong>Email:</strong> {client.email || 'N/A'}</Typography>
                    <Typography><strong>Phone:</strong> {client.phone || 'N/A'}</Typography>
                    <Typography><strong>Address:</strong> {client.address || 'N/A'}</Typography>
                    <Typography>
                        <strong>Website:</strong> {client.website ? (
                            <a href={client.website} target="_blank" rel="noopener noreferrer" style={{ color: '#90caf9' }}>
                                {client.website}
                            </a>
                        ) : 'N/A'}
                    </Typography>

                    {client.contacts && client.contacts.length > 0 && (
                        <Box mt={2}>
                            <Typography variant="subtitle2" color="text.secondary" gutterBottom>Additional Contacts</Typography>
                            <List disablePadding>
                                {client.contacts.map(c => (
                                    <ListItem key={c.id} sx={{ bgcolor: 'rgba(0,0,0,0.02)', mb: 1, borderRadius: 1 }}>
                                        <ListItemAvatar>
                                            <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.light' }}>
                                                {c.name.charAt(0)}
                                            </Avatar>
                                        </ListItemAvatar>
                                        <ListItemText
                                            primary={<Typography variant="body2" fontWeight="bold">{c.name} {c.position ? `(${c.position})` : ''}</Typography>}
                                            secondary={
                                                <Box display="flex" gap={2} mt={0.5}>
                                                    {c.phone && <Typography variant="caption">📞 <a href={`tel:${c.phone}`} style={{ textDecoration: 'none', color: 'inherit' }}>{c.phone}</a></Typography>}
                                                    {c.email && <Typography variant="caption">✉️ <a href={`mailto:${c.email}`} style={{ textDecoration: 'none', color: 'inherit' }}>{c.email}</a></Typography>}
                                                </Box>
                                            }
                                        />
                                    </ListItem>
                                ))}
                            </List>
                        </Box>
                    )}

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

                    <Divider sx={{ my: 3 }} />
                    <Typography variant="h6" gutterBottom>Связанные контакты (Справочник)</Typography>
                    {linkedContacts.length > 0 ? (
                        <List disablePadding>
                            {linkedContacts.map(c => (
                                <ListItem key={c.id} sx={{ bgcolor: 'background.default', mb: 1, borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
                                    <ListItemAvatar>
                                        <Avatar sx={{ bgcolor: 'secondary.main', width: 32, height: 32 }}>
                                            <PersonIcon fontSize="small" />
                                        </Avatar>
                                    </ListItemAvatar>
                                    <ListItemText
                                        primary={<Typography variant="body2" fontWeight="bold">{c.name}</Typography>}
                                        secondary={
                                            <React.Fragment>
                                                {c.roles && c.roles.length > 0 && <Typography variant="caption" color="text.secondary" display="block">{c.roles.join(', ')}</Typography>}
                                                {c.phones && c.phones.length > 0 && <Typography variant="caption" color="text.secondary" display="block">{c.phones.map(p => p.number).join(', ')}</Typography>}
                                            </React.Fragment>
                                        }
                                    />
                                </ListItem>
                            ))}
                        </List>
                    ) : (
                        <Typography color="textSecondary" variant="body2">Нет связанных контактов.</Typography>
                    )}

                    <Divider sx={{ my: 3 }} />

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
                        onClick={() => navigate('/estimates/projects')}
                        sx={{ borderRadius: 2, textTransform: 'none' }}
                    >
                        Новый проект
                    </Button>
                </Box>

                {projects.length === 0 ? (
                    <Paper sx={{ p: 4, textAlign: 'center', borderRadius: 2 }}>
                        <FolderIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
                        <Typography color="text.secondary">Нет проектов для этого клиента</Typography>
                    </Paper>
                ) : (
                    <Grid container spacing={2}>
                        {projects.map(proj => (
                            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={proj.id}>
                                <Paper
                                    elevation={0}
                                    sx={{
                                        p: 2.5, borderRadius: 3,
                                        border: '1px solid', borderColor: 'divider',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s ease',
                                        '&:hover': {
                                            transform: 'translateY(-2px)',
                                            boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
                                            borderColor: 'primary.light',
                                        },
                                        position: 'relative',
                                        overflow: 'hidden',
                                        '&::before': {
                                            content: '""', position: 'absolute',
                                            top: 0, left: 0, right: 0, height: 3,
                                            background: proj.type === 'estimate'
                                                ? 'linear-gradient(90deg, #1976d2, #64b5f6)'
                                                : 'linear-gradient(90deg, #4caf50, #81c784)',
                                        }
                                    }}
                                    onClick={() => navigate(`/estimates/projects/${proj.id}`)}
                                >
                                    <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={1}>
                                        <Typography variant="subtitle2" fontWeight={700} noWrap sx={{ flex: 1, mr: 1 }}>
                                            {proj.name}
                                        </Typography>
                                        <Chip
                                            label={proj.type === 'estimate' ? '📐 Estimate' : '🔧 Work'}
                                            size="small"
                                            sx={{ fontSize: '0.65rem', height: 20 }}
                                        />
                                    </Box>
                                    {proj.address && (
                                        <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                                            📍 {proj.address}
                                        </Typography>
                                    )}
                                    <Box display="flex" alignItems="center" gap={0.5}>
                                        <InsertDriveFileIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                                        <Typography variant="caption" color="text.secondary">
                                            {proj.files?.length || 0} файлов
                                        </Typography>
                                        {proj.status && (
                                            <Chip
                                                label={proj.status === 'completed' ? 'Завершен' : 'В работе'}
                                                size="small"
                                                color={proj.status === 'completed' ? 'success' : 'default'}
                                                sx={{ fontSize: '0.6rem', height: 18, ml: 1 }}
                                            />
                                        )}
                                    </Box>
                                </Paper>
                            </Grid>
                        ))}
                    </Grid>
                )}
            </TabPanel>

            <TabPanel value={tabValue} index={2}>
                <ProjectFinanceTab clientId={client.id} clientName={client.name} />
            </TabPanel>

            <TabPanel value={tabValue} index={3}>
                <ClientTasksTab clientId={client.id} clientName={client.name} />
            </TabPanel>

            <ClientEditDialog
                open={isEditDialogOpen}
                onClose={() => setIsEditDialogOpen(false)}
                client={client}
                onSave={(updatedClient) => setClient(updatedClient)}
            />
        </Container>
    );
};

export default ClientDetailsPage;
