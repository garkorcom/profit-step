import React from 'react';
import { Paper, Stack, Typography, Button, Chip, IconButton, Tooltip, Box } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import PeopleIcon from '@mui/icons-material/People';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import StarIcon from '@mui/icons-material/Star';
import EventBusyIcon from '@mui/icons-material/EventBusy';

interface Props {
    stats: {
        total: number;
        active: number;
        vip: number;
        churned: number;
        atRisk: number;
    };
    onAdd: () => void;
    onRefresh: () => void;
    isMobile: boolean;
}

const ClientsPageHeader: React.FC<Props> = ({ stats, onAdd, onRefresh, isMobile }) => {
    return (
        <Paper
            elevation={0}
            variant="outlined"
            sx={{
                p: { xs: 2, md: 2.5 },
                mb: 2,
                borderRadius: 2,
                display: 'flex',
                flexDirection: { xs: 'column', sm: 'row' },
                alignItems: { xs: 'stretch', sm: 'center' },
                gap: 2,
            }}
        >
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" alignItems="center" spacing={1.5} mb={1}>
                    <Typography variant="h5" fontWeight={700}>
                        Клиенты
                    </Typography>
                    <Chip
                        icon={<PeopleIcon sx={{ fontSize: 14 }} />}
                        label={`${stats.total} всего`}
                        size="small"
                        variant="outlined"
                    />
                </Stack>
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                    {stats.active > 0 && (
                        <Chip
                            icon={<CheckCircleOutlineIcon sx={{ fontSize: 14 }} />}
                            label={`${stats.active} активных`}
                            size="small"
                            color="success"
                            variant="outlined"
                        />
                    )}
                    {stats.vip > 0 && (
                        <Chip
                            icon={<StarIcon sx={{ fontSize: 14 }} />}
                            label={`${stats.vip} VIP`}
                            size="small"
                            sx={{
                                borderColor: '#ff9800',
                                color: '#ff9800',
                                bgcolor: 'transparent',
                            }}
                            variant="outlined"
                        />
                    )}
                    {stats.atRisk > 0 && (
                        <Chip
                            icon={<WarningAmberIcon sx={{ fontSize: 14 }} />}
                            label={`${stats.atRisk} под риском`}
                            size="small"
                            color="error"
                            variant="outlined"
                        />
                    )}
                    {stats.churned > 0 && (
                        <Chip
                            icon={<EventBusyIcon sx={{ fontSize: 14 }} />}
                            label={`${stats.churned} ушедших`}
                            size="small"
                            variant="outlined"
                        />
                    )}
                </Stack>
            </Box>

            <Stack direction="row" spacing={1} alignItems="center">
                <Tooltip title="Обновить">
                    <IconButton onClick={onRefresh} size="small">
                        <RefreshIcon />
                    </IconButton>
                </Tooltip>
                <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={onAdd}
                    sx={{ textTransform: 'none', fontWeight: 600 }}
                >
                    {isMobile ? 'Новый' : 'Добавить клиента'}
                </Button>
            </Stack>
        </Paper>
    );
};

export default ClientsPageHeader;
