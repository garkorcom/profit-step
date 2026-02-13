/**
 * @fileoverview TasksMasonryHeader — Sticky glassmorphism header
 * 
 * Features: group toggle (Timeline/Context), task stats,
 * multi-select toolbar for bulk done/delete.
 */

import React, { useState } from 'react';
import {
    Box, Typography, Button, ToggleButton, ToggleButtonGroup,
    Chip, IconButton, TextField, InputAdornment, Collapse,
} from '@mui/material';
import {
    Timeline as TimelineIcon,
    Category as ContextIcon,
    CheckCircle as DoneIcon,
    Delete as DeleteIcon,
    Close as CloseIcon,
    TouchApp as TouchIcon,
    Search as SearchIcon,
} from '@mui/icons-material';
import { GroupMode } from '../../hooks/useTasksMasonry';

interface TasksMasonryHeaderProps {
    groupMode: GroupMode;
    onGroupModeChange: (mode: GroupMode) => void;
    stats: {
        total: number;
        active: number;
        overdue: number;
        dueToday: number;
        done: number;
    };
    // Select mode
    selectMode: boolean;
    selectedCount: number;
    onBulkDone: () => void;
    onBulkDelete: () => void;
    onClearSelection: () => void;
    // Search
    searchQuery: string;
    onSearchChange: (q: string) => void;
}

const SF_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

const TasksMasonryHeader: React.FC<TasksMasonryHeaderProps> = ({
    groupMode,
    onGroupModeChange,
    stats,
    selectMode,
    selectedCount,
    onBulkDone,
    onBulkDelete,
    onClearSelection,
    searchQuery,
    onSearchChange,
}) => {
    const [searchOpen, setSearchOpen] = useState(false);
    return (
        <Box sx={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            bgcolor: 'rgba(255,255,255,0.85)',
            borderBottom: '1px solid rgba(0,0,0,0.06)',
        }}>
            {/* ── Main header row ── */}
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                px: { xs: 2, md: 3 },
                py: 1.5,
                minHeight: 56,
            }}>
                {/* Title + stats */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <TouchIcon sx={{ fontSize: 24, color: '#007AFF' }} />
                    <Typography sx={{
                        fontWeight: 700,
                        fontSize: { xs: '18px', md: '22px' },
                        fontFamily: SF_FONT,
                        color: '#1D1D1F',
                        letterSpacing: '-0.02em',
                    }}>
                        Touch Board
                    </Typography>
                </Box>

                {/* Stats pills (compact on mobile) */}
                <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
                    {stats.overdue > 0 && (
                        <Chip
                            size="small"
                            label={`${stats.overdue} overdue`}
                            sx={{
                                bgcolor: '#FFEBEE',
                                color: '#FF3B30',
                                fontWeight: 700,
                                fontSize: '11px',
                                height: 26,
                                fontFamily: SF_FONT,
                                '& .MuiChip-label': {
                                    px: { xs: 0.75, sm: 1 },
                                },
                            }}
                        />
                    )}
                    {stats.dueToday > 0 && (
                        <Chip
                            size="small"
                            label={`${stats.dueToday} today`}
                            sx={{
                                bgcolor: '#FFF3E0',
                                color: '#FF9500',
                                fontWeight: 700,
                                fontSize: '11px',
                                height: 26,
                                fontFamily: SF_FONT,
                                '& .MuiChip-label': {
                                    px: { xs: 0.75, sm: 1 },
                                },
                            }}
                        />
                    )}
                    <Chip
                        size="small"
                        label={`${stats.active} active`}
                        sx={{
                            bgcolor: '#E3F2FD',
                            color: '#007AFF',
                            fontWeight: 700,
                            fontSize: '11px',
                            height: 26,
                            fontFamily: SF_FONT,
                        }}
                    />
                </Box>
            </Box>

            {/* ── Group toggle row ── */}
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                px: { xs: 2, md: 3 },
                pb: 1.5,
            }}>
                <ToggleButtonGroup
                    value={groupMode}
                    exclusive
                    onChange={(_, v) => v && onGroupModeChange(v)}
                    size="small"
                    sx={{
                        '& .MuiToggleButton-root': {
                            textTransform: 'none',
                            fontFamily: SF_FONT,
                            fontWeight: 600,
                            fontSize: '13px',
                            px: 2,
                            py: 0.5,
                            border: '1px solid rgba(0,0,0,0.08)',
                            borderRadius: '10px !important',
                            '&.Mui-selected': {
                                bgcolor: '#007AFF',
                                color: '#fff',
                                '&:hover': { bgcolor: '#0066DD' },
                            },
                        },
                    }}
                >
                    <ToggleButton value="timeline">
                        <TimelineIcon sx={{ fontSize: 16, mr: 0.5 }} /> Timeline
                    </ToggleButton>
                    <ToggleButton value="context">
                        <ContextIcon sx={{ fontSize: 16, mr: 0.5 }} /> Context
                    </ToggleButton>
                </ToggleButtonGroup>

                {/* Search toggle */}
                <IconButton
                    onClick={() => {
                        setSearchOpen(!searchOpen);
                        if (searchOpen) onSearchChange('');
                    }}
                    sx={{
                        width: 36,
                        height: 36,
                        bgcolor: searchQuery ? '#007AFF15' : 'transparent',
                        color: searchQuery ? '#007AFF' : '#8E8E93',
                    }}
                >
                    {searchOpen ? <CloseIcon sx={{ fontSize: 18 }} /> : <SearchIcon sx={{ fontSize: 18 }} />}
                </IconButton>
            </Box>

            {/* ── Search bar (collapsible) ── */}
            <Collapse in={searchOpen}>
                <Box sx={{ px: { xs: 2, md: 3 }, pb: 1.5 }}>
                    <TextField
                        fullWidth
                        autoFocus
                        size="small"
                        value={searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                        placeholder="Поиск по названию, контексту, проекту..."
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <SearchIcon sx={{ fontSize: 18, color: '#8E8E93' }} />
                                </InputAdornment>
                            ),
                            endAdornment: searchQuery ? (
                                <InputAdornment position="end">
                                    <IconButton size="small" onClick={() => onSearchChange('')}>
                                        <CloseIcon sx={{ fontSize: 16 }} />
                                    </IconButton>
                                </InputAdornment>
                            ) : null,
                        }}
                        sx={{
                            '& .MuiOutlinedInput-root': {
                                borderRadius: '12px',
                                fontFamily: SF_FONT,
                                fontSize: '14px',
                                bgcolor: '#F5F5F7',
                                '& fieldset': { border: 'none' },
                            },
                        }}
                    />
                </Box>
            </Collapse>

            {/* ── Multi-select toolbar ── */}
            {selectMode && selectedCount > 0 && (
                <Box sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    px: { xs: 2, md: 3 },
                    py: 1.5,
                    background: 'linear-gradient(135deg, #E3F2FD 0%, #BBDEFB 100%)',
                    borderTop: '1px solid #90CAF9',
                }}>
                    <Typography sx={{ fontFamily: SF_FONT, fontWeight: 700, fontSize: '14px', color: '#1565C0' }}>
                        {selectedCount} selected
                    </Typography>

                    <Button
                        size="small"
                        startIcon={<DoneIcon />}
                        onClick={onBulkDone}
                        sx={{
                            fontFamily: SF_FONT,
                            fontSize: '13px',
                            textTransform: 'none',
                            fontWeight: 600,
                            color: '#34C759',
                            minWidth: 44,
                            minHeight: 44,
                        }}
                    >
                        Done
                    </Button>

                    <Button
                        size="small"
                        startIcon={<DeleteIcon />}
                        onClick={onBulkDelete}
                        sx={{
                            fontFamily: SF_FONT,
                            fontSize: '13px',
                            textTransform: 'none',
                            fontWeight: 600,
                            color: '#FF3B30',
                            minWidth: 44,
                            minHeight: 44,
                        }}
                    >
                        Delete
                    </Button>

                    <Box sx={{ flex: 1 }} />

                    <IconButton onClick={onClearSelection} sx={{ width: 44, height: 44 }}>
                        <CloseIcon sx={{ fontSize: 20 }} />
                    </IconButton>
                </Box>
            )}
        </Box>
    );
};

export default TasksMasonryHeader;
