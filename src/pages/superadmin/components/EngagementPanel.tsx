import React from 'react';
import { Paper, Typography, Box, Card, CardContent } from '@mui/material';
import Grid from '@mui/material/Grid';
import { People as PeopleIcon } from '@mui/icons-material';

/**
 * Engagement Panel
 * Метрики вовлеченности пользователей
 */
const EngagementPanel: React.FC = () => {
  return (
    <Box>
      <Typography variant="h5" gutterBottom>
        User Engagement
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Метрики активности и вовлеченности пользователей
      </Typography>

      <Grid container spacing={3}>
        {/* DAU */}
        <Grid size={{ xs: 12, md: 6, lg: 3 }}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <PeopleIcon color="primary" sx={{ mr: 1 }} />
                <Typography variant="h6">DAU</Typography>
              </Box>
              <Typography variant="h3" sx={{ mb: 1 }}>
                324
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Daily Active Users
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* WAU */}
        <Grid size={{ xs: 12, md: 6, lg: 3 }}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <PeopleIcon color="info" sx={{ mr: 1 }} />
                <Typography variant="h6">WAU</Typography>
              </Box>
              <Typography variant="h3" sx={{ mb: 1 }}>
                1,247
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Weekly Active Users
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* MAU */}
        <Grid size={{ xs: 12, md: 6, lg: 3 }}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <PeopleIcon color="success" sx={{ mr: 1 }} />
                <Typography variant="h6">MAU</Typography>
              </Box>
              <Typography variant="h3" sx={{ mb: 1 }}>
                3,892
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Monthly Active Users
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* Stickiness */}
        <Grid size={{ xs: 12, md: 6, lg: 3 }}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <PeopleIcon color="warning" sx={{ mr: 1 }} />
                <Typography variant="h6">Stickiness</Typography>
              </Box>
              <Typography variant="h3" sx={{ mb: 1 }}>
                8.3%
              </Typography>
              <Typography variant="body2" color="text.secondary">
                DAU/MAU ratio
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* DAU History Chart */}
        <Grid size={{ xs: 12, md: 8 }}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Daily Active Users (Last 30 Days)
            </Typography>
            <Box sx={{ mt: 2, textAlign: 'center', py: 4 }}>
              <Typography color="text.secondary">
                📈 DAU trend chart в разработке
              </Typography>
            </Box>
          </Paper>
        </Grid>

        {/* Profile Completion */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Profile Completion
            </Typography>
            <Box sx={{ mt: 2, textAlign: 'center', py: 4 }}>
              <Typography variant="h2" color="primary">
                67%
              </Typography>
              <Typography color="text.secondary">
                Profiles completed
              </Typography>
            </Box>
          </Paper>
        </Grid>

        {/* Feature Adoption */}
        <Grid size={{ xs: 12 }}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Feature Adoption
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Процент пользователей, использующих каждую функцию
            </Typography>
            <Box sx={{ mt: 2, textAlign: 'center', py: 4 }}>
              <Typography color="text.secondary">
                📊 Horizontal bar chart в разработке
              </Typography>
            </Box>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default EngagementPanel;
