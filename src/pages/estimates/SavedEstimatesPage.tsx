import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Container, Box, Typography, Button, Paper, Chip, IconButton, TextField,
    CircularProgress, InputAdornment, Dialog, DialogTitle, DialogContent,
    DialogActions, Grid, Tooltip, Autocomplete
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import VisibilityIcon from '@mui/icons-material/Visibility';
import FolderIcon from '@mui/icons-material/Folder';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import { useAuth } from '../../auth/AuthContext';
import { projectsApi } from '../../api/projectsApi';
import { crmApi } from '../../api/crmApi';
import { Project } from '../../types/project.types';
import { Client } from '../../types/crm.types';

const SavedEstimatesPage: React.FC = () => {
    const navigate = useNavigate();
    const { userProfile } = useAuth();
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed'>('all');
    const [deleteDialog, setDeleteDialog] = useState<Project | null>(null);

    // Create modal state
    const [createDialog, setCreateDialog] = useState(false);
    const [newProjectName, setNewProjectName] = useState('');
    const [newProjectAddress, setNewProjectAddress] = useState('');
    const [newProjectSqft, setNewProjectSqft] = useState<number | ''>('');
    const [selectedClient, setSelectedClient] = useState<Client | null>(null);
    const [clients, setClients] = useState<Client[]>([]);
    const [loadingClients, setLoadingClients] = useState(false);

    const load = async () => {
        if (!userProfile?.companyId) { setLoading(false); return; }
        try {
            setLoading(true);
            const data = await projectsApi.getAll(userProfile.companyId);
            setProjects(data);
        } catch (err) {
            console.error('Failed to load estimates', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, [userProfile?.companyId]); // eslint-disable-line

    const filtered = projects.filter(e => {
        if (statusFilter !== 'all' && e.status !== statusFilter) return false;
        if (search) {
            const s = search.toLowerCase();
            return e.name.toLowerCase().includes(s) || (e.clientName || '').toLowerCase().includes(s);
        }
        return true;
    });

    const handleDelete = async () => {
        if (!deleteDialog) return;
        try {
            await projectsApi.remove(deleteDialog.id);
            setProjects(prev => prev.filter(e => e.id !== deleteDialog.id));
        } catch (err) { console.error('Delete failed', err); }
        setDeleteDialog(null);
    };

    const handleOpenCreate = async () => {
        setCreateDialog(true);
        setNewProjectName('');
        setNewProjectAddress('');
        setNewProjectSqft('');
        setSelectedClient(null);
        // Load clients for the selector
        if (userProfile?.companyId && clients.length === 0) {
            setLoadingClients(true);
            try {
                const loadedClients = await crmApi.getClients(userProfile.companyId);
                setClients(loadedClients);
            } catch (err) {
                console.error('Failed to load clients', err);
            } finally {
                setLoadingClients(false);
            }
        }
    };

    const handleCreateProject = async () => {
        if (!userProfile?.companyId || !newProjectName.trim()) return;
        try {
            const newId = await projectsApi.create({
                companyId: userProfile.companyId,
                createdBy: userProfile.id,
                clientId: selectedClient?.id || '',
                clientName: selectedClient?.name || '',
                type: 'estimate',
                name: newProjectName.trim(),
                address: newProjectAddress.trim() || undefined,
                areaSqft: newProjectSqft ? Number(newProjectSqft) : undefined,
                status: 'active',
                files: [],
            });
            setCreateDialog(false);
            navigate(`/estimates/electrical?projectId=${newId}`);
        } catch (err) {
            console.error('Failed to create project', err);
        }
    };

    const formatDate = (ts: any) => {
        if (!ts) return '—';
        const d = ts.toDate ? ts.toDate() : new Date(ts);
        return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    if (loading) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
            {/* Header */}
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={3} flexWrap="wrap" gap={2}>
                <Box display="flex" alignItems="center" gap={1}>
                    <FolderIcon sx={{ fontSize: 32, color: 'primary.main' }} />
                    <Typography variant="h4" fontWeight={700}>Проекты</Typography>
                    <Chip label={projects.length} size="small" sx={{ ml: 1 }} />
                </Box>
                <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={handleOpenCreate}
                    sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600 }}
                >
                    Новый проект
                </Button>
            </Box>

            {/* Filters */}
            <Box display="flex" gap={2} mb={3} flexWrap="wrap" alignItems="center">
                <TextField
                    size="small"
                    placeholder="Поиск по проекту или адресу..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    sx={{ minWidth: 280 }}
                    InputProps={{
                        startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
                    }}
                />
                <Box display="flex" gap={0.5}>
                    {(['all', 'active', 'completed'] as const).map(s => (
                        <Chip
                            key={s}
                            label={s === 'all' ? 'Все' : s === 'active' ? 'В работе' : 'Завершен'}
                            variant={statusFilter === s ? 'filled' : 'outlined'}
                            color={statusFilter === s ? 'primary' : 'default'}
                            onClick={() => setStatusFilter(s)}
                            sx={{ cursor: 'pointer' }}
                        />
                    ))}
                </Box>
            </Box>

            {/* Cards Grid */}
            {filtered.length === 0 ? (
                <Paper sx={{ p: 6, textAlign: 'center', borderRadius: 3 }}>
                    <FolderIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
                    <Typography variant="h6" color="text.secondary">
                        {search ? 'Проекты не найдены' : 'Пока нет сохранённых проектов'}
                    </Typography>
                    <Typography variant="body2" color="text.disabled" mb={2}>
                        Загрузите чертежи и нажмите "Сохранить проект" после анализа
                    </Typography>
                </Paper>
            ) : (
                <Grid container spacing={2}>
                    {filtered.map(est => (
                        <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={est.id}>
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
                                        background: est.status === 'completed'
                                            ? 'linear-gradient(90deg, #4caf50, #81c784)'
                                            : 'linear-gradient(90deg, #1976d2, #64b5f6)',
                                    }
                                }}
                                onClick={() => navigate(`/estimates/projects/${est.id}`)}
                            >
                                <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={1.5}>
                                    <Typography variant="subtitle1" fontWeight={700} noWrap sx={{ flex: 1, mr: 1 }}>
                                        {est.name}
                                    </Typography>
                                    {est.status && (
                                        <Chip
                                            label={est.status === 'completed' ? 'Завершен' : 'В работе'}
                                            size="small"
                                            color={est.status === 'completed' ? 'success' : 'default'}
                                            sx={{ fontSize: '0.65rem', height: 20 }}
                                        />
                                    )}
                                </Box>

                                {/* Files Count */}
                                <Box display="flex" alignItems="center" gap={0.5} mb={2}>
                                    <InsertDriveFileIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                                    <Typography variant="caption" color="text.secondary">
                                        {est.files?.length || 0} файлов
                                    </Typography>
                                </Box>

                                {est.clientName && (
                                    <Typography
                                        variant="caption"
                                        color="primary.main"
                                        display="block"
                                        mb={0.5}
                                        sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                                        onClick={(e: React.MouseEvent) => {
                                            e.stopPropagation();
                                            if (est.clientId) navigate(`/crm/clients/${est.clientId}`);
                                        }}
                                    >
                                        👤 {est.clientName}
                                    </Typography>
                                )}

                                <Typography variant="caption" color="text.disabled">
                                    Создан: {formatDate(est.createdAt)}
                                </Typography>

                                {/* Actions */}
                                <Box display="flex" justifyContent="flex-end" gap={0.5} mt={1}>
                                    <Tooltip title="Просмотр">
                                        <IconButton size="small" onClick={e => { e.stopPropagation(); navigate(`/estimates/projects/${est.id}`); }}>
                                            <VisibilityIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    <Tooltip title="Удалить">
                                        <IconButton size="small" color="error" onClick={e => { e.stopPropagation(); setDeleteDialog(est); }}>
                                            <DeleteIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                </Box>
                            </Paper>
                        </Grid>
                    ))}
                </Grid>
            )}

            <Dialog open={!!deleteDialog} onClose={() => setDeleteDialog(null)} maxWidth="xs">
                <DialogTitle>Удалить проект?</DialogTitle>
                <DialogContent>
                    <Typography>
                        Проект <strong>"{deleteDialog?.name}"</strong> будет удалён навсегда.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteDialog(null)}>Отмена</Button>
                    <Button onClick={handleDelete} color="error" variant="contained">Удалить</Button>
                </DialogActions>
            </Dialog>

            <Dialog open={createDialog} onClose={() => setCreateDialog(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Создать новый проект</DialogTitle>
                <DialogContent>
                    <Grid container spacing={2} sx={{ mt: 1 }}>
                        <Grid size={{ xs: 12 }}>
                            <Autocomplete
                                options={clients}
                                getOptionLabel={(option) => option.name || ''}
                                value={selectedClient}
                                onChange={(_, value) => setSelectedClient(value)}
                                loading={loadingClients}
                                renderInput={(params) => (
                                    <TextField
                                        {...params}
                                        label="Клиент (опционально)"
                                        placeholder="Выберите клиента..."
                                    />
                                )}
                                renderOption={(props, option) => (
                                    <li {...props} key={option.id}>
                                        <Box>
                                            <Typography variant="body2">{option.name}</Typography>
                                            {option.email && (
                                                <Typography variant="caption" color="text.secondary">{option.email}</Typography>
                                            )}
                                        </Box>
                                    </li>
                                )}
                                isOptionEqualToValue={(option, value) => option.id === value.id}
                                noOptionsText="Нет клиентов"
                            />
                        </Grid>
                        <Grid size={{ xs: 12 }}>
                            <TextField
                                fullWidth
                                label="Название проекта *"
                                value={newProjectName}
                                onChange={(e) => setNewProjectName(e.target.value)}
                                autoFocus
                            />
                        </Grid>
                        <Grid size={{ xs: 12 }}>
                            <TextField
                                fullWidth
                                label="Адрес объекта (опционально)"
                                value={newProjectAddress}
                                onChange={(e) => setNewProjectAddress(e.target.value)}
                            />
                        </Grid>
                        <Grid size={{ xs: 12 }}>
                            <TextField
                                fullWidth
                                label="Площадь (Sq Ft - опционально)"
                                type="number"
                                value={newProjectSqft}
                                onChange={(e) => setNewProjectSqft(e.target.value ? Number(e.target.value) : '')}
                            />
                        </Grid>
                    </Grid>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setCreateDialog(false)}>Отмена</Button>
                    <Button
                        onClick={handleCreateProject}
                        color="primary"
                        variant="contained"
                        disabled={!newProjectName.trim()}
                    >
                        Создать и начать расчёт
                    </Button>
                </DialogActions>
            </Dialog>
        </Container>
    );
};

export default SavedEstimatesPage;
