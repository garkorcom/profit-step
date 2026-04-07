import React, { useMemo } from 'react';
import { Box, Typography, Paper, Alert } from '@mui/material';
import { format as formatDate } from 'date-fns';
import { ru } from 'date-fns/locale';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import EditIcon from '@mui/icons-material/Edit';
import PersonAddAltIcon from '@mui/icons-material/PersonAddAlt';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import FlagIcon from '@mui/icons-material/Flag';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';

import { GTDTask } from '../../types/gtd.types';

interface TaskHistoryTimelineProps {
    task: GTDTask;
}

interface TimelineEvent {
    id: string;
    date: Date;
    title: string;
    description?: string;
    userName?: string;
    color: string;
    icon: React.ReactNode;
    isSystem?: boolean;
}

const parseDate = (d: any): Date | null => {
    if (!d) return null;
    if (d.toDate) return d.toDate();
    return new Date(d);
};

export const TaskHistoryTimeline: React.FC<TaskHistoryTimelineProps> = ({ task }) => {

    const events = useMemo(() => {
        const evts: TimelineEvent[] = [];

        // 1. Base Task lifecycle events
        const createdAt = parseDate(task.createdAt);
        if (createdAt) {
            evts.push({
                id: 'sys_created',
                date: createdAt,
                title: 'Задача создана',
                userName: task.ownerName || 'Система',
                color: 'primary.main',
                icon: <FlagIcon fontSize="small" />,
                isSystem: true
            });
        }

        if (task.assigneeName && createdAt) {
            // we use createdAt as approximation if no other date is present for legacy tasks
            evts.push({
                id: 'sys_assigned',
                date: new Date(createdAt.getTime() + 1000), // bump slightly so it appears after created
                title: `Назначен исполнитель: ${task.assigneeName}`,
                color: 'info.main',
                icon: <PersonAddAltIcon fontSize="small" />,
                isSystem: true
            });
        }

        const startDate = parseDate(task.startDate);
        if (startDate) {
            evts.push({
                id: 'sys_start',
                date: startDate,
                title: 'План старта',
                color: 'warning.main',
                icon: <PlayCircleOutlineIcon fontSize="small" />,
                isSystem: true
            });
        }

        const dueDate = parseDate(task.dueDate);
        if (dueDate) {
            evts.push({
                id: 'sys_due',
                date: dueDate,
                title: 'Дедлайн',
                color: 'error.main',
                icon: <WarningAmberIcon fontSize="small" />,
                isSystem: true
            });
        }

        const completedAt = parseDate(task.completedAt);
        if (completedAt) {
            evts.push({
                id: 'sys_completed',
                date: completedAt,
                title: 'Задача завершена',
                color: 'success.main',
                icon: <CheckCircleOutlineIcon fontSize="small" />,
                isSystem: true
            });
        }

        // 2. Custom History Events (taskHistory array)
        if (task.taskHistory && Array.isArray(task.taskHistory)) {
            task.taskHistory.forEach((h, i) => {
                const ts = parseDate(h.timestamp);
                if (!ts) return;

                let title = h.type === 'status_changed' ? 'Смена статуса' :
                    h.type === 'assigned' ? 'Смена исполнителя' :
                        h.type === 'co_assignee_added' ? 'Добавлен со-исполнитель' :
                            h.type === 'co_assignee_removed' ? 'Удален со-исполнитель' :
                                h.type === 'materials_added' ? 'Добавлен материал' :
                                    h.type === 'ai_mutation_snapshot' ? 'AI Редактура' : 'Обновление';

                let color = 'grey.500';
                let icon = <EditIcon fontSize="small" />;

                if (h.type === 'status_changed') {
                    color = 'warning.main';
                } else if (h.type === 'ai_mutation_snapshot') {
                    color = 'success.light';
                    icon = <AutoAwesomeIcon fontSize="small" />;
                } else if (h.type === 'materials_added') {
                    color = 'secondary.main';
                    icon = <Inventory2OutlinedIcon fontSize="small" />;
                } else if (h.type?.includes('assignee')) {
                    color = 'info.main';
                    icon = <PersonAddAltIcon fontSize="small" />;
                }

                evts.push({
                    id: `hist_${i}_${ts.getTime()}`,
                    date: ts,
                    title: title,
                    description: h.description,
                    userName: h.userName,
                    color: color,
                    icon: icon
                });
            });
        }

        // 3. Sort DESCENDING (newest first)
        return evts.sort((a, b) => b.date.getTime() - a.date.getTime());
    }, [task]);

    if (events.length === 0) {
        return (
            <Alert severity="info" sx={{ mt: 2 }}>
                История изменений пуста
            </Alert>
        );
    }

    return (
        <Box sx={{ py: 2, maxHeight: '60vh', overflowY: 'auto', pr: 2 }}>
            <Box sx={{ position: 'relative', ml: 2 }}>
                {/* Vertical Line */}
                <Box
                    sx={{
                        position: 'absolute',
                        left: 15,
                        top: 20,
                        bottom: 20,
                        width: 2,
                        bgcolor: 'grey.200',
                        zIndex: 0
                    }}
                />

                {events.map((evt, _idx) => (
                    <Box key={evt.id} sx={{ display: 'flex', mb: 4, position: 'relative', zIndex: 1 }}>

                        {/* Dot / Icon container */}
                        <Box sx={{
                            width: 32,
                            height: 32,
                            borderRadius: '50%',
                            bgcolor: 'background.paper',
                            boxShadow: 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                            color: evt.color,
                            border: '2px solid',
                            borderColor: evt.color,
                            mt: 0.5
                        }}>
                            {evt.icon}
                        </Box>

                        {/* Content */}
                        <Box sx={{ ml: 2, flexGrow: 1 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                <Typography variant="subtitle2" fontWeight={600} color={evt.color}>
                                    {evt.title}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                    {formatDate(evt.date, 'dd MMM yyyy, HH:mm', { locale: ru })}
                                </Typography>
                            </Box>

                            {evt.description && (
                                <Paper elevation={0} sx={{
                                    p: 1.5,
                                    mt: 1,
                                    bgcolor: evt.isSystem ? 'transparent' : 'grey.50',
                                    border: evt.isSystem ? 'none' : '1px solid',
                                    borderColor: 'grey.200',
                                    borderRadius: 1
                                }}>
                                    <Typography variant="body2" color="text.primary">
                                        {evt.description}
                                    </Typography>
                                </Paper>
                            )}

                            {evt.userName && !evt.isSystem && (
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                                    Изм: {evt.userName}
                                </Typography>
                            )}
                        </Box>
                    </Box>
                ))}
            </Box>
        </Box>
    );
};
