import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, Typography, Box, CircularProgress, Divider, Grid } from '@mui/material';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import { BarChart, Bar, ResponsiveContainer, Tooltip } from 'recharts';

interface TimeTrackingWidgetProps {
    data: {
        today: {
            totalHours: number;
            activeEmployees: number;
            activeSessions: number;
        };
        week: {
            totalHours: number;
            trend: number;
            dailyBreakdown: { day: string; hours: number }[];
        };
        topEmployees: { name: string; hours: number }[];
        loading: boolean;
    };
}

const MetricDisplay: React.FC<{ label: string; value: string; sublabel?: string | React.ReactNode }> = ({ label, value, sublabel }) => (
    <Box>
        <Typography variant="body2" color="text.secondary">{label}</Typography>
        <Typography variant="h5" sx={{ fontWeight: 600, my: 0.5 }}>{value}</Typography>
        {sublabel && <Typography variant="caption" color="text.secondary">{sublabel}</Typography>}
    </Box>
);

const EmployeeRow: React.FC<{ name: string; hours: number }> = ({ name, hours }) => (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.5 }}>
        <Typography variant="body2">{name}</Typography>
        <Typography variant="body2" fontWeight={600}>{hours.toFixed(1)}ч</Typography>
    </Box>
);

export const TimeTrackingWidget: React.FC<TimeTrackingWidgetProps> = ({ data }) => {
    const navigate = useNavigate();

    const trendUp = data.week.trend >= 0;

    const SubLabelTrend = (
        <Box component="span" sx={{ display: 'flex', alignItems: 'center', color: trendUp ? 'success.main' : 'error.main' }}>
            {trendUp ? <TrendingUpIcon fontSize="inherit" sx={{ mr: 0.5 }} /> : <TrendingDownIcon fontSize="inherit" sx={{ mr: 0.5 }} />}
            {Math.abs(data.week.trend).toFixed(1)}% от прошлой
        </Box>
    );

    return (
        <Card
            sx={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                cursor: 'pointer',
                transition: 'transform 0.2s, box-shadow 0.2s',
                '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: 4
                }
            }}
            onClick={() => navigate('/crm/time-tracking')}
        >
            <CardContent sx={{ flex: 1, p: 3, display: 'flex', flexDirection: 'column' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <Box sx={{
                        bgcolor: 'info.50',
                        color: 'info.main',
                        p: 1,
                        borderRadius: 2,
                        display: 'flex',
                        mr: 2
                    }}>
                        <AccessTimeIcon />
                    </Box>
                    <Typography variant="h6" component="div" sx={{ flex: 1, fontWeight: 600 }}>
                        Учет времени
                    </Typography>
                    {data.loading && <CircularProgress size={20} />}
                </Box>

                <Grid container spacing={2} sx={{ mb: 2 }}>
                    <Grid size={{ xs: 6 }}>
                        <MetricDisplay
                            label="Сегодня"
                            value={`${data.today.totalHours}ч`}
                            sublabel={`${data.today.activeEmployees} сотрудников`}
                        />
                    </Grid>
                    <Grid size={{ xs: 6 }}>
                        <MetricDisplay
                            label="Эта неделя"
                            value={`${data.week.totalHours}ч`}
                            sublabel={SubLabelTrend}
                        />
                    </Grid>
                </Grid>

                {data.today.activeSessions > 0 && (
                    <Box sx={{ mb: 2, bgcolor: 'success.50', color: 'success.main', px: 2, py: 1, borderRadius: 1, fontSize: '0.875rem', fontWeight: 500 }}>
                        <Box component="span" sx={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', bgcolor: 'success.main', mr: 1, animation: 'pulse 2s infinite' }} />
                        {data.today.activeSessions} активных сессий
                    </Box>
                )}

                <Divider sx={{ my: 1 }} />

                <Box sx={{ my: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>Топ активные сегодня</Typography>
                    {data.topEmployees.length > 0 ? (
                        data.topEmployees.map((emp, idx) => (
                            <EmployeeRow key={idx} name={emp.name} hours={emp.hours} />
                        ))
                    ) : (
                        <Typography variant="body2" color="text.disabled">Нет активности</Typography>
                    )}
                </Box>

                <Box sx={{ mt: 'auto', height: 60, width: '100%', minWidth: 0 }}>
                    <ResponsiveContainer width="100%" height={60} minWidth={0}>
                        <BarChart data={data.week.dailyBreakdown} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                            <Tooltip
                                cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                                contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                                formatter={(val: number) => [`${val}ч`, 'Часы']}
                            />
                            <Bar dataKey="hours" fill="#0288d1" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </Box>
            </CardContent>
        </Card>
    );
};
