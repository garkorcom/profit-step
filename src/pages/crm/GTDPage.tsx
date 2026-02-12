/**
 * @fileoverview GTD Page — Compact full-height layout
 * 
 * Minimal header (40px) + full-height board.
 * Footer hidden via MainLayout path detection.
 */

import React from 'react';
import { Box, Typography, IconButton, Tooltip } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import GTDBoard from '../../components/gtd/GTDBoard';

const GTDPage: React.FC = () => {
    const navigate = useNavigate();

    return (
        <Box sx={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
        }}>
            {/* Compact Header — 40px */}
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                px: { xs: 1.5, md: 2 },
                py: 0.5,
                minHeight: 40,
                flexShrink: 0,
            }}>
                <Typography
                    variant="h6"
                    sx={{
                        fontWeight: 700,
                        fontSize: '16px',
                        letterSpacing: '-0.02em',
                        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
                    }}
                >
                    Cockpit
                </Typography>

                <Box sx={{ display: 'flex', gap: 0.5 }}>
                    <Tooltip title="Закупки" arrow>
                        <IconButton
                            size="small"
                            onClick={() => navigate('/crm/shopping')}
                            sx={{
                                width: 36,
                                height: 36,
                                color: '#34c759',
                                '&:hover': { bgcolor: 'rgba(52, 199, 89, 0.1)' },
                            }}
                        >
                            <ShoppingCartIcon sx={{ fontSize: 20 }} />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Calendar" arrow>
                        <IconButton
                            size="small"
                            onClick={() => navigate('/crm/calendar')}
                            sx={{
                                width: 36,
                                height: 36,
                                color: '#007aff',
                                '&:hover': { bgcolor: 'rgba(0, 122, 255, 0.1)' },
                            }}
                        >
                            <CalendarMonthIcon sx={{ fontSize: 20 }} />
                        </IconButton>
                    </Tooltip>
                </Box>
            </Box>

            {/* Board takes all remaining space */}
            <Box sx={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
                <GTDBoard />
            </Box>
        </Box>
    );
};

export default GTDPage;
