import React from 'react';
import { Box, Typography } from '@mui/material';
import MapIcon from '@mui/icons-material/Map';

export const TasksMapView: React.FC = () => {
    return (
        <Box
            sx={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: '#F9FAFB'
            }}
        >
            <MapIcon sx={{ fontSize: 64, color: '#9CA3AF', mb: 2 }} />
            <Typography variant="h5" color="text.primary" fontWeight={600} gutterBottom>
                Map View
            </Typography>
            <Typography variant="body1" color="text.secondary" align="center" sx={{ maxWidth: 400 }}>
                This feature is currently under development. Soon you'll be able to view tasks by location for field works.
            </Typography>
        </Box>
    );
};

export default TasksMapView;
