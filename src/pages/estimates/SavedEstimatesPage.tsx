import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Container, Box, Typography, Button, Paper, Chip, IconButton, TextField,
    CircularProgress, InputAdornment, Dialog, DialogTitle, DialogContent,
    DialogActions, Grid, Tooltip
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import VisibilityIcon from '@mui/icons-material/Visibility';
import FolderIcon from '@mui/icons-material/Folder';
import PlaceIcon from '@mui/icons-material/Place';
import SquareFootIcon from '@mui/icons-material/SquareFoot';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import { useAuth } from '../../auth/AuthContext';
import { savedEstimateApi } from '../../api/savedEstimateApi';
import { SavedEstimate } from '../../types/savedEstimate.types';

const SavedEstimatesPage: React.FC = () => {
    const navigate = useNavigate();
    const { userProfile } = useAuth();
    const [estimates, setEstimates] = useState<SavedEstimate[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'final'>('all');
    const [deleteDialog, setDeleteDialog] = useState<SavedEstimate | null>(null);

    const load = async () => {
        if (!userProfile?.companyId) { setLoading(false); return; }
        try {
            setLoading(true);
            const data = await savedEstimateApi.getAll(userProfile.companyId);
            setEstimates(data);
        } catch (err) {
            console.error('Failed to load estimates', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, [userProfile?.companyId]); // eslint-disable-line

    const filtered = estimates.filter(e => {
        if (statusFilter !== 'all' && e.status !== statusFilter) return false;
        if (search) {
            const s = search.toLowerCase();
            return e.projectName.toLowerCase().includes(s) ||
                (e.address || '').toLowerCase().includes(s);
        }
        return true;
    });

    const handleDelete = async () => {
        if (!deleteDialog) return;
        try {
            await savedEstimateApi.remove(deleteDialog.id);
            setEstimates(prev => prev.filter(e => e.id !== deleteDialog.id));
        } catch (err) { console.error('Delete failed', err); }
        setDeleteDialog(null);
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
                    <Chip label={estimates.length} size="small" sx={{ ml: 1 }} />
                </Box>
                <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={() => navigate('/estimates/electrical')}
                    sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600 }}
                >
                    Новый просчёт
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
                    {(['all', 'draft', 'final'] as const).map(s => (
                        <Chip
                            key={s}
                            label={s === 'all' ? 'Все' : s === 'draft' ? 'Черновик' : 'Финал'}
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
                                        background: est.status === 'final'
                                            ? 'linear-gradient(90deg, #4caf50, #81c784)'
                                            : 'linear-gradient(90deg, #1976d2, #64b5f6)',
                                    }
                                }}
                                onClick={() => navigate(`/estimates/projects/${est.id}`)}
                            >
                                {/* Name + Status */}
                                <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={1.5}>
                                    <Typography variant="subtitle1" fontWeight={700} noWrap sx={{ flex: 1, mr: 1 }}>
                                        {est.projectName}
                                    </Typography>
                                    <Chip
                                        label={est.status === 'final' ? 'Финал' : 'Черновик'}
                                        size="small"
                                        color={est.status === 'final' ? 'success' : 'default'}
                                        sx={{ fontSize: '0.65rem', height: 20 }}
                                    />
                                </Box>

                                {/* Address */}
                                {est.address && (
                                    <Box display="flex" alignItems="center" gap={0.5} mb={0.5}>
                                        <PlaceIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                                        <Typography variant="caption" color="text.secondary" noWrap>
                                            {est.address}
                                        </Typography>
                                    </Box>
                                )}

                                {/* Meta row */}
                                <Box display="flex" gap={2} mb={2} flexWrap="wrap">
                                    {est.areaSqft && (
                                        <Box display="flex" alignItems="center" gap={0.5}>
                                            <SquareFootIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                                            <Typography variant="caption" color="text.secondary">
                                                {est.areaSqft.toLocaleString()} sf
                                            </Typography>
                                        </Box>
                                    )}
                                    <Box display="flex" alignItems="center" gap={0.5}>
                                        <InsertDriveFileIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                                        <Typography variant="caption" color="text.secondary">
                                            {est.filesCount} файлов
                                        </Typography>
                                    </Box>
                                </Box>

                                {/* Total */}
                                <Typography variant="h5" fontWeight={800} color="primary.main" mb={0.5}>
                                    ${est.grandTotal?.toLocaleString() || '0'}
                                </Typography>
                                <Typography variant="caption" color="text.disabled">
                                    {formatDate(est.createdAt)}
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

            {/* Delete confirmation */}
            <Dialog open={!!deleteDialog} onClose={() => setDeleteDialog(null)} maxWidth="xs">
                <DialogTitle>Удалить проект?</DialogTitle>
                <DialogContent>
                    <Typography>
                        Проект <strong>"{deleteDialog?.projectName}"</strong> будет удалён навсегда.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteDialog(null)}>Отмена</Button>
                    <Button onClick={handleDelete} color="error" variant="contained">Удалить</Button>
                </DialogActions>
            </Dialog>
        </Container>
    );
};

export default SavedEstimatesPage;
