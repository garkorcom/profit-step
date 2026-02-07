import React from 'react';
import { Box } from '@mui/material';

interface ColumnIndicatorProps {
    total: number;
    current: number;
    colors?: string[];
    onChange?: (index: number) => void;
}

/**
 * Column Indicator - показывает текущую позицию в виде точек
 * Apple-style pagination dots
 */
const ColumnIndicator: React.FC<ColumnIndicatorProps> = ({
    total,
    current,
    colors,
    onChange
}) => {
    // Цвета колонок GTD
    const defaultColors = [
        '#86868b', // Inbox - gray
        '#ff9f0a', // Next Actions - orange
        '#30d158', // Projects - green
        '#bf5af2', // Waiting For - purple
        '#34c759', // Estimate - green
        '#5856d6', // Someday - purple
        '#ff453a', // Done - red
    ];

    const dotColors = colors || defaultColors;

    return (
        <Box
            sx={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: 0.75,
                py: 1,
                px: 2,
            }}
        >
            {Array.from({ length: total }).map((_, index) => {
                const isActive = index === current;
                const color = dotColors[index % dotColors.length];

                return (
                    <Box
                        key={index}
                        onClick={() => onChange?.(index)}
                        sx={{
                            width: isActive ? 24 : 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: isActive ? color : '#e5e5ea',
                            transition: 'all 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)',
                            cursor: onChange ? 'pointer' : 'default',
                            opacity: isActive ? 1 : 0.6,
                            '&:hover': onChange ? {
                                opacity: 1,
                                transform: 'scale(1.2)',
                            } : {},
                        }}
                    />
                );
            })}
        </Box>
    );
};

export default ColumnIndicator;
