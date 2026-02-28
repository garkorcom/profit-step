/**
 * @fileoverview Project Finance Tab Component
 * 
 * Displays projects and financial ledger for a client.
 * Integrates with Project Accounting System.
 */

import React, { useEffect, useState } from 'react';
import {
    Box,
    Typography,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Button,
    CircularProgress,
    Chip,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Alert,
    Divider,
    Card,
    CardContent,
    Grid,
    Autocomplete
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import PaymentIcon from '@mui/icons-material/Payment';

import { projectsApi } from '../../api/projectsApi';
import { Project, LedgerEntry, LedgerCategory } from '../../types/crm.types';
import { useAuth } from '../../auth/AuthContext';
import { Contact } from '../../types/contact.types';
import { contactsService } from '../../services/contactsService';

interface ProjectFinanceTabProps {
    clientId: string;
    clientName: string;
}

const categoryLabels: Record<LedgerCategory, string> = {
    labor: '👷 Работа',
    materials: '🛒 Материалы',
    admin: '📋 Админ',
    documents: '📄 Документы',
    payment: '💰 Оплата',
    adjustment: '🔧 Корректировка'
};

const ProjectFinanceTab: React.FC<ProjectFinanceTabProps> = ({ clientId, clientName }) => {
    const { userProfile } = useAuth();

    const [projects, setProjects] = useState<Project[]>([]);
    const [selectedProject, setSelectedProject] = useState<Project | null>(null);
    const [ledger, setLedger] = useState<LedgerEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [ledgerLoading, setLedgerLoading] = useState(false);

    // Dialogs
    const [addProjectOpen, setAddProjectOpen] = useState(false);
    const [addEntryOpen, setAddEntryOpen] = useState(false);
    const [newProjectName, setNewProjectName] = useState('');

    // New entry form
    const [entryType, setEntryType] = useState<'debit' | 'credit'>('debit');
    const [entryCategory, setEntryCategory] = useState<LedgerCategory>('labor');
    const [entryAmount, setEntryAmount] = useState('');
    const [entryDescription, setEntryDescription] = useState('');
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [selectedContact, setSelectedContact] = useState<Contact | null>(null);

    useEffect(() => {
        loadProjects();
        if (userProfile?.companyId) {
            loadContacts(userProfile.companyId);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clientId, userProfile?.companyId]);

    const loadContacts = async (companyId: string) => {
        try {
            const data = await contactsService.getContacts(companyId);
            setContacts(data);
        } catch (error) {
            console.error('Error loading contacts:', error);
        }
    };

    const loadProjects = async () => {
        setLoading(true);
        try {
            const data = await projectsApi.getProjectsByClient(clientId);
            setProjects(data);

            // Auto-select first project if exists
            if (data.length > 0 && !selectedProject) {
                setSelectedProject(data[0]);
                loadLedger(data[0].id);
            }
        } catch (error) {
            console.error('Error loading projects:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadLedger = async (projectId: string) => {
        setLedgerLoading(true);
        try {
            const data = await projectsApi.getLedgerByProject(projectId);
            setLedger(data);
        } catch (error) {
            console.error('Error loading ledger:', error);
        } finally {
            setLedgerLoading(false);
        }
    };

    const handleProjectSelect = (project: Project) => {
        setSelectedProject(project);
        loadLedger(project.id);
    };

    const handleCreateProject = async () => {
        if (!newProjectName.trim() || !userProfile) return;

        try {
            await projectsApi.createProject({
                clientId,
                clientName,
                companyId: userProfile.companyId,
                name: newProjectName.trim(),
                createdBy: userProfile.id
            });
            setNewProjectName('');
            setAddProjectOpen(false);
            loadProjects();
        } catch (error) {
            console.error('Error creating project:', error);
        }
    };

    const handleCreateEntry = async () => {
        if (!selectedProject || !entryAmount || !userProfile) return;

        try {
            await projectsApi.createLedgerEntry({
                projectId: selectedProject.id,
                clientId,
                companyId: userProfile.companyId,
                type: entryType,
                category: entryCategory,
                amount: parseFloat(entryAmount),
                description: entryDescription || categoryLabels[entryCategory],
                sourceType: 'manual',
                linkedContactId: selectedContact?.id || undefined,
                linkedContactName: selectedContact?.name || undefined,
                date: new Date(),
                createdBy: userProfile.id
            });

            // Reset form
            setEntryAmount('');
            setEntryDescription('');
            setSelectedContact(null);
            setAddEntryOpen(false);

            // Reload data
            loadProjects();
            loadLedger(selectedProject.id);
        } catch (error) {
            console.error('Error creating entry:', error);
        }
    };

    // Calculate totals
    const totalBalance = projects.reduce((sum, p) => sum + (p.balance || 0), 0);

    if (loading) {
        return (
            <Box display="flex" justifyContent="center" p={4}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box>
            {/* Summary Cards */}
            <Grid container spacing={2} sx={{ mb: 3 }}>
                <Grid size={{ xs: 12, md: 4 }}>
                    <Card sx={{ bgcolor: totalBalance > 0 ? 'warning.light' : 'success.light' }}>
                        <CardContent>
                            <Typography variant="subtitle2" color="text.secondary">
                                Общий баланс
                            </Typography>
                            <Typography variant="h4">
                                ${totalBalance.toFixed(2)}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                {totalBalance > 0 ? 'Клиент должен' : 'Переплата'}
                            </Typography>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                    <Card>
                        <CardContent>
                            <Typography variant="subtitle2" color="text.secondary">
                                Всего начислено
                            </Typography>
                            <Typography variant="h4" color="error.main">
                                ${projects.reduce((sum, p) => sum + (p.totalDebit || 0), 0).toFixed(2)}
                            </Typography>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                    <Card>
                        <CardContent>
                            <Typography variant="subtitle2" color="text.secondary">
                                Всего оплачено
                            </Typography>
                            <Typography variant="h4" color="success.main">
                                ${projects.reduce((sum, p) => sum + (p.totalCredit || 0), 0).toFixed(2)}
                            </Typography>
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>

            {/* Projects List */}
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h6">Проекты</Typography>
                <Button
                    startIcon={<AddIcon />}
                    variant="outlined"
                    size="small"
                    onClick={() => setAddProjectOpen(true)}
                >
                    Новый проект
                </Button>
            </Box>

            {projects.length === 0 ? (
                <Alert severity="info" sx={{ mb: 2 }}>
                    Нет проектов. Создайте первый проект для учёта финансов.
                </Alert>
            ) : (
                <Box sx={{ mb: 3 }}>
                    {projects.map((project) => (
                        <Paper
                            key={project.id}
                            sx={{
                                p: 2,
                                mb: 1,
                                cursor: 'pointer',
                                bgcolor: selectedProject?.id === project.id ? 'action.selected' : 'background.paper',
                                '&:hover': { bgcolor: 'action.hover' }
                            }}
                            onClick={() => handleProjectSelect(project)}
                        >
                            <Box display="flex" justifyContent="space-between" alignItems="center">
                                <Box>
                                    <Typography variant="subtitle1" fontWeight="bold">
                                        {project.name}
                                    </Typography>
                                    <Chip
                                        label={project.status}
                                        size="small"
                                        color={project.status === 'active' ? 'success' : 'default'}
                                    />
                                </Box>
                                <Box textAlign="right">
                                    <Typography
                                        variant="h6"
                                        color={(project.balance || 0) > 0 ? 'error.main' : 'success.main'}
                                    >
                                        ${(project.balance || 0).toFixed(2)}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        баланс
                                    </Typography>
                                </Box>
                            </Box>
                        </Paper>
                    ))}
                </Box>
            )}

            {/* Ledger Table */}
            {selectedProject && (
                <>
                    <Divider sx={{ my: 3 }} />

                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                        <Typography variant="h6">
                            Журнал: {selectedProject.name}
                        </Typography>
                        <Box>
                            <Button
                                startIcon={<AddIcon />}
                                variant="contained"
                                size="small"
                                onClick={() => {
                                    setEntryType('debit');
                                    setEntryCategory('labor');
                                    setAddEntryOpen(true);
                                }}
                                sx={{ mr: 1 }}
                            >
                                Начисление
                            </Button>
                            <Button
                                startIcon={<PaymentIcon />}
                                variant="outlined"
                                size="small"
                                color="success"
                                onClick={() => {
                                    setEntryType('credit');
                                    setEntryCategory('payment');
                                    setAddEntryOpen(true);
                                }}
                            >
                                Оплата
                            </Button>
                        </Box>
                    </Box>

                    {ledgerLoading ? (
                        <Box display="flex" justifyContent="center" p={4}>
                            <CircularProgress size={24} />
                        </Box>
                    ) : (
                        <TableContainer component={Paper}>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>Дата</TableCell>
                                        <TableCell>Описание</TableCell>
                                        <TableCell>Категория</TableCell>
                                        <TableCell align="right">Дебет</TableCell>
                                        <TableCell align="right">Кредит</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {ledger.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} align="center">
                                                Нет записей
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        ledger.map((entry) => (
                                            <TableRow key={entry.id}>
                                                <TableCell>
                                                    {entry.date?.toDate?.()?.toLocaleDateString() || '-'}
                                                </TableCell>
                                                <TableCell>{entry.description}</TableCell>
                                                <TableCell>
                                                    <Chip
                                                        label={categoryLabels[entry.category] || entry.category}
                                                        size="small"
                                                        variant="outlined"
                                                    />
                                                </TableCell>
                                                <TableCell align="right" sx={{ color: 'error.main' }}>
                                                    {entry.type === 'debit' ? `$${entry.amount.toFixed(2)}` : ''}
                                                </TableCell>
                                                <TableCell align="right" sx={{ color: 'success.main' }}>
                                                    {entry.type === 'credit' ? `$${entry.amount.toFixed(2)}` : ''}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    )}
                </>
            )}

            {/* Add Project Dialog */}
            <Dialog open={addProjectOpen} onClose={() => setAddProjectOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Новый проект</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        fullWidth
                        label="Название проекта"
                        value={newProjectName}
                        onChange={(e) => setNewProjectName(e.target.value)}
                        sx={{ mt: 2 }}
                        placeholder="Например: Ремонт кухни"
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setAddProjectOpen(false)}>Отмена</Button>
                    <Button onClick={handleCreateProject} variant="contained" disabled={!newProjectName.trim()}>
                        Создать
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Add Entry Dialog */}
            <Dialog open={addEntryOpen} onClose={() => setAddEntryOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>
                    {entryType === 'debit' ? 'Новое начисление' : 'Новая оплата'}
                </DialogTitle>
                <DialogContent>
                    <FormControl fullWidth sx={{ mt: 2 }}>
                        <InputLabel>Категория</InputLabel>
                        <Select
                            value={entryCategory}
                            label="Категория"
                            onChange={(e) => setEntryCategory(e.target.value as LedgerCategory)}
                        >
                            {entryType === 'debit' ? (
                                <>
                                    <MenuItem value="labor">👷 Работа</MenuItem>
                                    <MenuItem value="materials">🛒 Материалы</MenuItem>
                                    <MenuItem value="admin">📋 Админ расходы</MenuItem>
                                    <MenuItem value="documents">📄 Документы</MenuItem>
                                </>
                            ) : (
                                <>
                                    <MenuItem value="payment">💰 Оплата</MenuItem>
                                    <MenuItem value="adjustment">🔧 Корректировка</MenuItem>
                                </>
                            )}
                        </Select>
                    </FormControl>

                    <TextField
                        fullWidth
                        type="number"
                        label="Сумма"
                        value={entryAmount}
                        onChange={(e) => setEntryAmount(e.target.value)}
                        sx={{ mt: 2 }}
                        InputProps={{ startAdornment: '$' }}
                    />

                    <TextField
                        fullWidth
                        label="Описание"
                        value={entryDescription}
                        onChange={(e) => setEntryDescription(e.target.value)}
                        sx={{ mt: 2 }}
                        multiline
                        rows={2}
                    />

                    <Autocomplete
                        options={contacts}
                        getOptionLabel={(option) => option.name}
                        value={selectedContact}
                        onChange={(_, newValue) => setSelectedContact(newValue)}
                        renderInput={(params) => (
                            <TextField
                                {...params}
                                label="Контакт (Опционально)"
                                placeholder="Выберите подрядчика/клиента"
                            />
                        )}
                        sx={{ mt: 2 }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setAddEntryOpen(false)}>Отмена</Button>
                    <Button
                        onClick={handleCreateEntry}
                        variant="contained"
                        disabled={!entryAmount}
                        color={entryType === 'credit' ? 'success' : 'primary'}
                    >
                        {entryType === 'debit' ? 'Начислить' : 'Записать оплату'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default ProjectFinanceTab;
