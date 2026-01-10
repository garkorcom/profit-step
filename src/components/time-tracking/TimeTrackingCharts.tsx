import React from 'react';
import { Box, Paper, Typography } from '@mui/material';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as RechartsTooltip,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell
} from 'recharts';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

interface DailyActivityItem {
    date: string;
    hours: number;
    [key: string]: string | number;
}

interface ClientDistributionItem {
    name: string;
    value: number;
    [key: string]: string | number;
}

interface TimeTrackingChartsProps {
    dailyActivity: DailyActivityItem[];
    clientDistribution: ClientDistributionItem[];
}

/**
 * Charts section with Daily Activity bar chart and Client Distribution pie chart
 */
const TimeTrackingCharts: React.FC<TimeTrackingChartsProps> = ({
    dailyActivity,
    clientDistribution
}) => {
    return (
        <Box sx={{ display: 'flex', gap: 3, mb: 4, flexWrap: 'wrap' }}>
            {/* Daily Activity Bar Chart */}
            <Box sx={{ width: { xs: '100%', md: 'calc(66.6% - 12px)' }, minWidth: 0 }}>
                <Paper sx={{ p: 3, height: 400 }}>
                    <Typography variant="h6" gutterBottom>Daily Activity (Hours)</Typography>
                    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                        <BarChart data={dailyActivity}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="date" />
                            <YAxis />
                            <RechartsTooltip />
                            <Bar dataKey="hours" fill="#1976d2" radius={[4, 4, 0, 0]} name="Hours Worked" />
                        </BarChart>
                    </ResponsiveContainer>
                </Paper>
            </Box>

            {/* Client Distribution Pie Chart */}
            <Box sx={{ width: { xs: '100%', md: 'calc(33.3% - 12px)' }, minWidth: 0 }}>
                <Paper sx={{ p: 3, height: 400 }}>
                    <Typography variant="h6" gutterBottom>Client Distribution</Typography>
                    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                        <PieChart>
                            <Pie
                                data={clientDistribution}
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={100}
                                fill="#8884d8"
                                paddingAngle={5}
                                dataKey="value"
                                label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
                            >
                                {clientDistribution.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                            </Pie>
                            <RechartsTooltip />
                        </PieChart>
                    </ResponsiveContainer>
                </Paper>
            </Box>
        </Box>
    );
};

export default TimeTrackingCharts;
