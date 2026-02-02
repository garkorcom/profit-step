/**
 * @fileoverview INBOX Page - View and manage notes captured via Telegram bot
 * 
 * Features:
 * - Real-time Firestore subscription on `notes` collection
 * - Filter by stage (inbox/ready/archived)
 * - Note preview with description and attachments
 * - Actions: Convert to Task (with dialog), Archive, Play Audio
 * 
 * @route /crm/inbox
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Box,
    Typography,
    Paper,
    Card,
    CardContent,
    CardActions,
    Button,
    IconButton,
    Chip,
    Stack,
    ToggleButton,
    ToggleButtonGroup,
    CircularProgress,
    Collapse,
    Divider,
    Tooltip,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    TextField,
} from '@mui/material';
import {
    Inbox as InboxIcon,
    CheckCircle as CheckCircleIcon,
    Archive as ArchiveIcon,
    ExpandMore as ExpandMoreIcon,
    ExpandLess as ExpandLessIcon,
    Mic as MicIcon,
    Photo as PhotoIcon,
    AttachFile as AttachFileIcon,
    Task as TaskIcon,
    PlayArrow as PlayArrowIcon,
    Pause as PauseIcon,
    Refresh as RefreshIcon,
    Person as PersonIcon,
    OpenInNew as OpenIcon,
} from '@mui/icons-material';
import {
    collection, query, where, orderBy, onSnapshot,
    doc, updateDoc, addDoc, getDocs, Timestamp
} from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { useAuth } from '../../auth/AuthContext';
import { GTDStatus, GTDPriority } from '../../types/gtd.types';
import { UserProfile } from '../../types/user.types';
import { Client } from '../../types/crm.types';

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

type NoteStage = 'inbox' | 'ready' | 'archived';

interface NoteAttachment {
    type: 'image' | 'audio' | 'file';
    url: string;
    name?: string;
    mimeType?: string;
}

interface ChecklistItem {
    id: string;
    text: string;
    isDone: boolean;
}

interface Note {
    id: string;
    stage: NoteStage;
    title: string;
    description?: string;
    checklist?: ChecklistItem[];
    attachments?: NoteAttachment[];
    projectId?: string;
    projectName?: string;
    deadline?: Timestamp;
    aiStatus: 'none' | 'pending' | 'completed' | 'failed';
    ownerId: string;
    ownerName: string;
    createdAt: Timestamp;
    updatedAt?: Timestamp;
}

// ═══════════════════════════════════════════════════════════
// STATUS OPTIONS
// ═══════════════════════════════════════════════════════════

const STATUS_OPTIONS: { value: GTDStatus; label: string }[] = [
    { value: 'inbox', label: '📥 Inbox' },
    { value: 'next_action', label: '▶️ Next Actions' },
    { value: 'waiting', label: '⏳ Waiting' },
    { value: 'projects', label: '📁 Projects' },
    { value: 'someday', label: '💭 Someday' },
];

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════

const InboxPage: React.FC = () => {
    const navigate = useNavigate();
    const { currentUser, userProfile } = useAuth();
    const [notes, setNotes] = useState<Note[]>([]);
    const [loading, setLoading] = useState(true);
    const [stageFilter, setStageFilter] = useState<NoteStage | 'all'>('inbox');
    const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
    const [playingAudio, setPlayingAudio] = useState<string | null>(null);
    const [audioRef, setAudioRef] = useState<HTMLAudioElement | null>(null);

    // Convert dialog state
    const [convertDialogOpen, setConvertDialogOpen] = useState(false);
    const [convertingNote, setConvertingNote] = useState<Note | null>(null);
    const [targetStatus, setTargetStatus] = useState<GTDStatus>('next_action');
    const [assigneeId, setAssigneeId] = useState<string>('');
    const [saving, setSaving] = useState(false);

    // Data for selects
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [clients, setClients] = useState<Client[]>([]);

    // ─────────────────────────────────────────────────────────
    // LOAD USERS AND CLIENTS
    // ─────────────────────────────────────────────────────────
    useEffect(() => {
        const loadData = async () => {
            try {
                const usersSnap = await getDocs(query(collection(db, 'users'), orderBy('displayName')));
                setUsers(usersSnap.docs.map(d => ({ id: d.id, ...d.data() } as UserProfile)));

                const clientsSnap = await getDocs(query(collection(db, 'clients'), orderBy('name')));
                setClients(clientsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Client)));
            } catch (error) {
                console.error('Error loading data:', error);
            }
        };
        loadData();
    }, []);

    // ─────────────────────────────────────────────────────────
    // FIRESTORE SUBSCRIPTION
    // ─────────────────────────────────────────────────────────
    useEffect(() => {
        let q = query(
            collection(db, 'notes'),
            orderBy('createdAt', 'desc')
        );

        if (stageFilter !== 'all') {
            q = query(
                collection(db, 'notes'),
                where('stage', '==', stageFilter),
                orderBy('createdAt', 'desc')
            );
        }

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const notesData = snapshot.docs.map(d => ({
                id: d.id,
                ...d.data()
            })) as Note[];
            setNotes(notesData);
            setLoading(false);
        }, (error) => {
            console.error('Error fetching notes:', error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [stageFilter]);

    // ─────────────────────────────────────────────────────────
    // HANDLERS
    // ─────────────────────────────────────────────────────────
    const handleStageFilterChange = (_: React.MouseEvent<HTMLElement>, newStage: NoteStage | 'all' | null) => {
        if (newStage !== null) {
            setStageFilter(newStage);
        }
    };

    const toggleExpanded = (noteId: string) => {
        setExpandedNotes(prev => {
            const next = new Set(prev);
            if (next.has(noteId)) {
                next.delete(noteId);
            } else {
                next.add(noteId);
            }
            return next;
        });
    };

    const handleArchive = async (noteId: string) => {
        try {
            await updateDoc(doc(db, 'notes', noteId), {
                stage: 'archived',
                archivedAt: Timestamp.now(),
                archivedReason: 'manual'
            });
        } catch (error) {
            console.error('Error archiving note:', error);
        }
    };

    const handleRestore = async (noteId: string) => {
        try {
            await updateDoc(doc(db, 'notes', noteId), {
                stage: 'inbox'
            });
        } catch (error) {
            console.error('Error restoring note:', error);
        }
    };

    // Open convert dialog
    const handleOpenConvertDialog = (note: Note) => {
        setConvertingNote(note);
        setTargetStatus('next_action');
        setAssigneeId(currentUser?.uid || '');
        setConvertDialogOpen(true);
    };

    // Convert note to GTD task
    const handleConvertToTask = async () => {
        if (!convertingNote || !currentUser) return;

        setSaving(true);
        try {
            const selectedAssignee = users.find(u => u.id === assigneeId);

            // Create GTD task
            const newTask = {
                title: convertingNote.title,
                description: convertingNote.description || '',
                status: targetStatus,
                priority: 'none' as GTDPriority,
                createdAt: Timestamp.now(),
                ownerId: currentUser.uid,
                ownerName: userProfile?.displayName || 'Unknown',
                context: '',
                ...(assigneeId && {
                    assigneeId,
                    assigneeName: selectedAssignee?.displayName || ''
                }),
                ...(convertingNote.projectId && {
                    projectId: convertingNote.projectId,
                    clientId: convertingNote.projectId,
                    clientName: convertingNote.projectName || ''
                }),
                // Copy checklist from note (map isDone → completed)
                ...(convertingNote.checklist?.length && {
                    checklistItems: convertingNote.checklist.map(item => ({
                        id: item.id,
                        text: item.text,
                        completed: item.isDone,
                        createdAt: Timestamp.now(),
                    }))
                }),
                // Link to original note
                sourceNoteId: convertingNote.id,
            };

            const taskRef = await addDoc(collection(db, 'gtd_tasks'), newTask);

            // Archive the note and link to created task
            await updateDoc(doc(db, 'notes', convertingNote.id), {
                stage: 'archived',
                archivedAt: Timestamp.now(),
                archivedReason: 'converted_to_task',
                convertedToTaskId: taskRef.id
            });

            setConvertDialogOpen(false);
            setConvertingNote(null);
        } catch (error) {
            console.error('Error converting note to task:', error);
        } finally {
            setSaving(false);
        }
    };

    const handlePlayAudio = (url: string, noteId: string) => {
        if (playingAudio === noteId && audioRef) {
            audioRef.pause();
            setPlayingAudio(null);
            return;
        }

        if (audioRef) {
            audioRef.pause();
        }

        const audio = new Audio(url);
        audio.play();
        audio.onended = () => setPlayingAudio(null);
        setAudioRef(audio);
        setPlayingAudio(noteId);
    };

    // ─────────────────────────────────────────────────────────
    // RENDER HELPERS
    // ─────────────────────────────────────────────────────────
    const getStageColor = (stage: NoteStage) => {
        switch (stage) {
            case 'inbox': return 'warning';
            case 'ready': return 'success';
            case 'archived': return 'default';
        }
    };

    const getStageLabel = (stage: NoteStage) => {
        switch (stage) {
            case 'inbox': return 'Входящие';
            case 'ready': return 'Обработано';
            case 'archived': return 'Архив';
        }
    };

    const formatDate = (timestamp: Timestamp) => {
        if (!timestamp) return '';
        const date = timestamp.toDate();
        const today = new Date();
        const isToday = date.toDateString() === today.toDateString();

        if (isToday) {
            return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        }
        return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) +
            ' ' + date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    };

    const getAttachmentIcon = (type: string) => {
        switch (type) {
            case 'audio': return <MicIcon fontSize="small" />;
            case 'image': return <PhotoIcon fontSize="small" />;
            default: return <AttachFileIcon fontSize="small" />;
        }
    };

    // ─────────────────────────────────────────────────────────
    // RENDER
    // ─────────────────────────────────────────────────────────
    return (
        <Box sx={{ p: 3 }}>
            {/* Header */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <InboxIcon sx={{ fontSize: 32, color: 'primary.main' }} />
                    <Typography variant="h4" fontWeight={600}>
                        Inbox
                    </Typography>
                    <Chip
                        label={notes.length}
                        color="primary"
                        size="small"
                    />
                </Box>

                <ToggleButtonGroup
                    value={stageFilter}
                    exclusive
                    onChange={handleStageFilterChange}
                    size="small"
                >
                    <ToggleButton value="inbox">
                        <InboxIcon sx={{ mr: 0.5 }} fontSize="small" />
                        Входящие
                    </ToggleButton>
                    <ToggleButton value="ready">
                        <CheckCircleIcon sx={{ mr: 0.5 }} fontSize="small" />
                        Обработано
                    </ToggleButton>
                    <ToggleButton value="archived">
                        <ArchiveIcon sx={{ mr: 0.5 }} fontSize="small" />
                        Архив
                    </ToggleButton>
                    <ToggleButton value="all">
                        Все
                    </ToggleButton>
                </ToggleButtonGroup>
            </Box>

            {/* Loading */}
            {loading && (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                    <CircularProgress />
                </Box>
            )}

            {/* Empty State */}
            {!loading && notes.length === 0 && (
                <Paper sx={{ p: 6, textAlign: 'center' }}>
                    <InboxIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
                    <Typography variant="h6" color="text.secondary">
                        {stageFilter === 'inbox'
                            ? 'Входящих заметок нет'
                            : 'Заметок не найдено'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        Отправьте голосовое, фото или текст в Telegram бота
                    </Typography>
                </Paper>
            )}

            {/* Notes List */}
            <Stack spacing={2}>
                {notes.map(note => (
                    <Card
                        key={note.id}
                        elevation={1}
                        onClick={() => navigate(`/crm/inbox/${note.id}`)}
                        sx={{
                            borderLeft: 4,
                            borderColor: note.aiStatus === 'pending'
                                ? 'warning.main'
                                : note.stage === 'ready'
                                    ? 'success.main'
                                    : 'grey.300',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            '&:hover': {
                                boxShadow: 4,
                                transform: 'translateY(-2px)',
                            }
                        }}
                    >
                        <CardContent sx={{ pb: 0 }}>
                            {/* Top Row */}
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <Box sx={{ flex: 1 }}>
                                    <Typography variant="subtitle1" fontWeight={600}>
                                        {note.title}
                                    </Typography>

                                    <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: 'wrap', gap: 0.5 }}>
                                        <Typography variant="caption" color="text.secondary">
                                            {formatDate(note.createdAt)}
                                        </Typography>

                                        <Chip
                                            label={getStageLabel(note.stage)}
                                            size="small"
                                            color={getStageColor(note.stage)}
                                            variant="outlined"
                                        />

                                        {note.aiStatus === 'pending' && (
                                            <Chip
                                                icon={<CircularProgress size={12} />}
                                                label="AI обрабатывает"
                                                size="small"
                                                color="warning"
                                            />
                                        )}

                                        {note.projectName && (
                                            <Chip
                                                label={`📍 ${note.projectName}`}
                                                size="small"
                                                variant="outlined"
                                            />
                                        )}

                                        {note.attachments?.map((att, idx) => (
                                            <Tooltip key={idx} title={att.type}>
                                                <Chip
                                                    icon={getAttachmentIcon(att.type)}
                                                    label={att.type === 'audio' ? 'Аудио' : att.type === 'image' ? 'Фото' : 'Файл'}
                                                    size="small"
                                                    variant="outlined"
                                                    onClick={att.type === 'audio' ? () => handlePlayAudio(att.url, note.id) : undefined}
                                                    sx={att.type === 'audio' ? { cursor: 'pointer' } : undefined}
                                                />
                                            </Tooltip>
                                        ))}

                                        {note.checklist && note.checklist.length > 0 && (
                                            <Chip
                                                label={`📋 ${note.checklist.length} пунктов`}
                                                size="small"
                                                color="info"
                                                variant="outlined"
                                            />
                                        )}
                                    </Stack>
                                </Box>

                                <IconButton
                                    size="small"
                                    onClick={() => toggleExpanded(note.id)}
                                >
                                    {expandedNotes.has(note.id) ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                                </IconButton>
                            </Box>

                            {/* Expanded Content */}
                            <Collapse in={expandedNotes.has(note.id)}>
                                <Divider sx={{ my: 2 }} />

                                {note.description && (
                                    <Typography
                                        variant="body2"
                                        sx={{
                                            whiteSpace: 'pre-wrap',
                                            bgcolor: 'grey.50',
                                            p: 2,
                                            borderRadius: 1,
                                            mb: 2
                                        }}
                                    >
                                        {note.description}
                                    </Typography>
                                )}

                                {note.checklist && note.checklist.length > 0 && (
                                    <Box sx={{ mb: 2 }}>
                                        <Typography variant="subtitle2" gutterBottom>
                                            Чеклист:
                                        </Typography>
                                        {note.checklist.map(item => (
                                            <Typography
                                                key={item.id}
                                                variant="body2"
                                                sx={{
                                                    pl: 2,
                                                    textDecoration: item.isDone ? 'line-through' : 'none',
                                                    color: item.isDone ? 'text.secondary' : 'text.primary'
                                                }}
                                            >
                                                {item.isDone ? '✅' : '▫️'} {item.text}
                                            </Typography>
                                        ))}
                                    </Box>
                                )}

                                {/* Audio Player */}
                                {note.attachments?.some(a => a.type === 'audio') && (
                                    <Box sx={{ mb: 2 }}>
                                        {note.attachments.filter(a => a.type === 'audio').map((att, idx) => (
                                            <Button
                                                key={idx}
                                                variant="outlined"
                                                startIcon={playingAudio === note.id ? <PauseIcon /> : <PlayArrowIcon />}
                                                onClick={() => handlePlayAudio(att.url, note.id)}
                                                size="small"
                                            >
                                                {playingAudio === note.id ? 'Пауза' : 'Воспроизвести'}
                                            </Button>
                                        ))}
                                    </Box>
                                )}

                                {/* Images */}
                                {note.attachments?.some(a => a.type === 'image') && (
                                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
                                        {note.attachments.filter(a => a.type === 'image').map((att, idx) => (
                                            <Box
                                                key={idx}
                                                component="img"
                                                src={att.url}
                                                alt="attachment"
                                                sx={{
                                                    maxWidth: 200,
                                                    maxHeight: 150,
                                                    borderRadius: 1,
                                                    cursor: 'pointer'
                                                }}
                                                onClick={() => window.open(att.url, '_blank')}
                                            />
                                        ))}
                                    </Box>
                                )}
                            </Collapse>
                        </CardContent>

                        {/* Actions */}
                        <CardActions
                            sx={{ justifyContent: 'flex-end', px: 2, pb: 2 }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            {note.stage === 'archived' ? (
                                <Button
                                    size="small"
                                    startIcon={<RefreshIcon />}
                                    onClick={() => handleRestore(note.id)}
                                >
                                    Восстановить
                                </Button>
                            ) : (
                                <>
                                    <Button
                                        size="small"
                                        color="secondary"
                                        variant="outlined"
                                        startIcon={<OpenIcon />}
                                        onClick={() => navigate(`/crm/inbox/${note.id}`)}
                                    >
                                        Open
                                    </Button>
                                    <Button
                                        size="small"
                                        color="inherit"
                                        startIcon={<ArchiveIcon />}
                                        onClick={() => handleArchive(note.id)}
                                    >
                                        Архив
                                    </Button>
                                </>
                            )}
                        </CardActions>
                    </Card>
                ))}
            </Stack>

            {/* ═══════════════════════════════════════════════════════════
                CONVERT TO TASK DIALOG
            ═══════════════════════════════════════════════════════════ */}
            <Dialog
                open={convertDialogOpen}
                onClose={() => setConvertDialogOpen(false)}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle>
                    Конвертировать в задачу
                </DialogTitle>
                <DialogContent>
                    <Box sx={{ pt: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {/* Title Preview */}
                        <TextField
                            label="Название"
                            value={convertingNote?.title || ''}
                            fullWidth
                            InputProps={{ readOnly: true }}
                            variant="filled"
                        />

                        {/* Description Preview */}
                        {convertingNote?.description && (
                            <TextField
                                label="Описание"
                                value={convertingNote.description}
                                fullWidth
                                multiline
                                rows={3}
                                InputProps={{ readOnly: true }}
                                variant="filled"
                            />
                        )}

                        {/* Status Select */}
                        <FormControl fullWidth>
                            <InputLabel>Статус</InputLabel>
                            <Select
                                value={targetStatus}
                                label="Статус"
                                onChange={(e) => setTargetStatus(e.target.value as GTDStatus)}
                            >
                                {STATUS_OPTIONS.map(opt => (
                                    <MenuItem key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        {/* Assignee Select */}
                        <FormControl fullWidth>
                            <InputLabel>Исполнитель</InputLabel>
                            <Select
                                value={assigneeId}
                                label="Исполнитель"
                                onChange={(e) => setAssigneeId(e.target.value)}
                            >
                                <MenuItem value="">
                                    <em>Не назначен</em>
                                </MenuItem>
                                {users.map(u => (
                                    <MenuItem key={u.id} value={u.id}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <PersonIcon fontSize="small" />
                                            {u.displayName}
                                        </Box>
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        {/* Checklist Preview */}
                        {convertingNote?.checklist && convertingNote.checklist.length > 0 && (
                            <Box sx={{ bgcolor: 'grey.50', p: 2, borderRadius: 1 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                                    Чеклист будет в описании задачи:
                                </Typography>
                                {convertingNote.checklist.map(item => (
                                    <Typography key={item.id} variant="body2">
                                        {item.isDone ? '✅' : '▫️'} {item.text}
                                    </Typography>
                                ))}
                            </Box>
                        )}
                    </Box>
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2 }}>
                    <Button onClick={() => setConvertDialogOpen(false)} color="inherit">
                        Отмена
                    </Button>
                    <Button
                        onClick={handleConvertToTask}
                        variant="contained"
                        disabled={saving}
                        startIcon={saving ? <CircularProgress size={16} /> : <TaskIcon />}
                    >
                        {saving ? 'Создание...' : 'Создать задачу'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default InboxPage;
