/**
 * @fileoverview Индикатор статуса пользователя
 * Визуальные стили для Active/Invited/Blocked/Online
 */

import React from 'react';
import { Box, Typography } from '@mui/material';

type UserStatus = 'active' | 'invited' | 'blocked' | 'inactive';

interface StatusIndicatorProps {
    status: UserStatus;
    isOnline?: boolean;
    showLabel?: boolean;
    size?: 'small' | 'medium';
}

const STATUS_CONFIG: Record<UserStatus, { color: string; label: string; dot: string }> = {
    active: { color: 'success.main', label: 'Активен', dot: '●' },
    invited: { color: 'warning.main', label: 'Приглашён', dot: '◐' },
    blocked: { color: 'error.main', label: 'Заблокирован', dot: '○' },
    inactive: { color: 'text.disabled', label: 'Неактивен', dot: '○' },
};

const StatusIndicator: React.FC<StatusIndicatorProps> = ({
    status,
    isOnline,
    showLabel = true,
    size = 'medium',
}) => {
    const config = STATUS_CONFIG[status] || STATUS_CONFIG.inactive;
    const dotSize = size === 'small' ? 6 : 8;

    // Online overrides active status visually
    const displayOnline = isOnline && status === 'active';

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box
                sx={{
                    width: dotSize,
                    height: dotSize,
                    borderRadius: '50%',
                    bgcolor: displayOnline ? 'success.light' : config.color,
                    ...(displayOnline && {
                        boxShadow: '0 0 8px rgba(76, 175, 80, 0.6)',
                        animation: 'pulse 2s infinite',
                        '@keyframes pulse': {
                            '0%': { opacity: 1 },
                            '50%': { opacity: 0.6 },
                            '100%': { opacity: 1 },
                        },
                    }),
                    ...(status === 'invited' && {
                        animation: 'spin 2s linear infinite',
                        background: `conic-gradient(${config.color} 0deg, transparent 180deg, ${config.color} 360deg)`,
                        '@keyframes spin': {
                            from: { transform: 'rotate(0deg)' },
                            to: { transform: 'rotate(360deg)' },
                        },
                    }),
                }}
            />
            {showLabel && (
                <Typography
                    variant={size === 'small' ? 'caption' : 'body2'}
                    sx={{ color: config.color }}
                >
                    {displayOnline ? 'Онлайн' : config.label}
                </Typography>
            )}
        </Box>
    );
};

export default StatusIndicator;
