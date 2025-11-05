import React from 'react';
import {
  Paper,
  Typography,
  Box,
  Card,
  CardContent,
  Chip,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import {
  Error as ErrorIcon,
  Email as EmailIcon,
  Speed as SpeedIcon,
  Storage as StorageIcon,
} from '@mui/icons-material';

/**
 * System Health Panel
 * Мониторинг здоровья системы
 */
const SystemHealthPanel: React.FC = () => {
  // TODO: Подключить real-time data из Firestore

  return (
    <Box>
      <Typography variant="h5" gutterBottom>
        System Health Monitoring
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Мониторинг ошибок, email delivery и performance метрик
      </Typography>

      <Grid container spacing={3}>
        {/* Error Rate Card */}
        <Grid size={{ xs: 12, md: 6, lg: 3 }}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <ErrorIcon color="error" sx={{ mr: 1 }} />
                <Typography variant="h6">Error Rate</Typography>
              </Box>
              <Typography variant="h3" sx={{ mb: 1 }}>
                12
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Last 24 hours
              </Typography>
              <Chip label="Normal" color="success" size="small" sx={{ mt: 1 }} />
            </CardContent>
          </Card>
        </Grid>

        {/* Email Delivery Card */}
        <Grid size={{ xs: 12, md: 6, lg: 3 }}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <EmailIcon color="primary" sx={{ mr: 1 }} />
                <Typography variant="h6">Email Delivery</Typography>
              </Box>
              <Typography variant="h3" sx={{ mb: 1 }}>
                98.5%
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Delivery rate
              </Typography>
              <Chip label="Excellent" color="success" size="small" sx={{ mt: 1 }} />
            </CardContent>
          </Card>
        </Grid>

        {/* API Latency Card */}
        <Grid size={{ xs: 12, md: 6, lg: 3 }}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <SpeedIcon color="info" sx={{ mr: 1 }} />
                <Typography variant="h6">API Latency</Typography>
              </Box>
              <Typography variant="h3" sx={{ mb: 1 }}>
                245ms
              </Typography>
              <Typography variant="body2" color="text.secondary">
                P95 latency
              </Typography>
              <Chip label="Good" color="info" size="small" sx={{ mt: 1 }} />
            </CardContent>
          </Card>
        </Grid>

        {/* Storage Usage Card */}
        <Grid size={{ xs: 12, md: 6, lg: 3 }}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <StorageIcon color="warning" sx={{ mr: 1 }} />
                <Typography variant="h6">Storage</Typography>
              </Box>
              <Typography variant="h3" sx={{ mb: 1 }}>
                4.2GB
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Total usage
              </Typography>
              <Chip label="Normal" color="success" size="small" sx={{ mt: 1 }} />
            </CardContent>
          </Card>
        </Grid>

        {/* Recent Errors Table */}
        <Grid size={{ xs: 12 }}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Recent Errors
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Последние ошибки из Cloud Functions
            </Typography>
            <Box sx={{ mt: 2, textAlign: 'center', py: 4 }}>
              <Typography color="text.secondary">
                🔧 Подключение к real-time данным в разработке
              </Typography>
            </Box>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default SystemHealthPanel;
