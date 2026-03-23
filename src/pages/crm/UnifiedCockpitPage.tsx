/**
 * @fileoverview UnifiedCockpitPage - Single page for all task details
 * 
 * Works with gtd_tasks collection directly.
 * Replaces both NoteCockpitPage and GTDTaskDetailsPage.
 * 
 * Features:
 * - Sticky header with status, timer, actions
 * - Main content: title, description, checklist
 * - Control panel: client, team, schedule, finance
 * 
 * @module pages/crm/UnifiedCockpitPage
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
    Box, Typography, TextField, Button, IconButton, Paper,
    Breadcrumbs, Link, Chip, Select, MenuItem, FormControl,
    Autocomplete, Avatar, Divider, Checkbox,
    Alert, List, ListItem, ListItemIcon, ListItemText, Tab, Tabs, Stack, Snackbar,
    CircularProgress, Tooltip, InputAdornment, FormControlLabel,
    Accordion, AccordionSummary, AccordionDetails,
    Table, TableBody, TableCell, TableHead, TableRow,
    useMediaQuery, useTheme
} from '@mui/material';
import {
    ArrowBack as BackIcon,
    PlayArrow as PlayIcon,
    Stop as StopIcon,
    Delete as DeleteIcon,
    Add as AddIcon,
    DragIndicator as DragIcon,
    AccessTime as TimeIcon,
    Person as PersonIcon,
    CalendarMonth as CalendarIcon,
    Schedule as ScheduleIcon,
    Inventory as InventoryIcon,
    Contacts as ContactsIcon,
    WhatsApp as WhatsAppIcon,
    Telegram as TelegramIcon,
    ExpandMore as ExpandMoreIcon,
    Description as BlueprintIcon,
    Receipt as EstimateIcon,
    BarChart as PercentageIcon,
    Architecture as BlueprintsIcon
} from '@mui/icons-material';
import { doc, updateDoc, onSnapshot, Timestamp, collection, getDocs, query, where, deleteDoc, orderBy, addDoc } from 'firebase/firestore';
import { db, functions } from '../../firebase/firebase';
import { useAuth } from '../../auth/AuthContext';
import { httpsCallable } from 'firebase/functions';
import { GTDTask, GTDStatus, GTDPriority, ChecklistItem } from '../../types/gtd.types';
import { useSessionManager } from '../../hooks/useSessionManager';
import { SmartCockpitInput } from '../../components/tasks/SmartCockpitInput';
import { TaskHistoryTimeline } from '../../components/gtd/TaskHistoryTimeline';
import { format as formatDate } from 'date-fns';
import { ru } from 'date-fns/locale';
import TaskMaterialsTab from '../../components/crm/TaskMaterialsTab';
import { TaskMaterial } from '../../types/inventory.types';
import { calculateMaterialsCost } from '../../features/inventory/inventoryService';
import GlobalContactQuickAdd from '../../components/contacts/GlobalContactQuickAdd';
import GTDSubtasksTable from '../../components/gtd/GTDSubtasksTable';
import ProjectFilesTab from '../../components/crm/ProjectFilesTab';
import { estimatesApi } from '../../api/estimatesApi';
import { Estimate, EstimateStatus } from '../../types/estimate.types';

// ═══════════════════════════════════════════════════════════
// HELPER TYPES
// ═══════════════════════════════════════════════════════════

interface User {
    id: string;
    displayName: string;
    avatarUrl?: string;
}

interface Client {
    id: string;
    name: string;
}

const STATUS_OPTIONS: { value: GTDStatus; label: string; color: string }[] = [
    { value: 'inbox', label: 'Inbox', color: '#9e9e9e' },
    { value: 'next_action', label: 'Next Actions', color: '#2196f3' },
    { value: 'projects', label: 'Projects', color: '#ff9800' },
    { value: 'waiting', label: 'Waiting', color: '#9c27b0' },
    { value: 'estimate', label: 'Estimate', color: '#00bcd4' },
    { value: 'done', label: 'Done', color: '#00c853' },
];

const PRIORITY_OPTIONS: { value: GTDPriority; label: string; color: string }[] = [
    { value: 'none', label: 'None', color: '#9e9e9e' },
    { value: 'low', label: 'Low', color: '#3b82f6' },
    { value: 'medium', label: 'Medium', color: '#f59e0b' },
    { value: 'high', label: 'High', color: '#ef4444' },
];

// ═══════════════════════════════════════════════════════════
// WORK SESSIONS LIST (sub-component)
// ═══════════════════════════════════════════════════════════

const WorkSessionsList: React.FC<{ taskId: string }> = ({ taskId }) => {
    const [sessions, setSessions] = useState<any[]>([]);
    const [loadingSessions, setLoadingSessions] = useState(true);

    useEffect(() => {
        if (!taskId) return;
        setLoadingSessions(true);

        const q = query(
            collection(db, 'work_sessions'),
            where('relatedTaskId', '==', taskId),
            orderBy('startTime', 'desc')
        );

        const unsubscribe = onSnapshot(q, (snap) => {
            setSessions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            setLoadingSessions(false);
        }, (error) => {
            console.error('Error fetching work sessions:', error);
            setLoadingSessions(false);
        });

        return () => unsubscribe();
    }, [taskId]);

    if (loadingSessions && sessions.length === 0) return <CircularProgress size={20} />;
    if (sessions.length === 0) return null;

    // Group by worker for summary
    const workerSummary = sessions.reduce<Record<string, { name: string; totalMinutes: number; totalEarnings: number; count: number }>>((acc, s) => {
        const name = s.workerName || s.userName || 'Работник';
        const start = s.startTime?.toDate ? s.startTime.toDate() : null;
        const end = s.endTime?.toDate ? s.endTime.toDate() : null;
        const duration = s.durationMinutes || (start && end ? Math.round((end.getTime() - start.getTime()) / 60000) : 0);
        if (!acc[name]) acc[name] = { name, totalMinutes: 0, totalEarnings: 0, count: 0 };
        acc[name].totalMinutes += duration;
        acc[name].totalEarnings += s.earnings || 0;
        acc[name].count += 1;
        return acc;
    }, {});

    const workerList = Object.values(workerSummary).sort((a, b) => b.totalMinutes - a.totalMinutes);
    const totalMinutes = workerList.reduce((s, w) => s + w.totalMinutes, 0);
    const totalEarnings = workerList.reduce((s, w) => s + w.totalEarnings, 0);

    return (
        <Box sx={{ mt: 1 }}>
            {/* Per-worker summary */}
            <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2, bgcolor: 'grey.50' }}>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>
                    👥 Кто сколько работал
                </Typography>
                {workerList.map(w => {
                    const pct = totalMinutes > 0 ? Math.round((w.totalMinutes / totalMinutes) * 100) : 0;
                    return (
                        <Box key={w.name} sx={{ mb: 1.5 }}>
                            <Box display="flex" justifyContent="space-between" alignItems="center" mb={0.5}>
                                <Box display="flex" alignItems="center" gap={1}>
                                    <Avatar sx={{ width: 24, height: 24, fontSize: '0.75rem', bgcolor: 'primary.main' }}>
                                        {w.name.charAt(0).toUpperCase()}
                                    </Avatar>
                                    <Typography variant="body2" fontWeight={500}>{w.name}</Typography>
                                    <Chip label={`${w.count} сес.`} size="small" sx={{ height: 20, fontSize: '0.65rem' }} />
                                </Box>
                                <Box textAlign="right">
                                    <Typography variant="body2" fontWeight={600}>
                                        {Math.floor(w.totalMinutes / 60)}ч {w.totalMinutes % 60}м
                                    </Typography>
                                    {w.totalEarnings > 0 && (
                                        <Typography variant="caption" color="success.main">
                                            ${w.totalEarnings.toFixed(2)}
                                        </Typography>
                                    )}
                                </Box>
                            </Box>
                            <Box sx={{ width: '100%', bgcolor: 'grey.200', borderRadius: 1, height: 6 }}>
                                <Box sx={{ width: `${pct}%`, bgcolor: 'primary.main', borderRadius: 1, height: 6, transition: 'width 0.3s' }} />
                            </Box>
                        </Box>
                    );
                })}
                <Divider sx={{ my: 1 }} />
                <Box display="flex" justifyContent="space-between" alignItems="center">
                    <Typography variant="body2" fontWeight={600}>Итого</Typography>
                    <Box textAlign="right">
                        <Typography variant="body2" fontWeight={700}>
                            {Math.floor(totalMinutes / 60)}ч {totalMinutes % 60}м
                        </Typography>
                        {totalEarnings > 0 && (
                            <Typography variant="caption" color="success.main" fontWeight={600}>
                                ${totalEarnings.toFixed(2)}
                            </Typography>
                        )}
                    </Box>
                </Box>
            </Paper>

            {/* Individual sessions */}
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block', textTransform: 'uppercase', letterSpacing: 1 }}>
                Сессии ({sessions.length})
            </Typography>
            {sessions.map((s) => {
                const start = s.startTime?.toDate ? s.startTime.toDate() : null;
                const end = s.endTime?.toDate ? s.endTime.toDate() : null;
                const duration = s.durationMinutes || (start && end ? Math.round((end.getTime() - start.getTime()) / 60000) : 0);
                return (
                    <Paper
                        key={s.id}
                        variant="outlined"
                        sx={{ p: 1.5, mb: 1, borderRadius: 2 }}
                    >
                        <Box display="flex" justifyContent="space-between" alignItems="center">
                            <Box display="flex" alignItems="center" gap={1}>
                                <Avatar sx={{ width: 28, height: 28, fontSize: '0.8rem', bgcolor: 'primary.light' }}>
                                    {(s.workerName || s.userName || 'Р').charAt(0).toUpperCase()}
                                </Avatar>
                                <Box>
                                    <Typography variant="body2" fontWeight={500}>
                                        {s.workerName || s.userName || 'Работник'}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        {start ? formatDate(start, 'dd MMM yyyy, HH:mm', { locale: ru }) : '—'}
                                        {end ? ` → ${formatDate(end, 'HH:mm', { locale: ru })}` : ' → в процессе'}
                                    </Typography>
                                </Box>
                            </Box>
                            <Box textAlign="right">
                                <Typography variant="body2" fontWeight={600}>
                                    {duration ? `${Math.floor(duration / 60)}ч ${duration % 60}м` : '—'}
                                </Typography>
                                {s.earnings ? (
                                    <Typography variant="caption" color="success.main">
                                        ${s.earnings.toFixed(2)}
                                    </Typography>
                                ) : null}
                            </Box>
                        </Box>
                    </Paper>
                );
            })}
        </Box>
    );
};

// ═══════════════════════════════════════════════════════════
// ESTIMATES TAB CONTENT
// ═══════════════════════════════════════════════════════════

const STATUS_COLORS: Record<EstimateStatus, string> = {
    draft: '#9e9e9e',
    sent: '#2196f3',
    approved: '#4caf50',
    rejected: '#f44336',
    converted: '#ff9800',
};

const STATUS_LABELS: Record<EstimateStatus, string> = {
    draft: 'Черновик',
    sent: 'Отправлено',
    approved: 'Одобрено',
    rejected: 'Отклонено',
    converted: 'Конвертировано',
};

const EstimatesTabContent: React.FC<{
    estimates: Estimate[];
    loading: boolean;
    expandedId: string | null;
    onToggle: (id: string) => void;
}> = ({ estimates, loading, expandedId, onToggle }) => {
    if (loading) return <Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box>;

    if (estimates.length === 0) {
        return (
            <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', borderStyle: 'dashed' }}>
                <EstimateIcon sx={{ fontSize: 48, color: 'grey.400', mb: 1 }} />
                <Typography color="text.secondary">Нет смет для этого клиента</Typography>
                <Typography variant="caption" color="text.secondary">
                    Создайте смету на странице Estimates
                </Typography>
            </Paper>
        );
    }

    return (
        <Stack spacing={1.5}>
            {estimates.map(est => {
                const isExpanded = expandedId === est.id;
                const createdDate = est.createdAt?.toDate ? formatDate(est.createdAt.toDate(), 'dd MMM yyyy', { locale: ru }) : '—';
                return (
                    <Paper
                        key={est.id}
                        variant="outlined"
                        sx={{
                            overflow: 'hidden',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            '&:hover': { borderColor: 'primary.main', boxShadow: 1 },
                        }}
                        onClick={() => onToggle(est.id)}
                    >
                        <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
                            <Box flex={1}>
                                <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                                    <Typography variant="subtitle1" fontWeight={600}>
                                        {est.number}
                                    </Typography>
                                    <Chip
                                        label={STATUS_LABELS[est.status] || est.status}
                                        size="small"
                                        sx={{
                                            bgcolor: STATUS_COLORS[est.status] || '#9e9e9e',
                                            color: '#fff',
                                            fontWeight: 600,
                                            height: 22,
                                            fontSize: '0.7rem',
                                        }}
                                    />
                                </Box>
                                <Typography variant="body2" color="text.secondary">
                                    {est.clientName} · {createdDate}
                                </Typography>
                            </Box>
                            <Typography variant="h6" fontWeight={700} color="primary.main">
                                ${est.total?.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </Typography>
                            <ExpandMoreIcon sx={{
                                transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)',
                                transition: 'transform 0.2s',
                            }} />
                        </Box>

                        {isExpanded && (
                            <Box sx={{ px: 2, pb: 2, borderTop: '1px solid', borderColor: 'divider' }}>
                                <Table size="small" sx={{ mt: 1 }}>
                                    <TableHead>
                                        <TableRow>
                                            <TableCell sx={{ fontWeight: 600 }}>Описание</TableCell>
                                            <TableCell align="center" sx={{ fontWeight: 600 }}>Кол-во</TableCell>
                                            <TableCell align="right" sx={{ fontWeight: 600 }}>Цена</TableCell>
                                            <TableCell align="right" sx={{ fontWeight: 600 }}>Итого</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {est.items.map((item, idx) => (
                                            <TableRow key={item.id || idx}>
                                                <TableCell>
                                                    <Box>
                                                        <Typography variant="body2">{item.description}</Typography>
                                                        <Chip label={item.type} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.65rem', mt: 0.5 }} />
                                                    </Box>
                                                </TableCell>
                                                <TableCell align="center">{item.quantity}</TableCell>
                                                <TableCell align="right">${item.unitPrice.toFixed(2)}</TableCell>
                                                <TableCell align="right" sx={{ fontWeight: 600 }}>${item.total.toFixed(2)}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                                <Box sx={{ mt: 1.5, display: 'flex', justifyContent: 'flex-end', gap: 3 }}>
                                    <Typography variant="body2" color="text.secondary">
                                        Subtotal: <strong>${est.subtotal?.toFixed(2)}</strong>
                                    </Typography>
                                    {est.taxAmount > 0 && (
                                        <Typography variant="body2" color="text.secondary">
                                            Tax ({est.taxRate}%): <strong>${est.taxAmount?.toFixed(2)}</strong>
                                        </Typography>
                                    )}
                                    <Typography variant="body1" fontWeight={700} color="primary.main">
                                        Total: ${est.total?.toFixed(2)}
                                    </Typography>
                                </Box>
                                {est.notes && (
                                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                        📝 {est.notes}
                                    </Typography>
                                )}
                            </Box>
                        )}
                    </Paper>
                );
            })}
        </Stack>
    );
};

// ═══════════════════════════════════════════════════════════
// BLUEPRINTS TAB CONTENT (Enhanced with sections)
// ═══════════════════════════════════════════════════════════

const BLUEPRINT_SECTIONS = [
    { key: 'electrical', label: 'Electrical', icon: '⚡' },
    { key: 'plumbing', label: 'Plumbing', icon: '🔧' },
    { key: 'mechanical', label: 'Mechanical', icon: '⚙️' },
    { key: 'architectural', label: 'Architectural', icon: '🏗️' },
    { key: 'fire', label: 'Fire', icon: '🔥' },
    { key: 'general', label: 'General', icon: '📄' },
] as const;

type BlueprintSection = typeof BLUEPRINT_SECTIONS[number]['key'];

interface BlueprintFile {
    id: string;
    name: string;
    path: string;
    url: string;
    size: number;
    contentType: string;
    description: string;
    version: number;
    uploadedBy: string;
    uploadedAt: string | null;
    section?: string;
}

const BlueprintsTabContent: React.FC<{ projectId: string }> = ({ projectId }) => {
    const [files, setFiles] = useState<BlueprintFile[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [selectedSection, setSelectedSection] = useState<BlueprintSection>('electrical');
    const [uploadSection, setUploadSection] = useState<BlueprintSection>('electrical');
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);
    const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(BLUEPRINT_SECTIONS.map(s => s.key)));

    useEffect(() => {
        if (!projectId) return;
        setLoading(true);

        const q = query(
            collection(db, `clients/${projectId}/files`),
            orderBy('uploadedAt', 'desc')
        );

        const unsubscribe = onSnapshot(q, (snap) => {
            const filesList: BlueprintFile[] = snap.docs.map(d => {
                const data = d.data();
                return {
                    id: d.id,
                    name: data.name || 'unnamed',
                    path: data.path || '',
                    url: data.url || '',
                    size: data.size || 0,
                    contentType: data.contentType || '',
                    description: data.description || '',
                    version: data.version || 1,
                    uploadedBy: data.uploadedBy || 'unknown',
                    uploadedAt: data.uploadedAt?.toDate?.()?.toISOString() || null,
                    section: data.section || 'general',
                };
            });
            setFiles(filesList);
            setLoading(false);
        }, (err) => {
            console.error('Error loading blueprint files:', err);
            setError('Не удалось загрузить файлы');
            setLoading(false);
        });

        return () => unsubscribe();
    }, [projectId]);

    const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFiles = event.target.files;
        if (!selectedFiles || selectedFiles.length === 0) return;

        setUploading(true);
        setError(null);

        try {
            for (let i = 0; i < selectedFiles.length; i++) {
                const file = selectedFiles[i];
                if (file.size > 50 * 1024 * 1024) {
                    setError(`Файл "${file.name}" слишком большой (максимум 50MB)`);
                    continue;
                }

                const base64 = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                        const result = reader.result as string;
                        resolve(result.split(',')[1]);
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });

                const response = await fetch(`/api/projects/${projectId}/files`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        fileName: file.name,
                        contentType: file.type,
                        base64Data: base64,
                        section: uploadSection,
                    }),
                });

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.error || `Upload failed: ${response.status}`);
                }

                setSuccessMsg(`Файл "${file.name}" загружен в ${uploadSection}`);
            }
        } catch (err: any) {
            console.error('Upload error:', err);
            setError(err.message || 'Ошибка загрузки файла');
        } finally {
            setUploading(false);
            event.target.value = '';
        }
    }, [projectId, uploadSection]);

    const toggleSection = (key: string) => {
        setExpandedSections(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const formatFileSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    if (loading) return <Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box>;

    // Group files by section
    const grouped: Record<string, BlueprintFile[]> = {};
    BLUEPRINT_SECTIONS.forEach(s => { grouped[s.key] = []; });
    files.forEach(f => {
        const sec = f.section || 'general';
        if (grouped[sec]) grouped[sec].push(f);
        else grouped['general'].push(f);
    });

    return (
        <Box>
            {/* Upload area */}
            <Paper variant="outlined" sx={{ p: 2, mb: 2, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                <FormControl size="small" sx={{ minWidth: 160 }}>
                    <Select
                        value={uploadSection}
                        onChange={(e) => setUploadSection(e.target.value as BlueprintSection)}
                        displayEmpty
                    >
                        {BLUEPRINT_SECTIONS.map(s => (
                            <MenuItem key={s.key} value={s.key}>{s.icon} {s.label}</MenuItem>
                        ))}
                    </Select>
                </FormControl>
                <Button
                    variant="contained"
                    component="label"
                    disabled={uploading}
                    startIcon={uploading ? <CircularProgress size={18} color="inherit" /> : <AddIcon />}
                >
                    {uploading ? 'Загрузка...' : 'Загрузить'}
                    <input
                        type="file"
                        hidden
                        multiple
                        accept=".pdf,.png,.jpg,.jpeg,.dwg,.dxf"
                        onChange={handleFileUpload}
                    />
                </Button>
            </Paper>

            {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
            {successMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg(null)}>{successMsg}</Alert>}

            {/* Sections */}
            {BLUEPRINT_SECTIONS.map(sec => {
                const sectionFiles = grouped[sec.key] || [];
                return (
                    <Accordion
                        key={sec.key}
                        expanded={expandedSections.has(sec.key)}
                        onChange={() => toggleSection(sec.key)}
                        variant="outlined"
                        sx={{ mb: 1, '&:before': { display: 'none' } }}
                        disableGutters
                    >
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Box display="flex" alignItems="center" gap={1}>
                                <Typography>{sec.icon}</Typography>
                                <Typography fontWeight={600}>{sec.label}</Typography>
                                <Chip label={sectionFiles.length} size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                            </Box>
                        </AccordionSummary>
                        <AccordionDetails sx={{ p: 1 }}>
                            {sectionFiles.length === 0 ? (
                                <Typography variant="body2" color="text.secondary" sx={{ py: 1, pl: 1 }}>
                                    Нет файлов в этом разделе
                                </Typography>
                            ) : (
                                <List dense disablePadding>
                                    {sectionFiles.map(file => (
                                        <ListItem key={file.id} sx={{ py: 0.5 }}>
                                            <ListItemIcon sx={{ minWidth: 36 }}>
                                                {file.contentType?.includes('pdf') ? <BlueprintIcon color="error" fontSize="small" /> : <BlueprintIcon color="primary" fontSize="small" />}
                                            </ListItemIcon>
                                            <ListItemText
                                                primary={
                                                    <Link href={file.url} target="_blank" rel="noopener noreferrer" underline="hover" fontWeight={500}>
                                                        {file.name}
                                                    </Link>
                                                }
                                                secondary={`${formatFileSize(file.size)} · v${file.version}${file.uploadedAt ? ' · ' + formatDate(new Date(file.uploadedAt), 'dd MMM yyyy', { locale: ru }) : ''}`}
                                            />
                                        </ListItem>
                                    ))}
                                </List>
                            )}
                        </AccordionDetails>
                    </Accordion>
                );
            })}
        </Box>
    );
};

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════

const UnifiedCockpitPage: React.FC = () => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const { taskId } = useParams<{ taskId: string }>();
    const navigate = useNavigate();
    const location = useLocation();
    const { currentUser, userProfile } = useAuth();

    // Context-aware back navigation
    const backPath = (location.state as any)?.from || '/crm/gtd';

    // Session manager for timer
    const { activeSession, startSession, stopSession } = useSessionManager(
        currentUser?.uid,
        currentUser?.displayName || undefined
    );

    // Timer elapsed seconds (calculated from activeSession)
    const [timerSeconds, setTimerSeconds] = useState(0);

    // State
    const [task, setTask] = useState<GTDTask | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);
    const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);

    // Refs for autosave
    const savingRef = useRef(false);
    const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
    const hasChangesRef = useRef(false);

    // Form state
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [status, setStatus] = useState<GTDStatus>('inbox');
    const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
    const [clientId, setClientId] = useState<string | null>(null);
    const [clientName, setClientName] = useState<string | null>(null);
    const [assigneeId, setAssigneeId] = useState<string | null>(null);
    const [assigneeName, setAssigneeName] = useState<string | null>(null);
    const [needsEstimate, setNeedsEstimate] = useState(false);
    const [priority, setPriority] = useState<GTDPriority>('none');

    // New fields
    const [estimatedDurationMinutes, setEstimatedDurationMinutes] = useState<number | ''>('');
    const [startDate, setStartDate] = useState<string>('');
    const [dueDate, setDueDate] = useState<string>('');
    const [dueDateManual, setDueDateManual] = useState(false);
    const [coAssignees, setCoAssignees] = useState<Array<{ id: string; name: string; role: 'executor' | 'reviewer' | 'observer' }>>([]);

    // Materials state
    const [materials, setMaterials] = useState<TaskMaterial[]>([]);

    // Subtasks state (for GTDSubtasksTable)
    const [subtasks, setSubtasks] = useState<GTDTask[]>([]);

    // Contacts state
    const [contacts, setContacts] = useState<any[]>([]);
    const [linkedContactIds, setLinkedContactIds] = useState<string[]>([]);

    // Linked project for files tab
    const [linkedProjectId, setLinkedProjectId] = useState<string | null>(null);
    const [globalContactOpen, setGlobalContactOpen] = useState(false);

    // reference arrays
    const [clients, setClients] = useState<Client[]>([]);
    const [users, setUsers] = useState<User[]>([]);

    // AI modification state
    const [isAiModifying, setIsAiModifying] = useState(false);

    // Estimates state
    const [estimates, setEstimates] = useState<Estimate[]>([]);
    const [estimatesLoading, setEstimatesLoading] = useState(false);
    const [expandedEstimateId, setExpandedEstimateId] = useState<string | null>(null);

    // Tab state
    const [activeTab, setActiveTab] = useState(0);

    // ─────────────────────────────────────────────────────────
    // LOAD DATA
    // ─────────────────────────────────────────────────────────

    useEffect(() => {
        if (!taskId) return;

        // Real-time subscription to task
        const unsubscribe = onSnapshot(doc(db, 'gtd_tasks', taskId), (snap) => {
            if (snap.exists()) {
                const data = { id: snap.id, ...snap.data() } as GTDTask;
                setTask(data);

                // Skip form re-init when WE just saved (to avoid overwriting user edits)
                if (savingRef.current) return;

                // Initialize form state
                setTitle(data.title || '');
                setDescription(data.description || '');
                setStatus(data.status);
                setChecklist(data.checklistItems || []);
                setClientId(data.clientId || null);
                setClientName(data.clientName || null);
                setAssigneeId(data.assigneeId || null);
                setAssigneeName(data.assigneeName || null);
                setNeedsEstimate(data.needsEstimate || false);
                setPriority(data.priority || 'none');
                setEstimatedDurationMinutes(data.estimatedDurationMinutes || '');

                // Convert Timestamp to date string for inputs
                if (data.startDate) {
                    const sd = data.startDate as any;
                    const dateObj = sd?.toDate ? sd.toDate() : new Date(sd);
                    setStartDate(formatDate(dateObj, 'yyyy-MM-dd'));
                } else {
                    setStartDate('');
                }
                if (data.dueDate) {
                    const dd = data.dueDate as any;
                    const dateObj = dd?.toDate ? dd.toDate() : new Date(dd);
                    setDueDate(formatDate(dateObj, 'yyyy-MM-dd'));
                } else {
                    setDueDate('');
                }
                setDueDateManual(false);
                setCoAssignees(data.coAssignees || []);
                setMaterials(data.materials || []);
                setLinkedContactIds(data.linkedContactIds || []);

                setLoading(false);
            }
        });

        // Real-time subscription to subtasks for this parent task
        const subtasksQuery = query(
            collection(db, 'gtd_tasks'),
            where('parentTaskId', '==', taskId)
        );
        const unsubSubtasks = onSnapshot(subtasksQuery, (snap) => {
            setSubtasks(snap.docs.map(d => ({ id: d.id, ...d.data() } as GTDTask)));
        });

        // Load clients
        getDocs(query(collection(db, 'clients'), where('status', '!=', 'archived')))
            .then(snap => {
                setClients(snap.docs.map(d => ({
                    id: d.id,
                    name: d.data().name
                })));
            });

        // Load users (all users, not filtered by status)
        getDocs(collection(db, 'users'))
            .then(snap => {
                setUsers(snap.docs
                    .map(d => ({
                        id: d.id,
                        displayName: d.data().displayName,
                        avatarUrl: d.data().avatarUrl
                    }))
                    .filter(u => u.displayName)
                    .sort((a, b) => a.displayName.localeCompare(b.displayName))
                );
            });

        // Load Contacts
        getDocs(query(collection(db, 'contacts'), orderBy('name')))
            .then(snap => {
                setContacts(snap.docs.map(d => ({
                    id: d.id,
                    ...d.data()
                })));
            });

        return () => {
            unsubscribe();
            unsubSubtasks();
        };
    }, [taskId]);

    // Look up linked project when clientId changes (for Files tab)
    useEffect(() => {
        if (!clientId) {
            setLinkedProjectId(null);
            return;
        }
        getDocs(query(collection(db, 'projects'), where('clientId', '==', clientId)))
            .then(snap => {
                if (!snap.empty) {
                    const sorted = snap.docs
                        .map(d => ({ id: d.id, ...d.data() }))
                        .sort((a: any, b: any) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0));
                    setLinkedProjectId(sorted[0].id);
                } else {
                    setLinkedProjectId(null);
                }
            })
            .catch(err => console.error('Error finding linked project:', err));
    }, [clientId]);

    // Auto-calculate end date from startDate + estimatedDurationMinutes
    useEffect(() => {
        if (!dueDateManual && startDate && estimatedDurationMinutes) {
            const start = new Date(startDate + 'T00:00:00');
            const durationMs = Number(estimatedDurationMinutes) * 60 * 1000;
            const end = new Date(start.getTime() + durationMs);
            setDueDate(formatDate(end, 'yyyy-MM-dd'));
            setHasChanges(true);
        }
    }, [startDate, estimatedDurationMinutes, dueDateManual]);

    // Timer tick - calculate elapsed time from activeSession startTime
    useEffect(() => {
        const isTimerRunningForThisTask = activeSession?.relatedTaskId === taskId;
        if (!isTimerRunningForThisTask || !activeSession?.startTime) {
            setTimerSeconds(0);
            return;
        }

        // Initial calculation
        const startTime = activeSession.startTime.toDate();
        const updateTimer = () => {
            const elapsed = Math.floor((Date.now() - startTime.getTime()) / 1000);
            setTimerSeconds(elapsed);
        };
        updateTimer();

        // Tick every second
        const interval = setInterval(updateTimer, 1000);
        return () => clearInterval(interval);
    }, [activeSession, taskId]);

    // ─────────────────────────────────────────────────────────
    // LOAD ESTIMATES for client
    // ─────────────────────────────────────────────────────────
    useEffect(() => {
        if (!clientId || !userProfile?.companyId) {
            setEstimates([]);
            return;
        }
        setEstimatesLoading(true);
        estimatesApi.getClientEstimates(userProfile.companyId, clientId)
            .then(data => setEstimates(data))
            .catch(err => console.error('Error loading estimates:', err))
            .finally(() => setEstimatesLoading(false));
    }, [clientId, userProfile?.companyId]);

    // ─────────────────────────────────────────────────────────
    // HANDLERS
    // ─────────────────────────────────────────────────────────

    const handleSave = useCallback(async () => {
        if (!taskId || savingRef.current) return;
        savingRef.current = true;
        setSaving(true);

        try {
            // Build history events for co-assignee changes
            const prevCoIds = (task?.coAssignees || []).map(c => c.id);
            const newCoIds = coAssignees.map(c => c.id);
            const historyUpdates: any[] = [...(task?.taskHistory || [])];

            // Detect added co-assignees
            coAssignees.forEach(ca => {
                if (!prevCoIds.includes(ca.id)) {
                    historyUpdates.push({
                        type: 'co_assignee_added',
                        description: `Добавлен соисполнитель: ${ca.name} (${ca.role === 'executor' ? 'Исполнитель' : ca.role === 'reviewer' ? 'Ревьюер' : 'Наблюдатель'})`,
                        userId: currentUser?.uid,
                        userName: currentUser?.displayName || '',
                        timestamp: Timestamp.now(),
                    });
                }
            });
            // Detect removed co-assignees
            (task?.coAssignees || []).forEach((ca: any) => {
                if (!newCoIds.includes(ca.id)) {
                    historyUpdates.push({
                        type: 'co_assignee_removed',
                        description: `Удалён соисполнитель: ${ca.name}`,
                        userId: currentUser?.uid,
                        userName: currentUser?.displayName || '',
                        timestamp: Timestamp.now(),
                    });
                }
            });

            await updateDoc(doc(db, 'gtd_tasks', taskId), {
                title,
                description,
                status,
                checklistItems: checklist,
                clientId: clientId || null,
                clientName: clientName || null,
                assigneeId: assigneeId || null,
                assigneeName: assigneeName || null,
                needsEstimate,
                priority,
                estimatedDurationMinutes: estimatedDurationMinutes || null,
                startDate: startDate ? Timestamp.fromDate(new Date(startDate + 'T00:00:00')) : null,
                dueDate: dueDate ? Timestamp.fromDate(new Date(dueDate + 'T00:00:00')) : null,
                coAssignees: coAssignees.length > 0 ? coAssignees : [],
                coAssigneeIds: coAssignees.map(c => c.id),
                taskHistory: historyUpdates,
                materials: materials.length > 0 ? materials : [],
                materialsCostPlanned: calculateMaterialsCost(materials).planned || null,
                materialsCostActual: calculateMaterialsCost(materials).actual || null,
                linkedContactIds: linkedContactIds.length > 0 ? linkedContactIds : [],
                updatedAt: Timestamp.now()
            });
            setHasChanges(false);
            hasChangesRef.current = false;
            setLastSavedAt(new Date());
            setSaveError(null);
        } catch (error: any) {
            console.error('Save failed:', error);
            setSaveError(error.message || 'Ошибка автосохранения. Проверьте подключение к интернету.');
        } finally {
            setSaving(false);
            // Allow onSnapshot re-init after a short delay
            setTimeout(() => { savingRef.current = false; }, 1000);
        }
    }, [taskId, title, description, status, checklist, clientId, clientName, assigneeId, assigneeName, needsEstimate, priority, estimatedDurationMinutes, startDate, dueDate, coAssignees, materials, linkedContactIds, task, currentUser]);

    // ── Debounced autosave ──
    useEffect(() => {
        hasChangesRef.current = hasChanges;
        if (!hasChanges) return;

        // Clear previous timer
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

        // Schedule save after 1.5s of inactivity
        autoSaveTimerRef.current = setTimeout(() => {
            handleSave();
        }, 1500);

        return () => {
            if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        };
    }, [hasChanges, handleSave]);

    // Save on unmount (navigating away)
    useEffect(() => {
        return () => {
            if (hasChangesRef.current) {
                // Fire-and-forget save
                handleSave();
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleStatusChange = (newStatus: GTDStatus) => {
        setStatus(newStatus);
        setHasChanges(true);
    };

    const handleTimerToggle = async () => {
        if (!taskId || !currentUser || !task) return;

        const isTimerRunningForThisTask = activeSession?.relatedTaskId === taskId;

        if (isTimerRunningForThisTask) {
            await stopSession();
        } else {
            // Pass task object for startSession
            await startSession({
                id: taskId,
                title,
                clientId: clientId || '',
                clientName: clientName || '',
            } as GTDTask);
        }
    };

    const handleAiModification = async (command: string) => {
        if (!taskId || !task) return;
        setIsAiModifying(true);
        try {
            const modifyTaskCallable = httpsCallable(functions, 'modifyAiTask');

            // Build current snapshot
            const currentSnapshot = {
                title,
                description,
                estimatedDurationMinutes: Number(estimatedDurationMinutes) || 0,
                checklistItems: checklist
            };

            const result = await modifyTaskCallable({
                currentTask: currentSnapshot,
                userCommand: command
            });

            const data = result.data as any; // TaskModification

            const changedFields = [];

            if (data.title && data.title !== title) {
                setTitle(data.title);
                changedFields.push('название');
            }
            if (data.description !== undefined && data.description !== description) {
                setDescription(data.description);
                changedFields.push('описание');
            }
            if (data.estimatedDurationMinutes !== undefined && data.estimatedDurationMinutes !== estimatedDurationMinutes) {
                setEstimatedDurationMinutes(data.estimatedDurationMinutes);
                changedFields.push('длительность');
            }
            if (data.checklistItems) {
                setChecklist(data.checklistItems);
                changedFields.push('чеклист');
            }

            if (changedFields.length > 0) {
                setHasChanges(true);

                // Immediately save the history log to avoid race conditions with generic auto-save
                const historyUpdates: any[] = [...(task?.taskHistory || [])];
                historyUpdates.push({
                    type: 'ai_mutation_snapshot',
                    description: `AI-редактура: изменены ${changedFields.join(', ')}`,
                    userId: currentUser?.uid,
                    userName: currentUser?.displayName || '',
                    timestamp: Timestamp.now(),
                    prompt: command
                });

                await updateDoc(doc(db, 'gtd_tasks', taskId), {
                    taskHistory: historyUpdates
                });
            }

        } catch (error: any) {
            console.error('AI Modification Failed:', error);
            setSaveError(error.message || 'Ошибка AI-ассистента. Проверьте логи.');
        } finally {
            setIsAiModifying(false);
        }
    };

    const handleChecklistToggle = (itemId: string) => {
        setChecklist(prev => prev.map(item =>
            item.id === itemId ? { ...item, completed: !item.completed } : item
        ));
        setHasChanges(true);
    };

    const handleAddChecklistItem = () => {
        const newItem: ChecklistItem = {
            id: crypto.randomUUID(),
            text: '',
            completed: false,
            createdAt: Timestamp.now()
        };
        setChecklist(prev => [...prev, newItem]);
        setHasChanges(true);
    };

    const handleChecklistTextChange = (itemId: string, text: string) => {
        setChecklist(prev => prev.map(item =>
            item.id === itemId ? { ...item, text } : item
        ));
        setHasChanges(true);
    };

    // ── Subtask handlers ──
    const handleUpdateSubtask = useCallback(async (subtaskId: string, updates: Partial<GTDTask>) => {
        const taskRef = doc(db, 'gtd_tasks', subtaskId);
        await updateDoc(taskRef, { ...updates, updatedAt: Timestamp.now() });
    }, []);

    const handleDeleteSubtask = useCallback(async (subtaskId: string) => {
        const taskRef = doc(db, 'gtd_tasks', subtaskId);
        await deleteDoc(taskRef);
    }, []);

    const handleAddSubtask = useCallback(async (
        parentId: string,
        title: string,
        budgetAmount?: number,
        extras?: { estimatedMinutes?: number; budgetCategory?: string }
    ) => {
        if (!currentUser) return;
        const newSubtask: Partial<GTDTask> = {
            title,
            status: 'next_action' as GTDStatus,
            priority: 'none' as GTDPriority,
            createdAt: Timestamp.now(),
            ownerId: currentUser.uid,
            ownerName: currentUser.displayName || 'Unknown',
            context: '',
            description: '',
            parentTaskId: parentId,
            isSubtask: true,
            budgetAmount: budgetAmount || 0,
            progressPercentage: 0,
            paidAmount: 0,
            ...(extras?.budgetCategory && { budgetCategory: extras.budgetCategory }),
            ...(extras?.estimatedMinutes && { estimatedMinutes: extras.estimatedMinutes }),
            ...(clientId && { clientId, clientName: clientName || undefined }),
        };
        await addDoc(collection(db, 'gtd_tasks'), newSubtask);
    }, [currentUser, clientId, clientName]);

    const handleDelete = async () => {
        if (!taskId) return;
        if (!window.confirm('Delete this task?')) return;

        await deleteDoc(doc(db, 'gtd_tasks', taskId));
        navigate('/crm/gtd');
    };

    const formatTime = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    // ─────────────────────────────────────────────────────────
    // RENDER
    // ─────────────────────────────────────────────────────────

    if (loading) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                <CircularProgress />
            </Box>
        );
    }

    if (!task) {
        return (
            <Box p={3}>
                <Alert severity="error">Task not found</Alert>
                <Button onClick={() => navigate(backPath)} sx={{ mt: 2 }}>
                    Back to Cockpit
                </Button>
            </Box>
        );
    }

    const isTimerRunningForThisTask = activeSession?.relatedTaskId === taskId;

    return (
        <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
            {/* ═══════════════════════════════════════════════════════════ */}
            {/* STICKY HEADER */}
            {/* ═══════════════════════════════════════════════════════════ */}
            <Paper
                elevation={2}
                sx={{
                    p: 2,
                    position: 'sticky',
                    top: 0,
                    zIndex: 100,
                    borderRadius: 0
                }}
            >
                <Box display="flex" alignItems="center" justifyContent="space-between">
                    {/* Left: Navigation */}
                    <Box display="flex" alignItems="center" gap={2}>
                        <IconButton onClick={() => navigate(backPath)}>
                            <BackIcon />
                        </IconButton>
                        <Breadcrumbs>
                            <Link
                                component="button"
                                variant="body2"
                                onClick={() => navigate(backPath)}
                                underline="hover"
                            >
                                {backPath === '/crm/tasks-masonry' ? 'Touch Board' : 'Cockpit'}
                            </Link>
                            {clientName && (
                                <Typography variant="body2" color="text.primary">
                                    {clientName}
                                </Typography>
                            )}
                        </Breadcrumbs>
                    </Box>

                    {/* Center: Status Selector */}
                    <FormControl size="small" sx={{ minWidth: 150 }}>
                        <Select
                            value={status}
                            onChange={(e) => handleStatusChange(e.target.value as GTDStatus)}
                            sx={{
                                bgcolor: STATUS_OPTIONS.find(s => s.value === status)?.color + '20',
                                '& .MuiSelect-select': { py: 1 }
                            }}
                        >
                            {STATUS_OPTIONS.map(opt => (
                                <MenuItem key={opt.value} value={opt.value}>
                                    <Chip
                                        size="small"
                                        label={opt.label}
                                        sx={{ bgcolor: opt.color + '30', color: opt.color }}
                                    />
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    {/* Right: Timer & Actions */}
                    <Box display="flex" alignItems="center" gap={2}>
                        {/* Source Audio Link */}
                        {task?.sourceAudioUrl && (
                            <Chip
                                label="🎙️ Voice"
                                color="info"
                                variant="outlined"
                                component="a"
                                href={task.sourceAudioUrl}
                                target="_blank"
                                clickable
                            />
                        )}

                        {/* Timer Button */}
                        <Button
                            variant={isTimerRunningForThisTask ? 'contained' : 'outlined'}
                            color={isTimerRunningForThisTask ? 'error' : 'success'}
                            startIcon={isTimerRunningForThisTask ? <StopIcon /> : <PlayIcon />}
                            onClick={handleTimerToggle}
                            sx={{
                                minWidth: 160,
                                animation: isTimerRunningForThisTask ? 'pulse 1.5s infinite' : 'none',
                                '@keyframes pulse': {
                                    '0%': { opacity: 1 },
                                    '50%': { opacity: 0.7 },
                                    '100%': { opacity: 1 },
                                }
                            }}
                        >
                            {isTimerRunningForThisTask ? formatTime(timerSeconds) : 'Start Work'}
                        </Button>

                        {/* Autosave indicator */}
                        {saving && (
                            <Box display="flex" alignItems="center" gap={0.5} sx={{ color: '#8E8E93' }}>
                                <CircularProgress size={14} sx={{ color: '#8E8E93' }} />
                                <Typography variant="caption">Saving…</Typography>
                            </Box>
                        )}
                        {!saving && lastSavedAt && !hasChanges && (
                            <Typography variant="caption" sx={{ color: '#34C759', fontWeight: 500 }}>
                                ✓ Saved
                            </Typography>
                        )}

                        {/* Delete Button */}
                        <IconButton color="error" onClick={handleDelete}>
                            <DeleteIcon />
                        </IconButton>
                    </Box>
                </Box>
            </Paper>

            {/* ═══════════════════════════════════════════════════════════ */}
            {/* MAIN CONTENT AREA (2 columns) */}
            {/* ═══════════════════════════════════════════════════════════ */}
            <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
                <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 3 }}>
                    {/* LEFT COLUMN: Content (65%) */}
                    <Box sx={{ flex: { xs: '1 1 100%', md: '1 1 55%' }, minWidth: 0 }}>
                        <SmartCockpitInput
                            onCommandSubmit={handleAiModification}
                            isLoading={isAiModifying}
                        />

                        <Paper sx={{ p: 3 }}>
                            {/* Title */}
                            <TextField
                                fullWidth
                                variant="standard"
                                placeholder="Task title..."
                                value={title}
                                onChange={(e) => { setTitle(e.target.value); setHasChanges(true); }}
                                InputProps={{
                                    sx: { fontSize: '1.5rem', fontWeight: 600 }
                                }}
                                sx={{ mb: 2 }}
                            />

                            {/* Description */}
                            <TextField
                                fullWidth
                                multiline
                                rows={3}
                                variant="outlined"
                                placeholder="Task description..."
                                value={description}
                                onChange={(e) => { setDescription(e.target.value); setHasChanges(true); }}
                                sx={{ mb: 3 }}
                            />

                            {/* Subtasks / Budget Table */}
                            {taskId && (
                                <GTDSubtasksTable
                                    parentTaskId={taskId}
                                    allTasks={subtasks}
                                    onUpdateTask={handleUpdateSubtask}
                                    onDeleteTask={handleDeleteSubtask}
                                    onAddSubtask={handleAddSubtask}
                                    onStartSession={(st) => {
                                        startSession({
                                            id: st.id,
                                            title: st.title,
                                            clientId: clientId || '',
                                            clientName: clientName || '',
                                        } as GTDTask);
                                    }}
                                    onStopSession={() => stopSession()}
                                    activeSession={activeSession}
                                />
                            )}

                            <Divider sx={{ my: 2 }} />

                            {/* Block A: Client */}
                            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                                🏢 Client
                            </Typography>

                            <Autocomplete
                                value={clients.find(c => c.id === clientId) || null}
                                options={clients}
                                getOptionLabel={(opt) => opt.name}
                                onChange={(_, newVal) => {
                                    setClientId(newVal?.id || null);
                                    setClientName(newVal?.name || null);
                                    setHasChanges(true);
                                }}
                                renderInput={(params) => (
                                    <TextField
                                        {...params}
                                        label="Client"
                                        size="small"
                                    />
                                )}
                                sx={{ mb: 2 }}
                            />

                            {/* Linked Contacts (v3 handled in Main Tab) */}

                            <Divider sx={{ my: 2 }} />

                            <Divider sx={{ my: 2 }} />

                        </Paper>
                    </Box>

                    {/* RIGHT COLUMN: Control Panel (45%) */}
                    <Box sx={{ flex: { xs: '1 1 100%', md: '1 1 45%' }, minWidth: 0 }}>
                        <Paper sx={{ p: 3 }}>
                            {/* Checklist */}
                            <Typography variant="h6" gutterBottom>
                                Checklist ({checklist.filter(i => i.completed).length}/{checklist.length})
                            </Typography>

                            <List dense>
                                {checklist.map((item, index) => (
                                    <ListItem
                                        key={item.id}
                                        sx={{
                                            bgcolor: item.completed ? 'action.hover' : 'transparent',
                                            borderRadius: 1,
                                            mb: 0.5
                                        }}
                                    >
                                        <ListItemIcon sx={{ minWidth: 36 }}>
                                            <IconButton size="small" sx={{ cursor: 'grab' }}>
                                                <DragIcon fontSize="small" />
                                            </IconButton>
                                        </ListItemIcon>
                                        <Checkbox
                                            checked={item.completed}
                                            onChange={() => handleChecklistToggle(item.id)}
                                            size="small"
                                        />
                                        <TextField
                                            fullWidth
                                            variant="standard"
                                            value={item.text}
                                            onChange={(e) => handleChecklistTextChange(item.id, e.target.value)}
                                            placeholder={`Step ${index + 1}`}
                                            sx={{
                                                textDecoration: item.completed ? 'line-through' : 'none',
                                                opacity: item.completed ? 0.6 : 1
                                            }}
                                        />
                                    </ListItem>
                                ))}
                            </List>

                            <Button
                                startIcon={<AddIcon />}
                                onClick={handleAddChecklistItem}
                                sx={{ mt: 1 }}
                            >
                                Add step
                            </Button>

                            <Divider sx={{ my: 3 }} />

                            {/* Activity Tabs */}
                            <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile>
                                <Tab icon={<TimeIcon />} label="Журнал работ" />
                                <Tab icon={<PersonIcon />} label="История" />
                                <Tab icon={<InventoryIcon />} label="Материалы" />
                                <Tab icon={<ContactsIcon />} label="Справочник" />
                                <Tab icon={<BlueprintsIcon />} label="Blueprints" />
                                <Tab icon={<EstimateIcon />} label="Estimates" />
                                <Tab icon={<PercentageIcon />} label="Процентовка" />
                            </Tabs>

                            {activeTab === 0 && (
                                <Box sx={{ py: 2, maxHeight: '60vh', overflowY: 'auto', pr: 1 }}>
                                    {isTimerRunningForThisTask && (
                                        <Alert severity="success" sx={{ mb: 2 }}>
                                            🟢 Сейчас идёт работа...
                                        </Alert>
                                    )}
                                    {task.totalTimeSpentMinutes && task.totalTimeSpentMinutes > 0 ? (
                                        <Typography variant="body2" sx={{ mb: 2 }}>
                                            Общее время: <strong>{Math.floor(task.totalTimeSpentMinutes / 60)}ч {task.totalTimeSpentMinutes % 60}м</strong>
                                            {task.totalEarnings ? ` · ${task.totalEarnings.toFixed(2)}` : ''}
                                        </Typography>
                                    ) : (
                                        !isTimerRunningForThisTask && (
                                            <Typography color="text.secondary" variant="body2">
                                                Нет записей о работе
                                            </Typography>
                                        )
                                    )}
                                    <WorkSessionsList taskId={taskId || ''} />
                                </Box>
                            )}

                            {activeTab === 1 && (
                                <TaskHistoryTimeline task={task} />
                            )}

                            {activeTab === 2 && (
                                <TaskMaterialsTab
                                    taskId={taskId || ''}
                                    materials={materials}
                                    clientId={clientId || undefined}
                                    clientName={clientName || undefined}
                                    userId={currentUser?.uid || ''}
                                    userName={currentUser?.displayName || ''}
                                    onMaterialsChange={(updated) => {
                                        setMaterials(updated);
                                        setHasChanges(true);
                                    }}
                                />
                            )}

                            {activeTab === 4 && (
                                <Box sx={{ py: 2, pr: 1 }}>
                                    {linkedProjectId ? (
                                        <BlueprintsTabContent projectId={linkedProjectId} />
                                    ) : (
                                        <Alert severity="info">
                                            Для работы с чертежами необходимо привязать задачу к клиенту с активным проектом.
                                        </Alert>
                                    )}
                                </Box>
                            )}

                            {activeTab === 5 && (
                                <Box sx={{ py: 2, pr: 1 }}>
                                    <EstimatesTabContent
                                        estimates={estimates}
                                        loading={estimatesLoading}
                                        expandedId={expandedEstimateId}
                                        onToggle={(id) => setExpandedEstimateId(prev => prev === id ? null : id)}
                                    />
                                </Box>
                            )}

                            {activeTab === 6 && (
                                <Box sx={{ py: 2, pr: 1 }}>
                                    {taskId ? (
                                        <GTDSubtasksTable
                                            parentTaskId={taskId}
                                            allTasks={subtasks}
                                            onUpdateTask={handleUpdateSubtask}
                                            onDeleteTask={handleDeleteSubtask}
                                            onAddSubtask={handleAddSubtask}
                                            onStartSession={(st) => {
                                                startSession({
                                                    id: st.id,
                                                    title: st.title,
                                                    clientId: clientId || '',
                                                    clientName: clientName || '',
                                                } as GTDTask);
                                            }}
                                            onStopSession={() => stopSession()}
                                            activeSession={activeSession}
                                        />
                                    ) : (
                                        <Alert severity="info">Загрузка задачи...</Alert>
                                    )}
                                </Box>
                            )}

                            {activeTab === 3 && (
                                <Box sx={{ py: 2, pr: 1 }}>
                                    <Box display="flex" gap={2} alignItems="center" mb={3}>
                                        <Autocomplete
                                            multiple
                                            fullWidth
                                            size="small"
                                            value={contacts.filter(c => linkedContactIds.includes(c.id))}
                                            options={contacts}
                                            getOptionLabel={(opt: any) => opt.name || ''}
                                            onChange={(_, newVal: any[]) => {
                                                const newIds = newVal.map(v => v.id);
                                                setLinkedContactIds(newIds);
                                                setHasChanges(true);
                                            }}
                                            renderInput={(params) => (
                                                <TextField {...params} label="Привязать контакт из базы" placeholder="Имя, телефон..." />
                                            )}
                                        />
                                        <Button
                                            variant="outlined"
                                            startIcon={<AddIcon />}
                                            onClick={() => setGlobalContactOpen(true)}
                                            sx={{ whiteSpace: 'nowrap' }}
                                        >
                                            Новый
                                        </Button>
                                    </Box>

                                    <Stack spacing={2}>
                                        {linkedContactIds.length === 0 ? (
                                            <Typography color="text.secondary" variant="body2">Нет привязанных контактов.</Typography>
                                        ) : (
                                            contacts.filter(c => linkedContactIds.includes(c.id)).map(contact => (
                                                <Paper key={contact.id} variant="outlined" sx={{ p: 2, bgcolor: 'background.default' }}>
                                                    <Box display="flex" alignItems="flex-start" gap={2}>
                                                        <Avatar sx={{ width: 44, height: 44, bgcolor: 'primary.main', fontWeight: 600 }}>
                                                            {contact.name?.charAt(0)}
                                                        </Avatar>
                                                        <Box flex={1}>
                                                            <Typography variant="subtitle1" fontWeight={600} mb={0.5}>{contact.name}</Typography>
                                                            {contact.roles && contact.roles.length > 0 && (
                                                                <Box display="flex" gap={0.5} mb={1.5} flexWrap="wrap">
                                                                    {contact.roles.map((r: string) => (
                                                                        <Chip key={r} label={r} size="small" variant="outlined" sx={{ height: 22, fontSize: '0.7rem' }} />
                                                                    ))}
                                                                </Box>
                                                            )}
                                                            <Box display="flex" flexDirection="column" gap={0.5}>
                                                                {(contact.phones || []).map((p: any, i: number) => {
                                                                    const cleanNumber = p.number.replace(/\\D/g, '');
                                                                    return (
                                                                        <Box key={i} display="flex" alignItems="center" gap={1} mb={0.5}>
                                                                            <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center' }}>
                                                                                <Link href={`tel:${p.number}`} underline="hover" color="primary.main" fontWeight={500}>📞 {p.number}</Link>
                                                                                {p.label ? <Typography component="span" variant="caption" color="text.secondary" ml={1}>• {p.label}</Typography> : ''}
                                                                            </Typography>
                                                                            <IconButton component="a" size="small" href={`https://wa.me/${cleanNumber}`} target="_blank" rel="noopener noreferrer" color="success" sx={{ padding: '2px' }} title="WhatsApp">
                                                                                <WhatsAppIcon fontSize="small" sx={{ fontSize: 18 }} />
                                                                            </IconButton>
                                                                            <IconButton component="a" size="small" href={`https://t.me/+${cleanNumber}`} target="_blank" rel="noopener noreferrer" color="info" sx={{ padding: '2px' }} title="Telegram">
                                                                                <TelegramIcon fontSize="small" sx={{ fontSize: 18 }} />
                                                                            </IconButton>
                                                                        </Box>
                                                                    );
                                                                })}
                                                                {(contact.emails || []).map((e: any, i: number) => (
                                                                    <Typography key={i} variant="body2">
                                                                        <Link href={`mailto:${e.address}`} underline="hover" color="info.main">✉️ {e.address}</Link>
                                                                        {e.label ? <Typography component="span" variant="caption" color="text.secondary" ml={1}>• {e.label}</Typography> : ''}
                                                                    </Typography>
                                                                ))}
                                                            </Box>
                                                        </Box>
                                                    </Box>
                                                </Paper>
                                            ))
                                        )}
                                    </Stack>

                                    <GlobalContactQuickAdd
                                        open={globalContactOpen}
                                        onClose={() => setGlobalContactOpen(false)}
                                        onContactAdded={(newContact: any) => {
                                            setContacts(prev => [...prev, newContact].sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '')));
                                            if (newContact.id) {
                                                setLinkedContactIds(prev => [...prev, newContact.id!]);
                                                setHasChanges(true);
                                            }
                                        }}
                                    />
                                </Box>
                            )}

                            <Divider sx={{ my: 2 }} />

                            {/* Block B: Team */}
                            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                                👤 Исполнитель
                            </Typography>

                            <Autocomplete
                                value={users.find(u => u.id === assigneeId) || null}
                                options={users}
                                getOptionLabel={(opt) => opt.displayName}
                                onChange={(_, newVal) => {
                                    setAssigneeId(newVal?.id || null);
                                    setAssigneeName(newVal?.displayName || null);
                                    setHasChanges(true);
                                }}
                                renderInput={(params) => (
                                    <TextField {...params} label="Исполнитель" size="small" />
                                )}
                                renderOption={(props, option) => (
                                    <li {...props}>
                                        <Avatar sx={{ width: 24, height: 24, mr: 1 }} src={option.avatarUrl}>
                                            {option.displayName?.charAt(0)}
                                        </Avatar>
                                        {option.displayName}
                                    </li>
                                )}
                                sx={{ mb: 2 }}
                            />

                            {/* Co-assignees */}
                            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                                Соисполнители
                            </Typography>

                            {coAssignees.length > 0 && (
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mb: 1 }}>
                                    {coAssignees.map(ca => (
                                        <Box key={ca.id} display="flex" alignItems="center" gap={0.5}>
                                            <Chip
                                                label={ca.name}
                                                size="small"
                                                avatar={<Avatar sx={{ width: 20, height: 20 }}>{ca.name?.charAt(0)}</Avatar>}
                                                onDelete={() => {
                                                    setCoAssignees(prev => prev.filter(c => c.id !== ca.id));
                                                    setHasChanges(true);
                                                }}
                                                sx={{ flexShrink: 0 }}
                                            />
                                            <Box
                                                component="select"
                                                value={ca.role || 'executor'}
                                                onChange={(e: any) => {
                                                    setCoAssignees(prev => prev.map(c =>
                                                        c.id === ca.id ? { ...c, role: e.target.value } : c
                                                    ));
                                                    setHasChanges(true);
                                                }}
                                                sx={{
                                                    border: '1px solid',
                                                    borderColor: 'divider',
                                                    borderRadius: 1,
                                                    px: 0.5,
                                                    py: 0.25,
                                                    fontSize: '0.7rem',
                                                    bgcolor: 'transparent',
                                                    cursor: 'pointer',
                                                    outline: 'none',
                                                    color: 'text.secondary',
                                                }}
                                            >
                                                <option value="executor">Исполнитель</option>
                                                <option value="reviewer">Ревьюер</option>
                                                <option value="observer">Наблюдатель</option>
                                            </Box>
                                        </Box>
                                    ))}
                                </Box>
                            )}

                            <Autocomplete
                                value={null}
                                options={users.filter(u => u.id !== assigneeId && !coAssignees.some(ca => ca.id === u.id))}
                                getOptionLabel={(opt) => opt.displayName}
                                onChange={(_, newVal) => {
                                    if (newVal) {
                                        setCoAssignees(prev => [...prev, { id: newVal.id, name: newVal.displayName, role: 'executor' as const }]);
                                        setHasChanges(true);
                                    }
                                }}
                                renderInput={(params) => (
                                    <TextField {...params} label="Добавить соисполнителя" size="small" />
                                )}
                                renderOption={(props, option) => (
                                    <li {...props}>
                                        <Avatar sx={{ width: 24, height: 24, mr: 1 }} src={option.avatarUrl}>
                                            {option.displayName?.charAt(0)}
                                        </Avatar>
                                        {option.displayName}
                                    </li>
                                )}
                                sx={{ mb: 3 }}
                                blurOnSelect
                                clearOnBlur
                            />

                            <Divider sx={{ my: 2 }} />


                            {/* Block B2: Metadata — Creator, Time */}
                            <Accordion disableGutters variant="outlined" sx={{ mb: 2, '&:before': { display: 'none' }, borderRadius: 1 }}>
                                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                    <Typography variant="subtitle2" color="text.secondary">
                                        📋 Информация
                                    </Typography>
                                </AccordionSummary>
                                <AccordionDetails>



                                    <Stack spacing={1} sx={{ mb: 3 }}>
                                        {/* Creator */}
                                        {task.ownerName && (
                                            <Box display="flex" justifyContent="space-between" alignItems="center">
                                                <Typography variant="body2" color="text.secondary">Создал</Typography>
                                                <Typography variant="body2" fontWeight={500}>{task.ownerName}</Typography>
                                            </Box>
                                        )}

                                        {/* Created At */}
                                        {task.createdAt && (
                                            <Box display="flex" justifyContent="space-between" alignItems="center">
                                                <Typography variant="body2" color="text.secondary">Дата создания</Typography>
                                                <Typography variant="body2" fontWeight={500}>
                                                    {formatDate(
                                                        (task.createdAt as any)?.toDate ? (task.createdAt as any).toDate() : new Date(task.createdAt as any),
                                                        'dd MMM yyyy, HH:mm',
                                                        { locale: ru }
                                                    )}
                                                </Typography>
                                            </Box>
                                        )}

                                        {/* Updated At */}
                                        {task.updatedAt && (
                                            <Box display="flex" justifyContent="space-between" alignItems="center">
                                                <Typography variant="body2" color="text.secondary">Обновлено</Typography>
                                                <Typography variant="body2">
                                                    {formatDate(
                                                        (task.updatedAt as any)?.toDate ? (task.updatedAt as any).toDate() : new Date(task.updatedAt as any),
                                                        'dd MMM yyyy, HH:mm',
                                                        { locale: ru }
                                                    )}
                                                </Typography>
                                            </Box>
                                        )}
                                    </Stack>


                                </AccordionDetails>
                            </Accordion>
                            <Divider sx={{ my: 2 }} />


                            {/* Block B3: Planning — Duration, Start, End */}
                            <Accordion defaultExpanded={!isMobile} disableGutters variant="outlined" sx={{ mb: 2, '&:before': { display: 'none' }, borderRadius: 1 }}>
                                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                    <Typography variant="subtitle2" color="text.secondary">
                                        📅 Планирование
                                    </Typography>
                                </AccordionSummary>
                                <AccordionDetails>



                                    {/* Estimated Duration */}
                                    <TextField
                                        fullWidth
                                        size="small"
                                        label="Планируемое время (мин)"
                                        type="number"
                                        value={estimatedDurationMinutes}
                                        onChange={(e) => {
                                            const val = e.target.value ? Math.max(0, Number(e.target.value)) : '';
                                            setEstimatedDurationMinutes(val);
                                            setHasChanges(true);
                                        }}
                                        InputProps={{
                                            inputProps: { min: 0 },
                                            startAdornment: <InputAdornment position="start"><ScheduleIcon fontSize="small" /></InputAdornment>,
                                            endAdornment: estimatedDurationMinutes ? (
                                                <InputAdornment position="end">
                                                    <Typography variant="caption" color="text.secondary">
                                                        {Math.floor(Number(estimatedDurationMinutes) / 60)}ч {Number(estimatedDurationMinutes) % 60}м
                                                    </Typography>
                                                </InputAdornment>
                                            ) : null
                                        }}
                                        sx={{ mb: 2 }}
                                    />

                                    {/* Plan Start Date */}
                                    <TextField
                                        fullWidth
                                        size="small"
                                        label="План старта"
                                        type="date"
                                        value={startDate}
                                        onChange={(e) => { setStartDate(e.target.value); setHasChanges(true); }}
                                        InputLabelProps={{ shrink: true }}
                                        InputProps={{
                                            startAdornment: <InputAdornment position="start"><CalendarIcon fontSize="small" /></InputAdornment>
                                        }}
                                        sx={{ mb: 2 }}
                                    />

                                    {/* Due Date / Plan End */}
                                    <TextField
                                        fullWidth
                                        size="small"
                                        label={!dueDateManual && startDate && estimatedDurationMinutes ? 'План окончания (авто)' : 'План окончания'}
                                        type="date"
                                        value={dueDate}
                                        onChange={(e) => { setDueDate(e.target.value); setDueDateManual(true); setHasChanges(true); }}
                                        InputLabelProps={{ shrink: true }}
                                        InputProps={{
                                            startAdornment: <InputAdornment position="start"><CalendarIcon fontSize="small" /></InputAdornment>,
                                            endAdornment: dueDateManual && startDate && estimatedDurationMinutes ? (
                                                <InputAdornment position="end">
                                                    <Tooltip title="Сбросить на авто-расчёт">
                                                        <IconButton size="small" onClick={() => { setDueDateManual(false); setHasChanges(true); }}>
                                                            <ScheduleIcon fontSize="small" />
                                                        </IconButton>
                                                    </Tooltip>
                                                </InputAdornment>
                                            ) : null
                                        }}
                                        sx={{
                                            mb: 3,
                                            '& .MuiOutlinedInput-root': !dueDateManual && startDate && estimatedDurationMinutes ? {
                                                bgcolor: 'action.hover'
                                            } : {}
                                        }}
                                        helperText={!dueDateManual && startDate && estimatedDurationMinutes ? 'Авто-расчёт от старта + длительность' : undefined}
                                    />

                                    {/* Show in Calendar Button */}
                                    {(startDate || dueDate) && (
                                        <Button
                                            fullWidth
                                            size="small"
                                            startIcon={<CalendarIcon />}
                                            onClick={() => {
                                                const targetDate = dueDate || startDate;
                                                navigate(`/crm/calendar?date=${targetDate}`);
                                            }}
                                            sx={{
                                                mb: 1,
                                                textTransform: 'none',
                                                justifyContent: 'flex-start',
                                                color: 'primary.main',
                                                fontWeight: 500,
                                            }}
                                        >
                                            Показать в календаре
                                        </Button>
                                    )}


                                </AccordionDetails>
                            </Accordion>
                            <Divider sx={{ my: 2 }} />


                            {/* Block C & D: Settings */}
                            <Accordion disableGutters variant="outlined" sx={{ mb: 2, '&:before': { display: 'none' }, borderRadius: 1 }}>
                                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                    <Typography variant="subtitle2" color="text.secondary">
                                        ⚙️ Приоритет и Финансы
                                    </Typography>
                                </AccordionSummary>
                                <AccordionDetails>
                                    {/* Block C: Priority */}
                                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                                        🎯 Priority
                                    </Typography>

                                    <Box display="flex" gap={1} flexWrap="wrap" mb={3}>
                                        {PRIORITY_OPTIONS.map(opt => (
                                            <Chip
                                                key={opt.value}
                                                label={opt.label}
                                                onClick={() => { setPriority(opt.value); setHasChanges(true); }}
                                                sx={{
                                                    bgcolor: priority === opt.value ? opt.color : 'transparent',
                                                    color: priority === opt.value ? 'white' : opt.color,
                                                    border: `1px solid ${opt.color}`,
                                                    cursor: 'pointer'
                                                }}
                                            />
                                        ))}
                                    </Box>



                                    {/* Block D: Finance */}
                                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                                        💰 Finance
                                    </Typography>

                                    <FormControlLabel
                                        control={
                                            <Checkbox
                                                checked={needsEstimate}
                                                onChange={(e) => { setNeedsEstimate(e.target.checked); setHasChanges(true); }}
                                            />
                                        }
                                        label="Needs estimate"
                                        sx={{ mb: 2 }}
                                    />

                                </AccordionDetails>
                            </Accordion>
                        </Paper>
                    </Box>
                </Box>
            </Box>

            {/* ERROR SNACKBAR */}
            <Snackbar
                open={!!saveError}
                autoHideDuration={6000}
                onClose={() => setSaveError(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert onClose={() => setSaveError(null)} severity="error" sx={{ width: '100%' }}>
                    {saveError}
                </Alert>
            </Snackbar>

            {/* ═══════════════════════════════════════════════════════════ */}
            {/* MOBILE: STICKY BOTTOM ACTION BAR */}
            {/* ═══════════════════════════════════════════════════════════ */}
            {isMobile && (
                <Paper
                    elevation={8}
                    sx={{
                        position: 'sticky',
                        bottom: 0,
                        zIndex: 100,
                        p: 2,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        bgcolor: 'background.paper',
                        paddingBottom: 'env(safe-area-inset-bottom)'
                    }}
                >
                    <Button
                        variant={isTimerRunningForThisTask ? 'contained' : 'outlined'}
                        color={isTimerRunningForThisTask ? 'error' : 'success'}
                        startIcon={isTimerRunningForThisTask ? <StopIcon /> : <PlayIcon />}
                        onClick={handleTimerToggle}
                        fullWidth
                        size="large"
                        sx={{
                            animation: isTimerRunningForThisTask ? 'pulse 1.5s infinite' : 'none',
                        }}
                    >
                        {isTimerRunningForThisTask ? formatTime(timerSeconds) : 'Start Work'}
                    </Button>
                </Paper>
            )}
        </Box>
    );
};

export default UnifiedCockpitPage;
