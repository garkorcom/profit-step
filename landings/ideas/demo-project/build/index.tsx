import React from 'react';
import { Box, Container, Typography, Grid } from '@mui/material';
import { ActionForm } from '../../../infrastructure/components/ActionForm';
import '../../../infrastructure/shared.css';

import { LandingMetadata } from '../../../infrastructure/types';

// Metadata for CRM Admin Panel scanner and SEO
export const metadata: LandingMetadata = {
  title: 'Умный расчет стоимости (Демо)',
  description: 'Простейший конверсионный лендинг с формой для захвата лидов и глобальной раскраской.',
  status: 'Live',
  tech: ['React', 'MUI', 'Profit Tools'],
};

export default function DemoLanding() {
  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: 'var(--lp-bg-color)' }}>
      <Container maxWidth="lg" className="lp-section">
        <Grid container spacing={6} alignItems="center">
          <Grid size={{ xs: 12, md: 7 }}>
            <Typography variant="overline" sx={{ color: 'var(--lp-primary-color)', fontWeight: 'bold', mb: 1, display: 'block' }}>
              PROFIT STEP
            </Typography>
            <Typography variant="h1" className="lp-title">
              Умный расчет стоимости <br/>
              <span className="lp-text-gradient">без скрытых доплат</span>
            </Typography>
            <Typography className="lp-subtitle">
              Мы используем ИИ, чтобы точно рассчитать смету вашего объекта за 15 минут. 
              Никаких задержек и долгих встреч.
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, mb: 4 }}>
              {/* Optional bullets or guarantees */}
              <Typography variant="body2" sx={{ fontWeight: 'bold' }}>✓ Точная цена</Typography>
              <Typography variant="body2" sx={{ fontWeight: 'bold' }}>✓ Быстрый старт</Typography>
            </Box>
          </Grid>
          <Grid size={{ xs: 12, md: 5 }}>
            <ActionForm title="Получить точный расчет" source="demo-project" />
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
}
