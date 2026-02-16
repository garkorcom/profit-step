/**
 * @fileoverview About Project Page — Development Changelog
 * 
 * Shows the full development history of Profit Step organized by modules.
 * Each module has a list of commits/features with dates.
 */

import React, { useState, useMemo } from 'react';
import {
    Box,
    Container,
    Typography,
    Paper,
    Chip,
    Avatar,
    Accordion,
    AccordionSummary,
    AccordionDetails,
    alpha,
    useTheme,
    IconButton,
    Tooltip,
} from '@mui/material';
import {
    ExpandMore as ExpandMoreIcon,
    Assignment as TaskIcon,
    CalendarMonth as CalendarIcon,
    AttachMoney as FinanceIcon,
    AccountBalance as BankIcon,
    SmartToy as AIIcon,
    ShoppingCart as ShoppingIcon,
    Inventory as InventoryIcon,
    People as TeamIcon,
    Telegram as BotIcon,
    Storage as DWHIcon,
    Build as InfraIcon,
    Timeline as TimelineIcon,
    Code as CodeIcon,
    Commit as CommitIcon,
    UnfoldMore as ExpandAllIcon,
    UnfoldLess as CollapseAllIcon,
    TouchApp as TouchIcon,
    Speed as SpeedIcon,
} from '@mui/icons-material';

// ═══════════════════════════════════════
// CHANGELOG DATA
// ═══════════════════════════════════════

interface ChangelogEntry {
    date: string;
    hash: string;
    message: string;
    type: 'feat' | 'fix' | 'refactor' | 'docs' | 'style';
}

interface Module {
    id: string;
    name: string;
    icon: React.ReactNode;
    description: string;
    color: string;
    status: 'active' | 'beta' | 'stable';
    entries: ChangelogEntry[];
}

const MODULES: Module[] = [
    {
        id: 'gtd',
        name: 'GTD / Task Management',
        icon: <TaskIcon />,
        description: 'Kanban-доска, визард создания задач, Cockpit View, чек-листы, smart sorting',
        color: '#3b82f6',
        status: 'active',
        entries: [
            { date: '2026-02-16', hash: 'd753a8d', message: 'Smart Team Selector + Quick Scheduling Bar в визарде', type: 'feat' },
            { date: '2026-02-16', hash: '13cb6a4', message: '14 критических фиксов: очистка полей, DnD rollback, MUI подтверждение удаления', type: 'fix' },
            { date: '2026-02-13', hash: '60cb0f2', message: 'Touch Board wave 2 + автосохранение в cockpit', type: 'feat' },
            { date: '2026-02-12', hash: '6185a52', message: 'Компактные карточки, группировка по проектам, WIP лимиты, оценки времени', type: 'feat' },
            { date: '2026-02-11', hash: '0934e11', message: 'Фильтр-чипы, хоткеи, bounce-анимация, swipe-to-actions', type: 'feat' },
            { date: '2026-02-11', hash: 'e685508', message: 'Drag handles, scroll gradient, drop placeholder, сворачиваемые колонки', type: 'feat' },
            { date: '2026-02-11', hash: 'f743aa6', message: 'Pixel Fold оптимизация: компактный layout, CSS grid, 600px breakpoint', type: 'feat' },
            { date: '2026-02-03', hash: '7c655a4', message: 'GTD Create Wizard — 4-шаговый визард создания задач', type: 'feat' },
            { date: '2026-02-02', hash: '114aefc', message: 'Cockpit View интеграция, единый хедер задач', type: 'feat' },
            { date: '2026-02-01', hash: '1b9cbb9', message: 'INBOX v2: batch tasks, split/merge, AI-детекция списков', type: 'feat' },
            { date: '2026-01-21', hash: '34680ad', message: 'Редизайн Edit Dialog UI', type: 'feat' },
            { date: '2026-01-20', hash: '889623f', message: 'Колонка Estimate для задач, требующих просчёт', type: 'feat' },
            { date: '2026-01-17', hash: '19ec996', message: 'Premium mobile-first модалка создания задач', type: 'feat' },
            { date: '2026-01-17', hash: '9326d71', message: 'KPI статистика, переключение вида, slide-over панель', type: 'feat' },
            { date: '2026-01-16', hash: '543278e', message: 'Redesign Full Task Page в стиле Notion', type: 'feat' },
            { date: '2026-01-16', hash: '682954c', message: 'Интерактивный чек-лист в Full Task Page', type: 'feat' },
            { date: '2026-01-13', hash: '61bd7bc', message: 'Глобальные задачи с поддержкой назначения', type: 'feat' },
        ],
    },
    {
        id: 'touch-board',
        name: 'Touch Board (Masonry)',
        icon: <TouchIcon />,
        description: 'Альтернативная доска задач для планшетов и foldable-устройств',
        color: '#8b5cf6',
        status: 'beta',
        entries: [
            { date: '2026-02-13', hash: '60cb0f2', message: 'Touch Board wave 2: группировка, время, жесты', type: 'feat' },
            { date: '2026-02-11', hash: '37bc86d', message: 'Фикс drag-and-drop видимости карточек (overflow)', type: 'fix' },
        ],
    },
    {
        id: 'calendar',
        name: 'Календарь',
        icon: <CalendarIcon />,
        description: 'Notion/Google-style календарь с Day View, Drag & Drop, Quick Add',
        color: '#10b981',
        status: 'active',
        entries: [
            { date: '2026-01-20', hash: '0209a7a', message: 'Day View, Drag & Drop, Quick Add с выбором времени', type: 'feat' },
            { date: '2026-01-20', hash: '147f9e5', message: 'Редизайн в стиле Notion/Google + Advanced Filters', type: 'feat' },
            { date: '2026-01-20', hash: '5c9fc12', message: 'Beautiful design с градиентами и modern colors', type: 'style' },
            { date: '2026-01-20', hash: '0375e5a', message: '7 улучшений GTD Calendar', type: 'feat' },
            { date: '2026-01-20', hash: '705af95', message: 'Full rewrite для GTD Task Calendar', type: 'feat' },
        ],
    },
    {
        id: 'finance',
        name: 'Финансы и Платежи',
        icon: <FinanceIcon />,
        description: 'Модуль финансов: трекинг расходов, зарплаты, ставки, отчёты',
        color: '#f59e0b',
        status: 'active',
        entries: [
            { date: '2026-02-01', hash: '29924fb', message: 'Карточки Salary/Payments/Balance, диалог Add Payment', type: 'feat' },
            { date: '2026-01-30', hash: 'e7b5e3f', message: 'Фикс ставок, чеки, GTD Accept фича', type: 'feat' },
            { date: '2026-01-26', hash: '195bc42', message: 'Унифицированная система ставок (employees→users)', type: 'feat' },
            { date: '2025-12-07', hash: '4ba78b6', message: 'Модуль финансов, зарплата, управление ставками', type: 'feat' },
        ],
    },
    {
        id: 'bank',
        name: 'Bank Statements',
        icon: <BankIcon />,
        description: 'AI-парсинг банковских выписок, категоризация, Schedule C PDF',
        color: '#6366f1',
        status: 'active',
        entries: [
            { date: '2026-02-12', hash: 'eb86a43', message: 'Round 2: привязка чеков, Schedule C PDF, рекуррентная детекция, vendor search', type: 'feat' },
        ],
    },
    {
        id: 'ai',
        name: 'AI & Автоматизация',
        icon: <AIIcon />,
        description: 'Gemini AI: оценка задач, шаблоны, голосовые отчёты, Smart Input',
        color: '#ec4899',
        status: 'active',
        entries: [
            { date: '2026-01-20', hash: '385ef02', message: 'AI Template Library (Phase 2)', type: 'feat' },
            { date: '2026-01-20', hash: 'a8a7fab', message: 'AI accuracy learning (Phase 3)', type: 'feat' },
            { date: '2026-01-20', hash: '7d21834', message: 'AI estimation caching (Phase 1)', type: 'feat' },
            { date: '2026-01-17', hash: '45e5d58', message: 'AI estimation и ресурсы в Edit Dialog', type: 'feat' },
            { date: '2026-01-17', hash: '7a88417', message: 'AI Task Estimation Module', type: 'feat' },
            { date: '2026-01-15', hash: 'd15d586', message: 'Voice-to-GTD интеграция, временные атрибуты', type: 'feat' },
        ],
    },
    {
        id: 'shopping',
        name: 'Закупки',
        icon: <ShoppingIcon />,
        description: 'Модуль закупок: списки, мультивыбор, чеки, мобильный UX',
        color: '#14b8a6',
        status: 'active',
        entries: [
            { date: '2026-01-26', hash: '195bc42', message: 'Shopping mobile-first redesign', type: 'feat' },
            { date: '2026-01-22', hash: '277f185', message: 'Service Desk (Quick Repair) модуль', type: 'feat' },
        ],
    },
    {
        id: 'inventory',
        name: 'Склад',
        icon: <InventoryIcon />,
        description: 'Управление инвентарём: каталог, транзакции, локации, real-time',
        color: '#78716c',
        status: 'active',
        entries: [
            { date: '2026-02-07', hash: '8ca7d0a', message: 'Real-time подписки, фильтры транзакций, CRUD локаций, Snackbar фидбек', type: 'feat' },
        ],
    },
    {
        id: 'team',
        name: 'Команда & RBAC',
        icon: <TeamIcon />,
        description: 'Управление командой, роли, иерархия, детальная страница пользователя',
        color: '#0ea5e9',
        status: 'active',
        entries: [
            { date: '2026-02-07', hash: 'e5c3cf4', message: 'User Detail Page (/admin/team/:userId)', type: 'feat' },
            { date: '2026-01-17', hash: '6c98441', message: 'RBAC модуль: иерархия, field security, offboarding', type: 'feat' },
            { date: '2025-11-07', hash: '010fa4e', message: 'Companies (CRM) модуль — полная реализация', type: 'feat' },
            { date: '2025-11-06', hash: '23159fe', message: 'Enterprise Server-Side Pagination в TeamAdminPage', type: 'feat' },
        ],
    },
    {
        id: 'bot',
        name: 'Telegram Bot',
        icon: <BotIcon />,
        description: 'Worker Bot: тайм-трекинг, закупки, голосовые, GPS-детекция проектов',
        color: '#0088cc',
        status: 'active',
        entries: [
            { date: '2026-01-21', hash: 'a5bf1af', message: 'EXIF GPS извлечение из фото', type: 'feat' },
            { date: '2026-01-21', hash: '42be17f', message: 'Location-Based Project Detection (Photo-First Flow)', type: 'feat' },
            { date: '2026-01-15', hash: '7c268c5', message: 'Переключение на Google AI SDK для голосовой транскрипции', type: 'fix' },
            { date: '2026-01-14', hash: '5f610f2', message: 'Улучшения Time Tracking + AI Voice Transcription', type: 'feat' },
            { date: '2026-01-09', hash: '2d6e002', message: 'Rate history, GTD-Bot синхронизация', type: 'feat' },
            { date: '2025-12-07', hash: '4ba78b6', message: 'Worker bot rate snapshots, daily totals, smart reminders', type: 'feat' },
        ],
    },
    {
        id: 'dwh',
        name: 'Data Warehouse',
        icon: <DWHIcon />,
        description: 'BigQuery интеграция: ELT pipeline, аудит-события, trigger-система',
        color: '#4285f4',
        status: 'beta',
        entries: [
            { date: '2026-02-04', hash: '8d70422', message: 'Data Warehouse с BigQuery интеграцией', type: 'feat' },
        ],
    },
    {
        id: 'infra',
        name: 'Инфраструктура',
        icon: <InfraIcon />,
        description: 'PWA, anti-loop guards, CI/CD, Firebase оптимизации, performance',
        color: '#64748b',
        status: 'stable',
        entries: [
            { date: '2025-11-09', hash: '7a6dff0', message: 'Оптимизация Cloud Functions для снижения Firestore операций', type: 'feat' },
            { date: '2025-11-08', hash: '0f3a1d5', message: 'CRITICAL: остановка бесконечного цикла — удаление дублирующих v1 функций', type: 'fix' },
            { date: '2025-11-06', hash: '70c163a', message: 'Anti-Loop Guards V2 — Enterprise', type: 'feat' },
            { date: '2025-11-06', hash: '13e0fad', message: 'Idempotency Guards для всех onUpdate триггеров', type: 'fix' },
            { date: '2025-11-05', hash: '3a116db', message: 'Anti-Loop CI/CD Pipeline — автоматическое предотвращение бесконечных циклов', type: 'feat' },
        ],
    },
];

// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════

const TYPE_COLORS: Record<string, string> = {
    feat: '#22c55e',
    fix: '#ef4444',
    refactor: '#8b5cf6',
    docs: '#3b82f6',
    style: '#f59e0b',
};

const TYPE_LABELS: Record<string, string> = {
    feat: 'Фича',
    fix: 'Фикс',
    refactor: 'Рефакторинг',
    docs: 'Документация',
    style: 'Стиль',
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
    active: { label: 'Активно', color: '#22c55e' },
    beta: { label: 'Beta', color: '#f59e0b' },
    stable: { label: 'Стабильно', color: '#3b82f6' },
};

// ═══════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════

const AboutProjectPage: React.FC = () => {
    const theme = useTheme();
    const [expandedAll, setExpandedAll] = useState(false);
    const [expanded, setExpanded] = useState<string | false>(false);

    const stats = useMemo(() => {
        const totalEntries = MODULES.reduce((acc, m) => acc + m.entries.length, 0);
        const firstDate = '2025-11-05';
        const lastDate = MODULES[0].entries[0].date;
        return { modules: MODULES.length, entries: totalEntries, firstDate, lastDate };
    }, []);

    const toggleAll = () => {
        setExpandedAll(!expandedAll);
        setExpanded(false);
    };

    const handleAccordionChange = (panel: string) => (_: React.SyntheticEvent, isExpanded: boolean) => {
        setExpanded(isExpanded ? panel : false);
        if (isExpanded) setExpandedAll(false);
    };

    return (
        <Box sx={{ minHeight: '100vh', bgcolor: '#fafbfc', pb: 6 }}>
            {/* Hero Section */}
            <Box
                sx={{
                    background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.08)}, ${alpha('#8b5cf6', 0.06)})`,
                    py: { xs: 4, md: 6 },
                    px: 2,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                }}
            >
                <Container maxWidth="lg">
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                        <Avatar
                            sx={{
                                width: 56,
                                height: 56,
                                bgcolor: 'primary.main',
                                fontSize: '1.5rem',
                            }}
                        >
                            PS
                        </Avatar>
                        <Box>
                            <Typography variant="h4" fontWeight={800}>
                                Profit Step
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                Полная история разработки платформы
                            </Typography>
                        </Box>
                    </Box>

                    {/* Stats Row */}
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                        {[
                            { label: 'Модулей', value: stats.modules, icon: <CodeIcon fontSize="small" /> },
                            { label: 'Обновлений', value: stats.entries, icon: <CommitIcon fontSize="small" /> },
                            { label: 'Начало', value: 'Ноя 2025', icon: <TimelineIcon fontSize="small" /> },
                            { label: 'Последнее', value: 'Фев 2026', icon: <SpeedIcon fontSize="small" /> },
                        ].map((stat) => (
                            <Paper
                                key={stat.label}
                                elevation={0}
                                sx={{
                                    px: 2.5,
                                    py: 1.5,
                                    borderRadius: 3,
                                    border: '1px solid',
                                    borderColor: 'divider',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1.5,
                                    bgcolor: 'background.paper',
                                }}
                            >
                                <Box sx={{ color: 'primary.main' }}>{stat.icon}</Box>
                                <Box>
                                    <Typography variant="h6" fontWeight={700} lineHeight={1.2}>
                                        {stat.value}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        {stat.label}
                                    </Typography>
                                </Box>
                            </Paper>
                        ))}
                    </Box>
                </Container>
            </Box>

            {/* Main Content */}
            <Container maxWidth="lg" sx={{ mt: 4 }}>
                {/* Toolbar */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                    <Typography variant="h6" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <TimelineIcon color="primary" /> Модули и история
                    </Typography>
                    <Tooltip title={expandedAll ? 'Свернуть все' : 'Развернуть все'}>
                        <IconButton onClick={toggleAll}>
                            {expandedAll ? <CollapseAllIcon /> : <ExpandAllIcon />}
                        </IconButton>
                    </Tooltip>
                </Box>

                {/* Module Accordion List */}
                {MODULES.map((module) => {
                    const isOpen = expandedAll || expanded === module.id;
                    const statusCfg = STATUS_LABELS[module.status];

                    return (
                        <Accordion
                            key={module.id}
                            expanded={isOpen}
                            onChange={handleAccordionChange(module.id)}
                            elevation={0}
                            disableGutters
                            sx={{
                                mb: 1.5,
                                border: '1px solid',
                                borderColor: isOpen ? alpha(module.color, 0.4) : 'divider',
                                borderRadius: '12px !important',
                                overflow: 'hidden',
                                transition: 'border-color 0.2s',
                                '&::before': { display: 'none' },
                            }}
                        >
                            <AccordionSummary
                                expandIcon={<ExpandMoreIcon />}
                                sx={{
                                    px: 2.5,
                                    py: 0.5,
                                    '&.Mui-expanded': {
                                        borderBottom: '1px solid',
                                        borderColor: 'divider',
                                    },
                                }}
                            >
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%', pr: 2 }}>
                                    <Avatar
                                        sx={{
                                            bgcolor: alpha(module.color, 0.12),
                                            color: module.color,
                                            width: 40,
                                            height: 40,
                                        }}
                                    >
                                        {module.icon}
                                    </Avatar>
                                    <Box sx={{ flex: 1, minWidth: 0 }}>
                                        <Typography fontWeight={600}>
                                            {module.name}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary" noWrap>
                                            {module.description}
                                        </Typography>
                                    </Box>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
                                        <Chip
                                            label={statusCfg.label}
                                            size="small"
                                            sx={{
                                                bgcolor: alpha(statusCfg.color, 0.1),
                                                color: statusCfg.color,
                                                fontWeight: 600,
                                                fontSize: '0.7rem',
                                            }}
                                        />
                                        <Chip
                                            label={`${module.entries.length}`}
                                            size="small"
                                            variant="outlined"
                                            sx={{ fontWeight: 600, fontSize: '0.7rem', minWidth: 28 }}
                                        />
                                    </Box>
                                </Box>
                            </AccordionSummary>

                            <AccordionDetails sx={{ p: 0 }}>
                                {/* Timeline */}
                                <Box sx={{ py: 1 }}>
                                    {module.entries.map((entry, idx) => (
                                        <Box
                                            key={`${entry.hash}-${idx}`}
                                            sx={{
                                                display: 'flex',
                                                gap: 2,
                                                px: 2.5,
                                                py: 1,
                                                '&:hover': { bgcolor: alpha(module.color, 0.03) },
                                                transition: 'background 0.15s',
                                            }}
                                        >
                                            {/* Timeline dot + line */}
                                            <Box
                                                sx={{
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    alignItems: 'center',
                                                    pt: 0.5,
                                                    minWidth: 20,
                                                }}
                                            >
                                                <Box
                                                    sx={{
                                                        width: 10,
                                                        height: 10,
                                                        borderRadius: '50%',
                                                        bgcolor: TYPE_COLORS[entry.type] || module.color,
                                                        flexShrink: 0,
                                                    }}
                                                />
                                                {idx < module.entries.length - 1 && (
                                                    <Box
                                                        sx={{
                                                            width: 2,
                                                            flexGrow: 1,
                                                            bgcolor: 'divider',
                                                            mt: 0.5,
                                                        }}
                                                    />
                                                )}
                                            </Box>

                                            {/* Content */}
                                            <Box sx={{ flex: 1, pb: 1 }}>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
                                                        {entry.date}
                                                    </Typography>
                                                    <Chip
                                                        label={TYPE_LABELS[entry.type]}
                                                        size="small"
                                                        sx={{
                                                            height: 18,
                                                            fontSize: '0.6rem',
                                                            fontWeight: 600,
                                                            bgcolor: alpha(TYPE_COLORS[entry.type], 0.1),
                                                            color: TYPE_COLORS[entry.type],
                                                        }}
                                                    />
                                                    <Typography
                                                        variant="caption"
                                                        sx={{
                                                            fontFamily: 'monospace',
                                                            color: 'text.disabled',
                                                            fontSize: '0.65rem',
                                                        }}
                                                    >
                                                        {entry.hash}
                                                    </Typography>
                                                </Box>
                                                <Typography variant="body2" sx={{ lineHeight: 1.4 }}>
                                                    {entry.message}
                                                </Typography>
                                            </Box>
                                        </Box>
                                    ))}
                                </Box>
                            </AccordionDetails>
                        </Accordion>
                    );
                })}

                {/* Footer */}
                <Paper
                    elevation={0}
                    sx={{
                        mt: 4,
                        p: 3,
                        borderRadius: 3,
                        border: '1px solid',
                        borderColor: 'divider',
                        textAlign: 'center',
                    }}
                >
                    <Typography variant="body2" color="text.secondary">
                        Profit Step — платформа для управления строительными проектами
                    </Typography>
                    <Typography variant="caption" color="text.disabled">
                        Разработка ведётся с ноября 2025 г. • {stats.modules} модулей • {stats.entries} обновлений
                    </Typography>
                </Paper>
            </Container>
        </Box>
    );
};

export default AboutProjectPage;
