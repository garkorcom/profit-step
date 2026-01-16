import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
    Box, Typography, Paper, Grid, IconButton, Chip, TextField, Button,
    Avatar, Divider, CircularProgress, Breadcrumbs, useTheme, alpha, Skeleton
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import EditIcon from '@mui/icons-material/Edit';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import PersonIcon from '@mui/icons-material/Person';
import FlagIcon from '@mui/icons-material/Flag';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import ChecklistIcon from '@mui/icons-material/Checklist';

import { doc, getDoc, updateDoc, Timestamp, onSnapshot, collection, addDoc, query, orderBy } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { GTDTask, GTDStatus, GTD_COLUMNS, PRIORITY_COLORS, GTDPriority } from '../../types/gtd.types';
import { useAuth } from '../../auth/AuthContext';

/**
 * Full Task Page - Task Workspace/Ecosystem
 * Route: /crm/gtd/:taskId
 * 
 * Layout:
 * +-----------------------------+-------------------+------------------+
 * |        Zone A (60%)         |    Zone B (25%)   |   Zone C (15%)   |
 * |  Description Editor         |   Comments Feed   |   Meta Sidebar   |
 * |  Checklist                  |   Activity Log    |   Start/Stop     |
 * |  Files & Media              |                   |   Dates/People   |
 * +-----------------------------+-------------------+------------------+
 */

const GTDTaskDetailsPage: React.FC = () => {
    const { taskId } = useParams<{ taskId: string }>();
    const navigate = useNavigate();
    const theme = useTheme();
    const { userProfile } = useAuth();

    const [task, setTask] = useState<GTDTask | null>(null);
    const [loading, setLoading] = useState(true);
    const [editingDescription, setEditingDescription] = useState(false);
    const [description, setDescription] = useState('');
    const [comments, setComments] = useState<any[]>([]);
    const [newComment, setNewComment] = useState('');

    // Fetch task data
    useEffect(() => {
        if (!taskId) return;

        const unsubscribe = onSnapshot(doc(db, 'gtd_tasks', taskId), (docSnap) => {
            if (docSnap.exists()) {
                setTask({ id: docSnap.id, ...docSnap.data() } as GTDTask);
                setDescription(docSnap.data().description || '');
            } else {
                // Task not found
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

    const formatDate = (timestamp: Timestamp | undefined) => {
        if (!timestamp) return '-';
        return new Date(timestamp.seconds * 1000).toLocaleDateString('ru-RU');
    };

    const formatDuration = (minutes: number | undefined) => {
        if (!minutes) return '-';
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return h > 0 ? `${h}ч ${m}м` : `${m}м`;
    };

    if (loading) {
        return (
            <Box p={3}>
                <Skeleton variant="text" width="40%" height={40} />
                <Skeleton variant="rectangular" height={300} sx={{ mt: 2 }} />
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
    const currentColumn = GTD_COLUMNS.find(c => c.id === task.status);

    return (
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1600, mx: 'auto' }}>
            {/* Header / Breadcrumbs */}
            <Box display="flex" alignItems="center" gap={2} mb={3}>
                <IconButton onClick={() => navigate('/crm/gtd')} size="small">
                    <ArrowBackIcon />
                </IconButton>
                <Breadcrumbs>
                    <Link to="/crm/gtd" style={{ textDecoration: 'none', color: theme.palette.text.secondary }}>
                        Lookahead
                    </Link>
                    <Typography color="text.primary" fontWeight="bold">{task.title}</Typography>
                </Breadcrumbs>
            </Box>

            {/* Main 3-Column Layout */}
            <Grid container spacing={3}>
                {/* ========== ZONE A: Work Content (60%) ========== */}
                <Grid size={{ xs: 12, md: 7 }}>
                    <Paper elevation={0} sx={{ p: 3, borderRadius: 2, border: '1px solid #e0e0e0' }}>
                        {/* Title */}
                        <Typography variant="h5" fontWeight="bold" gutterBottom>
                            {task.title}
                        </Typography>

                        {/* Status Chips */}
                        <Box display="flex" gap={1} mb={3} flexWrap="wrap">
                            {GTD_COLUMNS.slice(0, 4).map(col => (
                                <Chip
                                    key={col.id}
                                    label={col.title}
                                    size="small"
                                    onClick={() => handleStatusChange(col.id)}
                                    color={task.status === col.id ? 'primary' : 'default'}
                                    variant={task.status === col.id ? 'filled' : 'outlined'}
                                />
                            ))}
                        </Box>

                        <Divider sx={{ my: 2 }} />

                        {/* Description */}
                        <Box>
                            <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
                                <Typography variant="subtitle2" color="text.secondary">Описание</Typography>
                                {!editingDescription && (
                                    <IconButton size="small" onClick={() => setEditingDescription(true)}>
                                        <EditIcon fontSize="small" />
                                    </IconButton>
                                )}
                            </Box>
                            {editingDescription ? (
                                <Box>
                                    <TextField
                                        fullWidth
                                        multiline
                                        rows={6}
                                        value={description}
                                        onChange={(e) => setDescription(e.target.value)}
                                        variant="outlined"
                                        placeholder="Добавьте описание задачи..."
                                    />
                                    <Box display="flex" gap={1} mt={1}>
                                        <Button variant="contained" size="small" onClick={handleSaveDescription}>
                                            Сохранить
                                        </Button>
                                        <Button size="small" onClick={() => { setEditingDescription(false); setDescription(task.description || ''); }}>
                                            Отмена
                                        </Button>
                                    </Box>
                                </Box>
                            ) : (
                                <Typography
                                    variant="body1"
                                    sx={{ whiteSpace: 'pre-wrap', color: description ? 'text.primary' : 'text.disabled', cursor: 'pointer' }}
                                    onClick={() => setEditingDescription(true)}
                                >
                                    {description || 'Нажмите, чтобы добавить описание...'}
                                </Typography>
                            )}
                        </Box>

                        <Divider sx={{ my: 3 }} />

                        {/* Checklist Placeholder */}
                        <Box>
                            <Box display="flex" alignItems="center" gap={1} mb={1}>
                                <ChecklistIcon fontSize="small" color="action" />
                                <Typography variant="subtitle2" color="text.secondary">Чек-лист</Typography>
                            </Box>
                            <Typography variant="body2" color="text.disabled" fontStyle="italic">
                                Чек-лист будет добавлен в следующей версии
                            </Typography>
                        </Box>

                        <Divider sx={{ my: 3 }} />

                        {/* Attachments Placeholder */}
                        <Box>
                            <Box display="flex" alignItems="center" gap={1} mb={1}>
                                <AttachFileIcon fontSize="small" color="action" />
                                <Typography variant="subtitle2" color="text.secondary">Вложения</Typography>
                            </Box>
                            {task.sourceAudioUrl ? (
                                <Box>
                                    <a href={task.sourceAudioUrl} target="_blank" rel="noopener noreferrer">
                                        🎙️ Исходное аудио
                                    </a>
                                </Box>
                            ) : (
                                <Typography variant="body2" color="text.disabled" fontStyle="italic">
                                    Нет вложений
                                </Typography>
                            )}
                        </Box>
                    </Paper>
                </Grid>

                {/* ========== ZONE B: Communication (25%) ========== */}
                <Grid size={{ xs: 12, md: 3 }}>
                    <Paper elevation={0} sx={{ p: 2, borderRadius: 2, border: '1px solid #e0e0e0', height: '100%' }}>
                        <Typography variant="subtitle2" color="text.secondary" mb={2}>
                            💬 Комментарии
                        </Typography>

                        {/* Comment Input */}
                        <Box display="flex" gap={1} mb={2}>
                            <TextField
                                size="small"
                                fullWidth
                                placeholder="Добавить комментарий..."
                                value={newComment}
                                onChange={(e) => setNewComment(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleAddComment()}
                            />
                            <Button variant="contained" size="small" onClick={handleAddComment} disabled={!newComment.trim()}>
                                →
                            </Button>
                        </Box>

                        <Divider sx={{ mb: 2 }} />

                        {/* Comments List */}
                        <Box sx={{ maxHeight: 400, overflowY: 'auto' }}>
                            {comments.length === 0 ? (
                                <Typography variant="body2" color="text.disabled" textAlign="center">
                                    Нет комментариев
                                </Typography>
                            ) : (
                                comments.map(comment => (
                                    <Box key={comment.id} mb={2}>
                                        <Box display="flex" alignItems="center" gap={1}>
                                            <Avatar sx={{ width: 24, height: 24, fontSize: 12 }}>
                                                {comment.authorName?.charAt(0) || '?'}
                                            </Avatar>
                                            <Typography variant="caption" fontWeight="bold">
                                                {comment.authorName || 'Unknown'}
                                            </Typography>
                                            <Typography variant="caption" color="text.disabled">
                                                {comment.createdAt ? formatDate(comment.createdAt) : ''}
                                            </Typography>
                                        </Box>
                                        <Typography variant="body2" sx={{ ml: 4, mt: 0.5 }}>
                                            {comment.text}
                                        </Typography>
                                    </Box>
                                ))
                            )}
                        </Box>
                    </Paper>
                </Grid>

                {/* ========== ZONE C: Meta Sidebar (15%) ========== */}
                <Grid size={{ xs: 12, md: 2 }}>
                    <Paper elevation={0} sx={{ p: 2, borderRadius: 2, border: '1px solid #e0e0e0' }}>
                        <Typography variant="subtitle2" color="text.secondary" mb={2}>
                            ⚙️ Детали
                        </Typography>

                        {/* Priority */}
                        <Box mb={2}>
                            <Typography variant="caption" color="text.disabled">Приоритет</Typography>
                            <Chip
                                size="small"
                                label={task.priority || 'none'}
                                sx={{ mt: 0.5, bgcolor: priorityColor + '20', color: priorityColor, fontWeight: 'bold' }}
                            />
                        </Box>

                        {/* Assignee */}
                        <Box mb={2}>
                            <Typography variant="caption" color="text.disabled">Исполнитель</Typography>
                            <Box display="flex" alignItems="center" gap={1} mt={0.5}>
                                <PersonIcon fontSize="small" color="action" />
                                <Typography variant="body2">{task.assigneeName || 'Не назначен'}</Typography>
                            </Box>
                        </Box>

                        {/* Client */}
                        {task.clientName && (
                            <Box mb={2}>
                                <Typography variant="caption" color="text.disabled">Клиент</Typography>
                                <Typography variant="body2">{task.clientName}</Typography>
                            </Box>
                        )}

                        <Divider sx={{ my: 2 }} />

                        {/* Dates */}
                        <Box mb={2}>
                            <Typography variant="caption" color="text.disabled">Дата старта</Typography>
                            <Box display="flex" alignItems="center" gap={1} mt={0.5}>
                                <PlayArrowIcon fontSize="small" color="action" />
                                <Typography variant="body2">{formatDate(task.startDate)}</Typography>
                            </Box>
                        </Box>

                        <Box mb={2}>
                            <Typography variant="caption" color="text.disabled">Дедлайн</Typography>
                            <Box display="flex" alignItems="center" gap={1} mt={0.5}>
                                <FlagIcon fontSize="small" color="error" />
                                <Typography variant="body2" color={task.dueDate && new Date(task.dueDate.seconds * 1000) < new Date() && task.status !== 'done' ? 'error' : 'inherit'}>
                                    {formatDate(task.dueDate)}
                                </Typography>
                            </Box>
                        </Box>

                        <Box mb={2}>
                            <Typography variant="caption" color="text.disabled">Оценка времени</Typography>
                            <Box display="flex" alignItems="center" gap={1} mt={0.5}>
                                <AccessTimeIcon fontSize="small" color="action" />
                                <Typography variant="body2">{formatDuration(task.estimatedDurationMinutes)}</Typography>
                            </Box>
                        </Box>

                        <Divider sx={{ my: 2 }} />

                        {/* Created / Updated */}
                        <Box>
                            <Typography variant="caption" color="text.disabled">Создано</Typography>
                            <Typography variant="body2" fontSize="0.75rem">{formatDate(task.createdAt)}</Typography>
                        </Box>
                        {task.completedAt && (
                            <Box mt={1}>
                                <Typography variant="caption" color="text.disabled">Завершено</Typography>
                                <Typography variant="body2" fontSize="0.75rem" color="success.main">{formatDate(task.completedAt)}</Typography>
                            </Box>
                        )}
                    </Paper>
                </Grid>
            </Grid>
        </Box>
    );
};

export default GTDTaskDetailsPage;
