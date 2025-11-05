import React from 'react';
import { Paper, Typography, Box, Card, CardContent } from '@mui/material';
import Grid from '@mui/material/Grid';
import { TrendingUp as GrowthIcon } from '@mui/icons-material';

/**
 * Growth Panel
 * Метрики роста платформы
 */
const GrowthPanel: React.FC = () => {
  return (
    <Box>
      <Typography variant="h5" gutterBottom>
        Platform Growth
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Рост пользовательской базы и воронка активации
      </Typography>

      <Grid container spacing={3}>
        {/* New Users */}
        <Grid size={{ xs: 12, md: 6, lg: 3 }}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <GrowthIcon color="success" sx={{ mr: 1 }} />
                <Typography variant="h6">New Users</Typography>
              </Box>
              <Typography variant="h3" sx={{ mb: 1 }}>
                142
              </Typography>
              <Typography variant="body2" color="text.secondary">
                This month
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* New Companies */}
        <Grid size={{ xs: 12, md: 6, lg: 3 }}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <GrowthIcon color="primary" sx={{ mr: 1 }} />
                <Typography variant="h6">New Companies</Typography>
              </Box>
              <Typography variant="h3" sx={{ mb: 1 }}>
                28
              </Typography>
              <Typography variant="body2" color="text.secondary">
                This month
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* User Growth Chart */}
        <Grid size={{ xs: 12, md: 8 }}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              User & Company Growth
            </Typography>
            <Box sx={{ mt: 2, textAlign: 'center', py: 4 }}>
              <Typography color="text.secondary">
                📈 Growth chart в разработке
              </Typography>
            </Box>
          </Paper>
        </Grid>

        {/* Signup Sources */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Signup Sources
            </Typography>
            <Box sx={{ mt: 2, textAlign: 'center', py: 4 }}>
              <Typography color="text.secondary">
                🥧 Pie chart в разработке
              </Typography>
            </Box>
          </Paper>
        </Grid>

        {/* Activation Funnel */}
        <Grid size={{ xs: 12 }}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Activation Funnel
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Воронка активации новых пользователей
            </Typography>
            <Box sx={{ mt: 2, textAlign: 'center', py: 4 }}>
              <Typography color="text.secondary">
                🔽 Funnel chart в разработке
              </Typography>
            </Box>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default GrowthPanel;
