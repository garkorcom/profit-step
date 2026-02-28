import React from 'react';
import { Card, CardContent, Typography, Box, CircularProgress, Chip, Avatar } from '@mui/material';
import { ActivityEvent } from '../../../hooks/dashboard/useDashboardActivity';
import { useNavigate } from 'react-router-dom';
import TimelineIcon from '@mui/icons-material/Timeline';

interface ActivityFeedWidgetProps {
    data: {
        activities: ActivityEvent[];
        loading: boolean;
    };
    filterType: string;
    onFilterChange: (type: string) => void;
}

const FilterChip: React.FC<{ label: string; active: boolean; onClick: () => void }> = ({ label, active, onClick }) => (
    <Chip
        label={label}
        onClick={onClick}
        color={active ? "primary" : "default"}
        variant={active ? "filled" : "outlined"}
        size="small"
        sx={{ mr: 1, mb: 1 }}
    />
);

export const ActivityFeedWidget: React.FC<ActivityFeedWidgetProps> = ({ data, filterType, onFilterChange }) => {
    const navigate = useNavigate();

    return (
        <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <CardContent sx={{ flex: 1, p: 3, display: 'flex', flexDirection: 'column' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <Box sx={{
                        bgcolor: 'secondary.50',
                        color: 'secondary.main',
                        p: 1,
                        borderRadius: 2,
                        display: 'flex',
                        mr: 2
                    }}>
                        <TimelineIcon />
                    </Box>
                    <Typography variant="h6" component="div" sx={{ flex: 1, fontWeight: 600 }}>
                        Лента активности
                    </Typography>
                    {data.loading && <CircularProgress size={20} />}
                </Box>

                <Box sx={{ mb: 2, display: 'flex', flexWrap: 'wrap' }}>
                    <FilterChip label="Все" active={filterType === 'all'} onClick={() => onFilterChange('all')} />
                    <FilterChip label="Сделки" active={filterType === 'deals'} onClick={() => onFilterChange('deals')} />
                    <FilterChip label="Задачи" active={filterType === 'tasks'} onClick={() => onFilterChange('tasks')} />
                    <FilterChip label="Финансы" active={filterType === 'finance'} onClick={() => onFilterChange('finance')} />
                    <FilterChip label="Пользователи" active={filterType === 'users'} onClick={() => onFilterChange('users')} />
                </Box>

                <Box sx={{ flex: 1, overflowY: 'auto', pr: 1 }}>
                    {data.activities.length > 0 ? (
                        data.activities.map((event) => (
                            <Box key={event.id} sx={{ display: 'flex', mb: 2, '&:last-child': { mb: 0 } }}>
                                <Avatar
                                    src={event.user.avatar}
                                    sx={{ width: 32, height: 32, mr: 2, bgcolor: 'grey.200', color: 'text.secondary', fontSize: '1rem' }}
                                >
                                    {event.icon || event.user.name.charAt(0)}
                                </Avatar>
                                <Box sx={{ flex: 1 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap' }}>
                                        <Typography variant="body2" sx={{ fontWeight: 600, mr: 0.5 }}>
                                            {event.user.name}
                                        </Typography>
                                        <Typography variant="body2" color="text.secondary" sx={{ mr: 0.5 }}>
                                            {event.action}
                                        </Typography>
                                        {event.target && (
                                            <Typography
                                                variant="body2"
                                                color="primary"
                                                sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                                                onClick={() => navigate(event.target!.link)}
                                            >
                                                {event.target.title}
                                            </Typography>
                                        )}
                                    </Box>
                                    <Typography variant="caption" color="text.disabled">
                                        {event.timeAgo}
                                    </Typography>
                                </Box>
                            </Box>
                        ))
                    ) : (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                            {!data.loading && <Typography variant="body2" color="text.disabled">Нет активности по выбранному фильтру</Typography>}
                        </Box>
                    )}
                </Box>
            </CardContent>
        </Card>
    );
};
