import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
    Box, Typography, Paper, Grid, IconButton, Chip, TextField, Button,
    Avatar, Divider, Breadcrumbs, useTheme, Skeleton, Tooltip
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import EditIcon from '@mui/icons-material/Edit';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import PersonIcon from '@mui/icons-material/Person';
import FlagIcon from '@mui/icons-material/Flag';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import ChecklistIcon from '@mui/icons-material/Checklist';
import SendIcon from '@mui/icons-material/Send';
import HistoryIcon from '@mui/icons-material/History';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';

import { doc, updateDoc, Timestamp, onSnapshot, collection, addDoc, query, orderBy } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { GTDTask, GTDStatus, GTD_COLUMNS, PRIORITY_COLORS, ChecklistItem } from '../../types/gtd.types';
import { useAuth } from '../../auth/AuthContext';
import { useSessionManager } from '../../hooks/useSessionManager';
import TaskChecklist from '../../components/gtd/TaskChecklist';

/**
 * Full Task Page - Notion-Style Layout
 * Route: /crm/gtd/:taskId
 * 
 * Layout (2-Column):
 * +------------------------------------------+-------------------+
 * |              Main Content (75%)          |  Sidebar (25%)    |
 * |  Title (inline editable)                 |  Timer Widget     |
 * |  Status Chips                            |  Priority         |
 * |  Description                             |  Assignee/Client  |
 * |  Checklist                               |  Dates            |
 * |  Attachments                             |  Created/Updated  |
 * |  Activity & Comments (merged timeline)   |                   |
 * +------------------------------------------+-------------------+
 */

const GTDTaskDetailsPage: React.FC = () => {
    const { taskId } = useParams<{ taskId: string }>();
    const navigate = useNavigate();
    const theme = useTheme();
    const { userProfile, currentUser } = useAuth();
    const { activeSession, startSession, stopSession, sessionSnackbarOpen, sessionStartMessage, setSessionSnackbarOpen } = useSessionManager(
        currentUser?.uid,
        userProfile?.displayName || currentUser?.displayName || undefined,
        userProfile?.telegramId
    );

    const [task, setTask] = useState<GTDTask | null>(null);
    const [loading, setLoading] = useState(true);
    const [editingDescription, setEditingDescription] = useState(false);
    const [editingTitle, setEditingTitle] = useState(false);
    const [description, setDescription] = useState('');
    const [title, setTitle] = useState('');
    const [comments, setComments] = useState<any[]>([]);
    const [newComment, setNewComment] = useState('');
    const [elapsedTime, setElapsedTime] = useState(0);

    // Check if this task is active
    const isTaskActive = activeSession && activeSession.relatedTaskId === taskId;

    // Timer for elapsed time
    useEffect(() => {
        if (!isTaskActive || !activeSession?.startTime) return;

        const updateElapsed = () => {
            const start = activeSession.startTime.toDate();
            const now = new Date();
            setElapsedTime(Math.floor((now.getTime() - start.getTime()) / 1000));
        };

        updateElapsed();
        const interval = setInterval(updateElapsed, 1000);
        return () => clearInterval(interval);
    }, [isTaskActive, activeSession?.startTime]);

    // Fetch task data
    useEffect(() => {
        if (!taskId) return;

        const unsubscribe = onSnapshot(doc(db, 'gtd_tasks', taskId), (docSnap) => {
            if (docSnap.exists()) {
                const data = { id: docSnap.id, ...docSnap.data() } as GTDTask;
                setTask(data);
                setDescription(data.description || '');
                setTitle(data.title || '');
            } else {
                navigate('/crm/gtd');
            }
            setLoading(false);
        });

        return () => unsubscribe();
    }, [taskId, navigate]);

    // Fetch comments
    useEffect(() => {
        if (!taskId) return;

        const commentsQuery = query(
            collection(db, 'gtd_tasks', taskId, 'comments'),
            orderBy('createdAt', 'desc')
        );

        const unsubscribe = onSnapshot(commentsQuery, (snapshot) => {
            setComments(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
        });

        return () => unsubscribe();
    }, [taskId]);

    const handleSaveTitle = async () => {
        if (!taskId || !task || !title.trim()) return;
        await updateDoc(doc(db, 'gtd_tasks', taskId), {
            title: title.trim(),
            updatedAt: Timestamp.now()
        });
        setEditingTitle(false);
    };

    const handleSaveDescription = async () => {
        if (!taskId || !task) return;
        await updateDoc(doc(db, 'gtd_tasks', taskId), {
            description,
            updatedAt: Timestamp.now()
        });
        setEditingDescription(false);
    };

    const handleAddComment = async () => {
        if (!taskId || !newComment.trim() || !userProfile) return;

        await addDoc(collection(db, 'gtd_tasks', taskId, 'comments'), {
            text: newComment,
            type: 'comment',
            authorId: userProfile.id,
            authorName: userProfile.displayName || userProfile.email,
            createdAt: Timestamp.now()
        });

        setNewComment('');
    };

    const handleStatusChange = async (newStatus: GTDStatus) => {
        if (!taskId || !task) return;
        const updates: Partial<GTDTask> = {
            status: newStatus,
            updatedAt: Timestamp.now()
        };
        if (newStatus === 'done' && task.status !== 'done') {
            updates.completedAt = Timestamp.now();
        }
        await updateDoc(doc(db, 'gtd_tasks', taskId), updates);
    };

    const handleStartTimer = () => {
        if (task && startSession) {
            startSession(task);
        }
    };

    const handleStopTimer = () => {
        if (stopSession) {
            stopSession();
        }
    };

    const handleChecklistUpdate = async (items: ChecklistItem[]) => {
        if (!taskId) return;
        await updateDoc(doc(db, 'gtd_tasks', taskId), {
            checklistItems: items,
            updatedAt: Timestamp.now()
        });
    };


    const formatDate = (timestamp: Timestamp | undefined) => {
        if (!timestamp) return '—';
        return new Date(timestamp.seconds * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    };

    const formatDuration = (minutes: number | undefined) => {
        if (!minutes) return '—';
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return h > 0 ? `${h}ч ${m}м` : `${m}м`;
    };

    const formatElapsedTime = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const formatCommentTime = (timestamp: Timestamp | undefined) => {
        if (!timestamp) return '';
        const date = new Date(timestamp.seconds * 1000);
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return 'сейчас';
        if (minutes < 60) return `${minutes}м назад`;
        if (hours < 24) return `${hours}ч назад`;
        if (days < 7) return `${days}д назад`;
        return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    };

    if (loading) {
        return (
            <Box p={3}>
                <Skeleton variant="text" width="40%" height={40} />
                <Skeleton variant="rectangular" height={400} sx={{ mt: 2, borderRadius: 2 }} />
            </Box>
        );
    }

    if (!task) {
        return (
            <Box p={3} textAlign="center">
                <Typography color="error">Задача не найдена</Typography>
                <Button component={Link} to="/crm/gtd" sx={{ mt: 2 }}>Назад к списку</Button>
            </Box>
        );
    }

    const priorityColor = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.none;

    return (
        <Box sx={{
            minHeight: 'calc(100vh - 64px)',
            bgcolor: '#f8fafc',
            pb: 4
        }}>
            {/* Sticky Header */}
            <Box
                sx={{
                    position: 'sticky',
                    top: 64,
                    zIndex: 10,
                    bgcolor: 'white',
                    borderBottom: '1px solid #e2e8f0',
                    px: { xs: 2, md: 4 },
                    py: 1.5
                }}
            >
                <Box display="flex" alignItems="center" gap={2} maxWidth={1400} mx="auto">
                    <Tooltip title="Назад к списку">
                        <IconButton onClick={() => navigate('/crm/gtd')} size="small">
                            <ArrowBackIcon />
                        </IconButton>
                    </Tooltip>
                    <Breadcrumbs sx={{ flex: 1 }}>
                        <Link to="/crm/gtd" style={{ textDecoration: 'none', color: theme.palette.primary.main, fontSize: 14 }}>
                            Lookahead
                        </Link>
                        <Typography color="text.primary" fontSize={14} fontWeight={500} sx={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {task.title}
                        </Typography>
                    </Breadcrumbs>

                    {/* Timer in Header (when active) */}
                    {isTaskActive && (
                        <Box display="flex" alignItems="center" gap={1} sx={{ bgcolor: '#dcfce7', px: 2, py: 0.5, borderRadius: 2 }}>
                            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#22c55e', animation: 'pulse 1.5s infinite' }} />
                            <Typography variant="body2" fontWeight="bold" fontFamily="monospace">
                                {formatElapsedTime(elapsedTime)}
                            </Typography>
                            <IconButton size="small" color="error" onClick={handleStopTimer}>
                                <StopIcon fontSize="small" />
                            </IconButton>
                        </Box>
                    )}
                </Box>
            </Box>

            {/* Main Content */}
            <Box sx={{ maxWidth: 1400, mx: 'auto', px: { xs: 2, md: 4 }, pt: 3 }}>
                <Grid container spacing={3}>

                    {/* ========== MAIN CONTENT (75%) ========== */}
                    <Grid size={{ xs: 12, lg: 9 }}>
                        <Paper elevation={0} sx={{ p: { xs: 2, md: 4 }, borderRadius: 3, border: '1px solid #e2e8f0' }}>

                            {/* Editable Title */}
                            {editingTitle ? (
                                <Box mb={2}>
                                    <TextField
                                        fullWidth
                                        value={title}
                                        onChange={(e) => setTitle(e.target.value)}
                                        onBlur={handleSaveTitle}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSaveTitle()}
                                        autoFocus
                                        variant="standard"
                                        InputProps={{
                                            disableUnderline: true,
                                            sx: { fontSize: '1.75rem', fontWeight: 700 }
                                        }}
                                    />
                                </Box>
                            ) : (
                                <Typography
                                    variant="h4"
                                    fontWeight={700}
                                    mb={2}
                                    onClick={() => setEditingTitle(true)}
                                    sx={{ cursor: 'text', '&:hover': { bgcolor: '#f1f5f9', borderRadius: 1, mx: -1, px: 1 } }}
                                >
                                    {task.title}
                                </Typography>
                            )}

                            {/* Status Chips - Horizontal Pills */}
                            <Box display="flex" gap={1} mb={4} flexWrap="wrap">
                                {GTD_COLUMNS.slice(0, 4).map(col => (
                                    <Chip
                                        key={col.id}
                                        label={col.title}
                                        onClick={() => handleStatusChange(col.id)}
                                        sx={{
                                            fontWeight: 600,
                                            borderRadius: 2,
                                            transition: 'all 0.2s',
                                            ...(task.status === col.id ? {
                                                bgcolor: theme.palette.primary.main,
                                                color: 'white',
                                                '&:hover': { bgcolor: theme.palette.primary.dark }
                                            } : {
                                                bgcolor: '#f1f5f9',
                                                color: '#64748b',
                                                '&:hover': { bgcolor: '#e2e8f0' }
                                            })
                                        }}
                                    />
                                ))}
                                {task.status === 'done' && (
                                    <Chip label="✓ Done" sx={{ bgcolor: '#dcfce7', color: '#166534', fontWeight: 600 }} />
                                )}
                            </Box>

                            {/* Description Section */}
                            <Box mb={4}>
                                <Box display="flex" alignItems="center" gap={1} mb={1}>
                                    <Typography variant="subtitle1" fontWeight={600} color="text.secondary">
                                        📝 Описание
                                    </Typography>
                                    {!editingDescription && (
                                        <IconButton size="small" onClick={() => setEditingDescription(true)} sx={{ opacity: 0.5, '&:hover': { opacity: 1 } }}>
                                            <EditIcon fontSize="small" />
                                        </IconButton>
                                    )}
                                </Box>
                                {editingDescription ? (
                                    <Box>
                                        <TextField
                                            fullWidth
                                            multiline
                                            rows={5}
                                            value={description}
                                            onChange={(e) => setDescription(e.target.value)}
                                            variant="outlined"
                                            placeholder="Опишите задачу..."
                                            sx={{
                                                '& .MuiOutlinedInput-root': { borderRadius: 2 }
                                            }}
                                        />
                                        <Box display="flex" gap={1} mt={2}>
                                            <Button variant="contained" onClick={handleSaveDescription} sx={{ borderRadius: 2 }}>
                                                Сохранить
                                            </Button>
                                            <Button onClick={() => { setEditingDescription(false); setDescription(task.description || ''); }} sx={{ borderRadius: 2 }}>
                                                Отмена
                                            </Button>
                                        </Box>
                                    </Box>
                                ) : (
                                    <Typography
                                        variant="body1"
                                        sx={{
                                            whiteSpace: 'pre-wrap',
                                            color: description ? 'text.primary' : 'text.disabled',
                                            cursor: 'text',
                                            p: 2,
                                            bgcolor: '#f8fafc',
                                            borderRadius: 2,
                                            minHeight: 80,
                                            '&:hover': { bgcolor: '#f1f5f9' }
                                        }}
                                        onClick={() => setEditingDescription(true)}
                                    >
                                        {description || 'Нажмите, чтобы добавить описание...'}
                                    </Typography>
                                )}
                            </Box>

                            <Divider sx={{ my: 3 }} />

                            {/* Checklist Section */}
                            <Box mb={4}>
                                <Box display="flex" alignItems="center" gap={1} mb={2}>
                                    <ChecklistIcon color="action" />
                                    <Typography variant="subtitle1" fontWeight={600} color="text.secondary">
                                        Чек-лист
                                    </Typography>
                                </Box>
                                <Box sx={{ bgcolor: '#f8fafc', p: 2, borderRadius: 2, border: '1px solid #e2e8f0' }}>
                                    <TaskChecklist
                                        items={task.checklistItems || []}
                                        onUpdate={handleChecklistUpdate}
                                    />
                                </Box>
                            </Box>

                            {/* Attachments Section */}
                            <Box mb={4}>
                                <Box display="flex" alignItems="center" gap={1} mb={2}>
                                    <AttachFileIcon color="action" />
                                    <Typography variant="subtitle1" fontWeight={600} color="text.secondary">
                                        Вложения
                                    </Typography>
                                </Box>
                                {task.sourceAudioUrl ? (
                                    <Box
                                        component="a"
                                        href={task.sourceAudioUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        sx={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 1,
                                            px: 2,
                                            py: 1,
                                            bgcolor: '#fef3c7',
                                            borderRadius: 2,
                                            textDecoration: 'none',
                                            color: '#92400e',
                                            '&:hover': { bgcolor: '#fde68a' }
                                        }}
                                    >
                                        🎙️ Исходное голосовое сообщение
                                    </Box>
                                ) : (
                                    <Box sx={{ bgcolor: '#f8fafc', p: 2, borderRadius: 2, border: '1px dashed #cbd5e1' }}>
                                        <Typography variant="body2" color="text.disabled" textAlign="center">
                                            Нет вложений
                                        </Typography>
                                    </Box>
                                )}
                            </Box>

                            <Divider sx={{ my: 3 }} />

                            {/* Activity & Comments (Merged Timeline) */}
                            <Box>
                                <Box display="flex" alignItems="center" gap={1} mb={3}>
                                    <HistoryIcon color="action" />
                                    <Typography variant="subtitle1" fontWeight={600} color="text.secondary">
                                        Активность и комментарии
                                    </Typography>
                                </Box>

                                {/* Comment Input */}
                                <Box display="flex" gap={2} mb={3}>
                                    <Avatar sx={{ width: 36, height: 36, bgcolor: theme.palette.primary.main }}>
                                        {userProfile?.displayName?.charAt(0) || userProfile?.email?.charAt(0) || '?'}
                                    </Avatar>
                                    <Box flex={1}>
                                        <TextField
                                            fullWidth
                                            placeholder="Написать комментарий..."
                                            value={newComment}
                                            onChange={(e) => setNewComment(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleAddComment()}
                                            multiline
                                            maxRows={4}
                                            sx={{
                                                '& .MuiOutlinedInput-root': { borderRadius: 2 }
                                            }}
                                        />
                                        {newComment.trim() && (
                                            <Box display="flex" justifyContent="flex-end" mt={1}>
                                                <Button
                                                    variant="contained"
                                                    size="small"
                                                    endIcon={<SendIcon />}
                                                    onClick={handleAddComment}
                                                    sx={{ borderRadius: 2 }}
                                                >
                                                    Отправить
                                                </Button>
                                            </Box>
                                        )}
                                    </Box>
                                </Box>

                                {/* Comments List */}
                                <Box>
                                    {comments.length === 0 ? (
                                        <Box textAlign="center" py={4}>
                                            <ChatBubbleOutlineIcon sx={{ fontSize: 48, color: '#cbd5e1', mb: 1 }} />
                                            <Typography variant="body2" color="text.disabled">
                                                Пока нет комментариев. Будьте первым!
                                            </Typography>
                                        </Box>
                                    ) : (
                                        comments.map(comment => (
                                            <Box key={comment.id} display="flex" gap={2} mb={3}>
                                                <Avatar sx={{ width: 36, height: 36, bgcolor: '#e2e8f0', color: '#64748b', fontSize: 14 }}>
                                                    {comment.authorName?.charAt(0) || '?'}
                                                </Avatar>
                                                <Box flex={1}>
                                                    <Box display="flex" alignItems="center" gap={1}>
                                                        <Typography variant="body2" fontWeight={600}>
                                                            {comment.authorName || 'Unknown'}
                                                        </Typography>
                                                        <Typography variant="caption" color="text.disabled">
                                                            {formatCommentTime(comment.createdAt)}
                                                        </Typography>
                                                    </Box>
                                                    <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>
                                                        {comment.text}
                                                    </Typography>
                                                </Box>
                                            </Box>
                                        ))
                                    )}
                                </Box>
                            </Box>
                        </Paper>
                    </Grid>

                    {/* ========== SIDEBAR (25%) ========== */}
                    <Grid size={{ xs: 12, lg: 3 }}>
                        <Box sx={{ position: 'sticky', top: 120 }}>

                            {/* Timer Widget */}
                            <Paper elevation={0} sx={{ p: 3, borderRadius: 3, border: '1px solid #e2e8f0', mb: 2, textAlign: 'center' }}>
                                <Typography variant="subtitle2" color="text.secondary" mb={2}>
                                    ⏱️ Таймер
                                </Typography>
                                {isTaskActive ? (
                                    <>
                                        <Typography variant="h4" fontWeight={700} fontFamily="monospace" color="success.main" mb={2}>
                                            {formatElapsedTime(elapsedTime)}
                                        </Typography>
                                        <Button
                                            variant="contained"
                                            color="error"
                                            fullWidth
                                            startIcon={<StopIcon />}
                                            onClick={handleStopTimer}
                                            sx={{ borderRadius: 2 }}
                                        >
                                            Остановить
                                        </Button>
                                    </>
                                ) : (
                                    <>
                                        <Typography variant="h4" fontWeight={700} fontFamily="monospace" color="text.disabled" mb={2}>
                                            00:00:00
                                        </Typography>
                                        <Button
                                            variant="contained"
                                            color="success"
                                            fullWidth
                                            startIcon={<PlayArrowIcon />}
                                            onClick={handleStartTimer}
                                            sx={{ borderRadius: 2 }}
                                        >
                                            Начать работу
                                        </Button>
                                    </>
                                )}
                            </Paper>

                            {/* Meta Details */}
                            <Paper elevation={0} sx={{ p: 3, borderRadius: 3, border: '1px solid #e2e8f0' }}>
                                <Typography variant="subtitle2" color="text.secondary" mb={2}>
                                    ⚙️ Детали
                                </Typography>

                                {/* Priority */}
                                <Box mb={2.5}>
                                    <Typography variant="caption" color="text.disabled" display="block" mb={0.5}>
                                        Приоритет
                                    </Typography>
                                    <Chip
                                        size="small"
                                        label={task.priority === 'none' ? '—' : task.priority}
                                        sx={{
                                            bgcolor: task.priority === 'none' ? '#f1f5f9' : priorityColor + '20',
                                            color: task.priority === 'none' ? '#94a3b8' : priorityColor,
                                            fontWeight: 600,
                                            textTransform: 'capitalize'
                                        }}
                                    />
                                </Box>

                                {/* Assignee */}
                                <Box mb={2.5}>
                                    <Typography variant="caption" color="text.disabled" display="block" mb={0.5}>
                                        Исполнитель
                                    </Typography>
                                    <Box display="flex" alignItems="center" gap={1}>
                                        <Avatar sx={{ width: 24, height: 24, bgcolor: '#e2e8f0', fontSize: 12 }}>
                                            {task.assigneeName?.charAt(0) || <PersonIcon sx={{ fontSize: 14 }} />}
                                        </Avatar>
                                        <Typography variant="body2">{task.assigneeName || '—'}</Typography>
                                    </Box>
                                </Box>

                                {/* Client */}
                                {task.clientName && (
                                    <Box mb={2.5}>
                                        <Typography variant="caption" color="text.disabled" display="block" mb={0.5}>
                                            Клиент
                                        </Typography>
                                        <Typography variant="body2" fontWeight={500}>{task.clientName}</Typography>
                                    </Box>
                                )}

                                <Divider sx={{ my: 2 }} />

                                {/* Dates */}
                                <Box mb={2}>
                                    <Typography variant="caption" color="text.disabled" display="block" mb={0.5}>
                                        Дата старта
                                    </Typography>
                                    <Box display="flex" alignItems="center" gap={1}>
                                        <PlayArrowIcon sx={{ fontSize: 16, color: '#94a3b8' }} />
                                        <Typography variant="body2">{formatDate(task.startDate)}</Typography>
                                    </Box>
                                </Box>

                                <Box mb={2}>
                                    <Typography variant="caption" color="text.disabled" display="block" mb={0.5}>
                                        Дедлайн
                                    </Typography>
                                    <Box display="flex" alignItems="center" gap={1}>
                                        <FlagIcon sx={{ fontSize: 16, color: task.dueDate && new Date(task.dueDate.seconds * 1000) < new Date() && task.status !== 'done' ? '#ef4444' : '#94a3b8' }} />
                                        <Typography
                                            variant="body2"
                                            color={task.dueDate && new Date(task.dueDate.seconds * 1000) < new Date() && task.status !== 'done' ? 'error' : 'inherit'}
                                            fontWeight={task.dueDate ? 500 : 400}
                                        >
                                            {formatDate(task.dueDate)}
                                        </Typography>
                                    </Box>
                                </Box>

                                <Box mb={2}>
                                    <Typography variant="caption" color="text.disabled" display="block" mb={0.5}>
                                        Оценка времени
                                    </Typography>
                                    <Box display="flex" alignItems="center" gap={1}>
                                        <AccessTimeIcon sx={{ fontSize: 16, color: '#94a3b8' }} />
                                        <Typography variant="body2">{formatDuration(task.estimatedDurationMinutes)}</Typography>
                                    </Box>
                                </Box>

                                <Divider sx={{ my: 2 }} />

                                {/* Timestamps */}
                                <Box mb={1}>
                                    <Typography variant="caption" color="text.disabled">Создано</Typography>
                                    <Typography variant="body2" fontSize="0.8rem">{formatDate(task.createdAt)}</Typography>
                                </Box>
                                {task.completedAt && (
                                    <Box>
                                        <Typography variant="caption" color="text.disabled">Завершено</Typography>
                                        <Typography variant="body2" fontSize="0.8rem" color="success.main">
                                            {formatDate(task.completedAt)}
                                        </Typography>
                                    </Box>
                                )}
                            </Paper>
                        </Box>
                    </Grid>
                </Grid>
            </Box>

            {/* CSS Animation for Timer Pulse */}
            <style>{`
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.5; }
                }
            `}</style>
        </Box>
    );
};

export default GTDTaskDetailsPage;
