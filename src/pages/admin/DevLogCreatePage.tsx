import React, { useState, useEffect } from 'react';
import {
    Box,
    Container,
    Typography,
    TextField,
    Button,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    Paper,
    Alert,
    CircularProgress,
    Chip,
    Divider,
    IconButton,
    Snackbar,
    Fade,
    ToggleButton,
    ToggleButtonGroup,
} from '@mui/material';
import {
    AutoAwesome as AIIcon,
    Save as SaveIcon,
    Publish as PublishIcon,
    ArrowBack as BackIcon,
    Code as CodeIcon,
    Timer as TimerIcon,
    Notes as NotesIcon,
    Visibility as PreviewIcon,
    Search as SEOIcon,
    EmojiEmotions as FunIcon,
    BusinessCenter as SeriousIcon,
    AutoMode as AutoModeIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import {
    getFeatures,
    mockGenerateLogDraft,
    saveDevLog,
    createFeature,
    getTodayAccomplishments,
} from '../../api/devlogService';
import type {
    DevFeature,
    AIGenerationResult,
    DevLogFormData,
    DevLogType,
    TonePreference,
} from '../../types/devlog.types';
import { useAuth } from '../../auth/AuthContext';
import { Timestamp } from 'firebase/firestore';

// ============================================
// Type config
// ============================================
const TYPE_CONFIG: { key: DevLogType; label: string; emoji: string; color: string }[] = [
    { key: 'feature', label: 'Фича', emoji: '🟢', color: '#4caf50' },
    { key: 'bugfix', label: 'Баг', emoji: '🔴', color: '#f44336' },
    { key: 'refactor', label: 'Рефактор', emoji: '🔵', color: '#2196f3' },
    { key: 'infrastructure', label: 'Инфра', emoji: '🟣', color: '#9c27b0' },
];

// ============================================
// Markdown renderer (lightweight)
// ============================================
const MarkdownBlock: React.FC<{ content: string }> = ({ content }) => {
    const lines = content.split('\n');
    return (
        <Box sx={{ lineHeight: 1.8 }}>
            {lines.map((line, i) => {
                if (line.startsWith('## '))
                    return <Typography key={i} variant="h6" sx={{ mt: 2, mb: 1, fontWeight: 700 }}>{line.replace('## ', '')}</Typography>;
                if (line.startsWith('### '))
                    return <Typography key={i} variant="subtitle1" sx={{ mt: 1.5, mb: 0.5, fontWeight: 600 }}>{line.replace('### ', '')}</Typography>;
                if (line.startsWith('> '))
                    return (
                        <Box key={i} sx={{ borderLeft: 3, borderColor: 'primary.main', pl: 2, ml: 1, my: 1, fontStyle: 'italic', color: 'text.secondary' }}>
                            <Typography variant="body2">{line.replace('> ', '').replace(/_/g, '')}</Typography>
                        </Box>
                    );
                if (line.startsWith('```')) return null;
                if (line.trim() === '') return <Box key={i} sx={{ height: 8 }} />;
                const parsed = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
                return <Typography key={i} variant="body2" sx={{ mb: 0.3 }} dangerouslySetInnerHTML={{ __html: parsed }} />;
            })}
        </Box>
    );
};

// ============================================
// DevLog Create Page v2 (AI-Assisted Editor)
// ============================================
const DevLogCreatePage: React.FC = () => {
    const navigate = useNavigate();
    const { currentUser, userProfile } = useAuth();

    // Form state
    const [formData, setFormData] = useState<DevLogFormData>({
        featureId: '',
        type: 'feature',
        notes: '',
        codeDiff: '',
        images: [],
        timeSpentMinutes: 0,
        tone: 'neutral',
    });

    const [imageUrl, setImageUrl] = useState('');
    const [features, setFeatures] = useState<DevFeature[]>([]);
    const [loadingFeatures, setLoadingFeatures] = useState(true);

    // AI state
    const [isGenerating, setIsGenerating] = useState(false);
    const [isGathering, setIsGathering] = useState(false);
    const [aiResult, setAiResult] = useState<AIGenerationResult | null>(null);
    const [activeTab, setActiveTab] = useState<'story' | 'technical' | 'code' | 'seo'>('story');

    // Save state
    const [isSaving, setIsSaving] = useState(false);
    const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
        open: false, message: '', severity: 'success',
    });

    const [newFeatureTitle, setNewFeatureTitle] = useState('');

    // Load features
    useEffect(() => {
        const load = async () => {
            try {
                const loaded = await getFeatures();
                setFeatures(loaded);
            } catch (err) {
                console.error('Error loading features:', err);
            } finally {
                setLoadingFeatures(false);
            }
        };
        load();
    }, []);

    const selectedFeature = features.find(f => f.id === formData.featureId);
    const canGenerate = formData.featureId !== '' && formData.notes.trim().length >= 10 && formData.timeSpentMinutes > 0;

    // ==================== HANDLERS ====================

    const handleGenerate = async (overrideTone?: TonePreference) => {
        if (!canGenerate || !selectedFeature) return;
        const data = overrideTone ? { ...formData, tone: overrideTone } : formData;
        if (overrideTone) setFormData(prev => ({ ...prev, tone: overrideTone }));

        setIsGenerating(true);
        setAiResult(null);
        try {
            const result = await mockGenerateLogDraft(data, selectedFeature.title, selectedFeature.fullDocumentation);
            setAiResult(result);
            setFormData(prev => ({ ...prev, type: result.detectedType }));
            setActiveTab('story');
        } catch (err) {
            console.error('AI generation error:', err);
            setSnackbar({ open: true, message: 'Ошибка генерации', severity: 'error' });
        } finally {
            setIsGenerating(false);
        }
    };

    const handleSave = async (publish: boolean) => {
        if (!aiResult || !selectedFeature || !currentUser) return;
        setIsSaving(true);
        try {
            await saveDevLog(formData, aiResult, selectedFeature.title, currentUser.uid, publish);
            setSnackbar({
                open: true,
                message: publish ? '✅ Опубликовано!' : '💾 Черновик сохранён',
                severity: 'success',
            });
            setTimeout(() => navigate('/blog'), 1500);
        } catch (err) {
            console.error('Save error:', err);
            setSnackbar({ open: true, message: 'Ошибка сохранения', severity: 'error' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleGatherToday = async () => {
        if (!currentUser || !userProfile?.companyId) return;
        setIsGathering(true);
        try {
            const result = await getTodayAccomplishments(currentUser.uid, userProfile.companyId);

            // Append if there's already some text
            const newNotes = formData.notes
                ? `${formData.notes}\n\n${result.notes}`
                : result.notes;

            // Add new minutes to existing (or just replace if 0)
            const newMinutes = formData.timeSpentMinutes === 0
                ? result.totalMinutes
                : formData.timeSpentMinutes + result.totalMinutes;

            setFormData(prev => ({
                ...prev,
                notes: newNotes,
                timeSpentMinutes: newMinutes
            }));

            setSnackbar({ open: true, message: '✅ Задачи за сегодня успешно собраны!', severity: 'success' });
        } catch (e) {
            console.error('Error gathering accomplishments:', e);
            setSnackbar({ open: true, message: 'Ошибка при сборе данных за сегодня', severity: 'error' });
        } finally {
            setIsGathering(false);
        }
    };

    const handleAddImage = () => {
        if (!imageUrl.trim()) return;
        setFormData(prev => ({ ...prev, images: [...prev.images, imageUrl.trim()] }));
        setImageUrl('');
    };

    const handleQuickCreateFeature = async () => {
        if (!newFeatureTitle.trim()) return;
        try {
            const id = await createFeature({
                title: newFeatureTitle.trim(),
                slug: newFeatureTitle.trim().toLowerCase().replace(/\s+/g, '-'),
                shortDescription: '',
                fullDocumentation: '',
                status: 'in-progress',
                techStack: [],
                version: '0.1.0',
                roadmap: [],
            });
            const newF: DevFeature = {
                id,
                title: newFeatureTitle.trim(),
                slug: newFeatureTitle.trim().toLowerCase().replace(/\s+/g, '-'),
                shortDescription: '',
                fullDocumentation: '',
                status: 'in-progress',
                techStack: [],
                version: '0.1.0',
                roadmap: [],
                createdAt: Timestamp.now(),
                lastUpdated: Timestamp.now(),
            };
            setFeatures(prev => [...prev, newF].sort((a, b) => a.title.localeCompare(b.title)));
            setFormData(prev => ({ ...prev, featureId: id }));
            setNewFeatureTitle('');
        } catch (err) {
            console.error('Error creating feature:', err);
        }
    };

    // ==================== STYLES ====================
    const glassCard = {
        background: 'rgba(255,255,255,0.05)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 3,
    };

    const inputSx = {
        '& .MuiInputBase-input': { color: 'white', fontSize: 14 },
        '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.15)' },
        '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.3)' },
    };

    // ==================== RENDER ====================

    return (
        <Box sx={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)', py: 4 }}>
            <Container maxWidth="lg">
                {/* Header */}
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 4 }}>
                    <IconButton onClick={() => navigate(-1)} sx={{ color: 'white', mr: 2 }}><BackIcon /></IconButton>
                    <Box>
                        <Typography variant="h4" sx={{ color: 'white', fontWeight: 800 }}>✍️ DevLog Editor</Typography>
                        <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.6)' }}>
                            Сырые данные → ИИ → Красивый пост + SEO + Документация
                        </Typography>
                    </Box>
                </Box>

                <Box sx={{ display: 'flex', gap: 3, flexDirection: { xs: 'column', md: 'row' } }}>
                    {/* ========== LEFT: INPUT FORM ========== */}
                    <Box sx={{ flex: 1 }}>
                        <Paper sx={{ p: 3, ...glassCard }}>
                            <Typography variant="h6" sx={{ color: 'white', mb: 2, fontWeight: 600 }}>📝 Входные данные</Typography>

                            {/* Type chips */}
                            <Box sx={{ mb: 2 }}>
                                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', mb: 0.5, display: 'block' }}>
                                    Тип изменений
                                </Typography>
                                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                    {TYPE_CONFIG.map(t => (
                                        <Chip
                                            key={t.key}
                                            label={`${t.emoji} ${t.label}`}
                                            clickable
                                            onClick={() => setFormData(prev => ({ ...prev, type: t.key }))}
                                            sx={{
                                                background: formData.type === t.key ? `${t.color}33` : 'rgba(255,255,255,0.06)',
                                                border: formData.type === t.key ? `1px solid ${t.color}` : '1px solid transparent',
                                                color: formData.type === t.key ? t.color : 'rgba(255,255,255,0.5)',
                                                fontWeight: formData.type === t.key ? 600 : 400,
                                                transition: 'all 0.2s',
                                            }}
                                        />
                                    ))}
                                </Box>
                            </Box>

                            {/* Feature select */}
                            <FormControl fullWidth sx={{ mb: 2 }}>
                                <InputLabel sx={{ color: 'rgba(255,255,255,0.5)' }}>Модуль</InputLabel>
                                <Select
                                    value={formData.featureId}
                                    onChange={e => setFormData(prev => ({ ...prev, featureId: e.target.value }))}
                                    label="Модуль"
                                    sx={{
                                        color: 'white',
                                        '.MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.2)' },
                                        '.MuiSvgIcon-root': { color: 'rgba(255,255,255,0.5)' },
                                    }}
                                >
                                    {loadingFeatures ? (
                                        <MenuItem disabled>Загрузка...</MenuItem>
                                    ) : features.length === 0 ? (
                                        <MenuItem disabled>Нет модулей — создайте ↓</MenuItem>
                                    ) : (
                                        features.map(f => (
                                            <MenuItem key={f.id} value={f.id}>
                                                {f.title}
                                                <Chip label={f.status} size="small" sx={{ ml: 1, height: 18, fontSize: 10 }}
                                                    color={f.status === 'stable' ? 'success' : f.status === 'in-progress' ? 'warning' : 'default'} />
                                            </MenuItem>
                                        ))
                                    )}
                                </Select>
                            </FormControl>

                            {/* Quick create */}
                            <Box sx={{ display: 'flex', gap: 1, mb: 3 }}>
                                <TextField size="small" placeholder="Создать модуль..." value={newFeatureTitle}
                                    onChange={e => setNewFeatureTitle(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleQuickCreateFeature()}
                                    sx={{ flex: 1, '& .MuiInputBase-input': { color: 'white', fontSize: 13 }, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.15)' } }}
                                />
                                <Button size="small" variant="outlined" onClick={handleQuickCreateFeature}
                                    disabled={!newFeatureTitle.trim()}
                                    sx={{ color: 'rgba(255,255,255,0.7)', borderColor: 'rgba(255,255,255,0.2)', textTransform: 'none', fontSize: 12 }}>
                                    + New
                                </Button>
                            </Box>

                            <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', mb: 2 }} />

                            {/* Notes */}
                            <Box sx={{ mb: 2 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                        <NotesIcon sx={{ color: 'rgba(255,255,255,0.5)', mr: 1, fontSize: 18 }} />
                                        <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.6)' }}>Заметки / Поток сознания</Typography>
                                    </Box>
                                    <Button
                                        size="small"
                                        onClick={handleGatherToday}
                                        disabled={isGathering}
                                        startIcon={isGathering ? <CircularProgress size={14} /> : <AutoModeIcon fontSize="small" />}
                                        sx={{
                                            color: '#a5d6a7',
                                            textTransform: 'none',
                                            fontSize: 12,
                                            background: 'rgba(165,214,167,0.1)',
                                            '&:hover': { background: 'rgba(165,214,167,0.2)' }
                                        }}
                                    >
                                        Собрать итоги за сегодня
                                    </Button>
                                </Box>
                                <TextField multiline minRows={5} maxRows={12} fullWidth
                                    placeholder="Что делал, какие проблемы, какие решения нашел..."
                                    value={formData.notes}
                                    onChange={e => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                                    sx={{ ...inputSx, '& .MuiInputBase-input': { color: 'white', fontSize: 14, lineHeight: 1.6 } }}
                                />
                            </Box>

                            {/* Code Diff */}
                            <Box sx={{ mb: 2 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                                    <CodeIcon sx={{ color: 'rgba(255,255,255,0.5)', mr: 1, fontSize: 18 }} />
                                    <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.6)' }}>Код / Diff</Typography>
                                </Box>
                                <TextField multiline minRows={4} maxRows={10} fullWidth
                                    placeholder="Вставьте diff или snippet..."
                                    value={formData.codeDiff}
                                    onChange={e => setFormData(prev => ({ ...prev, codeDiff: e.target.value }))}
                                    sx={{
                                        '& .MuiInputBase-input': { color: '#a5d6a7', fontFamily: '"JetBrains Mono", monospace', fontSize: 13, lineHeight: 1.5 },
                                        '& .MuiOutlinedInput-root': { background: 'rgba(0,0,0,0.3)' },
                                        '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.1)' },
                                    }}
                                />
                            </Box>

                            {/* Images */}
                            <Box sx={{ mb: 2 }}>
                                <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.6)', mb: 1 }}>📸 Скриншоты (URL)</Typography>
                                <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                                    <TextField size="small" fullWidth placeholder="https://..." value={imageUrl}
                                        onChange={e => setImageUrl(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleAddImage()}
                                        sx={{ '& .MuiInputBase-input': { color: 'white', fontSize: 13 }, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.15)' } }}
                                    />
                                    <Button size="small" variant="outlined" onClick={handleAddImage}
                                        sx={{ color: 'rgba(255,255,255,0.6)', borderColor: 'rgba(255,255,255,0.2)', textTransform: 'none' }}>+</Button>
                                </Box>
                                {formData.images.length > 0 && (
                                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                        {formData.images.map((url, i) => (
                                            <Chip key={i} label={url.slice(0, 30) + '...'} size="small"
                                                onDelete={() => setFormData(prev => ({ ...prev, images: prev.images.filter((_, j) => j !== i) }))}
                                                sx={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)', fontSize: 10 }} />
                                        ))}
                                    </Box>
                                )}
                            </Box>

                            {/* Time + Tone */}
                            <Box sx={{ display: 'flex', gap: 2, mb: 3, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                <Box>
                                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                                        <TimerIcon sx={{ color: 'rgba(255,255,255,0.5)', mr: 1, fontSize: 18 }} />
                                        <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.6)' }}>Время (мин)</Typography>
                                    </Box>
                                    <TextField type="number" inputProps={{ min: 5, step: 5 }}
                                        value={formData.timeSpentMinutes || ''}
                                        onChange={e => setFormData(prev => ({ ...prev, timeSpentMinutes: parseInt(e.target.value) || 0 }))}
                                        sx={{ width: 120, '& .MuiInputBase-input': { color: 'white', fontSize: 16, fontWeight: 600 }, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.15)' } }}
                                    />
                                </Box>
                                <Box>
                                    <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.6)', mb: 1 }}>Тон</Typography>
                                    <ToggleButtonGroup
                                        value={formData.tone} exclusive
                                        onChange={(_, v) => v && setFormData(prev => ({ ...prev, tone: v }))}
                                        size="small"
                                    >
                                        <ToggleButton value="fun" sx={{ color: 'rgba(255,255,255,0.5)', borderColor: 'rgba(255,255,255,0.15)', textTransform: 'none' }}>
                                            <FunIcon sx={{ mr: 0.5, fontSize: 16 }} /> Fun
                                        </ToggleButton>
                                        <ToggleButton value="neutral" sx={{ color: 'rgba(255,255,255,0.5)', borderColor: 'rgba(255,255,255,0.15)', textTransform: 'none' }}>
                                            Neutral
                                        </ToggleButton>
                                        <ToggleButton value="serious" sx={{ color: 'rgba(255,255,255,0.5)', borderColor: 'rgba(255,255,255,0.15)', textTransform: 'none' }}>
                                            <SeriousIcon sx={{ mr: 0.5, fontSize: 16 }} /> Formal
                                        </ToggleButton>
                                    </ToggleButtonGroup>
                                </Box>
                            </Box>

                            {/* Generate */}
                            <Button variant="contained" fullWidth size="large"
                                startIcon={isGenerating ? <CircularProgress size={20} color="inherit" /> : <AIIcon />}
                                onClick={() => handleGenerate()} disabled={!canGenerate || isGenerating}
                                sx={{
                                    py: 1.5, fontSize: 16, fontWeight: 700, borderRadius: 2, textTransform: 'none',
                                    background: canGenerate ? 'linear-gradient(45deg, #667eea 0%, #764ba2 100%)' : 'rgba(255,255,255,0.1)',
                                    '&:hover': { background: 'linear-gradient(45deg, #764ba2 0%, #667eea 100%)' },
                                }}>
                                {isGenerating ? 'ИИ думает...' : '✨ Magic Generate'}
                            </Button>
                            {!canGenerate && (
                                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)', mt: 1, display: 'block', textAlign: 'center' }}>
                                    Модуль + заметки (мин 10) + время
                                </Typography>
                            )}
                        </Paper>
                    </Box>

                    {/* ========== RIGHT: PREVIEW ========== */}
                    <Box sx={{ flex: 1 }}>
                        {!aiResult && !isGenerating ? (
                            <Paper sx={{ p: 4, height: '100%', minHeight: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', ...glassCard, border: '1px dashed rgba(255,255,255,0.15)' }}>
                                <Box sx={{ textAlign: 'center' }}>
                                    <PreviewIcon sx={{ fontSize: 60, color: 'rgba(255,255,255,0.15)', mb: 2 }} />
                                    <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: 15 }}>Превью появится здесь</Typography>
                                </Box>
                            </Paper>
                        ) : isGenerating ? (
                            <Paper sx={{ p: 4, height: '100%', minHeight: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', ...glassCard, border: '1px solid rgba(102,126,234,0.3)' }}>
                                <Box sx={{ textAlign: 'center' }}>
                                    <CircularProgress sx={{ color: '#667eea', mb: 2 }} />
                                    <Typography sx={{ color: 'rgba(255,255,255,0.5)' }}>ИИ генерирует контент...</Typography>
                                </Box>
                            </Paper>
                        ) : aiResult && (
                            <Fade in>
                                <Paper sx={{ ...glassCard, border: '1px solid rgba(102,126,234,0.3)', overflow: 'hidden' }}>
                                    {/* Header with type */}
                                    <Box sx={{ p: 2, background: 'rgba(102,126,234,0.15)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                            <Typography variant="h5" sx={{ color: 'white', fontWeight: 700 }}>
                                                {aiResult.content.title}
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                                            {selectedFeature && (
                                                <Chip label={selectedFeature.title} size="small"
                                                    sx={{ background: 'rgba(102,126,234,0.3)', color: 'white', fontSize: 11 }} />
                                            )}
                                            <Chip label={TYPE_CONFIG.find(t => t.key === aiResult.detectedType)?.label}
                                                size="small"
                                                sx={{
                                                    background: `${TYPE_CONFIG.find(t => t.key === aiResult.detectedType)?.color}33`,
                                                    color: TYPE_CONFIG.find(t => t.key === aiResult.detectedType)?.color,
                                                    fontSize: 11, fontWeight: 600,
                                                }} />
                                        </Box>
                                        {/* TLDR */}
                                        <Box sx={{ mt: 1.5, p: 1.5, background: 'rgba(0,0,0,0.2)', borderRadius: 1.5 }}>
                                            <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.8)', fontStyle: 'italic' }}>
                                                {aiResult.content.tldr}
                                            </Typography>
                                        </Box>
                                    </Box>

                                    {/* Tabs */}
                                    <Box sx={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                        {([
                                            { key: 'story' as const, label: '📖 История' },
                                            { key: 'technical' as const, label: '🔧 Тех.' },
                                            { key: 'code' as const, label: '💻 Код' },
                                            { key: 'seo' as const, label: '🔍 SEO' },
                                        ]).map(tab => (
                                            <Button key={tab.key} onClick={() => setActiveTab(tab.key)}
                                                sx={{
                                                    flex: 1, py: 1, fontSize: 12, textTransform: 'none', borderRadius: 0,
                                                    color: activeTab === tab.key ? '#667eea' : 'rgba(255,255,255,0.5)',
                                                    borderBottom: activeTab === tab.key ? '2px solid #667eea' : '2px solid transparent',
                                                    fontWeight: activeTab === tab.key ? 600 : 400,
                                                }}>
                                                {tab.label}
                                            </Button>
                                        ))}
                                    </Box>

                                    {/* Tab Content */}
                                    <Box sx={{ p: 2.5, maxHeight: 350, overflowY: 'auto' }}>
                                        {activeTab === 'story' && <MarkdownBlock content={aiResult.content.storyMarkdown} />}
                                        {activeTab === 'technical' && <MarkdownBlock content={aiResult.content.technicalMarkdown} />}
                                        {activeTab === 'code' && (
                                            <Box sx={{ background: 'rgba(0,0,0,0.4)', borderRadius: 2, p: 2, fontFamily: '"JetBrains Mono", monospace', fontSize: 13, color: '#a5d6a7', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                                                {formData.codeDiff || '// Код не указан'}
                                            </Box>
                                        )}
                                        {activeTab === 'seo' && (
                                            <Box>
                                                <Typography variant="subtitle2" sx={{ color: 'rgba(255,255,255,0.7)', mb: 1 }}>
                                                    <SEOIcon sx={{ fontSize: 16, mr: 0.5, verticalAlign: 'middle' }} />
                                                    Meta Description
                                                </Typography>
                                                <Paper sx={{ p: 1.5, mb: 2, background: 'rgba(0,0,0,0.2)', borderRadius: 1 }}>
                                                    <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.6)' }}>{aiResult.seo.metaDescription}</Typography>
                                                </Paper>
                                                <Typography variant="subtitle2" sx={{ color: 'rgba(255,255,255,0.7)', mb: 1 }}>Keywords</Typography>
                                                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                                    {aiResult.seo.keywords.map((kw, i) => (
                                                        <Chip key={i} label={kw} size="small"
                                                            sx={{ background: 'rgba(102,126,234,0.15)', color: '#93a5f6', fontSize: 11 }} />
                                                    ))}
                                                </Box>
                                                <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', my: 2 }} />
                                                <Typography variant="subtitle2" sx={{ color: 'rgba(255,255,255,0.7)', mb: 1 }}>Key Takeaways</Typography>
                                                {aiResult.content.keyTakeaways.map((t, i) => (
                                                    <Typography key={i} variant="body2" sx={{ color: 'rgba(255,255,255,0.5)', mb: 0.5 }}>• {t}</Typography>
                                                ))}
                                            </Box>
                                        )}
                                    </Box>

                                    {/* Tone buttons */}
                                    <Box sx={{ px: 2, pb: 1, display: 'flex', gap: 1, borderTop: '1px solid rgba(255,255,255,0.05)', pt: 1 }}>
                                        <Button size="small" onClick={() => handleGenerate('fun')}
                                            sx={{ color: 'rgba(255,255,255,0.5)', textTransform: 'none', fontSize: 11 }}>
                                            🎉 Веселее
                                        </Button>
                                        <Button size="small" onClick={() => handleGenerate('serious')}
                                            sx={{ color: 'rgba(255,255,255,0.5)', textTransform: 'none', fontSize: 11 }}>
                                            📋 Серьёзнее
                                        </Button>
                                    </Box>

                                    {/* Actions */}
                                    <Box sx={{ p: 2, display: 'flex', gap: 2, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                                        <Button variant="outlined" startIcon={isSaving ? <CircularProgress size={16} /> : <SaveIcon />}
                                            onClick={() => handleSave(false)} disabled={isSaving}
                                            sx={{ flex: 1, color: 'rgba(255,255,255,0.7)', borderColor: 'rgba(255,255,255,0.2)', textTransform: 'none' }}>
                                            Черновик
                                        </Button>
                                        <Button variant="contained" startIcon={isSaving ? <CircularProgress size={16} color="inherit" /> : <PublishIcon />}
                                            onClick={() => handleSave(true)} disabled={isSaving}
                                            sx={{
                                                flex: 1, textTransform: 'none', fontWeight: 600,
                                                background: 'linear-gradient(45deg, #43a047, #66bb6a)',
                                                '&:hover': { background: 'linear-gradient(45deg, #388e3c, #43a047)' },
                                            }}>
                                            Опубликовать
                                        </Button>
                                    </Box>
                                </Paper>
                            </Fade>
                        )}
                    </Box>
                </Box>
            </Container>

            <Snackbar open={snackbar.open} autoHideDuration={3000}
                onClose={() => setSnackbar(p => ({ ...p, open: false }))}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
                <Alert severity={snackbar.severity} onClose={() => setSnackbar(p => ({ ...p, open: false }))} sx={{ width: '100%' }}>
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default DevLogCreatePage;
