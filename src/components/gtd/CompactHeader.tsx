import React from 'react';
import { Box, Typography, IconButton, Button, Badge, Collapse, Chip } from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';
import AddIcon from '@mui/icons-material/Add';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import { useNavigate } from 'react-router-dom';

interface CompactHeaderProps {
    title: string;
    subtitle?: string;
    isCompact: boolean;
    hasActiveFilters: boolean;
    onFilterClick: () => void;
    onAddClick: () => void;
    totalTasks?: number;
    children?: React.ReactNode; // Filter controls
}

/**
 * Compact Header - сворачивается при скролле
 * 
 * Полная высота: ~130px (title + subtitle + children)
 * Компактная высота: ~50px (только title + actions)
 */
const CompactHeader: React.FC<CompactHeaderProps> = ({
    title,
    subtitle,
    isCompact,
    hasActiveFilters,
    onFilterClick,
    onAddClick,
    totalTasks,
    children
}) => {
    const navigate = useNavigate();

    return (
        <Box
            sx={{
                position: 'sticky',
                top: 0,
                zIndex: 100,
                bgcolor: 'rgba(255, 255, 255, 0.85)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                borderBottom: '1px solid',
                borderColor: isCompact ? 'rgba(0,0,0,0.1)' : 'transparent',
                transition: 'all 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)',
                px: 2,
                py: isCompact ? 1 : 2,
            }}
        >
            {/* Main Header Row */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {/* Title */}
                <Box sx={{ flex: 1 }}>
                    <Typography
                        variant={isCompact ? 'h6' : 'h4'}
                        sx={{
                            fontWeight: 700,
                            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
                            letterSpacing: '-0.02em',
                            transition: 'all 0.3s ease',
                        }}
                    >
                        {title}
                        {totalTasks !== undefined && (
                            <Chip
                                label={totalTasks}
                                size="small"
                                sx={{
                                    ml: 1,
                                    height: isCompact ? 20 : 24,
                                    fontSize: isCompact ? '0.7rem' : '0.8rem',
                                    bgcolor: '#e5e5ea',
                                    fontWeight: 600,
                                }}
                            />
                        )}
                    </Typography>
                </Box>

                {/* Quick Actions */}
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                    {/* Shopping Button */}
                    <IconButton
                        onClick={() => navigate('/crm/shopping')}
                        sx={{
                            bgcolor: '#fff3e0',
                            color: '#ff9800',
                            width: 40,
                            height: 40,
                            '&:hover': { bgcolor: '#ffe0b2' }
                        }}
                    >
                        <ShoppingCartIcon fontSize="small" />
                    </IconButton>

                    {/* Calendar Button */}
                    <IconButton
                        onClick={() => navigate('/crm/calendar')}
                        sx={{
                            bgcolor: '#e3f2fd',
                            color: '#1976d2',
                            width: 40,
                            height: 40,
                            '&:hover': { bgcolor: '#bbdefb' }
                        }}
                    >
                        <CalendarMonthIcon fontSize="small" />
                    </IconButton>

                    {/* Filters */}
                    <IconButton
                        onClick={onFilterClick}
                        sx={{
                            bgcolor: hasActiveFilters ? '#e8f5e9' : '#f5f5f5',
                            width: 40,
                            height: 40,
                            '&:hover': { bgcolor: hasActiveFilters ? '#c8e6c9' : '#eeeeee' }
                        }}
                    >
                        <Badge
                            color="success"
                            variant="dot"
                            invisible={!hasActiveFilters}
                        >
                            <FilterListIcon fontSize="small" />
                        </Badge>
                    </IconButton>

                    {/* Add Task */}
                    <Button
                        variant="contained"
                        size="small"
                        startIcon={<AddIcon />}
                        onClick={onAddClick}
                        sx={{
                            bgcolor: '#34c759',
                            borderRadius: 3,
                            px: 2,
                            height: 40,
                            textTransform: 'none',
                            fontWeight: 600,
                            boxShadow: '0 2px 8px rgba(52, 199, 89, 0.3)',
                            '&:hover': { bgcolor: '#2da44e' }
                        }}
                    >
                        {isCompact ? '' : 'Add Task'}
                    </Button>
                </Box>
            </Box>

            {/* Subtitle - only when not compact */}
            <Collapse in={!isCompact}>
                {subtitle && (
                    <Typography
                        variant="body2"
                        sx={{
                            color: '#86868b',
                            mt: 0.5,
                            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
                        }}
                    >
                        {subtitle}
                    </Typography>
                )}
            </Collapse>

            {/* Filter Controls - only when not compact */}
            <Collapse in={!isCompact}>
                {children && (
                    <Box sx={{ mt: 2 }}>
                        {children}
                    </Box>
                )}
            </Collapse>
        </Box>
    );
};

export default CompactHeader;
