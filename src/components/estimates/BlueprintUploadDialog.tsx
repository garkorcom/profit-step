import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, Box, Typography, CircularProgress,
    Chip, LinearProgress, Tooltip, Menu, MenuItem,
    IconButton, Table, TableBody, TableCell, TableHead, TableRow, TableContainer, Paper
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import CloseIcon from '@mui/icons-material/Close';
import HistoryIcon from '@mui/icons-material/History';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import DeleteIcon from '@mui/icons-material/Delete';
import DescriptionIcon from '@mui/icons-material/Description';
import SaveIcon from '@mui/icons-material/Save';
import ImageIcon from '@mui/icons-material/Image';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import BoltIcon from '@mui/icons-material/Bolt';

import { useAuth } from '../../auth/AuthContext';
import { db } from '../../firebase/firebase';
import { Timestamp, doc, onSnapshot, updateDoc, collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { blueprintApi } from '../../api/blueprintApi';
import { savedEstimateApi } from '../../api/savedEstimateApi';
import { projectsApi } from '../../api/projectsApi';
import { BlueprintBatchJob, BlueprintAgentResult, BlueprintFileEntry } from '../../types/blueprint.types';
import { ProjectFile } from '../../types/project.types';
import { DEVICES, GEAR, POOL, GENERATOR, LANDSCAPE } from '../../constants/electricalDevices';
import jsPDF from 'jspdf';
import BlueprintV2Pipeline, { PageAnalysisResult } from './BlueprintV2Pipeline';
import autoTable from 'jspdf-autotable';



// ===== Sound notification =====
const playCompletionSound = () => {
    try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.5);
    } catch { /* silent */ }
};

// ===== Category mapping =====
let _categoryCache: { dev: Set<string>, gear: Set<string>, pool: Set<string>, gen: Set<string>, land: Set<string> } | null = null;

const getCategorySets = () => {
    if (!_categoryCache) {
        _categoryCache = {
            dev: new Set(Object.values(DEVICES).flat().map((i: any) => i.id)),
            gear: new Set(GEAR.map(i => i.id)),
            pool: new Set(POOL.map(i => i.id)),
            gen: new Set(GENERATOR.map(i => i.id)),
            land: new Set(LANDSCAPE.map(i => i.id)),
        };
    }
    return _categoryCache;
};

const getCategory = (key: string) => {
    const s = getCategorySets();
    if (s.dev.has(key)) return 'Devices & Lighting';
    if (s.gear.has(key)) return 'Gear & Panels';
    if (s.pool.has(key)) return 'Pool Equipment';
    if (s.gen.has(key)) return 'Generator';
    if (s.land.has(key)) return 'Landscape';
    return 'Other / Unknown';
};

// ===== History =====
interface JobHistoryItem { id: string; fileName: string; createdAt: any; status: string; totalFiles?: number; }

// ===== Classification labels =====
const classificationLabel: Record<string, { label: string; emoji: string; color: string }> = {
    electrical_plan: { label: 'Электрический план', emoji: '⚡', color: 'success.main' },
    schedule: { label: 'Панельная спец.', emoji: '📋', color: 'info.main' },
    cover: { label: 'Обложка / Титул', emoji: '📄', color: 'text.secondary' },
    specification: { label: 'Техническая спец.', emoji: '📝', color: 'text.secondary' },
    other: { label: 'Другое', emoji: '❓', color: 'text.secondary' },
    pending: { label: 'Ожидание...', emoji: '⏳', color: 'text.secondary' },
};

const fileStatusIcon = (status: string) => {
    switch (status) {
        case 'completed': return <CheckCircleIcon fontSize="small" color="success" />;
        case 'failed': return <ErrorOutlineIcon fontSize="small" color="error" />;
        case 'skipped': return <SkipNextIcon fontSize="small" sx={{ color: 'text.secondary' }} />;
        case 'analyzing': return <CircularProgress size={16} />;
        case 'classifying': return <CircularProgress size={16} color="secondary" />;
        default: return <CircularProgress size={16} variant="indeterminate" />;
    }
};

/**
 * BLUEPRINT UPLOAD DIALOG (V1 & V2)
 * 
 * Modified to support the "Estimate Versioning" architecture.
 * If a `projectId` is passed as a prop (e.g. from an existing Project Workspace), the save logic
 * will skip creating a new Project and instead append the AI analysis results as a NEW version
 * under the existing project. This enables A/B testing of AI prompts (v1 vs v2).
 */
export interface BlueprintUploadDialogProps {
    open: boolean;
    onClose: () => void;
    onApply: (data: any, areaSqft?: number) => void;
    projectId?: string | null;
}

export const BlueprintUploadDialog: React.FC<BlueprintUploadDialogProps> = ({ open, onClose, onApply, projectId }) => {
    const { userProfile } = useAuth();
    const navigate = useNavigate();

    // Multi-file selection (before upload)
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

    // Batch job state
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState('');
    const [batchId, setBatchId] = useState<string | null>(null);
    const [batch, setBatch] = useState<BlueprintBatchJob | null>(null);
    const [processStartTime, setProcessStartTime] = useState<number | null>(null);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [localResult, setLocalResult] = useState<BlueprintAgentResult>({});
    const [v2AiResults, setV2AiResults] = useState<{ gemini?: Record<string, number>, claude?: Record<string, number>, openai?: Record<string, number> }>({});
    const [v2PageResults, setV2PageResults] = useState<PageAnalysisResult[]>([]);

    // History
    const [showHistory, setShowHistory] = useState(false);
    const [historyItems, setHistoryItems] = useState<JobHistoryItem[]>([]);
    // Drag & Drop
    const [isDragging, setIsDragging] = useState(false);
    // V2 Pipeline mode
    const [useV2Pipeline, setUseV2Pipeline] = useState(false);
    const [v2Completed, setV2Completed] = useState(false);
    // V2 Metadata
    const [v2ProjectName, setV2ProjectName] = useState('');
    const [v2Address, setV2Address] = useState('');
    const [v2AreaSqft, setV2AreaSqft] = useState<number | ''>('');
    const [pdfMenuAnchorEl, setPdfMenuAnchorEl] = useState<null | HTMLElement>(null);
    const dragCounter = useRef(0);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const logBoxRef = useRef<HTMLDivElement>(null);
    const soundPlayedRef = useRef(false);

    // ===== Firestore listener for batch =====
    useEffect(() => {
        if (!batchId) return;
        const unsub = onSnapshot(doc(db, 'blueprint_batches', batchId), (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data() as BlueprintBatchJob;
                setBatch(data);
                if (data.status === 'completed' && data.finalResult) {
                    setLocalResult(prev => Object.keys(prev).length === 0 ? data.finalResult! : prev);
                }
            }
        });
        return () => unsub();
    }, [batchId]);

    // ===== Auto-scroll terminal =====
    useEffect(() => {
        if (logBoxRef.current) {
            logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
        }
    }, [batch?.logs]);

    // ===== Sound on completion =====
    useEffect(() => {
        if (batch?.status === 'completed' && !soundPlayedRef.current) {
            soundPlayedRef.current = true;
            playCompletionSound();
        }
    }, [batch?.status]);

    // ===== Timer =====
    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (processStartTime && (uploading || (batch && batch.status !== 'completed' && batch.status !== 'failed'))) {
            interval = setInterval(() => {
                setElapsedSeconds(Math.floor((Date.now() - processStartTime) / 1000));
            }, 1000);
        }
        return () => { if (interval) clearInterval(interval); };
    }, [processStartTime, uploading, batch, batch?.status]);

    // ===== Reset =====
    const resetState = () => {
        setBatchId(null);
        setBatch(null);
        setSelectedFiles([]);
        setProcessStartTime(null);
        setElapsedSeconds(0);
        setLocalResult({});
        setUploading(false);
        setUploadProgress('');
        setUseV2Pipeline(false);
        setV2Completed(false);
        setV2ProjectName('');
        setV2Address('');
        setV2AreaSqft('');
        setV2AiResults({});
        setV2PageResults([]);
        setPdfMenuAnchorEl(null);
        soundPlayedRef.current = false;
        dragCounter.current = 0;
    };

    const handleResetJob = async () => {
        if (!batchId) return;
        try {
            await updateDoc(doc(db, 'blueprint_batches', batchId), { status: 'failed', error: 'Cancelled by user' });
        } catch (error) { console.error('Failed to cancel job', error); }
        resetState();
    };

    const handleClose = () => { onClose(); setTimeout(resetState, 300); };

    // ===== File selection (not upload yet) =====
    const addFiles = useCallback((newFiles: File[]) => {
        const MAX_SIZE_MB = 50;
        const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'];
        const MAX_FILES = 20;

        // Deduplicate by name + size
        const validated = newFiles.filter(file => {
            if (file.size > MAX_SIZE_MB * 1024 * 1024) {
                alert(`${file.name}: слишком большой (${(file.size / 1024 / 1024).toFixed(1)}MB). Макс ${MAX_SIZE_MB}MB.`);
                return false;
            }
            if (!allowedTypes.includes(file.type) && !file.name.match(/\.(pdf|png|jpe?g)$/i)) {
                alert(`${file.name}: неподдерживаемый формат.`);
                return false;
            }
            return true;
        });

        setSelectedFiles(prev => {
            // Filter out duplicates (same name + same size)
            const existingKeys = new Set(prev.map(f => `${f.name}_${f.size}`));
            const unique = validated.filter(f => !existingKeys.has(`${f.name}_${f.size}`));
            if (unique.length < validated.length) {
                const dupeCount = validated.length - unique.length;
                // Silent skip for dupes
                console.log(`Skipped ${dupeCount} duplicate file(s)`);
            }
            const combined = [...prev, ...unique];
            if (combined.length > MAX_FILES) {
                alert(`Максимум ${MAX_FILES} файлов. Лишние удалены.`);
                return combined.slice(0, MAX_FILES);
            }
            return combined;
        });
    }, []);

    const removeFile = (index: number) => {
        setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    };

    const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            addFiles(Array.from(files));
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
    }, [addFiles]);

    const handleUploadClick = () => fileInputRef.current?.click();

    // ===== Start batch upload =====
    const startBatchUpload = async () => {
        if (!userProfile?.companyId || !userProfile?.id || selectedFiles.length === 0) return;

        try {
            setProcessStartTime(Date.now());
            setUploading(true);
            setUploadProgress(`0/${selectedFiles.length}`);
            soundPlayedRef.current = false;
            const newBatchId = await blueprintApi.createBlueprintBatchJob(
                userProfile.companyId,
                userProfile.id,
                selectedFiles,
                (uploaded, total) => setUploadProgress(`${uploaded}/${total}`)
            );
            setBatchId(newBatchId);
        } catch (error) {
            console.error('Batch upload failed', error);
            alert('Ошибка загрузки файлов');
        } finally {
            setUploading(false);
        }
    };

    // ===== Drag & drop =====
    const handleDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault(); e.stopPropagation();
        dragCounter.current++;
        setIsDragging(true);
    }, []);
    const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); }, []);
    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault(); e.stopPropagation();
        dragCounter.current--;
        if (dragCounter.current === 0) setIsDragging(false);
    }, []);
    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault(); e.stopPropagation();
        setIsDragging(false);
        dragCounter.current = 0;
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            addFiles(Array.from(files));
        }
    }, [addFiles]);

    // ===== History =====
    const loadHistory = async () => {
        if (!userProfile?.companyId) return;
        try {
            const q = query(
                collection(db, 'blueprint_batches'),
                where('companyId', '==', userProfile.companyId),
                orderBy('createdAt', 'desc'),
                limit(10)
            );
            const snap = await getDocs(q);
            setHistoryItems(snap.docs.map(d => ({
                id: d.id,
                fileName: `${d.data().totalFiles || 0} файлов`,
                createdAt: d.data().createdAt,
                status: d.data().status,
                totalFiles: d.data().totalFiles
            })));
            setShowHistory(true);
        } catch (err) { console.error('Failed to load history', err); }
    };

    const loadHistoryJob = (id: string) => {
        setShowHistory(false);
        soundPlayedRef.current = true;
        setBatchId(id);
    };


    const handleApply = () => {
        onApply(localResult, v2AreaSqft ? Number(v2AreaSqft) : undefined);
        handleClose();
    };

    const [savingProject, setSavingProject] = useState(false);
    const [saveSnackbar, setSaveSnackbar] = useState('');

    const handleSaveProject = async () => {
        if (!localResult || !batchId || !batch || !userProfile?.companyId) return;
        setSavingProject(true);
        try {
            const projectName = batch.metadata?.address || `Estimate ${new Date().toLocaleDateString()}`;
            await savedEstimateApi.save({
                companyId: userProfile.companyId,
                createdBy: userProfile.id || '',
                projectName,
                address: batch.metadata?.address,
                description: batch.metadata?.description,
                areaSqft: batch.metadata?.areaSqft,
                batchId,
                quantities: { ...localResult },
                originalQuantities: { ...localResult },
                laborRate: 65,
                wirePrice: 0.45,
                totalMaterials: 0,
                totalLabor: 0,
                totalWire: 0,
                grandTotal: 0,
                filesCount: batch.totalFiles || 0,
                electricalCount: batch.electricalCount || 0,
                status: 'draft',
            });
            setSaveSnackbar('Проект сохранён ✅');
        } catch (err) { console.error('Save project failed', err); setSaveSnackbar('Ошибка сохранения'); }
        setSavingProject(false);
    };

    // ===== PDF Export =====
    const exportAiReportPDF = () => {
        if (!batch || !localResult) return;
        const pdf = new jsPDF();
        pdf.setFontSize(16);
        pdf.text('AI Blueprint Batch Report', 14, 22);
        pdf.setFontSize(10);
        pdf.setTextColor(100);
        pdf.text(`Files: ${batch.totalFiles} | Electrical: ${batch.electricalCount || 0} | Date: ${new Date().toLocaleDateString()}`, 14, 30);

        const allKeys = Object.keys(localResult);
        const grouped: Record<string, any[]> = {};
        allKeys.forEach(key => {
            const cat = getCategory(key);
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push({
                name: key.replace(/_/g, ' '),
                qty: localResult[key]?.toString() || '0',
            });
        });

        let startY = 40;
        Object.entries(grouped).forEach(([category, items]) => {
            pdf.setFontSize(11);
            pdf.setTextColor(33, 33, 33);
            pdf.text(category.toUpperCase(), 14, startY);
            startY += 4;
            autoTable(pdf, {
                startY,
                head: [['Item', 'Total Qty']],
                body: items.map(r => [r.name, r.qty]),
                styles: { fontSize: 8 },
                headStyles: { fillColor: [46, 125, 50] },
                margin: { left: 14 },
                theme: 'grid'
            });
            startY = (pdf as any).lastAutoTable.finalY + 10;
        });

        pdf.save(`AI_Batch_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
    };

    // ===== RENDER: File list before upload =====
    const renderFileList = () => (
        <Box>
            <Box
                sx={{
                    border: '2px dashed',
                    borderColor: isDragging ? 'primary.main' : 'divider',
                    borderRadius: 2, p: 4, textAlign: 'center', cursor: 'pointer',
                    bgcolor: isDragging ? 'primary.50' : 'transparent',
                    '&:hover': { bgcolor: 'action.hover', borderColor: 'primary.main' },
                    transition: 'all 0.2s', mb: 2
                }}
                onClick={handleUploadClick}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                <CloudUploadIcon sx={{ fontSize: 48, color: isDragging ? 'primary.main' : 'text.secondary', mb: 1 }} />
                <Typography variant="h6" gutterBottom>
                    {isDragging ? 'Отпустите файлы здесь' : 'Загрузите чертежи проекта'}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    Перетащите или выберите PDF / изображения (до 20 файлов, макс 50MB)
                </Typography>
            </Box>

            {selectedFiles.length > 0 && (
                <Box>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                        <Typography variant="subtitle2" color="text.secondary">
                            Выбрано файлов: {selectedFiles.length}
                        </Typography>
                        <Box display="flex" alignItems="center" gap={1}>
                            <Typography variant="caption" color="text.secondary">
                                {(selectedFiles.reduce((s, f) => s + f.size, 0) / 1024 / 1024).toFixed(1)} MB
                            </Typography>
                            <Button size="small" variant="outlined" onClick={handleUploadClick} sx={{ minWidth: 0, px: 1, py: 0.3, fontSize: '0.7rem' }}>
                                + Добавить
                            </Button>
                        </Box>
                    </Box>
                    <Box sx={{ maxHeight: 200, overflowY: 'auto', mb: 2 }}>
                        {selectedFiles.map((file, idx) => (
                            <Box key={idx} display="flex" alignItems="center" justifyContent="space-between"
                                sx={{ p: 0.8, borderBottom: 1, borderColor: 'divider' }}>
                                <Box display="flex" alignItems="center" gap={1}>
                                    {file.type === 'application/pdf'
                                        ? <DescriptionIcon fontSize="small" color="error" />
                                        : <ImageIcon fontSize="small" color="primary" />}
                                    <Typography variant="body2" noWrap sx={{ maxWidth: 300 }}>{file.name}</Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        {(file.size / 1024).toFixed(0)}KB
                                    </Typography>
                                </Box>
                                <IconButton size="small" onClick={() => removeFile(idx)}>
                                    <DeleteIcon fontSize="small" />
                                </IconButton>
                            </Box>
                        ))}
                    </Box>

                    <Box display="flex" gap={1}>
                        <Button
                            variant="contained"
                            fullWidth
                            size="large"
                            startIcon={<BoltIcon />}
                            onClick={startBatchUpload}
                            sx={{ py: 1.5 }}
                        >
                            ⚡ Быстрый анализ ({selectedFiles.length})
                        </Button>
                        <Button
                            variant="outlined"
                            fullWidth
                            size="large"
                            onClick={() => setUseV2Pipeline(true)}
                            sx={{ py: 1.5 }}
                        >
                            📄 Постраничный V2
                        </Button>
                    </Box>
                </Box>
            )}
        </Box>
    );

    // ===== RENDER: Processing state with per-file table =====
    const renderProcessing = () => {
        const logs = batch?.logs || [];
        const displayLogs = [...logs];
        if (uploading && displayLogs.length === 0) {
            displayLogs.push({ timestamp: Date.now(), message: 'Загрузка файлов на сервер...', type: 'info' });
        }

        const files = batch?.files || [];

        return (
            <Box py={1}>
                <Box mb={2} display="flex" justifyContent="space-between" alignItems="center">
                    <Typography variant="h6" color="primary">{batch?.message || 'Обработка...'}</Typography>
                    <Typography variant="h6" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                        {Math.floor(elapsedSeconds / 60).toString().padStart(2, '0')}:{(elapsedSeconds % 60).toString().padStart(2, '0')}
                    </Typography>
                </Box>

                <LinearProgress variant={uploading ? "indeterminate" : "determinate"} value={batch?.progress || 0} sx={{ mb: 2 }} />

                {/* Upload counter */}
                {uploading && uploadProgress && (
                    <Typography variant="body2" color="primary" textAlign="center" mb={1} sx={{ fontFamily: 'monospace' }}>
                        📤 Загрузка файлов: {uploadProgress}
                    </Typography>
                )}

                {/* Per-file status table */}
                {files.length > 0 && (
                    <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 200, mb: 2 }}>
                        <Table size="small" stickyHeader>
                            <TableHead>
                                <TableRow>
                                    <TableCell sx={{ py: 0.5 }}>Файл</TableCell>
                                    <TableCell sx={{ py: 0.5 }} align="center">Тип</TableCell>
                                    <TableCell sx={{ py: 0.5 }} align="center">Статус</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {files.map((f: BlueprintFileEntry, i: number) => {
                                    const cls = classificationLabel[f.classification] || classificationLabel.pending;
                                    return (
                                        <TableRow key={i} sx={{
                                            opacity: f.status === 'skipped' ? 0.5 : 1,
                                            bgcolor: f.status === 'failed' ? 'error.50' : undefined
                                        }}>
                                            <TableCell sx={{ py: 0.5 }}>
                                                <Box display="flex" alignItems="center" gap={0.5}>
                                                    {f.mimeType?.includes('pdf')
                                                        ? <DescriptionIcon fontSize="small" color="error" />
                                                        : <ImageIcon fontSize="small" color="primary" />}
                                                    <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>{f.fileName}</Typography>
                                                </Box>
                                            </TableCell>
                                            <TableCell align="center" sx={{ py: 0.5 }}>
                                                <Typography variant="caption" color={cls.color}>
                                                    {cls.emoji} {cls.label}
                                                </Typography>
                                            </TableCell>
                                            <TableCell align="center" sx={{ py: 0.5 }}>
                                                <Box display="flex" alignItems="center" justifyContent="center" gap={0.5}>
                                                    {fileStatusIcon(f.status)}
                                                    {f.error && (
                                                        <Tooltip title={f.error}>
                                                            <Typography variant="caption" color="error">!</Typography>
                                                        </Tooltip>
                                                    )}
                                                </Box>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </TableContainer>
                )}

                {/* Metadata */}
                {batch?.metadata && (
                    <Box mb={2} p={1.5} bgcolor="grey.50" borderRadius={1} border={1} borderColor="grey.200">
                        <Typography variant="subtitle2" color="primary">
                            <CheckCircleIcon sx={{ fontSize: 14, verticalAlign: 'middle', mr: 0.5 }} />
                            Project Info
                        </Typography>
                        {batch.metadata.description && <Typography variant="body2"><strong>Name:</strong> {batch.metadata.description}</Typography>}
                        {batch.metadata.address && <Typography variant="body2"><strong>Address:</strong> {batch.metadata.address}</Typography>}
                        {batch.metadata.areaSqft && <Typography variant="body2"><strong>Area:</strong> {batch.metadata.areaSqft.toLocaleString()} sq ft</Typography>}
                    </Box>
                )}

                {/* Terminal Log */}
                <Box sx={{
                    bgcolor: '#121212', p: 1.5, borderRadius: 1,
                    fontFamily: 'monospace', height: 140, overflowY: 'auto', textAlign: 'left',
                    boxShadow: 'inset 0 0 10px rgba(0,0,0,0.5)', mb: 2
                }} ref={logBoxRef}>
                    {displayLogs.map((log, i) => {
                        const colorMap: any = {
                            error: '#ff5555', success: '#00ff00', gemini: '#8ab4f8', claude: '#fbbc04',
                            openAi: '#34a853', info: '#cccccc', classify: '#ce93d8'
                        };
                        return (
                            <Box key={i} sx={{ mb: 0.3, opacity: i === displayLogs.length - 1 ? 1 : 0.7 }}>
                                <Typography variant="body2" component="span" sx={{ color: '#888', mr: 1, fontFamily: 'monospace', fontSize: '0.7rem' }}>
                                    [{new Date(log.timestamp).toLocaleTimeString()}]
                                </Typography>
                                <Typography variant="body2" component="span" sx={{ color: colorMap[log.type] || '#ccc', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                                    {log.message}
                                </Typography>
                            </Box>
                        );
                    })}
                </Box>

                <Box display="flex" justifyContent="center">
                    <Button color="error" variant="outlined" onClick={handleResetJob} size="small">
                        Остановить (Force Reset)
                    </Button>
                </Box>
            </Box>
        );
    };

    // ===== RENDER: Completed =====
    const renderCompleted = () => {
        if (!batch || !batch.finalResult) return null;
        const result = localResult;
        const allKeys = Object.keys(result);
        const totalDevices = Object.values(result).reduce((s, v) => s + v, 0);
        const completedFiles = batch.files?.filter(f => f.status === 'completed').length || 0;
        const failedFiles = batch.files?.filter(f => f.status === 'failed').length || 0;

        const grouped: Record<string, { key: string; qty: number }[]> = {};
        allKeys.forEach(key => {
            const cat = getCategory(key);
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push({ key, qty: result[key] });
        });

        return (
            <Box>
                {/* Summary banner */}
                <Box display="flex" alignItems="center" gap={1} mb={2}
                    bgcolor={failedFiles > 0 ? "warning.light" : "success.light"} p={2} borderRadius={1}
                    color={failedFiles > 0 ? "warning.contrastText" : "success.contrastText"}>
                    {failedFiles > 0 ? <ErrorOutlineIcon /> : <CheckCircleIcon />}
                    <Box>
                        <Typography fontWeight="medium">
                            Анализ завершён! {completedFiles}/{batch.totalFiles} файлов обработано.
                        </Typography>
                        <Typography variant="body2">
                            {allKeys.length} типов устройств, {totalDevices} всего
                            {failedFiles > 0 && ` • ${failedFiles} файлов с ошибками`}
                        </Typography>
                    </Box>
                </Box>

                {/* Per-file summary */}
                {batch.files && batch.files.length > 1 && (
                    <Box mb={2}>
                        <Typography variant="subtitle2" mb={1}>Файлы проекта:</Typography>
                        <Box sx={{ maxHeight: 120, overflowY: 'auto' }}>
                            {batch.files.map((f, i) => {
                                const cls = classificationLabel[f.classification] || classificationLabel.other;
                                const devCount = f.result ? Object.values(f.result).reduce((s, v) => s + v, 0) : 0;
                                return (
                                    <Box key={i} display="flex" alignItems="center" gap={1} py={0.3}
                                        sx={{ opacity: f.status === 'skipped' ? 0.5 : 1 }}>
                                        {fileStatusIcon(f.status)}
                                        <Typography variant="body2" noWrap sx={{ maxWidth: 250, flex: 1 }}>{f.fileName}</Typography>
                                        <Typography variant="caption" color={cls.color}>{cls.emoji}</Typography>
                                        {f.status === 'completed' && (
                                            <Chip label={`${devCount} шт`} size="small" color="primary" variant="outlined" />
                                        )}
                                        {f.status === 'failed' && (
                                            <Tooltip title={f.error || ''}><Chip label="Ошибка" size="small" color="error" /></Tooltip>
                                        )}
                                    </Box>
                                );
                            })}
                        </Box>
                    </Box>
                )}

                {/* Merged results table */}
                <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 350 }}>
                    <Table size="small" stickyHeader>
                        <TableHead>
                            <TableRow>
                                <TableCell>Item Name</TableCell>
                                <TableCell align="center">Итого</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {Object.entries(grouped).map(([category, items]) => (
                                <React.Fragment key={category}>
                                    <TableRow sx={{ bgcolor: 'grey.100' }}>
                                        <TableCell colSpan={2} sx={{ fontWeight: 'bold', py: 0.5 }}>
                                            {category.toUpperCase()}
                                        </TableCell>
                                    </TableRow>
                                    {items.map(({ key, qty }) => (
                                        <TableRow key={key}>
                                            <TableCell sx={{ textTransform: 'capitalize' }}>{key.replace(/_/g, ' ')}</TableCell>
                                            <TableCell align="center">
                                                <Chip label={qty} color="success" size="small" variant="outlined" />
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </React.Fragment>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            </Box>
        );
    };

    // ===== RENDER: History =====
    const renderHistory = () => (
        <Box>
            <Typography variant="subtitle1" fontWeight="bold" mb={2}>Последние анализы</Typography>
            {historyItems.length === 0 ? (
                <Typography color="text.secondary">Нет предыдущих анализов.</Typography>
            ) : (
                historyItems.map(item => (
                    <Box key={item.id} display="flex" justifyContent="space-between" alignItems="center" p={1.5}
                        sx={{ border: 1, borderColor: 'divider', borderRadius: 1, mb: 1, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
                        onClick={() => loadHistoryJob(item.id)}
                    >
                        <Box>
                            <Typography variant="body2" fontWeight="medium">{item.fileName}</Typography>
                            <Typography variant="caption" color="text.secondary">
                                {item.createdAt?.toDate ? item.createdAt.toDate().toLocaleString() : 'N/A'}
                            </Typography>
                        </Box>
                        <Chip label={item.status} size="small"
                            color={item.status === 'completed' ? 'success' : item.status === 'failed' ? 'error' : 'default'} variant="outlined"
                        />
                    </Box>
                ))
            )}
            <Button onClick={() => setShowHistory(false)} sx={{ mt: 2 }}>Назад</Button>
        </Box>
    );

    // ===== MAIN RENDER =====
    const exportV2Pdf = (quantities: Record<string, number>, label: string) => {
        const pdf = new jsPDF();
        pdf.setFontSize(16);
        pdf.text(`AI Blueprint V2 Analysis Report - ${label}`, 14, 22);
        pdf.setFontSize(10);
        pdf.setTextColor(100);
        pdf.text(`Project: ${v2ProjectName} | Files: ${selectedFiles.length} | Date: ${new Date().toLocaleDateString()}`, 14, 30);
        if (v2Address) pdf.text(`Address: ${v2Address}`, 14, 36);

        const allKeys = Object.keys(quantities);
        const grouped: Record<string, any[]> = {};
        allKeys.forEach(key => {
            const cat = getCategory(key);
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push({ name: key.replace(/_/g, ' '), qty: quantities[key]?.toString() || '0' });
        });

        let startY = v2Address ? 44 : 38;
        Object.entries(grouped).forEach(([category, items]) => {
            pdf.setFontSize(11);
            pdf.setTextColor(33, 33, 33);
            pdf.text(category.toUpperCase(), 14, startY);
            startY += 4;
            autoTable(pdf, {
                startY,
                head: [['Item', 'Qty']],
                body: items.map(r => [r.name, r.qty]),
                styles: { fontSize: 8 },
                headStyles: { fillColor: [46, 125, 50] },
                margin: { left: 14 },
                theme: 'grid'
            });
            startY = (pdf as any).lastAutoTable.finalY + 10;
        });

        const safeProjectName = v2ProjectName.replace(/\s+/g, '_');
        const safeLabel = label.replace(/\s+/g, '_');
        pdf.save(`AI_V2_${safeLabel}_Report_${safeProjectName}_${new Date().toISOString().slice(0, 10)}.pdf`);
    };
    const isProcessing = uploading || (batchId && batch && batch.status !== 'completed' && batch.status !== 'failed');

    return (
        <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box display="flex" alignItems="center" gap={1}>
                    <AutoAwesomeIcon color="primary" />
                    {"Multi-File Blueprint Analysis"}
                </Box>
                <Box display="flex" gap={0.5}>
                    {!batchId && !uploading && !showHistory && selectedFiles.length === 0 && (
                        <Tooltip title="История анализов">
                            <IconButton onClick={loadHistory} size="small"><HistoryIcon /></IconButton>
                        </Tooltip>
                    )}
                    <IconButton onClick={handleClose} size="small"><CloseIcon /></IconButton>
                </Box>
            </DialogTitle>

            <DialogContent dividers>
                <input type="file" ref={fileInputRef} style={{ display: 'none' }}
                    accept="image/*,.pdf" multiple onChange={handleFileChange} />

                {/* History View */}
                {showHistory && renderHistory()}

                {/* STATE 1: File selection (V1 or V2 entry) */}
                {!batchId && !uploading && !showHistory && !useV2Pipeline && renderFileList()}

                {/* V2 PIPELINE MODE */}
                {useV2Pipeline && selectedFiles.length > 0 && !batchId && !v2Completed && (
                    <BlueprintV2Pipeline
                        files={selectedFiles}
                        onComplete={(result, aiResults, pageResults) => {
                            setLocalResult(result);
                            setV2AiResults(aiResults);
                            setV2PageResults(pageResults);
                            setV2Completed(true);
                            setV2ProjectName(selectedFiles[0]?.name?.replace(/\.pdf$/i, '') || `Estimate ${new Date().toLocaleDateString()}`);
                            playCompletionSound();
                        }}
                        onCancel={() => setUseV2Pipeline(false)}
                    />
                )}

                {/* V2 COMPLETED: Review Screen */}
                {v2Completed && (() => {
                    const result = localResult;
                    const allKeys = Object.keys(result);
                    const totalDevices = Object.values(result).reduce((s, v) => s + v, 0);
                    const grouped: Record<string, { key: string; qty: number }[]> = {};
                    allKeys.forEach(key => {
                        const cat = getCategory(key);
                        if (!grouped[cat]) grouped[cat] = [];
                        grouped[cat].push({ key, qty: result[key] });
                    });

                    return (
                        <Box>
                            {/* Summary banner */}
                            <Box display="flex" alignItems="center" gap={1} mb={2}
                                bgcolor="success.light" p={2} borderRadius={1} color="success.contrastText">
                                <CheckCircleIcon />
                                <Box>
                                    <Typography fontWeight="medium">
                                        V2 Анализ завершён! {selectedFiles.length} файлов
                                    </Typography>
                                    <Typography variant="body2">
                                        {allKeys.length} типов устройств, {totalDevices} шт. суммарно
                                    </Typography>
                                </Box>
                            </Box>

                            {/* Metadata fields */}
                            <Box display="flex" gap={2} mb={2} flexWrap="wrap">
                                <Box sx={{ flex: '1 1 200px' }}>
                                    <Typography variant="caption" color="text.secondary" mb={0.5} display="block">Название проекта</Typography>
                                    <input
                                        value={v2ProjectName}
                                        onChange={e => setV2ProjectName(e.target.value)}
                                        placeholder="My Project"
                                        style={{
                                            width: '100%', padding: '8px 12px', border: '1px solid #ccc',
                                            borderRadius: 6, fontSize: 14, outline: 'none',
                                        }}
                                    />
                                </Box>
                                <Box sx={{ flex: '1 1 200px' }}>
                                    <Typography variant="caption" color="text.secondary" mb={0.5} display="block">Адрес</Typography>
                                    <input
                                        value={v2Address}
                                        onChange={e => setV2Address(e.target.value)}
                                        placeholder="123 Main St"
                                        style={{
                                            width: '100%', padding: '8px 12px', border: '1px solid #ccc',
                                            borderRadius: 6, fontSize: 14, outline: 'none',
                                        }}
                                    />
                                </Box>
                                <Box sx={{ flex: '0 1 120px' }}>
                                    <Typography variant="caption" color="text.secondary" mb={0.5} display="block">Площадь (sq ft)</Typography>
                                    <input
                                        type="number"
                                        value={v2AreaSqft}
                                        onChange={e => setV2AreaSqft(e.target.value ? Number(e.target.value) : '')}
                                        placeholder="2500"
                                        style={{
                                            width: '100%', padding: '8px 12px', border: '1px solid #ccc',
                                            borderRadius: 6, fontSize: 14, outline: 'none',
                                        }}
                                    />
                                </Box>
                            </Box>

                            {/* Editable results table */}
                            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 350 }}>
                                <Table size="small" stickyHeader>
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>Позиция</TableCell>
                                            <TableCell align="center">Кол-во</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {Object.entries(grouped).map(([category, items]) => (
                                            <React.Fragment key={category}>
                                                <TableRow sx={{ bgcolor: 'grey.100' }}>
                                                    <TableCell colSpan={2} sx={{ fontWeight: 'bold', py: 0.5 }}>
                                                        {category.toUpperCase()}
                                                    </TableCell>
                                                </TableRow>
                                                {items.map(({ key, qty }) => (
                                                    <TableRow key={key}>
                                                        <TableCell sx={{ textTransform: 'capitalize' }}>
                                                            {key.replace(/_/g, ' ')}
                                                        </TableCell>
                                                        <TableCell align="center">
                                                            <input
                                                                type="number"
                                                                value={qty}
                                                                onChange={e => {
                                                                    const val = Math.max(0, parseInt(e.target.value) || 0);
                                                                    setLocalResult(prev => ({ ...prev, [key]: val }));
                                                                }}
                                                                style={{
                                                                    width: 60, textAlign: 'center', padding: '4px',
                                                                    border: '1px solid #ddd', borderRadius: 4, fontSize: 14,
                                                                }}
                                                            />
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </React.Fragment>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Box>
                    );
                })()}

                {/* STATE 2 & 3: Processing (V1) */}
                {isProcessing && renderProcessing()}

                {/* STATE 4: Failed */}
                {batch && batch.status === 'failed' && (
                    <Box textAlign="center" py={4}>
                        <ErrorOutlineIcon color="error" sx={{ fontSize: 48, mb: 2 }} />
                        <Typography variant="h6" color="error" gutterBottom>Анализ не удался</Typography>
                        <Typography color="text.secondary">{batch.error || 'Неизвестная ошибка.'}</Typography>
                        <Button variant="outlined" sx={{ mt: 3 }} onClick={resetState}>Попробовать снова</Button>
                    </Box>
                )}

                {/* STATE 5: Completed (V1) */}
                {batch && batch.status === 'completed' && renderCompleted()}
            </DialogContent>

            <DialogActions>
                <Button onClick={handleClose}>Отмена</Button>
                {/* V1 actions */}
                {batch && batch.status === 'completed' && !useV2Pipeline && !v2Completed && (
                    <Button onClick={exportAiReportPDF} color="secondary" variant="outlined" size="small" startIcon={<PictureAsPdfIcon />}>
                        PDF Report
                    </Button>
                )}
                <Button
                    onClick={handleSaveProject}
                    variant="outlined"
                    color="success"
                    disabled={!batch || batch.status !== 'completed' || savingProject}
                    style={{ display: (useV2Pipeline || v2Completed) ? 'none' : 'inline-flex' }}
                    startIcon={savingProject ? <CircularProgress size={16} /> : <SaveIcon />}
                    size="small"
                >
                    {saveSnackbar || 'Сохранить проект'}
                </Button>
                <Button
                    onClick={handleApply}
                    variant="contained"
                    disabled={!batch || batch.status !== 'completed'}
                    style={{ display: (useV2Pipeline || v2Completed) ? 'none' : 'inline-flex' }}
                    startIcon={<AutoAwesomeIcon />}
                >
                    Apply to Estimate
                </Button>

                {/* V2 actions */}
                {v2Completed && (
                    <>
                        <Button
                            onClick={(e) => setPdfMenuAnchorEl(e.currentTarget)}
                            color="secondary"
                            variant="outlined"
                            size="small"
                            startIcon={<PictureAsPdfIcon />}
                        >
                            PDF Reports ▾
                        </Button>
                        <Menu
                            anchorEl={pdfMenuAnchorEl}
                            open={Boolean(pdfMenuAnchorEl)}
                            onClose={() => setPdfMenuAnchorEl(null)}
                        >
                            <MenuItem onClick={() => {
                                setPdfMenuAnchorEl(null);
                                exportV2Pdf(localResult, 'Final (Merged)');
                            }}>
                                <PictureAsPdfIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> Final (Merged)
                            </MenuItem>
                            {v2AiResults.gemini && Object.keys(v2AiResults.gemini).length > 0 && (
                                <MenuItem onClick={() => {
                                    setPdfMenuAnchorEl(null);
                                    exportV2Pdf(v2AiResults.gemini!, 'Gemini');
                                }}>
                                    <PictureAsPdfIcon fontSize="small" sx={{ mr: 1, color: 'info.main' }} /> Gemini
                                </MenuItem>
                            )}
                            {v2AiResults.claude && Object.keys(v2AiResults.claude).length > 0 && (
                                <MenuItem onClick={() => {
                                    setPdfMenuAnchorEl(null);
                                    exportV2Pdf(v2AiResults.claude!, 'Claude');
                                }}>
                                    <PictureAsPdfIcon fontSize="small" sx={{ mr: 1, color: 'warning.main' }} /> Claude
                                </MenuItem>
                            )}
                            {v2AiResults.openai && Object.keys(v2AiResults.openai).length > 0 && (
                                <MenuItem onClick={() => {
                                    setPdfMenuAnchorEl(null);
                                    exportV2Pdf(v2AiResults.openai!, 'OpenAI');
                                }}>
                                    <PictureAsPdfIcon fontSize="small" sx={{ mr: 1, color: 'success.main' }} /> OpenAI
                                </MenuItem>
                            )}
                        </Menu>
                        <Button
                            onClick={async () => {
                                if (!userProfile?.companyId || !userProfile?.id) return;
                                setSavingProject(true);
                                try {
                                    let savedProjectId = projectId;
                                    let projTitle = v2ProjectName || `Project ${new Date().toLocaleDateString()}`;

                                    const cleanPayload = (obj: any): any => {
                                        if (Array.isArray(obj)) return obj.map(cleanPayload).filter(v => v !== undefined);
                                        if (obj !== null && typeof obj === 'object') {
                                            return Object.fromEntries(
                                                Object.entries(obj)
                                                    .filter(([_, v]) => v !== undefined)
                                                    .map(([k, v]) => [k, cleanPayload(v)])
                                            );
                                        }
                                        return obj;
                                    };

                                    if (!savedProjectId) {
                                        // 1. Create Project
                                        const projectData: any = {
                                            companyId: userProfile.companyId,
                                            createdBy: userProfile.id,
                                            clientId: '',           // TODO: Phase 2 — add client selector
                                            clientName: '',
                                            type: 'estimate' as const,
                                            name: projTitle,
                                            status: 'active',
                                            files: []
                                        };
                                        if (v2AreaSqft) projectData.areaSqft = Number(v2AreaSqft);
                                        if (v2Address) projectData.address = v2Address;

                                        savedProjectId = await projectsApi.create(cleanPayload(projectData));
                                    } else {
                                        const proj = await projectsApi.getById(savedProjectId);
                                        if (proj) projTitle = proj.name;
                                    }

                                    // 1.5. Upload Original PDFs and AI PNGs to Storage
                                    const storage = getStorage();
                                    const newFiles: ProjectFile[] = [];

                                    // Original PDFs
                                    for (let i = 0; i < selectedFiles.length; i++) {
                                        const file = selectedFiles[i];
                                        const sPath = `companies/${userProfile.companyId}/projects/${savedProjectId}/files/${Date.now()}_original_${file.name.replace(/\s+/g, '_')}`;
                                        const sRef = ref(storage, sPath);
                                        await uploadBytes(sRef, file);
                                        const dUrl = await getDownloadURL(sRef);
                                        newFiles.push({
                                            id: `file_orig_${Date.now()}_${i}`,
                                            name: file.name,
                                            path: sPath,
                                            url: dUrl,
                                            size: file.size,
                                            type: file.type || 'application/pdf',
                                            uploadedAt: Timestamp.now(),
                                            uploadedBy: userProfile.id,
                                        });
                                    }

                                    // AI PNGs from pageResults
                                    if (v2PageResults && v2PageResults.length > 0) {
                                        for (let i = 0; i < v2PageResults.length; i++) {
                                            const page = v2PageResults[i];
                                            if (page.storagePath) {
                                                try {
                                                    const sRef = ref(storage, page.storagePath);
                                                    const dUrl = await getDownloadURL(sRef);
                                                    newFiles.push({
                                                        id: `file_png_${Date.now()}_${i}`,
                                                        name: `AI_Scan_${page.fileName}_p${page.pageIndex + 1}.png`,
                                                        path: page.storagePath,
                                                        url: dUrl,
                                                        size: 0,
                                                        type: 'image/png',
                                                        uploadedAt: Timestamp.now(),
                                                        uploadedBy: userProfile.id,
                                                    });
                                                } catch (err) {
                                                    console.warn('Failed to get download URL for', page.storagePath, err);
                                                }
                                            }
                                        }
                                    }

                                    if (newFiles.length > 0) {
                                        for (const nf of newFiles) {
                                            await projectsApi.addFile(savedProjectId, nf);
                                        }
                                    }

                                    // 2. Save Estimate Version
                                    const payload: any = {
                                        companyId: userProfile.companyId,
                                        createdBy: userProfile.id,
                                        projectName: projTitle,
                                        projectId: savedProjectId,
                                        versionName: projectId ? `v${new Date().toLocaleTimeString()} (Re-run)` : 'v1.0 (Initial)',
                                        isBaseline: false,
                                        batchId: `v2_${Date.now()}`,
                                        quantities: { ...localResult },
                                        originalQuantities: { ...localResult },
                                        aiResults: v2AiResults,
                                        laborRate: 65,
                                        wirePrice: 0.45,
                                        totalMaterials: 0, totalLabor: 0, totalWire: 0, grandTotal: 0,
                                        filesCount: selectedFiles.length,
                                        electricalCount: selectedFiles.length,
                                        status: 'draft',
                                    };
                                    if (v2Address) payload.address = v2Address;
                                    if (v2AreaSqft) payload.areaSqft = v2AreaSqft;

                                    await savedEstimateApi.save(cleanPayload(payload));

                                    setSaveSnackbar('Проект успешно сохранен! Открываем проект...');
                                    setTimeout(() => {
                                        navigate(`/estimates/projects/${savedProjectId}`);
                                        onClose();
                                    }, 800);
                                } catch (err) {
                                    console.error('V2 save failed:', err);
                                    setSaveSnackbar('Ошибка сохранения');
                                }
                                setSavingProject(false);
                            }}
                            variant="outlined"
                            color="success"
                            disabled={savingProject}
                            startIcon={savingProject ? <CircularProgress size={16} /> : <SaveIcon />}
                            size="small"
                        >
                            {saveSnackbar || 'Сохранить проект'}
                        </Button>
                        <Button
                            onClick={() => { onApply(localResult, v2AreaSqft ? Number(v2AreaSqft) : undefined); handleClose(); }}
                            variant="contained"
                            startIcon={<AutoAwesomeIcon />}
                        >
                            Apply to Estimate
                        </Button>
                    </>
                )}
            </DialogActions>
        </Dialog>
    );
};
