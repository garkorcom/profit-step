import React, { useState, useEffect } from 'react';
import {
    Box,
    Container,
    Typography,
    Button,
    Paper,
    CircularProgress,
    Chip,
    Collapse,
    IconButton,
} from '@mui/material';
import {
    Add as AddIcon,
    ExpandMore as ExpandIcon,
    ExpandLess as CollapseIcon,
    AccessTime as TimeIcon,
    CalendarToday as DateIcon,
} from '@mui/icons-material';
import { Link } from 'react-router-dom';
import { getPublishedDevLogs } from '../api/devlogService';
import type { DevLog, DevLogType } from '../types/devlog.types';

// ============================================
// Type color map
// ============================================
const TYPE_STYLE: Record<DevLogType, { color: string; bg: string; label: string }> = {
    feature: { color: '#4caf50', bg: '#4caf5022', label: '🟢 Фича' },
    bugfix: { color: '#f44336', bg: '#f4433622', label: '🔴 Баг-фикс' },
    refactor: { color: '#2196f3', bg: '#2196f322', label: '🔵 Рефактор' },
    infrastructure: { color: '#9c27b0', bg: '#9c27b022', label: '🟣 Инфра' },
};

// ============================================
// Markdown renderer (shared, lightweight)
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
// Timeline Card
// ============================================
const TimelineCard: React.FC<{ log: DevLog; isLast: boolean }> = ({ log, isLast }) => {
    const [expanded, setExpanded] = useState(false);
    const [showTechnical, setShowTechnical] = useState(false);
    const typeStyle = TYPE_STYLE[log.type] || TYPE_STYLE.feature;
    const minutes = log.rawInput?.timeSpentMinutes || 0;
    const hours = (minutes / 60).toFixed(1);
    const date = log.createdAt?.toDate?.()
        ? log.createdAt.toDate().toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
        : '—';

    return (
        <Box sx={{ display: 'flex', gap: 2, position: 'relative' }}>
            {/* Timeline line + dot */}
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 32, flexShrink: 0 }}>
                {/* Dot */}
                <Box sx={{
                    width: 14, height: 14, borderRadius: '50%',
                    background: typeStyle.color,
                    boxShadow: `0 0 12px ${typeStyle.color}66`,
                    border: '2px solid rgba(255,255,255,0.2)',
                    zIndex: 1,
                    mt: 2.5,
                }} />
                {/* Line */}
                {!isLast && (
                    <Box sx={{
                        width: 2, flex: 1,
                        background: `linear-gradient(to bottom, ${typeStyle.color}44, rgba(255,255,255,0.05))`,
                    }} />
                )}
            </Box>

            {/* Card */}
            <Paper
                sx={{
                    flex: 1, mb: 3,
                    background: 'rgba(255,255,255,0.04)',
                    backdropFilter: 'blur(16px)',
                    border: `1px solid ${expanded ? typeStyle.color + '44' : 'rgba(255,255,255,0.08)'}`,
                    borderRadius: 3,
                    overflow: 'hidden',
                    transition: 'border-color 0.3s',
                    cursor: 'pointer',
                    '&:hover': {
                        border: `1px solid ${typeStyle.color}66`,
                        background: 'rgba(255,255,255,0.06)',
                    },
                }}
                onClick={() => setExpanded(!expanded)}
            >
                {/* Card header */}
                <Box sx={{ p: 2.5 }}>
                    {/* Date + Type */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Chip label={typeStyle.label} size="small"
                            sx={{ background: typeStyle.bg, color: typeStyle.color, fontSize: 11, fontWeight: 600, height: 22 }} />
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <DateIcon sx={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }} />
                            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.35)' }}>{date}</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <TimeIcon sx={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }} />
                            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.35)' }}>{hours}ч</Typography>
                        </Box>
                        <Box sx={{ flex: 1 }} />
                        <IconButton size="small" sx={{ color: 'rgba(255,255,255,0.3)' }} onClick={e => { e.stopPropagation(); setExpanded(!expanded); }}>
                            {expanded ? <CollapseIcon /> : <ExpandIcon />}
                        </IconButton>
                    </Box>

                    {/* Title */}
                    <Typography variant="h6" sx={{ color: 'white', fontWeight: 700, mb: 0.5, lineHeight: 1.3 }}>
                        {log.content?.title || 'Без заголовка'}
                    </Typography>

                    {/* TLDR */}
                    <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.55)', fontStyle: 'italic', lineHeight: 1.5 }}>
                        {log.content?.tldr || ''}
                    </Typography>

                    {/* Feature chip */}
                    {log.featureTitle && (
                        <Chip label={log.featureTitle} size="small"
                            sx={{ mt: 1.5, background: 'rgba(102,126,234,0.15)', color: '#93a5f6', fontSize: 11 }} />
                    )}
                </Box>

                {/* Expanded content */}
                <Collapse in={expanded}>
                    <Box sx={{ px: 2.5, pb: 2.5 }}>
                        {/* Story (for clients) */}
                        <Box sx={{ background: 'rgba(255,255,255,0.03)', borderRadius: 2, p: 2, mb: 2 }}>
                            <Typography variant="subtitle2" sx={{ color: 'rgba(255,255,255,0.5)', mb: 1 }}>
                                📖 Для клиентов
                            </Typography>
                            <MarkdownBlock content={log.content?.storyMarkdown || ''} />
                        </Box>

                        {/* Key Takeaways */}
                        {log.content?.keyTakeaways?.length > 0 && (
                            <Box sx={{ mb: 2 }}>
                                <Typography variant="subtitle2" sx={{ color: 'rgba(255,255,255,0.5)', mb: 0.5 }}>
                                    💡 Key Takeaways
                                </Typography>
                                {log.content.keyTakeaways.map((t, i) => (
                                    <Typography key={i} variant="body2" sx={{ color: 'rgba(255,255,255,0.6)', mb: 0.3 }}>
                                        • {t}
                                    </Typography>
                                ))}
                            </Box>
                        )}

                        {/* Technical (for devs, under fold) */}
                        <Button size="small" onClick={e => { e.stopPropagation(); setShowTechnical(!showTechnical); }}
                            sx={{ color: 'rgba(255,255,255,0.4)', textTransform: 'none', fontSize: 12, mb: 1 }}>
                            {showTechnical ? '▲ Скрыть техническое' : '▼ Для разработчиков'}
                        </Button>
                        <Collapse in={showTechnical}>
                            <Box sx={{ background: 'rgba(0,0,0,0.25)', borderRadius: 2, p: 2 }}>
                                <MarkdownBlock content={log.content?.technicalMarkdown || ''} />
                            </Box>
                        </Collapse>
                    </Box>
                </Collapse>
            </Paper>
        </Box>
    );
};

// ============================================
// Blog Page (Timeline)
// ============================================
const DevLogBlogPage: React.FC = () => {
    const [logs, setLogs] = useState<DevLog[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const load = async () => {
            try {
                const data = await getPublishedDevLogs();
                setLogs(data);
            } catch (err) {
                console.error('Error loading dev logs:', err);
            } finally {
                setLoading(false);
            }
        };
        load();

        // SEO
        document.title = 'DevLog — Profit Step | Build in Public';
        const meta = document.querySelector('meta[name="description"]');
        if (meta) meta.setAttribute('content', 'Следите за процессом разработки Profit Step. Фичи, баги, рефакторинг — всё прозрачно.');
    }, []);

    return (
        <Box sx={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f0c29 0%, #1a1a2e 50%, #16213e 100%)', py: 5 }}>
            <Container maxWidth="md">
                {/* Header */}
                <Box sx={{ textAlign: 'center', mb: 5 }}>
                    <Typography variant="h3" sx={{
                        color: 'white', fontWeight: 900, mb: 1,
                        background: 'linear-gradient(90deg, #667eea, #764ba2)',
                        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                    }}>
                        🛠 DevLog
                    </Typography>
                    <Typography variant="h6" sx={{ color: 'rgba(255,255,255,0.5)', fontWeight: 400, mb: 3 }}>
                        Build in Public — прозрачный процесс разработки
                    </Typography>
                    {/* Stats summary */}
                    <Box sx={{ display: 'flex', justifyContent: 'center', gap: 3, mb: 3 }}>
                        <Box sx={{ textAlign: 'center' }}>
                            <Typography variant="h4" sx={{ color: '#667eea', fontWeight: 800 }}>{logs.length}</Typography>
                            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)' }}>постов</Typography>
                        </Box>
                        <Box sx={{ textAlign: 'center' }}>
                            <Typography variant="h4" sx={{ color: '#4caf50', fontWeight: 800 }}>
                                {logs.filter(l => l.type === 'feature').length}
                            </Typography>
                            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)' }}>фич</Typography>
                        </Box>
                        <Box sx={{ textAlign: 'center' }}>
                            <Typography variant="h4" sx={{ color: '#f44336', fontWeight: 800 }}>
                                {logs.filter(l => l.type === 'bugfix').length}
                            </Typography>
                            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)' }}>фиксов</Typography>
                        </Box>
                        <Box sx={{ textAlign: 'center' }}>
                            <Typography variant="h4" sx={{ color: '#9c27b0', fontWeight: 800 }}>
                                {Math.round(logs.reduce((sum, l) => sum + (l.rawInput?.timeSpentMinutes || 0), 0) / 60)}ч
                            </Typography>
                            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)' }}>разработки</Typography>
                        </Box>
                    </Box>
                    <Button variant="outlined" startIcon={<AddIcon />} component={Link} to="/admin/devlog/new"
                        sx={{
                            color: 'rgba(255,255,255,0.7)', borderColor: 'rgba(255,255,255,0.2)', textTransform: 'none',
                            '&:hover': { borderColor: '#667eea', color: '#667eea' },
                        }}>
                        Новый пост
                    </Button>
                </Box>

                {/* Timeline */}
                {loading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                        <CircularProgress sx={{ color: '#667eea' }} />
                    </Box>
                ) : logs.length === 0 ? (
                    <Paper sx={{
                        p: 5, textAlign: 'center',
                        background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.15)', borderRadius: 3,
                    }}>
                        <Typography variant="h5" sx={{ color: 'rgba(255,255,255,0.3)', mb: 1 }}>📭</Typography>
                        <Typography sx={{ color: 'rgba(255,255,255,0.3)' }}>Пока нет опубликованных постов</Typography>
                    </Paper>
                ) : (
                    <Box>
                        {logs.map((log, i) => (
                            <TimelineCard key={log.id} log={log} isLast={i === logs.length - 1} />
                        ))}
                    </Box>
                )}
            </Container>
        </Box>
    );
};

export default DevLogBlogPage;
