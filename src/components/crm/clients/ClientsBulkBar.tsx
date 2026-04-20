import React, { useState } from 'react';
import {
    Paper,
    Stack,
    Typography,
    Button,
    Divider,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    TextField,
    Slide,
} from '@mui/material';
import { TransitionProps } from '@mui/material/transitions';
import GroupIcon from '@mui/icons-material/Group';
import LabelIcon from '@mui/icons-material/Label';
import TimelineIcon from '@mui/icons-material/Timeline';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import CloseIcon from '@mui/icons-material/Close';

import { crmApi } from '../../../api/crmApi';
import { ClientRow } from '../../../hooks/useClientDashboard';
import { LifecycleStage } from '../../../types/crm.types';
import { LIFECYCLE_LABELS, LIFECYCLE_ORDER } from './designTokens';

interface Props {
    selectedIds: Set<string>;
    clients: ClientRow[];
    ownerOptions: Map<string, string>;
    onClear: () => void;
    onApplied: () => void;
}

const SlideUp = React.forwardRef<unknown, TransitionProps & { children: React.ReactElement }>(
    function SlideUp(props, ref) {
        return <Slide direction="up" ref={ref as React.Ref<HTMLElement>} {...props} />;
    }
);

type DialogKind = null | 'owner' | 'tag' | 'lifecycle';

const ClientsBulkBar: React.FC<Props> = ({ selectedIds, clients, ownerOptions, onClear, onApplied }) => {
    const [dialog, setDialog] = useState<DialogKind>(null);
    const [owner, setOwner] = useState('');
    const [tag, setTag] = useState('');
    const [lifecycle, setLifecycle] = useState<LifecycleStage>('active');
    const [submitting, setSubmitting] = useState(false);

    const selectedClients = clients.filter(c => selectedIds.has(c.id));
    const count = selectedIds.size;
    if (count === 0) return null;

    const closeDialog = () => {
        setDialog(null);
        setOwner('');
        setTag('');
    };

    const applyOwner = async () => {
        if (!owner) return;
        setSubmitting(true);
        try {
            await Promise.all(
                Array.from(selectedIds).map(id =>
                    crmApi.updateClient(id, { assignedTo: owner, createdBy: owner })
                )
            );
            closeDialog();
            onApplied();
        } catch (err) {
            console.error('Bulk owner assign failed:', err);
        } finally {
            setSubmitting(false);
        }
    };

    const applyTag = async () => {
        const normalized = tag.trim();
        if (!normalized) return;
        setSubmitting(true);
        try {
            await Promise.all(
                selectedClients.map(c => {
                    const next = Array.from(new Set([...(c.tags ?? []), normalized]));
                    return crmApi.updateClient(c.id, { tags: next });
                })
            );
            closeDialog();
            onApplied();
        } catch (err) {
            console.error('Bulk tag apply failed:', err);
        } finally {
            setSubmitting(false);
        }
    };

    const applyLifecycle = async () => {
        setSubmitting(true);
        try {
            await Promise.all(
                Array.from(selectedIds).map(id => crmApi.updateClient(id, { lifecycleStage: lifecycle }))
            );
            closeDialog();
            onApplied();
        } catch (err) {
            console.error('Bulk lifecycle change failed:', err);
        } finally {
            setSubmitting(false);
        }
    };

    const exportCsv = () => {
        const headers = ['Name', 'Lifecycle', 'Segment', 'HealthScore', 'LTV', 'Balance', 'Phone', 'Email', 'Tags'];
        const rows = selectedClients.map(c => [
            c.name,
            c.lifecycleStage ?? '',
            c.segment ?? '',
            c.healthScore ?? '',
            c.ltv ?? c.totalRevenue ?? 0,
            c.balance,
            c.contacts?.[0]?.phone ?? c.phone ?? '',
            c.contacts?.[0]?.email ?? c.email ?? '',
            (c.tags ?? []).join(';'),
        ]);
        const csv = [headers, ...rows]
            .map(row =>
                row
                    .map(cell => {
                        const s = String(cell ?? '');
                        return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
                    })
                    .join(',')
            )
            .join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `clients-${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    };

    return (
        <>
            <Paper
                elevation={8}
                sx={{
                    position: 'fixed',
                    bottom: { xs: 12, md: 20 },
                    left: '50%',
                    transform: 'translateX(-50%)',
                    px: 2,
                    py: 1,
                    borderRadius: 3,
                    zIndex: 1200,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    maxWidth: 'calc(100% - 24px)',
                    flexWrap: 'wrap',
                    bgcolor: 'background.paper',
                    border: '1px solid',
                    borderColor: 'divider',
                }}
            >
                <Typography variant="body2" fontWeight={700}>
                    {count} выбрано
                </Typography>
                <Divider orientation="vertical" flexItem />
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                    <Button size="small" startIcon={<GroupIcon />} onClick={() => setDialog('owner')}>
                        Ответственный
                    </Button>
                    <Button size="small" startIcon={<LabelIcon />} onClick={() => setDialog('tag')}>
                        Тег
                    </Button>
                    <Button size="small" startIcon={<TimelineIcon />} onClick={() => setDialog('lifecycle')}>
                        Этап
                    </Button>
                    <Button size="small" startIcon={<FileDownloadIcon />} onClick={exportCsv}>
                        CSV
                    </Button>
                </Stack>
                <Divider orientation="vertical" flexItem />
                <Button size="small" color="inherit" startIcon={<CloseIcon />} onClick={onClear}>
                    Снять выбор
                </Button>
            </Paper>

            <Dialog open={dialog === 'owner'} onClose={closeDialog} TransitionComponent={SlideUp} maxWidth="xs" fullWidth>
                <DialogTitle>Назначить ответственного ({count})</DialogTitle>
                <DialogContent>
                    <FormControl fullWidth sx={{ mt: 1 }}>
                        <InputLabel>Ответственный</InputLabel>
                        <Select value={owner} label="Ответственный" onChange={e => setOwner(e.target.value)}>
                            {Array.from(ownerOptions).map(([id, name]) => (
                                <MenuItem key={id} value={id}>
                                    {name}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </DialogContent>
                <DialogActions>
                    <Button onClick={closeDialog}>Отмена</Button>
                    <Button variant="contained" disabled={!owner || submitting} onClick={applyOwner}>
                        Применить
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog open={dialog === 'tag'} onClose={closeDialog} TransitionComponent={SlideUp} maxWidth="xs" fullWidth>
                <DialogTitle>Добавить тег ({count})</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        fullWidth
                        label="Тег"
                        value={tag}
                        onChange={e => setTag(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && applyTag()}
                        sx={{ mt: 1 }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={closeDialog}>Отмена</Button>
                    <Button variant="contained" disabled={!tag.trim() || submitting} onClick={applyTag}>
                        Добавить
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog
                open={dialog === 'lifecycle'}
                onClose={closeDialog}
                TransitionComponent={SlideUp}
                maxWidth="xs"
                fullWidth
            >
                <DialogTitle>Сменить этап ({count})</DialogTitle>
                <DialogContent>
                    <FormControl fullWidth sx={{ mt: 1 }}>
                        <InputLabel>Этап жизненного цикла</InputLabel>
                        <Select
                            value={lifecycle}
                            label="Этап жизненного цикла"
                            onChange={e => setLifecycle(e.target.value as LifecycleStage)}
                        >
                            {LIFECYCLE_ORDER.map(stage => (
                                <MenuItem key={stage} value={stage}>
                                    {LIFECYCLE_LABELS[stage]}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </DialogContent>
                <DialogActions>
                    <Button onClick={closeDialog}>Отмена</Button>
                    <Button variant="contained" disabled={submitting} onClick={applyLifecycle}>
                        Применить
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
};

export default ClientsBulkBar;
