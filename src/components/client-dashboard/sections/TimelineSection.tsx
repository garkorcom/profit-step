import React, { useState } from 'react';
import {
  Box,
  Typography,
  Card,
  Grid,
  Paper,
  Slider,
  LinearProgress,
} from '@mui/material';

export interface ProjectStage {
  name: string;
  status: 'completed' | 'current' | 'upcoming';
  progress: number;
  icon: string;
  description: string;
}

interface TimelineSectionProps {
  stages: ProjectStage[];
}

const TimelineSection: React.FC<TimelineSectionProps> = ({ stages }) => {
  const currentIndex = stages.findIndex(s => s.status === 'current');
  const [timelineProgress, setTimelineProgress] = useState(currentIndex >= 0 ? currentIndex : 0);

  return (
    <Card elevation={2} sx={{ borderRadius: 2, p: 3 }}>
      <Typography variant="h5" gutterBottom fontWeight="bold">
        Project Timeline
      </Typography>

      <Box sx={{ px: { xs: 1, md: 2 }, py: 4 }}>
        <Typography variant="body1" gutterBottom textAlign="center" color="text.secondary">
          Drag the slider to explore project phases
        </Typography>
        <Slider
          value={timelineProgress}
          onChange={(_e, value) => setTimelineProgress(value as number)}
          min={0}
          max={stages.length - 1}
          step={1}
          marks={stages.map((stage, index) => ({
            value: index,
            label: stage.icon + ' ' + stage.name,
          }))}
          valueLabelDisplay="off"
          sx={{
            mb: 4,
            '& .MuiSlider-markLabel': {
              fontSize: { xs: '0.65rem', md: '0.875rem' },
              whiteSpace: 'nowrap',
            },
          }}
        />

        <Paper variant="outlined" sx={{ p: 2, backgroundColor: '#f0f9f0', borderColor: '#2e7d32' }}>
          <Typography variant="h6" color="success.dark" gutterBottom>
            {stages[timelineProgress].icon} {stages[timelineProgress].name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {stages[timelineProgress].description}
          </Typography>
          <Box display="flex" alignItems="center" mt={1}>
            <Typography variant="body2" sx={{ mr: 1 }}>
              Progress:
            </Typography>
            <LinearProgress
              variant="determinate"
              value={stages[timelineProgress].progress}
              sx={{ flexGrow: 1, mr: 1 }}
            />
            <Typography variant="body2">
              {stages[timelineProgress].progress}%
            </Typography>
          </Box>
        </Paper>
      </Box>

      <Grid container spacing={2}>
        {stages.map((stage, index) => (
          <Grid size={{ xs: 6, sm: 4, md: 3 }} key={index}>
            <Card
              variant="outlined"
              sx={{
                textAlign: 'center',
                p: 2,
                cursor: 'pointer',
                transition: 'all 0.2s',
                backgroundColor: stage.status === 'current' ? '#e8f5e8' :
                                  stage.status === 'completed' ? '#f0f9f0' : '#fafafa',
                borderColor: stage.status === 'current' ? '#2e7d32' :
                             index === timelineProgress ? '#1976d2' : '#e0e0e0',
                borderWidth: stage.status === 'current' || index === timelineProgress ? 2 : 1,
                '&:hover': { borderColor: '#1976d2', transform: 'translateY(-2px)' },
              }}
              onClick={() => setTimelineProgress(index)}
            >
              <Typography variant="h5" mb={0.5}>{stage.icon}</Typography>
              <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                {stage.name}
              </Typography>
              <LinearProgress
                variant="determinate"
                value={stage.progress}
                sx={{ mb: 1, height: 6, borderRadius: 3 }}
                color={stage.status === 'completed' ? 'success' : 'primary'}
              />
              <Typography variant="caption" color="text.secondary">
                {stage.progress}%
              </Typography>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Card>
  );
};

export default TimelineSection;
