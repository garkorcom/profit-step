import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, Typography, Box, CircularProgress, Divider, IconButton, Tooltip } from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import MonetizationOnIcon from '@mui/icons-material/MonetizationOn';

interface MetricRowProps {
    label: string;
    value: string | number;
    trend?: string;
    trendUp?: boolean;
    highlighted?: boolean;
}

const MetricRow: React.FC<MetricRowProps> = ({ label, value, trend, trendUp, highlighted }) => (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1.5 }}>
        <Typography variant={highlighted ? "subtitle1" : "body2"} color={highlighted ? "text.primary" : "text.secondary"} sx={{ fontWeight: highlighted ? 600 : 400 }}>
            {label}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {trend && (
                <Box sx={{ display: 'flex', alignItems: 'center', color: trendUp ? 'success.main' : 'error.main', fontSize: '0.875rem', bgcolor: trendUp ? 'success.50' : 'error.50', px: 1, borderRadius: 1 }}>
                    {trendUp ? <TrendingUpIcon fontSize="small" sx={{ mr: 0.5 }} /> : <TrendingDownIcon fontSize="small" sx={{ mr: 0.5 }} />}
                    {trend}
                </Box>
            )}
            <Typography variant={highlighted ? "subtitle1" : "body1"} sx={{ fontWeight: highlighted ? 700 : 500 }}>
                {value}
            </Typography>
        </Box>
    </Box>
);

interface FinanceWidgetProps {
    data: {
        balance: number;
        income: number;
        expenses: number;
        profit: number;
        trend: {
            balance: number;
            income: number;
            expenses: number;
            profit: number;
        };
        loading: boolean;
    };
}

const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
};

const formatTrend = (percent: number) => {
    const abs = Math.abs(percent);
    // If it's finite, format to 1 decimal place. Otherwise show empty or just symbol.
    return isFinite(abs) ? `${abs.toFixed(1)}%` : '0%';
};

export const FinanceWidget: React.FC<FinanceWidgetProps> = ({ data }) => {
    const navigate = useNavigate();

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
            onClick={() => navigate('/crm/finance')}
        >
            <CardContent sx={{ flex: 1, p: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <Box sx={{
                        bgcolor: 'primary.50',
                        color: 'primary.main',
                        p: 1,
                        borderRadius: 2,
                        display: 'flex',
                        mr: 2
                    }}>
                        <MonetizationOnIcon />
                    </Box>
                    <Typography variant="h6" component="div" sx={{ flex: 1, fontWeight: 600 }}>
                        Финансы (Текущий месяц)
                    </Typography>
                    {data.loading && <CircularProgress size={20} />}
                </Box>

                <Box sx={{ mt: 2 }}>
                    <MetricRow
                        label="Доход"
                        value={formatCurrency(data.income)}
                        trend={formatTrend(data.trend.income)}
                        trendUp={data.trend.income >= 0}
                    />
                    <MetricRow
                        label="Расходы"
                        value={formatCurrency(data.expenses)}
                        trend={formatTrend(data.trend.expenses)}
                        trendUp={data.trend.expenses <= 0} // less expenses is "up" / good
                    />
                    <Divider sx={{ my: 1 }} />
                    <MetricRow
                        label="Чистая прибыль"
                        value={formatCurrency(data.profit)}
                        trend={formatTrend(data.trend.profit)}
                        trendUp={data.trend.profit >= 0}
                        highlighted={true}
                    />
                </Box>
            </CardContent>
        </Card>
    );
};
