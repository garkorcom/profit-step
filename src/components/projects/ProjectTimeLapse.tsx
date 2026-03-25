import React, { useEffect, useState } from 'react';
import { Box, Typography, Paper, IconButton, CircularProgress, Chip, TextField, Button, Dialog } from '@mui/material';
import { collection, query, where, onSnapshot, orderBy, Timestamp, addDoc } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { ActivityLog } from '../../types/crm.types';

// Icons
import MicIcon from '@mui/icons-material/Mic';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CloseIcon from '@mui/icons-material/Close';

interface ProjectTimeLapseProps {
    projectId: string;
    companyId: string;
}

export const ProjectTimeLapse: React.FC<ProjectTimeLapseProps> = ({ projectId, companyId }) => {
    const [logs, setLogs] = useState<ActivityLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<'all' | 'media' | 'files' | 'system'>('all');

    // Quick Add State
    const [showQuickAdd, setShowQuickAdd] = useState(false);
    const [quickAddText, setQuickAddText] = useState('');

    useEffect(() => {
        if (!projectId) return;

        const q = query(
            collection(db, 'activity_logs'),
            where('projectId', '==', projectId),
            orderBy('performedAt', 'desc')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data: ActivityLog[] = [];
            snapshot.forEach((docSnap) => {
                data.push({ id: docSnap.id, ...docSnap.data() } as ActivityLog);
            });
            setLogs(data);
            setLoading(false);
        }, (err) => {
            console.error("Time-Lapse: Failed to load logs", err);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [projectId]);

    const handleQuickAddSubmit = async () => {
        if (!quickAddText.trim()) return;

        try {
            await addDoc(collection(db, 'activity_logs'), {
                companyId,
                projectId,
                type: 'note',
                content: quickAddText,
                performedBy: 'Пользователь', // Ideally firebase auth current user ID
                performedAt: Timestamp.now()
            });
            setQuickAddText('');
            setShowQuickAdd(false);
        } catch (err) {
            console.error("Failed to add note", err);
        }
    };

    const filteredLogs = logs.filter(log => {
        if (filter === 'all') return true;
        if (filter === 'media') return log.type === 'media_added' || log.type === 'voice_report';
        if (filter === 'system') return log.type === 'status_change' || log.type === 'task_status_changed';
        if (filter === 'files') return log.metadata?.fileUrl; // Assuming generic file uploads have fileUrl
        return true;
    });

    if (loading) return <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>;

    return (
        <Box>
            {/* Toolbar / Filters */}
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Box display="flex" gap={1}>
                    <Chip label="Все события" color={filter === 'all' ? 'primary' : 'default'} onClick={() => setFilter('all')} />
                    <Chip label="Только медиа" color={filter === 'media' ? 'primary' : 'default'} onClick={() => setFilter('media')} />
                    <Chip label="Системные" color={filter === 'system' ? 'primary' : 'default'} onClick={() => setFilter('system')} />
                </Box>
                <Button variant="contained" startIcon={<ChatBubbleOutlineIcon />} onClick={() => setShowQuickAdd(true)}>
                    Добавить запись
                </Button>
            </Box>

            {/* Quick Add Dialog Placeholder */}
            <Dialog open={showQuickAdd} onClose={() => setShowQuickAdd(false)} fullWidth maxWidth="sm">
                <Box p={3}>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                        <Typography variant="h6">Новая запись в хронику</Typography>
                        <IconButton size="small" onClick={() => setShowQuickAdd(false)}><CloseIcon /></IconButton>
                    </Box>
                    <TextField
                        fullWidth
                        multiline
                        rows={3}
                        placeholder="Опишите, что произошло..."
                        value={quickAddText}
                        onChange={(e) => setQuickAddText(e.target.value)}
                        autoFocus
                    />
                    <Box display="flex" justifyContent="space-between" mt={2}>
                        <Box display="flex" gap={1}>
                            <IconButton color="primary"><PhotoCameraIcon /></IconButton>
                            <IconButton color="primary"><MicIcon /></IconButton>
                            <IconButton color="primary"><UploadFileIcon /></IconButton>
                        </Box>
                        <Button variant="contained" onClick={handleQuickAddSubmit}>Сохранить</Button>
                    </Box>
                </Box>
            </Dialog>

            {/* Timeline Feed */}
            {filteredLogs.length === 0 ? (
                <Paper sx={{ p: 4, textAlign: 'center', bgcolor: 'grey.50' }}>
                    <Typography color="text.secondary">Хроника проекта пуста.</Typography>
                </Paper>
            ) : (
                <Box sx={{ position: 'relative', ml: 2, borderLeft: '2px solid', borderColor: 'grey.300', pb: 2 }}>
                    {filteredLogs.map(log => {
                        const dateString = log.performedAt?.toDate().toLocaleString() || 'Unknown Date';

                        return (
                            <Box key={log.id} sx={{ position: 'relative', mb: 3, pl: 4 }}>
                                {/* Timeline Dot */}
                                <Box sx={{
                                    position: 'absolute', left: '-10px', top: '16px',
                                    width: 18, height: 18, borderRadius: '50%',
                                    bgcolor: log.type === 'voice_report' ? 'secondary.main' : 'primary.main',
                                    border: '3px solid white', boxShadow: 1
                                }} />

                                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                                    <Box display="flex" justifyContent="space-between" mb={1}>
                                        <Typography variant="caption" fontWeight={700} color="text.secondary">
                                            {log.performedBy}
                                        </Typography>
                                        <Typography variant="caption" color="text.disabled">
                                            {dateString}
                                        </Typography>
                                    </Box>

                                    {/* Audio Player */}
                                    {log.type === 'voice_report' && log.metadata?.audioUrl && (
                                        <Box mt={1} mb={2} p={1} bgcolor="grey.100" borderRadius={1} display="flex" alignItems="center" gap={1}>
                                            <IconButton size="small" color="secondary"><PlayArrowIcon /></IconButton>
                                            <Typography variant="body2" color="text.secondary">Голосовой отчет объекта</Typography>
                                            {/* In reality we would render HTML5 <audio controls src={log.metadata.audioUrl} /> */}
                                        </Box>
                                    )}

                                    {/* Photos Grid */}
                                    {log.type === 'media_added' && log.metadata?.photoUrls && (
                                        <Box display="flex" gap={1} mt={1} mb={1} flexWrap="wrap">
                                            {log.metadata.photoUrls.map((url: string, idx: number) => (
                                                <Box key={idx} sx={{
                                                    width: 100, height: 100, borderRadius: 1,
                                                    backgroundImage: `url(${url})`, backgroundSize: 'cover'
                                                }} />
                                            ))}
                                        </Box>
                                    )}

                                    {/* Text Content */}
                                    {log.content && (
                                        <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                                            {log.content}
                                        </Typography>
                                    )}
                                </Paper>
                            </Box>
                        );
                    })}
                </Box>
            )}
        </Box>
    );
};
