/**
 * @fileoverview Карточка статистики для дашбордов
 * Stripe/Linear inspired minimal design
 */

import React from 'react';
import { Box, Paper, Typography, Tooltip } from '@mui/material';
import { TrendingUp, TrendingDown } from '@mui/icons-material';

interface StatCardProps {
    value: number | string;
    label: string;
    icon?: React.ReactNode;
    trend?: string; // "+2" или "-3"
    trendColor?: 'success' | 'error' | 'warning';
    tooltip?: string;
    pulse?: boolean; // Пульсирующая точка
    live?: boolean; // Live индикатор
    onClick?: () => void;
}

const StatCard: React.FC<StatCardProps> = ({
    value,
    label,
    icon,
    trend,
    trendColor = 'success',
    tooltip,
    pulse,
    live,
    onClick,
}) => {
    const content = (
        <Paper
            elevation={0}
            onClick={onClick}
            sx={{
                p: 2.5,
                borderRadius: 2,
                border: '1px solid',
                borderColor: 'divider',
                cursor: onClick ? 'pointer' : 'default',
                transition: 'all 0.2s ease',
                '&:hover': onClick ? {
                    borderColor: 'primary.main',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                } : {},
            }}
        >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography
                            variant="h4"
                            component="div"
                            fontWeight={600}
                            sx={{ lineHeight: 1 }}
                        >
                            {value}
                        </Typography>

                        {/* Live indicator */}
                        {live && (
                            <Box
                                sx={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: '50%',
                                    bgcolor: 'success.main',
                                    boxShadow: '0 0 8px rgba(76, 175, 80, 0.6)',
                                    animation: 'pulse 2s infinite',
                                    '@keyframes pulse': {
                                        '0%': { opacity: 1 },
                                        '50%': { opacity: 0.5 },
                                        '100%': { opacity: 1 },
                                    },
                                }}
                            />
                        )}

                        {/* Pulse indicator */}
                        {pulse && (
                            <Box
                                sx={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: '50%',
                                    bgcolor: 'warning.main',
                                    animation: 'pulse 1.5s infinite',
                                    '@keyframes pulse': {
                                        '0%': { transform: 'scale(1)' },
                                        '50%': { transform: 'scale(1.2)' },
                                        '100%': { transform: 'scale(1)' },
                                    },
                                }}
                            />
                        )}
                    </Box>

                    <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mt: 0.5 }}
                    >
                        {label}
                    </Typography>

                    {/* Trend indicator */}
                    {trend && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1 }}>
                            {trend.startsWith('+') ? (
                                <TrendingUp sx={{ fontSize: 16, color: `${trendColor}.main` }} />
                            ) : (
                                <TrendingDown sx={{ fontSize: 16, color: `${trendColor}.main` }} />
                            )}
                            <Typography
                                variant="caption"
                                sx={{ color: `${trendColor}.main`, fontWeight: 500 }}
                            >
                                {trend} за месяц
                            </Typography>
                        </Box>
                    )}
                </Box>

                {/* Icon */}
                {icon && (
                    <Box sx={{ color: 'text.secondary', opacity: 0.5 }}>
                        {icon}
                    </Box>
                )}
            </Box>
        </Paper>
    );

    if (tooltip) {
        return <Tooltip title={tooltip}>{content}</Tooltip>;
    }

    return content;
};

export default StatCard;
