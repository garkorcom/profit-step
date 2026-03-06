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
    ArrowDownward as ExpandIcon,
    ArrowUpward as CollapseIcon,
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
// Wiki Cross-Linking Engine
// ============================================
const WikiText: React.FC<{ text: string; glossary: { title: string; log: DevLog }[] }> = ({ text, glossary }) => {
    if (!glossary || glossary.length === 0) return <span dangerouslySetInnerHTML={{ __html: text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />;

    // Create a regex to match any glossary title (case-insensitive), sorted by length descending so longer terms match first
    const terms = glossary.map(g => g.title).sort((a, b) => b.length - a.length);
    const escapedTerms = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const regex = new RegExp('(' + escapedTerms + ')', 'gi');

    const parts = text.split(regex);

    return (
        <>
            {parts.map((part, i) => {
                const match = glossary.find(g => g.title.toLowerCase() === part.toLowerCase());
                if (match) {
                    return (
                        <Box
                            component="span"
                            key={i}
                            sx={{
                                borderBottom: '1px dashed #667eea',
                                cursor: 'help',
                                color: '#93a5f6',
                                fontWeight: 600,
                                position: 'relative',
                                '&:hover .wiki-tooltip': {
                                    opacity: 1,
                                    visibility: 'visible',
                                    transform: 'translateY(0)',
                                }
                            }}
                        >
                            {part}
                            <Box
                                className="wiki-tooltip"
                                sx={{
                                    position: 'absolute',
                                    bottom: '100%',
                                    left: '50%',
                                    transform: 'translate(-50%, 10px)',
                                    opacity: 0,
                                    visibility: 'hidden',
                                    transition: 'all 0.2s',
                                    width: 250,
                                    p: 1.5,
                                    mb: 1,
                                    bgcolor: '#111',
                                    border: '1px solid #333',
                                    color: '#fff',
                                    fontSize: '0.75rem',
                                    fontWeight: 400,
                                    lineHeight: 1.5,
                                    zIndex: 100,
                                    boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
                                    pointerEvents: 'none'
                                }}
                            >
                                <Typography variant="caption" sx={{ color: TYPE_STYLE[match.log.type]?.color, fontWeight: 'bold', display: 'block', mb: 0.5 }}>
                                    {match.log.content.emoji} {match.title}
                                </Typography>
                                {match.log.content.tldr}
                            </Box>
                        </Box>
                    );
                }
                const parsedSpan = part.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
                return <span key={i} dangerouslySetInnerHTML={{ __html: parsedSpan }} />;
            })}
        </>
    );
};

// ============================================
// Markdown renderer (Wiki-Enabled)
// ============================================
const MarkdownBlock: React.FC<{ content: string; glossary?: { title: string; log: DevLog }[] }> = ({ content, glossary = [] }) => {
    const lines = content.split('\n');
    let isCodeBlock = false;
    let codeContent: string[] = [];

    return (
        <Box sx={{ lineHeight: 1.7, fontSize: '0.95rem' }}>
            {lines.map((line, i) => {
                if (line.startsWith('```')) {
                    if (isCodeBlock) {
                        isCodeBlock = false;
                        const block = codeContent.join('\n');
                        codeContent = [];
                        return (
                            <Box key={i} sx={{ bgcolor: '#000', border: '1px solid #333', p: 2, my: 2, overflowX: 'auto', fontFamily: 'monospace', fontSize: '0.8rem', color: '#a5b4fc' }}>
                                <pre style={{ margin: 0 }}>{block}</pre>
                            </Box>
                        );
                    } else {
                        isCodeBlock = true;
                        return null;
                    }
                }

                if (isCodeBlock) {
                    codeContent.push(line);
                    return null;
                }

                if (line.startsWith('## '))
                    return <Typography key={i} variant="h6" sx={{ mt: 3, mb: 1, fontWeight: 700, fontFamily: 'monospace', textTransform: 'uppercase', color: '#fff' }}>{line.replace('## ', '')}</Typography>;
                if (line.startsWith('### '))
                    return <Typography key={i} variant="subtitle1" sx={{ mt: 2, mb: 0.5, fontWeight: 700, color: '#ccc' }}>{line.replace('### ', '')}</Typography>;
                if (line.startsWith('> '))
                    return (
                        <Box key={i} sx={{ borderLeft: '4px solid #444', pl: 2, my: 2, bgcolor: '#111', py: 1, color: '#aaa' }}>
                            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{line.replace('> ', '').replace(/_/g, '')}</Typography>
                        </Box>
                    );
                if (line.trim() === '') return <Box key={i} sx={{ height: 12 }} />;

                // Images
                if (line.startsWith('![')) {
                    const match = line.match(/!\\[(.*?)\\]\\((.*?)\\)/);
                    if (match) {
                        return (
                            <Box key={i} sx={{ my: 3, border: '1px solid #333', p: 1, bgcolor: '#050505' }}>
                                <img src={match[2]} alt={match[1]} style={{ width: '100%', height: 'auto', display: 'block' }} />
                                {match[1] && <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', mt: 1, color: '#666', fontFamily: 'monospace' }}>{match[1]}</Typography>}
                            </Box>
                        );
                    }
                }

                return (
                    <Typography key={i} variant="body2" sx={{ mb: 1, color: '#bbb' }}>
                        <WikiText text={line} glossary={glossary} />
                    </Typography>
                );
            })}
        </Box>
    );
};

// ============================================
// Timeline Card (Brutalist)
// ============================================
const TimelineCard: React.FC<{ log: DevLog; isLast: boolean; glossary: any[] }> = ({ log, isLast, glossary }) => {
    const [expanded, setExpanded] = useState(false);
    const [showTechnical, setShowTechnical] = useState(false);
    const typeStyle = TYPE_STYLE[log.type] || TYPE_STYLE.feature;
    const minutes = log.rawInput?.timeSpentMinutes || 0;
    const hours = (minutes / 60).toFixed(1);
    const date = log.createdAt?.toDate?.()
        ? log.createdAt.toDate().toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
        : '—';

    return (
        <Box sx={{ display: 'flex', gap: 3, position: 'relative' }}>
            {/* Timeline line + dot (Square) */}
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 20, flexShrink: 0 }}>
                <Box sx={{
                    width: 12, height: 12, borderRadius: 0,
                    background: typeStyle.color,
                    mt: 3.5,
                }} />
                {!isLast && (
                    <Box sx={{
                        width: 2, flex: 1,
                        background: '#333',
                        mt: 1
                    }} />
                )}
            </Box>

            {/* Card (Brutalist) */}
            <Paper
                elevation={0}
                sx={{
                    flex: 1, mb: 4,
                    background: '#0a0a0a',
                    border: '1px solid #333',
                    borderRadius: 0,
                    transition: 'border-color 0.2s, transform 0.2s',
                    cursor: 'pointer',
                    '&:hover': {
                        border: '1px solid ' + typeStyle.color,
                        transform: 'translate(-2px, -2px)',
                        boxShadow: '4px 4px 0px ' + typeStyle.color + '44'
                    },
                }}
                onClick={() => setExpanded(!expanded)}
            >
                {/* Card header */}
                <Box sx={{ p: 3 }}>
                    {/* Meta Row */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
                        <Chip label={typeStyle.label} size="small"
                            sx={{ background: typeStyle.bg, color: typeStyle.color, fontSize: 11, fontWeight: 700, borderRadius: 0, border: '1px solid ' + typeStyle.color + '66' }} />
                        <Typography variant="caption" sx={{ color: '#888', fontFamily: 'monospace' }}>
                            {date} {'//'} {hours}h
                        </Typography>
                        <Box sx={{ flex: 1 }} />
                        <IconButton size="small" sx={{ color: '#888', border: '1px solid #333', borderRadius: 0 }} onClick={e => { e.stopPropagation(); setExpanded(!expanded); }}>
                            {expanded ? <CollapseIcon fontSize="small" /> : <ExpandIcon fontSize="small" />}
                        </IconButton>
                    </Box>

                    {/* Title */}
                    <Typography variant="h5" sx={{ color: 'white', fontWeight: 800, mb: 1, lineHeight: 1.2, fontFamily: 'system-ui' }}>
                        {log.content?.title || 'Untitled'}
                    </Typography>

                    {/* TLDR */}
                    <Typography variant="body1" sx={{ color: '#aaa', lineHeight: 1.6 }}>
                        <WikiText text={log.content?.tldr || ''} glossary={glossary} />
                    </Typography>

                    {/* Feature Label */}
                    {log.featureTitle && (
                        <Box sx={{ display: 'inline-block', mt: 2, px: 1, py: 0.5, bgcolor: '#111', border: '1px solid #333', color: '#667eea', fontSize: 11, fontFamily: 'monospace' }}>
                            MODULE: {log.featureTitle.toUpperCase()}
                        </Box>
                    )}
                </Box>

                {/* Expanded content */}
                <Collapse in={expanded}>
                    <Box sx={{ px: 3, pb: 3, borderTop: '1px solid #222', pt: 2 }}>
                        {/* Story Content */}
                        <Box sx={{ mb: 3 }}>
                            <MarkdownBlock content={log.content?.storyMarkdown || ''} glossary={glossary} />
                        </Box>

                        {/* Key Takeaways */}
                        {log.content?.keyTakeaways?.length > 0 && (
                            <Box sx={{ mb: 3, bgcolor: '#111', p: 2, border: '1px solid #333' }}>
                                <Typography variant="subtitle2" sx={{ color: '#fff', mb: 1, fontFamily: 'monospace', textTransform: 'uppercase' }}>
                                    {'// Key Takeaways'}
                                </Typography>
                                <Box component="ul" sx={{ color: '#aaa', m: 0, pl: 2, fontSize: '0.9rem', lineHeight: 1.6 }}>
                                    {log.content.keyTakeaways.map((t, i) => (
                                        <li key={i} style={{ marginBottom: '8px' }}>
                                            <WikiText text={t} glossary={glossary} />
                                        </li>
                                    ))}
                                </Box>
                            </Box>
                        )}

                        {/* Technical */}
                        <Button size="small" onClick={e => { e.stopPropagation(); setShowTechnical(!showTechnical); }}
                            sx={{ color: '#888', textTransform: 'none', fontSize: 13, mb: 1, borderRadius: 0, border: '1px solid transparent', '&:hover': { border: '1px solid #333' } }}>
                            {showTechnical ? '[ - ] Hide Backend Details' : '[ + ] View Technical Breakdown'}
                        </Button>
                        <Collapse in={showTechnical}>
                            <Box sx={{ bgcolor: '#050505', border: '1px solid #222', p: 2 }}>
                                <MarkdownBlock content={log.content?.technicalMarkdown || ''} glossary={glossary} />
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

    // Build Glossary for Cross-Linking
    const glossary = React.useMemo(() => {
        const terms: { title: string; log: DevLog }[] = [];
        logs.forEach(log => {
            if (log.featureTitle) {
                // Ignore duplicates
                if (!terms.find(t => t.title.toLowerCase() === log.featureTitle!.toLowerCase())) {
                    terms.push({ title: log.featureTitle, log });
                }
            }
        });
        return terms;
    }, [logs]);

    return (
        <Box sx={{ minHeight: '100vh', bgcolor: '#050505', py: 6, fontFamily: 'system-ui' }}>
            <Container maxWidth="md">
                {/* Header (Brutalist) */}
                <Box sx={{ borderBottom: '2px solid #333', pb: 4, mb: 6, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'flex-end', mb: 2 }}>
                        <Typography variant="h3" sx={{ color: 'white', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.03em' }}>
                            DevLog.
                        </Typography>
                        <Button variant="outlined" startIcon={<AddIcon />} component={Link} to="/admin/devlog/new"
                            sx={{
                                color: '#fff', borderColor: '#333', borderRadius: 0, textTransform: 'uppercase', fontFamily: 'monospace',
                                '&:hover': { background: '#fff', color: '#000', borderColor: '#fff' },
                            }}>
                            New Entry
                        </Button>
                    </Box>
                    <Typography variant="body1" sx={{ color: '#888', mb: 4, fontFamily: 'monospace' }}>
                        {'// Profit Step: System Changelog & Technical Glossary'}
                    </Typography>

                    {/* Stats summary (Square grid) */}
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0, width: '100%', borderTop: '1px solid #333', borderLeft: '1px solid #333' }}>
                        <Box sx={{ p: 2, borderRight: '1px solid #333', borderBottom: '1px solid #333' }}>
                            <Typography variant="h4" sx={{ color: '#fff', fontWeight: 800 }}>{logs.length}</Typography>
                            <Typography variant="caption" sx={{ color: '#666', fontFamily: 'monospace' }}>ENTRIES</Typography>
                        </Box>
                        <Box sx={{ p: 2, borderRight: '1px solid #333', borderBottom: '1px solid #333' }}>
                            <Typography variant="h4" sx={{ color: '#4caf50', fontWeight: 800 }}>{logs.filter(l => l.type === 'feature').length}</Typography>
                            <Typography variant="caption" sx={{ color: '#666', fontFamily: 'monospace' }}>FEATURES</Typography>
                        </Box>
                        <Box sx={{ p: 2, borderRight: '1px solid #333', borderBottom: '1px solid #333' }}>
                            <Typography variant="h4" sx={{ color: '#f44336', fontWeight: 800 }}>{logs.filter(l => l.type === 'bugfix').length}</Typography>
                            <Typography variant="caption" sx={{ color: '#666', fontFamily: 'monospace' }}>FIXES</Typography>
                        </Box>
                        <Box sx={{ p: 2, borderRight: '1px solid #333', borderBottom: '1px solid #333', bgcolor: '#111' }}>
                            <Typography variant="h4" sx={{ color: '#93a5f6', fontWeight: 800 }}>{glossary.length}</Typography>
                            <Typography variant="caption" sx={{ color: '#666', fontFamily: 'monospace' }}>WIKI NODES</Typography>
                        </Box>
                    </Box>
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
                            <TimelineCard key={log.id} log={log} isLast={i === logs.length - 1} glossary={glossary} />
                        ))}
                    </Box>
                )}
            </Container>
        </Box>
    );
};

export default DevLogBlogPage;
