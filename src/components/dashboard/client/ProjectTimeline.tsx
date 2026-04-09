/**
 * ProjectTimeline — vertical feed of project events.
 * Lazy-loads with "Load more" button.
 */

import React from 'react';
import {
  Paper,
  Typography,
  Box,
  Chip,
  Button,
  Skeleton,
  Divider,
} from '@mui/material';
import {
  Description as EstimateIcon,
  Payment as PaymentIcon,
  PlayArrow as StartIcon,
  Stop as StopIcon,
  CheckCircle as DoneIcon,
  PhotoCamera as PhotoIcon,
  ShoppingCart as PurchaseIcon,
  AttachMoney as CostIcon,
} from '@mui/icons-material';
import type { TimelineEvent, TimelineEventType } from '../../../types/clientDashboard.types';

interface ProjectTimelineProps {
  events: TimelineEvent[];
  loading: boolean;
  hasMore: boolean;
  total: number;
  onLoadMore: () => void;
}

const eventConfig: Record<
  TimelineEventType,
  { icon: React.ReactNode; color: string }
> = {
  estimate_created: { icon: <EstimateIcon fontSize="small" />, color: '#9e9e9e' },
  payment_received: { icon: <PaymentIcon fontSize="small" />, color: '#4caf50' },
  session_started: { icon: <StartIcon fontSize="small" />, color: '#1976d2' },
  session_ended: { icon: <StopIcon fontSize="small" />, color: '#1976d2' },
  task_completed: { icon: <DoneIcon fontSize="small" />, color: '#4caf50' },
  photo_added: { icon: <PhotoIcon fontSize="small" />, color: '#9c27b0' },
  material_purchased: { icon: <PurchaseIcon fontSize="small" />, color: '#ff9800' },
  cost_added: { icon: <CostIcon fontSize="small" />, color: '#ff5722' },
};

function formatRelativeTime(iso: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

const ProjectTimeline: React.FC<ProjectTimelineProps> = ({
  events,
  loading,
  hasMore,
  total,
  onLoadMore,
}) => {
  if (loading && events.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Skeleton variant="text" width="40%" />
        {[1, 2, 3].map(i => (
          <Skeleton key={i} variant="rounded" height={40} sx={{ mt: 1 }} />
        ))}
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle2" gutterBottom>
        Timeline ({total} events)
      </Typography>

      {events.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
          No events yet
        </Typography>
      ) : (
        <Box>
          {events.map((event, idx) => {
            const config = eventConfig[event.type] || {
              icon: <CostIcon fontSize="small" />,
              color: '#757575',
            };

            return (
              <React.Fragment key={event.id}>
                <Box sx={{ display: 'flex', gap: 1.5, py: 1 }}>
                  {/* Icon */}
                  <Box
                    sx={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      bgcolor: config.color,
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {config.icon}
                  </Box>

                  {/* Content */}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <Typography variant="body2" fontWeight={500} noWrap>
                        {event.title}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ ml: 1, flexShrink: 0 }}>
                        {formatRelativeTime(event.timestamp)}
                      </Typography>
                    </Box>
                    {event.description && (
                      <Typography variant="caption" color="text.secondary">
                        {event.description}
                      </Typography>
                    )}
                    {event.amount != null && event.amount > 0 && (
                      <Chip
                        label={`$${event.amount.toLocaleString()}`}
                        size="small"
                        variant="outlined"
                        sx={{ mt: 0.5 }}
                      />
                    )}
                  </Box>
                </Box>
                {idx < events.length - 1 && <Divider />}
              </React.Fragment>
            );
          })}
        </Box>
      )}

      {hasMore && (
        <Box sx={{ textAlign: 'center', mt: 2 }}>
          <Button size="small" onClick={onLoadMore} disabled={loading}>
            {loading ? 'Loading...' : 'Load more'}
          </Button>
        </Box>
      )}
    </Paper>
  );
};

export default ProjectTimeline;
