import React, { useEffect, useState, useRef } from 'react';
import { Box, Typography, Paper, IconButton, CircularProgress, Chip, TextField, Button, Dialog, Checkbox, FormControlLabel, Snackbar, Alert } from '@mui/material';
import { collection, query, where, onSnapshot, orderBy, Timestamp, addDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../firebase/firebase';
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
    const [isInternalOnly, setIsInternalOnly] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');

    // Hidden inputs refs
    const photoInputRef = useRef<HTMLInputElement>(null);
    const audioInputRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

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
        setUploading(true);
        try {
            await addDoc(collection(db, 'activity_logs'), {
                companyId,
                projectId,
                type: 'note',
                content: quickAddText,
                isInternalOnly,
                performedBy: 'Пользователь', // Ideally firebase auth current user ID
                performedAt: Timestamp.now()
            });
            setQuickAddText('');
            setIsInternalOnly(false);
            setShowQuickAdd(false);
        } catch (err) {
            console.error("Failed to add note", err);
            setErrorMsg('Ошибка при сохранении заметки');
        } finally {
            setUploading(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'media_added' | 'voice_report' | 'document_uploaded') => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploading(true);
        try {
            // Upload to storage
            const fileRef = ref(storage, `projects/${projectId}/timeline/${Date.now()}_${file.name}`);
            await uploadBytes(fileRef, file);
            const downloadUrl = await getDownloadURL(fileRef);

            let metadata: any = {};
            if (type === 'media_added') metadata.photoUrls = [downloadUrl];
            if (type === 'voice_report') metadata.audioUrl = downloadUrl;
            if (type === 'document_uploaded') metadata.fileUrls = [{ url: downloadUrl, name: file.name, size: file.size, type: file.type }];

            await addDoc(collection(db, 'activity_logs'), {
                companyId,
                projectId,
                type,
                content: quickAddText || (type === 'media_added' ? 'Фото добавлено' : type === 'voice_report' ? 'Голосовой отчет' : 'Документ загружен'),
                metadata,
                isInternalOnly,
                performedBy: 'Пользователь',
                performedAt: Timestamp.now()
            });

            setQuickAddText('');
            setIsInternalOnly(false);
            setShowQuickAdd(false);
        } catch (err) {
            console.error("Failed to upload file", err);
            setErrorMsg('Ошибка при загрузке файла');
        } finally {
            setUploading(false);
            if (e.target) e.target.value = ''; // reset input
        }
    };

    const filteredLogs = logs.filter(log => {
        if (filter === 'all') return true;
        if (filter === 'media') return log.type === 'media_added' || log.type === 'voice_report';
        if (filter === 'system') return log.type === 'status_change' || log.type === 'task_status_changed';
        if (filter === 'files') return log.type === 'document_uploaded' || log.metadata?.fileUrls;
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
                    <Chip label="Документы" color={filter === 'files' ? 'primary' : 'default'} onClick={() => setFilter('files')} />
                    <Chip label="Системные" color={filter === 'system' ? 'primary' : 'default'} onClick={() => setFilter('system')} />
                </Box>
                <Button variant="contained" startIcon={<ChatBubbleOutlineIcon />} onClick={() => setShowQuickAdd(true)}>
                    Добавить запись
                </Button>
            </Box>

            {/* Quick Add Dialog */}
            <Dialog open={showQuickAdd} onClose={() => !uploading && setShowQuickAdd(false)} fullWidth maxWidth="sm">
                <Box p={3}>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                        <Typography variant="h6">Новая запись в хронику</Typography>
                        <IconButton size="small" disabled={uploading} onClick={() => setShowQuickAdd(false)}><CloseIcon /></IconButton>
                    </Box>
                    <TextField
                        fullWidth
                        multiline
                        rows={3}
                        placeholder="Опишите, что произошло, или прикрепите файл..."
                        value={quickAddText}
                        onChange={(e) => setQuickAddText(e.target.value)}
                        autoFocus
                        disabled={uploading}
                    />
                    
                    <Box display="flex" justifyContent="space-between" alignItems="center" mt={2} flexWrap="wrap" gap={2}>
                        <Box display="flex" gap={1} alignItems="center">
                            <input type="file" accept="image/*" ref={photoInputRef} hidden onChange={(e) => handleFileUpload(e, 'media_added')} />
                            <input type="file" accept="audio/*" ref={audioInputRef} hidden onChange={(e) => handleFileUpload(e, 'voice_report')} />
                            <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx" ref={fileInputRef} hidden onChange={(e) => handleFileUpload(e, 'document_uploaded')} />
                            
                            <IconButton color="primary" disabled={uploading} onClick={() => photoInputRef.current?.click()}><PhotoCameraIcon /></IconButton>
                            <IconButton color="primary" disabled={uploading} onClick={() => audioInputRef.current?.click()}><MicIcon /></IconButton>
                            <IconButton color="primary" disabled={uploading} onClick={() => fileInputRef.current?.click()}><UploadFileIcon /></IconButton>
                        </Box>

                        <Box display="flex" alignItems="center" gap={2}>
                            <FormControlLabel 
                                control={<Checkbox checked={isInternalOnly} onChange={(e) => setIsInternalOnly(e.target.checked)} disabled={uploading} />} 
                                label={<Typography variant="body2" color="text.secondary">Только для своих</Typography>} 
                            />
                            <Button variant="contained" disabled={uploading || (!quickAddText.trim() && !uploading)} onClick={handleQuickAddSubmit}>
                                {uploading ? <CircularProgress size={24} color="inherit" /> : 'Сохранить Текст'}
                            </Button>
                        </Box>
                    </Box>
                </Box>
            </Dialog>

            <Snackbar open={!!errorMsg} autoHideDuration={6000} onClose={() => setErrorMsg('')}>
                <Alert severity="error" onClose={() => setErrorMsg('')}>{errorMsg}</Alert>
            </Snackbar>

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
                                    bgcolor: log.type === 'voice_report' ? 'secondary.main' : (log.isInternalOnly ? 'grey.500' : 'primary.main'),
                                    border: '3px solid white', boxShadow: 1
                                }} />

                                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: log.isInternalOnly ? 'grey.50' : 'background.paper', position: 'relative', overflow: 'hidden' }}>
                                    {log.isInternalOnly && (
                                        <Box sx={{ position: 'absolute', top: 0, right: 0, bgcolor: 'warning.light', color: 'warning.dark', px: 1, py: 0.5, borderBottomLeftRadius: 8, fontSize: '0.7rem', fontWeight: 'bold' }}>
                                            INTERNAL ONLY
                                        </Box>
                                    )}
                                    <Box display="flex" justifyContent="space-between" mb={1} pr={log.isInternalOnly ? 12 : 0}>
                                        <Typography variant="caption" fontWeight={700} color="text.secondary">
                                            {log.performedBy}
                                        </Typography>
                                        <Typography variant="caption" color="text.disabled">
                                            {dateString}
                                        </Typography>
                                    </Box>

                                    {/* Audio Player */}
                                    {log.type === 'voice_report' && log.metadata?.audioUrl && (
                                        <Box mt={1} mb={2} p={1.5} bgcolor="grey.100" borderRadius={1}>
                                            <Typography variant="body2" color="text.secondary" mb={1} fontWeight={600}>Голосовой обзор объекта</Typography>
                                            <audio controls src={log.metadata.audioUrl} style={{ width: '100%', outline: 'none' }} />
                                            {log.metadata.aiTranslation && (
                                                <Typography variant="body2" sx={{ mt: 1, fontStyle: 'italic', color: 'text.secondary' }}>
                                                    Транскрибация ИИ: "{log.metadata.aiTranslation}"
                                                </Typography>
                                            )}
                                        </Box>
                                    )}

                                    {/* Photos Grid */}
                                    {log.type === 'media_added' && log.metadata?.photoUrls && (
                                        <Box display="flex" gap={1} mt={1} mb={1} flexWrap="wrap">
                                            {log.metadata.photoUrls.map((url: string, idx: number) => (
                                                <Box key={idx} sx={{
                                                    width: 120, height: 120, borderRadius: 1,
                                                    backgroundImage: `url(${url})`, backgroundSize: 'cover', backgroundPosition: 'center', boxShadow: 1
                                                }} />
                                            ))}
                                        </Box>
                                    )}

                                    {/* Document Files */}
                                    {log.type === 'document_uploaded' && log.metadata?.fileUrls && (
                                        <Box display="flex" flexDirection="column" gap={1} mt={1} mb={1}>
                                            {log.metadata.fileUrls.map((f: any, idx: number) => (
                                                <Button key={idx} variant="outlined" startIcon={<UploadFileIcon />} href={f.url} target="_blank" sx={{ justifyContent: 'flex-start', textTransform: 'none' }}>
                                                    {f.name} ({(f.size / 1024).toFixed(1)} KB)
                                                </Button>
                                            ))}
                                        </Box>
                                    )}

                                    {/* Text Content */}
                                    {log.content && (
                                        <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', mt: 1 }}>
                                            {log.content}
                                        </Typography>
                                    )}
                                    
                                    {/* Location Geotagging */}
                                    {log.location && (
                                        <Typography variant="caption" color="primary" sx={{ display: 'block', mt: 1 }}>
                                            📍 Прикреплена геопозиция
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
