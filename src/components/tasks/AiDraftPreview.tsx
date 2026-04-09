/**
 * @fileoverview AiDraftPreview — Full MUI preview card for AI-generated task draft
 *
 * Rendered when ai.status === 'preview'. Shows:
 * - Scope Badge with action buttons
 * - Confidence rings grid
 * - Editable field rows (inline editing)
 * - Checklist preview
 * - Duplicate warning with Merge/Link/Ignore
 * - Collapsible AI Reasoning
 * - Cancel / Create Task footer
 */

import React, { useState } from 'react';
import {
    Box,
    Typography,
    Paper,
    Button,
    Chip,
    IconButton,
    Collapse,
    TextField,
    CircularProgress,
    alpha,
    useTheme,
    Select,
    MenuItem,
    FormControl,
    Checkbox,
    ListItemText,
} from '@mui/material';
import {
    Check as CheckIcon,
    Edit as EditIcon,
    Close as CloseIcon,
    ExpandMore as ExpandMoreIcon,
    ExpandLess as ExpandLessIcon,
    MergeType as MergeIcon,
    Link as LinkIcon,
    NotInterested as IgnoreIcon,
    Warning as WarningIcon,
} from '@mui/icons-material';
import type { AiTaskDraft, AiAnalysis } from '../../hooks/useAiTask';

// ============================================================
// SUB-COMPONENTS
// ============================================================

// --- Scope Badge ---

const SCOPE_CONFIG: Record<string, { color: string; icon: string; label: string; labelRu: string }> = {
    in_estimate_pending: { color: '#22c55e', icon: '✅', label: 'In Estimate', labelRu: 'В смете — ожидает выполнения' },
    in_estimate_completed: { color: '#f59e0b', icon: '⚠️', label: 'Warranty?', labelRu: 'Уже выполнено (гарантия?)' },
    in_change_order: { color: '#3b82f6', icon: '📋', label: 'Change Order', labelRu: 'В дополнительном заказе' },
    not_in_estimate: { color: '#ef4444', icon: '🔴', label: 'Extra Work', labelRu: 'Нет в смете — доп. работа!' },
    uncertain: { color: '#9ca3af', icon: '❓', label: 'Uncertain', labelRu: 'Статус не определён' },
};

function ScopeBadge({
    analysis,
    onScopeDecision,
}: {
    analysis: AiAnalysis;
    onScopeDecision: (decision: string) => void;
}) {
    const config = SCOPE_CONFIG[analysis.scopeStatus] || SCOPE_CONFIG.uncertain;

    return (
        <Paper
            sx={{
                p: 2,
                borderRadius: 3,
                border: 2,
                borderColor: config.color,
                bgcolor: alpha(config.color, 0.08),
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Typography fontSize="1.2rem">{config.icon}</Typography>
                <Typography fontWeight="bold" fontSize="0.9rem">
                    {config.labelRu}
                </Typography>
            </Box>

            {analysis.matchedEstimateItem && (
                <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                    Позиция сметы: {analysis.matchedEstimateItem}
                </Typography>
            )}

            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {analysis.scopeExplanation}
            </Typography>

            {/* Scope action buttons */}
            {analysis.scopeStatus === 'in_estimate_completed' && (
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button
                        size="small"
                        variant="contained"
                        onClick={() => onScopeDecision('warranty')}
                        sx={{
                            flex: 1, borderRadius: 2, textTransform: 'none', fontWeight: 600,
                            bgcolor: '#f59e0b', '&:hover': { bgcolor: '#d97706' },
                        }}
                    >
                        Гарантия
                    </Button>
                    <Button
                        size="small"
                        variant="outlined"
                        onClick={() => onScopeDecision('change_order')}
                        sx={{
                            flex: 1, borderRadius: 2, textTransform: 'none', fontWeight: 600,
                            borderColor: '#f59e0b', color: '#92400e',
                        }}
                    >
                        Создать CO
                    </Button>
                </Box>
            )}

            {analysis.scopeStatus === 'not_in_estimate' && (
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button
                        size="small"
                        variant="contained"
                        onClick={() => onScopeDecision('change_order')}
                        sx={{
                            flex: 1, borderRadius: 2, textTransform: 'none', fontWeight: 600,
                            bgcolor: '#ef4444', '&:hover': { bgcolor: '#dc2626' },
                        }}
                    >
                        Создать Change Order
                    </Button>
                    <Button
                        size="small"
                        variant="outlined"
                        onClick={() => onScopeDecision('included')}
                        sx={{
                            flex: 1, borderRadius: 2, textTransform: 'none', fontWeight: 600,
                            borderColor: '#ef4444', color: '#991b1b',
                        }}
                    >
                        Включить
                    </Button>
                </Box>
            )}
        </Paper>
    );
}

// --- Confidence Ring ---

function ConfidenceRing({ value, label }: { value: number; label: string }) {
    const color = value > 0.8 ? '#22c55e' : value > 0.5 ? '#f59e0b' : '#ef4444';

    return (
        <Paper
            variant="outlined"
            sx={{
                px: 1.5,
                py: 1,
                textAlign: 'center',
                borderRadius: 2,
                borderColor: alpha(color, 0.5),
                bgcolor: alpha(color, 0.05),
            }}
        >
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.65rem' }}>
                {label}
            </Typography>
            <Typography fontWeight="bold" fontSize="0.85rem" sx={{ color }}>
                {Math.round(value * 100)}%
            </Typography>
        </Paper>
    );
}

// --- Editable Field Row ---

function EditableField({
    label,
    value,
    confidence,
    onSave,
    editable = true,
}: {
    label: string;
    value: string;
    confidence?: number;
    onSave?: (newValue: string) => void;
    editable?: boolean;
}) {
    const [editing, setEditing] = useState(false);
    const [editValue, setEditValue] = useState(value);

    const borderColor =
        confidence === undefined ? 'divider' :
            confidence < 0.5 ? '#ef4444' :
                confidence < 0.8 ? '#f59e0b' :
                    'divider';

    const bgColor =
        confidence === undefined ? undefined :
            confidence < 0.5 ? alpha('#ef4444', 0.04) :
                confidence < 0.8 ? alpha('#f59e0b', 0.04) :
                    undefined;

    const handleSave = () => {
        if (onSave && editValue !== value) {
            onSave(editValue);
        }
        setEditing(false);
    };

    if (editing) {
        return (
            <Paper
                variant="outlined"
                sx={{ px: 2, py: 1.5, borderRadius: 3, borderColor }}
            >
                <Typography variant="caption" color="text.secondary">{label}</Typography>
                <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
                    <TextField
                        size="small"
                        fullWidth
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSave();
                            if (e.key === 'Escape') setEditing(false);
                        }}
                        sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
                    />
                    <IconButton size="small" onClick={handleSave} color="success">
                        <CheckIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" onClick={() => setEditing(false)}>
                        <CloseIcon fontSize="small" />
                    </IconButton>
                </Box>
            </Paper>
        );
    }

    return (
        <Paper
            variant="outlined"
            onClick={() => editable && onSave && setEditing(true)}
            sx={{
                px: 2,
                py: 1.5,
                borderRadius: 3,
                borderColor,
                bgcolor: bgColor,
                cursor: editable && onSave ? 'pointer' : 'default',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                transition: 'all 0.15s ease',
                '&:hover': editable && onSave ? {
                    bgcolor: alpha('#000', 0.02),
                    borderColor: 'primary.main',
                } : {},
            }}
        >
            <Box>
                <Typography variant="caption" color="text.secondary">{label}</Typography>
                <Typography fontWeight={500} fontSize="0.9rem" sx={{ lineHeight: 1.3 }}>
                    {value || '—'}
                </Typography>
            </Box>
            {editable && onSave && (
                <EditIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
            )}
        </Paper>
    );
}

// --- Editable Select Field ---

function EditableSelectField({
    label,
    value,
    options,
    confidence,
    onSave,
    error,
}: {
    label: string;
    value: string;
    options: { id: string; name: string }[];
    confidence?: number;
    onSave: (id: string) => void;
    error?: boolean;
}) {
    const borderColor = error ? '#ef4444' :
        confidence === undefined ? 'divider' :
            confidence < 0.5 ? '#ef4444' :
                confidence < 0.8 ? '#f59e0b' : 'divider';

    const bgColor = error ? alpha('#ef4444', 0.05) :
        confidence === undefined ? undefined :
            confidence < 0.5 ? alpha('#ef4444', 0.04) :
                confidence < 0.8 ? alpha('#f59e0b', 0.04) : undefined;

    return (
        <Paper
            variant="outlined"
            sx={{
                px: 2,
                py: 1,
                borderRadius: 3,
                borderColor,
                bgcolor: bgColor,
            }}
        >
            <Typography variant="caption" color={error ? "error" : "text.secondary"}>{label}</Typography>
            <FormControl fullWidth size="small" variant="standard" error={error}>
                <Select
                    value={value || ''}
                    onChange={(e) => onSave(e.target.value as string)}
                    displayEmpty
                    disableUnderline
                    sx={{ fontSize: '0.9rem', fontWeight: 500 }}
                >
                    <MenuItem value="" disabled>
                        <em>Не выбран</em>
                    </MenuItem>
                    {options.map((opt) => (
                        <MenuItem key={opt.id} value={opt.id}>
                            {opt.name}
                        </MenuItem>
                    ))}
                </Select>
            </FormControl>
        </Paper>
    );
}

// --- Editable Multi-Select Field ---

function EditableMultiSelectField({
    label,
    values,
    options,
    confidence,
    onSave,
}: {
    label: string;
    values: string[];
    options: { id: string; name: string }[];
    confidence?: number;
    onSave: (ids: string[]) => void;
}) {
    const borderColor =
        confidence === undefined ? 'divider' :
            confidence < 0.5 ? '#ef4444' :
                confidence < 0.8 ? '#f59e0b' : 'divider';

    const bgColor =
        confidence === undefined ? undefined :
            confidence < 0.5 ? alpha('#ef4444', 0.04) :
                confidence < 0.8 ? alpha('#f59e0b', 0.04) : undefined;

    return (
        <Paper
            variant="outlined"
            sx={{
                px: 2,
                py: 1,
                borderRadius: 3,
                borderColor,
                bgcolor: bgColor,
            }}
        >
            <Typography variant="caption" color="text.secondary">{label}</Typography>
            <FormControl fullWidth size="small" variant="standard">
                <Select
                    multiple
                    value={values}
                    onChange={(e) => onSave(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value as string[])}
                    displayEmpty
                    disableUnderline
                    renderValue={(selected) => {
                        if (selected.length === 0) {
                            return <em>Не назначен</em>;
                        }
                        return selected
                            .map(id => options.find(o => o.id === id)?.name || id)
                            .join(', ');
                    }}
                    sx={{ fontSize: '0.9rem', fontWeight: 500 }}
                >
                    <MenuItem value="" disabled>
                        <em>Не назначен</em>
                    </MenuItem>
                    {options.map((opt) => (
                        <MenuItem key={opt.id} value={opt.id}>
                            <Checkbox checked={values.indexOf(opt.id) > -1} size="small" />
                            <ListItemText primary={opt.name} />
                        </MenuItem>
                    ))}
                </Select>
            </FormControl>
        </Paper>
    );
}

// ============================================================
// MAIN COMPONENT
// ============================================================

interface AiDraftPreviewProps {
    draft: AiTaskDraft;
    analysis: AiAnalysis;
    latencyMs: number;
    employees: Array<{ id: string; name: string }>;
    projects: Array<{ id: string; name: string }>;
    onEditField: (field: keyof AiTaskDraft, value: AiTaskDraft[keyof AiTaskDraft]) => void;
    onConfirm: (scopeDecision?: string) => void;
    onCancel: () => void;
    isConfirming: boolean;
}

export default function AiDraftPreview({
    draft,
    analysis,
    latencyMs,
    employees,
    projects,
    onEditField,
    onConfirm,
    onCancel,
    isConfirming,
}: AiDraftPreviewProps) {
    const theme = useTheme();
    const [scopeDecision, setScopeDecision] = useState<string | undefined>();
    const [showReasoning, setShowReasoning] = useState(false);

    const formatDate = (iso: string) => {
        try {
            return new Date(iso).toLocaleDateString('ru-RU', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                hour: 'numeric',
                minute: '2-digit',
            });
        } catch {
            return iso;
        }
    };

    const PRIORITY_CHIPS: Record<string, { color: string; label: string }> = {
        low: { color: '#9ca3af', label: 'Низкий' },
        medium: { color: '#3b82f6', label: 'Средний' },
        high: { color: '#f59e0b', label: 'Высокий' },
        urgent: { color: '#ef4444', label: 'Срочно' },
    };

    const priorityConfig = PRIORITY_CHIPS[draft.priority] || PRIORITY_CHIPS.medium;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* ── Header ── */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography fontSize="1.2rem">✨</Typography>
                    <Typography fontWeight="bold" fontSize="1rem">
                        AI Черновик
                    </Typography>
                    <Chip
                        label={priorityConfig.label}
                        size="small"
                        sx={{
                            bgcolor: alpha(priorityConfig.color, 0.12),
                            color: priorityConfig.color,
                            fontWeight: 600,
                            fontSize: '0.7rem',
                            height: 22,
                        }}
                    />
                </Box>
                <Typography variant="caption" color="text.disabled">
                    {(latencyMs / 1000).toFixed(1)}s
                </Typography>
            </Box>

            {/* ── Confidence Rings ── */}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1 }}>
                <ConfidenceRing value={analysis.confidence.assignee} label="Исполнитель" />
                <ConfidenceRing value={analysis.confidence.project} label="Проект" />
                <ConfidenceRing value={analysis.confidence.dueDate} label="Дедлайн" />
                <ConfidenceRing value={analysis.confidence.scope} label="Скоуп" />
            </Box>

            {/* ── Editable Fields ── */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <EditableField
                    label="Задача"
                    value={draft.title}
                    onSave={(v) => onEditField('title', v)}
                />
                <EditableMultiSelectField
                    label="Исполнители"
                    values={draft.assigneeIds || []}
                    options={employees}
                    confidence={analysis.confidence.assignee}
                    onSave={(ids) => onEditField('assigneeIds', ids)}
                />
                <EditableSelectField
                    label="Проект"
                    value={draft.projectId || ''}
                    options={projects}
                    confidence={analysis.confidence.project}
                    onSave={(id) => onEditField('projectId', id)}
                    error={!draft.projectId}
                />
                <EditableField
                    label="Дедлайн"
                    value={draft.dueDate ? formatDate(draft.dueDate) : 'Не указан'}
                    confidence={analysis.confidence.dueDate}
                    editable={false} // TODO: open DatePicker
                />
                {draft.estimatedMinutes && (
                    <EditableField
                        label="Оценка времени"
                        value={`~${draft.estimatedMinutes} мин`}
                        onSave={(v) => {
                            const parsed = parseInt(v, 10);
                            if (!isNaN(parsed)) onEditField('estimatedMinutes', parsed);
                        }}
                    />
                )}
                {draft.zone && (
                    <EditableField
                        label="Зона"
                        value={draft.zone}
                        onSave={(v) => onEditField('zone', v)}
                    />
                )}
                {draft.description && (
                    <EditableField
                        label="Описание"
                        value={draft.description}
                        onSave={(v) => onEditField('description', v)}
                    />
                )}
            </Box>

            {/* ── Checklist ── */}
            {draft.checklist && draft.checklist.length > 0 && (
                <Paper
                    variant="outlined"
                    sx={{ p: 2, borderRadius: 3, bgcolor: alpha(theme.palette.grey[500], 0.04) }}
                >
                    <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                        Чек-лист ({draft.checklist.length})
                    </Typography>
                    {draft.checklist.map((item, i) => (
                        <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
                            <Box
                                sx={{
                                    width: 18, height: 18, borderRadius: 1,
                                    border: 2, borderColor: 'action.disabled',
                                    flexShrink: 0,
                                }}
                            />
                            <Typography variant="body2" color="text.primary">
                                {item.title}
                            </Typography>
                        </Box>
                    ))}
                </Paper>
            )}

            {/* ── Scope Badge ── */}
            <ScopeBadge
                analysis={analysis}
                onScopeDecision={(decision) => setScopeDecision(decision)}
            />

            {/* ── Duplicate Warning ── */}
            {analysis.possibleDuplicate?.found && (
                <Paper
                    sx={{
                        p: 2,
                        borderRadius: 3,
                        bgcolor: alpha('#8b5cf6', 0.06),
                        border: 1,
                        borderColor: alpha('#8b5cf6', 0.3),
                    }}
                >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <WarningIcon sx={{ fontSize: 18, color: '#8b5cf6' }} />
                        <Typography fontWeight={600} fontSize="0.85rem" color="#5b21b6">
                            Возможный дубликат
                        </Typography>
                    </Box>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                        «{analysis.possibleDuplicate.existingTaskTitle}»
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <Button
                            size="small"
                            variant="contained"
                            startIcon={<MergeIcon />}
                            onClick={() => setScopeDecision('merge')}
                            sx={{
                                borderRadius: 2, textTransform: 'none', fontSize: '0.75rem',
                                bgcolor: '#8b5cf6', '&:hover': { bgcolor: '#7c3aed' },
                            }}
                        >
                            Слить
                        </Button>
                        <Button
                            size="small"
                            variant="outlined"
                            startIcon={<LinkIcon />}
                            onClick={() => setScopeDecision('link')}
                            sx={{
                                borderRadius: 2, textTransform: 'none', fontSize: '0.75rem',
                                borderColor: alpha('#8b5cf6', 0.5), color: '#5b21b6',
                            }}
                        >
                            Связать
                        </Button>
                        <Button
                            size="small"
                            variant="outlined"
                            startIcon={<IgnoreIcon />}
                            onClick={() => setScopeDecision('ignore')}
                            sx={{
                                borderRadius: 2, textTransform: 'none', fontSize: '0.75rem',
                                borderColor: 'divider', color: 'text.secondary',
                            }}
                        >
                            Пропустить
                        </Button>
                    </Box>
                </Paper>
            )}

            {/* ── AI Reasoning (collapsible) ── */}
            <Box>
                <Button
                    size="small"
                    onClick={() => setShowReasoning(!showReasoning)}
                    endIcon={showReasoning ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    sx={{ textTransform: 'none', color: 'text.secondary', fontWeight: 500, px: 0 }}
                >
                    💡 {showReasoning ? 'Скрыть' : 'Показать'} рассуждения AI
                </Button>
                <Collapse in={showReasoning}>
                    <Paper
                        variant="outlined"
                        sx={{ mt: 1, p: 2, borderRadius: 2, bgcolor: alpha(theme.palette.grey[500], 0.04) }}
                    >
                        <Typography variant="caption" fontWeight={600} color="text.secondary" gutterBottom>
                            Скоуп:
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                            {analysis.scopeExplanation}
                        </Typography>
                        <Typography variant="caption" fontWeight={600} color="text.secondary" gutterBottom>
                            Исполнитель:
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            {analysis.assigneeReasoning}
                        </Typography>
                    </Paper>
                </Collapse>
            </Box>

            {/* ── Action Footer ── */}
            <Box sx={{ display: 'flex', gap: 2, pt: 1 }}>
                <Button
                    fullWidth
                    variant="outlined"
                    onClick={onCancel}
                    sx={{ py: 1.5, borderRadius: 3, fontWeight: 'bold', textTransform: 'none' }}
                >
                    Отмена
                </Button>
                <Button
                    fullWidth
                    variant="contained"
                    color="success"
                    onClick={() => onConfirm(scopeDecision)}
                    disabled={isConfirming || !draft.title || !draft.projectId}
                    startIcon={isConfirming ? <CircularProgress size={20} color="inherit" /> : <CheckIcon />}
                    sx={{ py: 1.5, borderRadius: 3, fontWeight: 'bold', textTransform: 'none' }}
                >
                    {isConfirming ? 'Сохранение...' : '✅ Создать задачу'}
                </Button>
            </Box>
        </Box>
    );
}
