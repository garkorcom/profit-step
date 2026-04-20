import React from 'react';
import { Button, ButtonProps } from '@mui/material';

interface ConversionButtonProps extends ButtonProps {
  label: string;
}

export const ConversionButton: React.FC<ConversionButtonProps> = ({ label, ...props }) => {
  return (
    <Button
      variant="contained"
      size="large"
      sx={{
        backgroundColor: 'var(--lp-primary-color)',
        color: '#fff',
        borderRadius: 'var(--lp-radius-sm)',
        padding: '12px 32px',
        fontWeight: 'bold',
        fontSize: '1rem',
        textTransform: 'none',
        boxShadow: 'var(--lp-shadow-card)',
        '&:hover': {
          backgroundColor: 'var(--lp-secondary-color)',
        },
        ...props.sx
      }}
      {...props}
    >
      {label}
    </Button>
  );
};
