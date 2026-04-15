/**
 * Placeholder for the internal timeline section.
 * Will be replaced with Master Plan / Gantt chart per SPEC v1.1 S1.3.
 */

import React from 'react';
import { Box, Typography, Card, Alert } from '@mui/material';

const TimelinePlaceholder: React.FC = () => (
  <Card elevation={2} sx={{ borderRadius: 2, p: 3 }}>
    <Typography variant="h5" gutterBottom fontWeight="bold">
      Internal Timeline View
    </Typography>

    <Alert severity="info" sx={{ mb: 3 }}>
      Master Plan / Interactive Gantt coming per SPEC v1.1 — unified timeline
      for all participants with plan/fact overlay and permit risk tracking.
    </Alert>

    <Box sx={{ textAlign: 'center', py: 4 }}>
      <Typography variant="h6" color="text.secondary">
        Master Plan integration pending
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        Will show internal deadlines, crew assignments, and material delivery schedules
      </Typography>
    </Box>
  </Card>
);

export default TimelinePlaceholder;
