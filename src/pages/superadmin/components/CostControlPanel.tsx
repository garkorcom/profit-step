import React from 'react';
import { Paper, Typography, Box, Card, CardContent } from '@mui/material';
import Grid from '@mui/material/Grid';
import { AttachMoney as MoneyIcon } from '@mui/icons-material';

/**
 * Cost Control Panel
 * Контроль затрат на Firebase и другие сервисы
 */
const CostControlPanel: React.FC = () => {
  return (
    <Box>
      <Typography variant="h5" gutterBottom>
        Cost Control
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Мониторинг расходов и прогнозирование бюджета
      </Typography>

      <Grid container spacing={3}>
        {/* Total Cost This Month */}
        <Grid size={{ xs: 12, md: 6, lg: 3 }}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <MoneyIcon color="primary" sx={{ mr: 1 }} />
                <Typography variant="h6">This Month</Typography>
              </Box>
              <Typography variant="h3" sx={{ mb: 1 }}>
                $47.32
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Total cost
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* Projected Monthly Cost */}
        <Grid size={{ xs: 12, md: 6, lg: 3 }}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <MoneyIcon color="warning" sx={{ mr: 1 }} />
                <Typography variant="h6">Projected</Typography>
              </Box>
              <Typography variant="h3" sx={{ mb: 1 }}>
                $145
              </Typography>
              <Typography variant="body2" color="text.secondary">
                End of month
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* Daily Cost Chart */}
        <Grid size={{ xs: 12 }}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Daily Cost Breakdown
            </Typography>
            <Box sx={{ mt: 2, textAlign: 'center', py: 4 }}>
              <Typography color="text.secondary">
                📊 Chart visualization в разработке
              </Typography>
            </Box>
          </Paper>
        </Grid>

        {/* Cost by Service */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Cost by Service
            </Typography>
            <Box sx={{ mt: 2, textAlign: 'center', py: 4 }}>
              <Typography color="text.secondary">
                📊 Service breakdown в разработке
              </Typography>
            </Box>
          </Paper>
        </Grid>

        {/* Cost by Company */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Cost per Company
            </Typography>
            <Box sx={{ mt: 2, textAlign: 'center', py: 4 }}>
              <Typography color="text.secondary">
                📊 Company breakdown в разработке
              </Typography>
            </Box>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default CostControlPanel;
