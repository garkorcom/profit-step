import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, Typography, Box, CircularProgress, Divider, Grid, IconButton, Tooltip, Chip } from '@mui/material';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import AddIcon from '@mui/icons-material/Add';
import { format } from 'date-fns';

interface UrgentTask {
    id: string;
    title: string;
    assignee: string;
    deadline?: Date;
    priority: 'high' | 'medium' | 'low' | 'none';
}

interface TasksWidgetProps {
    data: {
        inProgress: number;
        overdue: number;
        completedToday: number;
        urgentTasks: UrgentTask[];
        loading: boolean;
    };
    onAddTask: () => void;
}

const MetricDisplay: React.FC<{ label: string; value: string | number; color?: 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning', alert?: boolean, sublabel?: string }> = ({ label, value, color = 'primary', alert, sublabel }) => (
    <Box>
        <Typography variant="body2" color="text.secondary">{label}</Typography>
        <Typography variant="h5" color={alert ? 'error.main' : `${color}.main`} sx={{ fontWeight: 600, my: 0.5 }}>{value}</Typography>
        {sublabel && <Typography variant="caption" color="text.secondary">{sublabel}</Typography>}
    </Box>
);

const TaskRow: React.FC<UrgentTask> = ({ title, assignee, deadline, priority }) => (
    <Box sx={{ display: 'flex', flexDirection: 'column', py: 1, borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 'none' } }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Typography variant="body2" sx={{ fontWeight: 500, maxWidth: '70%', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }} title={title}>
                {title}
            </Typography>
            {priority === 'high' && <Chip label="High" size="small" color="error" sx={{ height: 20, fontSize: '0.65rem' }} />}
            {priority === 'medium' && <Chip label="Med" size="small" color="warning" sx={{ height: 20, fontSize: '0.65rem' }} />}
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0.5 }}>
            <Typography variant="caption" color="text.secondary">{assignee}</Typography>
            {deadline && (
                <Typography variant="caption" color={deadline.getTime() < Date.now() ? 'error.main' : 'text.secondary'}>
                    {format(deadline, 'dd MMM, HH:mm')}
                </Typography>
            )}
        </Box>
    </Box>
);

export const TasksWidget: React.FC<TasksWidgetProps> = ({ data, onAddTask }) => {
    const navigate = useNavigate();

    return (
        <Card
            sx={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                transition: 'transform 0.2s, box-shadow 0.2s',
                '&:hover': {
                    boxShadow: 4
                }
            }}
        >
            <CardContent sx={{ flex: 1, p: 3, display: 'flex', flexDirection: 'column' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <Box sx={{
                        bgcolor: 'warning.50',
                        color: 'warning.main',
                        p: 1,
                        borderRadius: 2,
                        display: 'flex',
                        mr: 2,
                        cursor: 'pointer'
                    }} onClick={() => navigate('/crm/tasks')}>
                        <CheckBoxIcon />
                    </Box>
                    <Typography
                        variant="h6"
                        component="div"
                        sx={{ flex: 1, fontWeight: 600, cursor: 'pointer' }}
                        onClick={() => navigate('/crm/tasks')}
                    >
                        Задачи & Проекты
                    </Typography>

                    {data.loading ? (
                        <CircularProgress size={20} sx={{ mr: 1 }} />
                    ) : (
                        <Tooltip title="Быстрая задача">
                            <IconButton
                                size="small"
                                color="primary"
                                onClick={onAddTask}
                                sx={{ bgcolor: 'primary.50' }}
                            >
                                <AddIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    )}
                </Box>

                <Grid container spacing={2} sx={{ mb: 2, cursor: 'pointer' }} onClick={() => navigate('/crm/tasks')}>
                    <Grid size={{ xs: 4 }}>
                        <MetricDisplay
                            label="В работе"
                            value={data.inProgress}
                            color="info"
                        />
                    </Grid>
                    <Grid size={{ xs: 4 }}>
                        <MetricDisplay
                            label="Просрочено"
                            value={data.overdue}
                            color="error"
                            alert={data.overdue > 0}
                        />
                    </Grid>
                    <Grid size={{ xs: 4 }}>
                        <MetricDisplay
                            label="Выполнено"
                            value={data.completedToday}
                            color="success"
                            sublabel="сегодня"
                        />
                    </Grid>
                </Grid>

                <Divider sx={{ my: 1 }} />

                <Box sx={{ mt: 1, flex: 1, display: 'flex', flexDirection: 'column' }} onClick={() => navigate('/crm/tasks')} style={{ cursor: 'pointer' }}>
                    <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>Срочные задачи</Typography>
                    {data.urgentTasks.length > 0 ? (
                        <Box sx={{ flex: 1, overflowY: 'auto' }}>
                            {data.urgentTasks.map(task => (
                                <TaskRow key={task.id} {...task} />
                            ))}
                        </Box>
                    ) : (
                        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Typography variant="body2" color="text.disabled">Горящих задач нет 🎉</Typography>
                        </Box>
                    )}
                </Box>
            </CardContent>
        </Card>
    );
};
