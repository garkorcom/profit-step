/**
 * @fileoverview TaskSquare — Touch-optimized boxy task card
 * 
 * Designed for iPad Mini (8.3") and Pixel Fold (7.6").
 * All interactive elements ≥ 44×44px.
 * Features: priority dot, context pill, large checkbox, due date,
 * checklist progress, swipe-to-delete, long-press multi-select.
 */

import React, { useState, useRef, useCallback } from 'react';
import { Box, Typography, Chip, Tooltip, Checkbox, Dialog, Button } from '@mui/material';
import {
    CheckCircle as CheckIcon,
    RadioButtonUnchecked as UncheckedIcon,
    AccessTime as TimeIcon,
    Delete as DeleteIcon,
    Warning as WarningIcon,
} from '@mui/icons-material';
import { GTDTask, PRIORITY_COLORS } from '../../types/gtd.types';

interface TaskSquareProps {
    task: GTDTask;
    onMarkDone: (taskId: string) => void;
    onMarkUndone: (taskId: string) => void;
    onDelete: (taskId: string) => void;
    onClick: (task: GTDTask) => void;
    // Select mode
    selectMode: boolean;
    isSelected: boolean;
    onToggleSelect: (taskId: string) => void;
    onLongPress: (taskId: string) => void;
    // Compact mode for done cards
    compact?: boolean;
}

const SF_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

// ── Due date formatter ──
const formatDueDate = (dueDate: any): { label: string; color: string } | null => {
    if (!dueDate?.seconds) return null;
    const due = new Date(dueDate.seconds * 1000);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfter = new Date(tomorrow);
    dayAfter.setDate(dayAfter.getDate() + 1);

    if (due < today) {
        const days = Math.ceil((today.getTime() - due.getTime()) / 86400000);
        return { label: `${days}d overdue`, color: '#FF3B30' };
    }
    if (due < tomorrow) return { label: 'Today', color: '#FF3B30' };
    if (due < dayAfter) return { label: 'Tomorrow', color: '#FF9500' };

    return {
        label: due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        color: '#8E8E93',
    };
};

// ── Context colors ──
const CONTEXT_PILL_COLORS: Record<string, string> = {
    '@calls': '#FF9500',
    '@office': '#007AFF',
    '@computer': '#5856D6',
    '@home': '#34C759',
    '@errands': '#FF3B30',
    '@phone': '#FF2D55',
    '@work': '#FF9500',
};

const SWIPE_THRESHOLD = 80;

const TaskSquare: React.FC<TaskSquareProps> = ({
    task,
    onMarkDone,
    onMarkUndone,
    onDelete,
    onClick,
    selectMode,
    isSelected,
    onToggleSelect,
    onLongPress,
    compact = false,
}) => {
    const isDone = task.status === 'done';
    const dueInfo = formatDueDate(task.dueDate);
    const priorityColor = PRIORITY_COLORS[task.priority] || 'transparent';
    const contextColor = task.context ? CONTEXT_PILL_COLORS[task.context.toLowerCase()] || '#8E8E93' : null;

    // Checklist progress
    const checklistTotal = task.checklistItems?.length || 0;
    const checklistDone = task.checklistItems?.filter(i => i.completed).length || 0;
    const checklistPercent = checklistTotal > 0 ? (checklistDone / checklistTotal) * 100 : 0;

    // Time estimate
    const estimatedHours = task.estimatedDurationMinutes
        ? (task.estimatedDurationMinutes / 60).toFixed(1)
        : null;

    // Card is "bare" — no context, client, priority
    const isBareCard = !task.context && !task.clientName && task.priority === 'none' && !estimatedHours && checklistTotal === 0;

    // ── Swipe state — use refs for real-time tracking to avoid stale closures ──
    const [swipeX, setSwipeX] = useState(0);
    const swipeXRef = useRef(0);           // Real-time swipe position (no stale closure)
    const swipingRef = useRef(false);      // Real-time swiping flag
    const touchStartX = useRef(0);
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Delete confirmation
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        touchStartX.current = e.touches[0].clientX;
        swipingRef.current = false;
        swipeXRef.current = 0;
        // Long press detection
        longPressTimer.current = setTimeout(() => {
            onLongPress(task.id);
        }, 500);
    }, [task.id, onLongPress]);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        const dx = e.touches[0].clientX - touchStartX.current;
        if (Math.abs(dx) > 10) {
            // Cancel long press on any significant move
            if (longPressTimer.current) {
                clearTimeout(longPressTimer.current);
                longPressTimer.current = null;
            }
            swipingRef.current = true;
            const clamped = Math.min(0, dx); // Only swipe left
            swipeXRef.current = clamped;
            setSwipeX(clamped);
        }
    }, []);

    const handleTouchEnd = useCallback(() => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
        // Use ref for real-time value (avoids stale closure)
        if (swipeXRef.current < -SWIPE_THRESHOLD && swipingRef.current) {
            setDeleteConfirmOpen(true);
        }
        swipeXRef.current = 0;
        swipingRef.current = false;
        setSwipeX(0);
    }, []);

    const handleClick = useCallback(() => {
        // Guard: ignore click if a swipe just happened
        if (swipingRef.current) return;
        if (selectMode) {
            onToggleSelect(task.id);
        } else {
            onClick(task);
        }
    }, [selectMode, task, onToggleSelect, onClick]);

    const handleConfirmDelete = useCallback(() => {
        setDeleteConfirmOpen(false);
        onDelete(task.id);
    }, [task.id, onDelete]);

    // ── COMPACT VIEW for done cards ──
    if (compact && isDone) {
        return (
            <Box
                onClick={handleClick}
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    bgcolor: isSelected ? '#E3F2FD' : '#F5F5F7',
                    borderRadius: '10px',
                    px: 1.5,
                    py: 1,
                    cursor: 'pointer',
                    opacity: 0.7,
                    transition: 'all 0.2s',
                    outline: isSelected ? '2px solid #007AFF' : 'none',
                    '&:hover': { opacity: 0.85 },
                    '&:active': { transform: 'scale(0.98)' },
                    userSelect: 'none',
                    fontFamily: SF_FONT,
                }}
            >
                <Box
                    onClick={(e) => {
                        e.stopPropagation();
                        if (navigator.vibrate) navigator.vibrate(10);
                        onMarkUndone(task.id);
                    }}
                    sx={{
                        width: 32,
                        height: 32,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        cursor: 'pointer',
                    }}
                >
                    <CheckIcon sx={{ fontSize: 24, color: '#34C759' }} />
                </Box>
                <Typography sx={{
                    fontSize: '14px',
                    fontFamily: SF_FONT,
                    color: '#8E8E93',
                    textDecoration: 'line-through',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    flex: 1,
                }}>
                    {task.title}
                </Typography>
                {task.clientName && (
                    <Typography sx={{ fontSize: '11px', color: '#007AFF', fontFamily: SF_FONT, fontWeight: 500, flexShrink: 0 }}>
                        {task.clientName}
                    </Typography>
                )}
            </Box>
        );
    }

    return (
        <Box sx={{ position: 'relative', overflow: 'hidden', borderRadius: '16px', mb: 0 }}>
            {/* ── Swipe background (delete reveal) ── */}
            <Box sx={{
                position: 'absolute',
                top: 0, right: 0, bottom: 0,
                width: SWIPE_THRESHOLD + 20,
                bgcolor: '#FF3B30',
                borderRadius: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: swipeX < -20 ? 1 : 0,
                transition: swipeX === 0 ? 'opacity 0.2s' : 'none',
            }}>
                <DeleteIcon sx={{ color: '#fff', fontSize: 28 }} />
            </Box>

            {/* ── Card body ── */}
            <Box
                onClick={handleClick}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                sx={{
                    position: 'relative',
                    bgcolor: isSelected ? '#E3F2FD' : isDone ? '#F5F5F7' : '#FFFFFF',
                    borderRadius: '16px',
                    p: 1.5,
                    boxShadow: isSelected
                        ? '0 2px 12px rgba(25,118,210,0.15)'
                        : '0 1px 8px rgba(0,0,0,0.06)',
                    transition: swipeX === 0 ? 'all 0.25s cubic-bezier(0.25, 0.1, 0.25, 1)' : 'none',
                    transform: `translateX(${swipeX}px)`,
                    cursor: 'pointer',
                    outline: isSelected ? '2px solid #007AFF' : 'none',
                    opacity: isDone ? 0.65 : 1,
                    fontFamily: SF_FONT,
                    '&:active': {
                        transform: selectMode ? `translateX(${swipeX}px)` : `translateX(${swipeX}px) scale(0.98)`,
                    },
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    touchAction: 'pan-y',
                    minHeight: 80,
                }}
            >
                {/* ── Select checkbox ── */}
                {selectMode && (
                    <Box sx={{ position: 'absolute', top: 8, right: 8, zIndex: 2 }}>
                        <Checkbox
                            checked={isSelected}
                            onChange={() => onToggleSelect(task.id)}
                            sx={{ p: 0.5, '& .MuiSvgIcon-root': { fontSize: 28 } }}
                        />
                    </Box>
                )}

                {/* ── Top bar: Context pill + Priority dot ── */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    {/* Priority dot */}
                    {task.priority !== 'none' && (
                        <Box sx={{
                            width: 10, height: 10,
                            borderRadius: '50%',
                            bgcolor: priorityColor,
                            flexShrink: 0,
                        }} />
                    )}

                    {/* Context pill */}
                    {task.context && contextColor && (
                        <Chip
                            label={task.context}
                            size="small"
                            sx={{
                                bgcolor: `${contextColor}30`,
                                color: contextColor,
                                fontWeight: 700,
                                fontSize: '11px',
                                height: 24,
                                fontFamily: SF_FONT,
                                border: `1px solid ${contextColor}50`,
                            }}
                        />
                    )}

                    {/* Time estimate */}
                    {estimatedHours && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, ml: 'auto' }}>
                            <TimeIcon sx={{ fontSize: 14, color: '#8E8E93' }} />
                            <Typography sx={{ fontSize: '12px', color: '#8E8E93', fontFamily: SF_FONT, fontWeight: 500 }}>
                                {estimatedHours}h
                            </Typography>
                        </Box>
                    )}
                </Box>

                {/* ── Center: Task title ── */}
                <Typography sx={{
                    fontSize: '17px',
                    fontWeight: 600,
                    fontFamily: SF_FONT,
                    color: isDone ? '#8E8E93' : '#1D1D1F',
                    lineHeight: 1.35,
                    mb: 0.5,
                    textDecoration: isDone ? 'line-through' : 'none',
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    pr: selectMode ? 4 : 0,
                }}>
                    {task.title}
                </Typography>

                {/* Client / Project name */}
                {task.clientName && (
                    <Typography sx={{
                        fontSize: '13px',
                        color: '#007AFF',
                        fontFamily: SF_FONT,
                        fontWeight: 500,
                        mb: 1,
                    }}>
                        {task.clientName}
                    </Typography>
                )}

                {/* ── Checklist progress ── */}
                {checklistTotal > 0 && (
                    <Box sx={{ mb: 1 }}>
                        <Box sx={{
                            height: 4,
                            bgcolor: '#F0F0F0',
                            borderRadius: 2,
                            overflow: 'hidden',
                        }}>
                            <Box sx={{
                                height: '100%',
                                width: `${checklistPercent}%`,
                                bgcolor: checklistPercent === 100 ? '#34C759' : '#007AFF',
                                borderRadius: 2,
                                transition: 'width 0.3s',
                            }} />
                        </Box>
                        <Typography sx={{ fontSize: '11px', color: '#8E8E93', fontFamily: SF_FONT, mt: 0.25 }}>
                            {checklistDone}/{checklistTotal}
                        </Typography>
                    </Box>
                )}

                {/* ── Bottom bar: Checkbox + Due date ── */}
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 'auto', pt: 0.5 }}>
                    {/* Large checkbox — 44×44px touch target */}
                    <Tooltip title={isDone ? 'Mark undone' : 'Mark done'}>
                        <Box
                            onClick={(e) => {
                                e.stopPropagation();
                                if (navigator.vibrate) navigator.vibrate(10);
                                isDone ? onMarkUndone(task.id) : onMarkDone(task.id);
                            }}
                            sx={{
                                width: 44,
                                height: 44,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: '50%',
                                cursor: 'pointer',
                                '&:hover': { bgcolor: 'rgba(0,0,0,0.04)' },
                                '&:active': { bgcolor: 'rgba(0,0,0,0.08)' },
                            }}
                        >
                            {isDone ? (
                                <CheckIcon sx={{ fontSize: 32, color: '#34C759' }} />
                            ) : (
                                <UncheckedIcon sx={{ fontSize: 32, color: '#C7C7CC' }} />
                            )}
                        </Box>
                    </Tooltip>

                    {/* Due date */}
                    {dueInfo && (
                        <Typography sx={{
                            fontSize: '13px',
                            fontWeight: 600,
                            fontFamily: SF_FONT,
                            color: dueInfo.color,
                        }}>
                            {dueInfo.label}
                        </Typography>
                    )}

                    {/* Assignee initial */}
                    {task.assigneeName && (
                        <Box sx={{
                            width: 28, height: 28,
                            borderRadius: '50%',
                            bgcolor: '#E8E8ED',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}>
                            <Typography sx={{ fontSize: '12px', fontWeight: 700, color: '#636366', fontFamily: SF_FONT }}>
                                {task.assigneeName.charAt(0).toUpperCase()}
                            </Typography>
                        </Box>
                    )}
                </Box>

                {/* Fallback hint for bare cards */}
                {isBareCard && !isDone && (
                    <Typography sx={{
                        fontSize: '11px',
                        color: '#C7C7CC',
                        fontFamily: SF_FONT,
                        fontStyle: 'italic',
                        mt: 0.5,
                    }}>
                        Тапни чтобы добавить детали
                    </Typography>
                )}
            </Box>

            {/* ── Delete Confirmation Dialog ── */}
            <Dialog
                open={deleteConfirmOpen}
                onClose={() => setDeleteConfirmOpen(false)}
                PaperProps={{
                    sx: {
                        borderRadius: '20px',
                        p: 3,
                        maxWidth: 340,
                        textAlign: 'center',
                        fontFamily: SF_FONT,
                    },
                }}
            >
                <WarningIcon sx={{ fontSize: 48, color: '#FF3B30', mx: 'auto', mb: 1.5 }} />
                <Typography sx={{
                    fontWeight: 700,
                    fontSize: '18px',
                    fontFamily: SF_FONT,
                    color: '#1D1D1F',
                    mb: 0.5,
                }}>
                    Удалить задачу?
                </Typography>
                <Typography sx={{
                    fontSize: '14px',
                    color: '#8E8E93',
                    fontFamily: SF_FONT,
                    mb: 3,
                    lineHeight: 1.4,
                }}>
                    «{task.title}» будет удалена без возможности восстановления.
                </Typography>
                <Box sx={{ display: 'flex', gap: 1.5 }}>
                    <Button
                        fullWidth
                        onClick={() => setDeleteConfirmOpen(false)}
                        sx={{
                            fontFamily: SF_FONT,
                            textTransform: 'none',
                            fontWeight: 600,
                            fontSize: '15px',
                            color: '#007AFF',
                            borderRadius: '12px',
                            bgcolor: '#F2F2F7',
                            minHeight: 48,
                            '&:hover': { bgcolor: '#E8E8ED' },
                        }}
                    >
                        Отмена
                    </Button>
                    <Button
                        fullWidth
                        onClick={handleConfirmDelete}
                        sx={{
                            fontFamily: SF_FONT,
                            textTransform: 'none',
                            fontWeight: 600,
                            fontSize: '15px',
                            color: '#fff',
                            borderRadius: '12px',
                            bgcolor: '#FF3B30',
                            minHeight: 48,
                            '&:hover': { bgcolor: '#E0342B' },
                        }}
                    >
                        Удалить
                    </Button>
                </Box>
            </Dialog>
        </Box>
    );
};

export default TaskSquare;
