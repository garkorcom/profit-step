import React, { useState } from 'react';
import { Box, TextField, Typography, Alert } from '@mui/material';
import { ConversionButton } from './ConversionButton';
import { addDoc, collection } from 'firebase/firestore';
import { db } from '../../../src/firebase/firebase'; // Pointing to main firebase

interface ActionFormProps {
  title?: string;
  source?: string;
}

export const ActionForm: React.FC<ActionFormProps> = ({ title = "Оставьте заявку", source = "landing_hub" }) => {
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone) return;
    
    setStatus('loading');
    try {
      // Add lead directly to CRM
      await addDoc(collection(db, 'leads'), {
        phone,
        source,
        status: 'Ожидает',
        createdAt: new Date(),
      });
      setStatus('success');
      setPhone('');
    } catch (err) {
      console.error("Ошибка при отправке лида", err);
      setStatus('error');
    }
  };

  return (
    <Box 
      component="form" 
      onSubmit={handleSubmit}
      sx={{
        p: 4,
        background: '#fff',
        borderRadius: 'var(--lp-radius-md)',
        boxShadow: 'var(--lp-shadow-card)',
        maxWidth: 400,
        margin: '0 auto',
      }}
    >
      <Typography variant="h5" fontWeight="bold" mb={3} textAlign="center" sx={{ color: 'var(--lp-text-primary)' }}>
        {title}
      </Typography>
      
      {status === 'success' ? (
        <Alert severity="success" sx={{ mb: 2 }}>Заявка отправлена! Мы скоро свяжемся.</Alert>
      ) : (
        <>
          <TextField
            fullWidth
            label="Ваш телефон"
            variant="outlined"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            sx={{ mb: 3 }}
            disabled={status === 'loading'}
            required
          />
          <ConversionButton 
            label={status === 'loading' ? 'Отправка...' : 'Получить расчет'} 
            type="submit"
            fullWidth 
            disabled={status === 'loading'}
          />
        </>
      )}
    </Box>
  );
};
