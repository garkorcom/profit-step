import React from 'react';
import {
  Container,
  Typography,
  Box,
  Paper,
  Grid,
  Button,
  Chip
} from '@mui/material';
import { Campaign as CampaignIcon, OpenInNew as OpenInNewIcon } from '@mui/icons-material';

const LandingsPage: React.FC = () => {
  const landings = [
    {
      id: 1,
      title: 'CCTV Video Surveillance',
      description: 'Landing page for Turnkey Video Surveillance Systems. Features Russian/English i18n, dark mode glassmorphism, and Framer Motion animations.',
      status: 'Development',
      url: 'http://localhost:3003',
      repo: 'cctv-landing',
      tech: ['Next.js 16', 'Tailwind v4', 'Framer Motion'],
    }
  ];

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 4 }}>
        <CampaignIcon sx={{ fontSize: 40, color: 'primary.main', mr: 2 }} />
        <Typography variant="h4" fontWeight="bold">
          Лендинги
        </Typography>
      </Box>

      <Typography variant="body1" color="text.secondary" paragraph>
        Центр управления промо-сайтами и лендингами компании.
      </Typography>

      <Grid container spacing={4} sx={{ mt: 2 }}>
        {landings.map((landing) => (
          <Grid size={{ xs: 12, md: 6, lg: 4 }} key={landing.id}>
            <Paper
              elevation={3}
              sx={{
                p: 3,
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                transition: 'transform 0.2s, box-shadow 0.2s',
                '&:hover': {
                  transform: 'translateY(-4px)',
                  boxShadow: 6
                }
              }}
            >
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                <Typography variant="h6" fontWeight="bold">
                  {landing.title}
                </Typography>
                <Chip 
                  label={landing.status} 
                  color="warning" 
                  size="small" 
                  sx={{ fontWeight: 'bold' }} 
                />
              </Box>

              <Typography variant="body2" color="text.secondary" sx={{ mb: 3, flexGrow: 1 }}>
                {landing.description}
              </Typography>

              <Box sx={{ mb: 3, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {landing.tech.map((t) => (
                  <Chip key={t} label={t} variant="outlined" size="small" />
                ))}
              </Box>

              <Button
                variant="contained"
                color="primary"
                endIcon={<OpenInNewIcon />}
                fullWidth
                href={landing.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Открыть сайт
              </Button>
            </Paper>
          </Grid>
        ))}
      </Grid>
    </Container>
  );
};

export default LandingsPage;
