import React from 'react';
import {
  Container,
  Typography,
  Box,
  Paper,
  Grid,
  Button,
  Chip,
  Alert
} from '@mui/material';
import { Campaign as CampaignIcon, OpenInNew as OpenInNewIcon } from '@mui/icons-material';

// Glob all index files inside ideas to extract metadata
// Using import.meta.glob with eager: true means it will import them right away.
// Notice we cast it as Record<string, any>
const ideaModules: Record<string, any> = import.meta.glob('/landings/ideas/*/build/index.tsx', { eager: true });

const LandingsPage: React.FC = () => {
  // Extract landings from modules
  const landings = Object.entries(ideaModules).map(([path, module]) => {
    // We want to extract "demo-project"
    const match = path.match(/ideas\/([^\/]+)\/build/);
    const ideaName = match ? match[1] : 'unknown';
    
    // Default metadata if not provided by the module
    const meta = module.metadata || {};
    
    return {
      id: ideaName,
      title: meta.title || ideaName,
      description: meta.description || 'Нет описания',
      status: meta.status || 'Draft',
      url: `/l/${ideaName}`,
      tech: meta.tech || ['React'],
    };
  });

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 4 }}>
        <CampaignIcon sx={{ fontSize: 40, color: 'primary.main', mr: 2 }} />
        <Typography variant="h4" fontWeight="bold">
          Идеи и Промо (Лендинги)
        </Typography>
      </Box>

      <Typography variant="body1" color="text.secondary" paragraph>
        Центр управления посадочными страницами. Все страницы генерируются динамически из папки <code>/landings/ideas/</code>.
      </Typography>

      <Grid container spacing={4} sx={{ mt: 2 }}>
        {landings.length === 0 ? (
          <Grid item xs={12}>
            <Alert severity="info">Нет доступных лендингов в директории /landings/ideas/</Alert>
          </Grid>
        ) : (
          landings.map((landing) => (
            <Grid item xs={12} md={6} lg={4} key={landing.id}>
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
                    color={landing.status === 'Live' ? 'success' : 'warning'} 
                    size="small" 
                    sx={{ fontWeight: 'bold' }} 
                  />
                </Box>

                <Typography variant="body2" color="text.secondary" sx={{ mb: 3, flexGrow: 1 }}>
                  {landing.description}
                </Typography>

                <Box sx={{ mb: 3, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {landing.tech.map((t: string) => (
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
                >
                  Открыть сайт
                </Button>
              </Paper>
            </Grid>
          ))
        )}
      </Grid>
    </Container>
  );
};

export default LandingsPage;
