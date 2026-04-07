import React from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Chip,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Avatar,
  Divider,
  Paper,
} from '@mui/material';
import {
  CheckCircle as PassedIcon,
  Cancel as FailedIcon,
  Schedule as ScheduledIcon,
  PlayCircle as InProgressIcon,
} from '@mui/icons-material';

export interface Inspection {
  id: number;
  name: string;
  date: string;
  status: 'passed' | 'failed' | 'scheduled' | 'in-progress';
  inspector?: string;
  notes?: string;
}

interface InspectionsViewProps {
  inspections: Inspection[];
}

const getStatusConfig = (status: string) => {
  switch (status) {
    case 'passed':
      return { color: '#4caf50', icon: <PassedIcon />, label: 'Passed' };
    case 'failed':
      return { color: '#f44336', icon: <FailedIcon />, label: 'Failed' };
    case 'in-progress':
      return { color: '#2196f3', icon: <InProgressIcon />, label: 'In Progress' };
    case 'scheduled':
    default:
      return { color: '#9e9e9e', icon: <ScheduledIcon />, label: 'Scheduled' };
  }
};

const InspectionsView: React.FC<InspectionsViewProps> = ({ inspections }) => {
  const upcoming = inspections.filter(i => i.status === 'scheduled' || i.status === 'in-progress');
  const completed = inspections.filter(i => i.status === 'passed' || i.status === 'failed');

  return (
    <Card elevation={2} sx={{ borderRadius: 2 }}>
      <CardContent>
        <Typography variant="h5" gutterBottom fontWeight="bold">
          Inspections
        </Typography>

        {upcoming.length > 0 && (
          <Box mb={3}>
            <Typography variant="h6" gutterBottom color="primary">
              Upcoming
            </Typography>
            <List disablePadding>
              {upcoming.map((inspection) => {
                const config = getStatusConfig(inspection.status);
                return (
                  <React.Fragment key={inspection.id}>
                    <ListItem sx={{ px: 0 }}>
                      <ListItemIcon>
                        <Avatar sx={{ bgcolor: config.color, width: 40, height: 40 }}>
                          {config.icon}
                        </Avatar>
                      </ListItemIcon>
                      <ListItemText
                        primary={
                          <Box display="flex" justifyContent="space-between" alignItems="center">
                            <Typography variant="body1" fontWeight="bold">
                              {inspection.name}
                            </Typography>
                            <Chip
                              label={config.label}
                              size="small"
                              sx={{ backgroundColor: config.color, color: '#fff' }}
                            />
                          </Box>
                        }
                        secondary={
                          <Box mt={0.5}>
                            <Typography variant="body2" color="text.secondary">
                              Date: {inspection.date}
                              {inspection.inspector && ` | Inspector: ${inspection.inspector}`}
                            </Typography>
                            {inspection.notes && (
                              <Typography variant="body2" color="text.secondary" mt={0.5}>
                                {inspection.notes}
                              </Typography>
                            )}
                          </Box>
                        }
                      />
                    </ListItem>
                    <Divider />
                  </React.Fragment>
                );
              })}
            </List>
          </Box>
        )}

        {completed.length > 0 && (
          <Box>
            <Typography variant="h6" gutterBottom color="text.secondary">
              Completed
            </Typography>
            <List disablePadding>
              {completed.map((inspection) => {
                const config = getStatusConfig(inspection.status);
                return (
                  <React.Fragment key={inspection.id}>
                    <ListItem sx={{ px: 0 }}>
                      <ListItemIcon>
                        <Avatar sx={{ bgcolor: config.color, width: 40, height: 40 }}>
                          {config.icon}
                        </Avatar>
                      </ListItemIcon>
                      <ListItemText
                        primary={
                          <Box display="flex" justifyContent="space-between" alignItems="center">
                            <Typography variant="body1" fontWeight="bold">
                              {inspection.name}
                            </Typography>
                            <Chip
                              label={config.label}
                              size="small"
                              sx={{ backgroundColor: config.color, color: '#fff' }}
                            />
                          </Box>
                        }
                        secondary={
                          <Box mt={0.5}>
                            <Typography variant="body2" color="text.secondary">
                              Date: {inspection.date}
                              {inspection.inspector && ` | Inspector: ${inspection.inspector}`}
                            </Typography>
                            {inspection.notes && (
                              <Paper variant="outlined" sx={{ p: 1, mt: 1, backgroundColor: '#f8f9fa' }}>
                                <Typography variant="body2">{inspection.notes}</Typography>
                              </Paper>
                            )}
                          </Box>
                        }
                      />
                    </ListItem>
                    <Divider />
                  </React.Fragment>
                );
              })}
            </List>
          </Box>
        )}

        {inspections.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <ScheduledIcon sx={{ fontSize: 48, color: '#bbb', mb: 2 }} />
            <Typography variant="body1" color="text.secondary">
              No inspections scheduled yet
            </Typography>
            <Typography variant="body2" color="text.secondary" mt={1}>
              Inspections will be scheduled once permits are approved
            </Typography>
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

export default InspectionsView;
