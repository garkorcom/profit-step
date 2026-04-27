/**
 * @fileoverview Tasktotime — placeholder for views not yet implemented.
 *
 * Each non-list nav item routes to this page. The reason we keep the route
 * (instead of disabling the nav item) is so URL-shared bookmarks resolve
 * predictably across the rollout — every PR can flip a single placeholder
 * into a real view without rewriting URLs.
 */

import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import { Link as RouterLink } from 'react-router-dom';

interface ComingSoonViewProps {
    label: string;
}

const ComingSoonView: React.FC<ComingSoonViewProps> = ({ label }) => (
    <Box
        sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            p: 4,
            textAlign: 'center',
            color: '#6B7280',
        }}
    >
        <HourglassEmptyIcon sx={{ fontSize: 56, mb: 2, color: '#9CA3AF' }} />
        <Typography variant="h6" fontWeight={600} gutterBottom>
            {label} — Coming soon
        </Typography>
        <Typography variant="body2" sx={{ maxWidth: 480, mb: 3 }}>
            Phase 4.0 ships the routing, hooks, and API client for tasktotime
            plus the Task List view. The {label} view will land in a follow-up
            PR.
        </Typography>
        <Button component={RouterLink} to="/crm/tasktotime/list" variant="outlined">
            Back to Task List
        </Button>
    </Box>
);

export default ComingSoonView;
