/**
 * @fileoverview AI Generate Button — standalone MUI button with purple gradient
 * Drop-in component for triggering AI task generation.
 */

import React from 'react';
import { Button, CircularProgress } from '@mui/material';
import { AutoAwesome as AIIcon } from '@mui/icons-material';

interface AiGenerateButtonProps {
    onClick: () => void;
    disabled?: boolean;
    loading?: boolean;
}

export function AiGenerateButton({ onClick, disabled, loading }: AiGenerateButtonProps) {
    return (
        <Button
            fullWidth
            variant="contained"
            onClick={onClick}
            disabled={disabled || loading}
            startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <AIIcon />}
            sx={{
                py: 1.5,
                borderRadius: 3,
                fontWeight: 'bold',
                fontSize: '0.95rem',
                color: '#fff',
                background: loading
                    ? 'linear-gradient(135deg, #9b6dff 0%, #5b8def 100%)'
                    : 'linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)',
                boxShadow: '0 4px 15px rgba(124, 58, 237, 0.3)',
                '&:hover': {
                    background: 'linear-gradient(135deg, #6d28d9 0%, #1d4ed8 100%)',
                    boxShadow: '0 6px 20px rgba(124, 58, 237, 0.4)',
                },
                '&:disabled': {
                    background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)',
                    opacity: 0.7,
                    color: 'rgba(255,255,255,0.8)',
                },
                animation: loading ? 'aiShimmer 2s infinite' : 'none',
                backgroundSize: loading ? '200% 100%' : 'auto',
                '@keyframes aiShimmer': {
                    '0%': { backgroundPosition: '-200% 0' },
                    '100%': { backgroundPosition: '200% 0' },
                },
                transition: 'all 0.2s ease',
                '&:active': {
                    transform: 'scale(0.98)',
                },
            }}
        >
            {loading ? 'Claude думает...' : '✨ AI Заполнить'}
        </Button>
    );
}

export default AiGenerateButton;
