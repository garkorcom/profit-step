/**
 * @fileoverview Slide-over панель с информацией о пользователе
 * Открывается справа при клике на строку таблицы
 */

import React, { useState, useEffect } from 'react';
import {
    Drawer,
    Box,
    Typography,
    Avatar,
    IconButton,
    Divider,
    Button,
    List,
    ListItem,
    ListItemIcon,
    ListItemText,
    Chip,
    CircularProgress,
} from '@mui/material';
import {
    Close as CloseIcon,
    Email as EmailIcon,
    Phone as PhoneIcon,
    Lock as LockIcon,
    Edit as EditIcon,
    Block as BlockIcon,
    History as HistoryIcon,
    } from '@mui/icons-material';
import { UserProfile, DEPARTMENT_LABELS } from '../../types/user.types';
import StatusIndicator, { type StatusIndicatorStatus } from '../common/StatusIndicator';

import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Timestamp } from 'firebase/firestore';

interface UserSlideOverProps {
    user: UserProfile | null;
    open: boolean;
    onClose: () => void;
    onEdit: (user: UserProfile) => void;
    onBlock: (user: UserProfile) => void;
    onResetPassword: (user: UserProfile) => void;
}

interface UserStats {
    deals: number;
    tasks: number;
    loading: boolean;
}

interface ActivityItem {
    id: string;
    action: string;
    timestamp: Date;
}

const UserSlideOver: React.FC<UserSlideOverProps> = ({
    user,
    open,
    onClose,
    onEdit,
    onBlock,
    onResetPassword,
}) => {
    const [stats, setStats] = useState<UserStats>({ deals: 0, tasks: 0, loading: true });
    const [activities, setActivities] = useState<ActivityItem[]>([]);

    // Load user stats
    useEffect(() => {
        const loadStats = async () => {
            if (!user) return;

            setStats(prev => ({ ...prev, loading: true }));

            try {
                // Deals count
                const dealsQuery = query(
                    collection(db, 'deals'),
                    where('assignedTo', '==', user.id)
                );
                const dealsSnap = await getDocs(dealsQuery);

                // Tasks count
                const tasksQuery = query(
                    collection(db, 'gtd_tasks'),
                    where('ownerId', '==', user.id),
                    where('status', '!=', 'done')
                );
                const tasksSnap = await getDocs(tasksQuery);

                setStats({
                    deals: dealsSnap.size,
                    tasks: tasksSnap.size,
                    loading: false,
                });
            } catch (err) {
                console.error('Error loading user stats:', err);
                setStats({ deals: 0, tasks: 0, loading: false });
            }
        };

        if (open && user) {
            loadStats();
        }
    }, [open, user]);

    // Load recent activity (mock for now)
    useEffect(() => {
        if (user) {
            // Mock activity data
            setActivities([
                { id: '1', action: 'Вошёл в систему', timestamp: new Date() },
                { id: '2', action: 'Обновил сделку #123', timestamp: new Date(Date.now() - 3600000) },
                { id: '3', action: 'Создал задачу', timestamp: new Date(Date.now() - 86400000) },
            ]);
        }
    }, [user]);

    if (!user) return null;

    // Handle both Timestamp and string for lastSeen
    const getLastSeenDate = (): Date | null => {
        if (!user.lastSeen) return null;
        if (user.lastSeen instanceof Timestamp) {
            return user.lastSeen.toDate();
        }
        return new Date(user.lastSeen);
    };

    const lastSeenDate = getLastSeenDate();
    const isOnline = lastSeenDate
        ? (new Date().getTime() - lastSeenDate.getTime()) < 5 * 60 * 1000
        : false;

    return (
        <Drawer
            anchor="right"
            open={open}
            onClose={onClose}
            PaperProps={{
                sx: { width: { xs: '100%', sm: 400 } }
            }}
        >
            {/* Header */}
            <Box sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                p: 2,
                borderBottom: 1,
                borderColor: 'divider',
            }}>
                <Typography variant="h6">Профиль</Typography>
                <IconButton onClick={onClose} size="small">
                    <CloseIcon />
                </IconButton>
            </Box>

            <Box sx={{ p: 3 }}>
                {/* User Info */}
                <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
                    <Avatar
                        src={user.photoURL}
                        sx={{ width: 80, height: 80, fontSize: 32 }}
                    >
                        {user.displayName?.charAt(0).toUpperCase()}
                    </Avatar>
                    <Box sx={{ flex: 1 }}>
                        <Typography variant="h6" fontWeight={600}>
                            {user.displayName}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                            {user.title || 'Без должности'}
                        </Typography>
                        <StatusIndicator
                            status={user.status as StatusIndicatorStatus}
                            isOnline={isOnline}
                            size="small"
                        />
                    </Box>
                </Box>

                {/* Contact Info */}
                <Box sx={{ mb: 3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <EmailIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                        <Typography variant="body2">{user.email}</Typography>
                    </Box>
                    {user.phone && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                            <PhoneIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                            <Typography variant="body2">{user.phone}</Typography>
                        </Box>
                    )}
                    <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
                        <Chip label={user.role} size="small" color="primary" variant="outlined" />
                        {user.department && (
                            <Chip
                                label={DEPARTMENT_LABELS[user.department]}
                                size="small"
                                variant="outlined"
                            />
                        )}
                    </Box>
                </Box>

                <Divider sx={{ my: 2 }} />

                {/* Quick Actions */}
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
                    БЫСТРЫЕ ДЕЙСТВИЯ
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 3 }}>
                    <Button
                        variant="outlined"
                        startIcon={<EditIcon />}
                        onClick={() => onEdit(user)}
                        fullWidth
                        sx={{ justifyContent: 'flex-start' }}
                    >
                        Редактировать профиль
                    </Button>
                    <Button
                        variant="outlined"
                        startIcon={<LockIcon />}
                        onClick={() => onResetPassword(user)}
                        fullWidth
                        sx={{ justifyContent: 'flex-start' }}
                    >
                        Сбросить пароль
                    </Button>
                    {user.status === 'active' && (
                        <Button
                            variant="outlined"
                            color="error"
                            startIcon={<BlockIcon />}
                            onClick={() => onBlock(user)}
                            fullWidth
                            sx={{ justifyContent: 'flex-start' }}
                        >
                            Заблокировать
                        </Button>
                    )}
                </Box>

                <Divider sx={{ my: 2 }} />

                {/* Stats */}
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
                    СТАТИСТИКА
                </Typography>
                {stats.loading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                        <CircularProgress size={24} />
                    </Box>
                ) : (
                    <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
                        <Box sx={{ flex: 1, p: 2, bgcolor: 'grey.50', borderRadius: 2, textAlign: 'center' }}>
                            <Typography variant="h5" fontWeight={600}>{stats.deals}</Typography>
                            <Typography variant="caption" color="text.secondary">сделок</Typography>
                        </Box>
                        <Box sx={{ flex: 1, p: 2, bgcolor: 'grey.50', borderRadius: 2, textAlign: 'center' }}>
                            <Typography variant="h5" fontWeight={600}>{stats.tasks}</Typography>
                            <Typography variant="caption" color="text.secondary">задач</Typography>
                        </Box>
                    </Box>
                )}

                <Divider sx={{ my: 2 }} />

                {/* Activity Log */}
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
                    ПОСЛЕДНЯЯ АКТИВНОСТЬ
                </Typography>
                <List dense disablePadding>
                    {activities.map((activity) => (
                        <ListItem key={activity.id} disablePadding sx={{ mb: 1 }}>
                            <ListItemIcon sx={{ minWidth: 32 }}>
                                <HistoryIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                            </ListItemIcon>
                            <ListItemText
                                primary={activity.action}
                                secondary={formatDistanceToNow(activity.timestamp, {
                                    addSuffix: true,
                                    locale: ru
                                })}
                                primaryTypographyProps={{ variant: 'body2' }}
                                secondaryTypographyProps={{ variant: 'caption' }}
                            />
                        </ListItem>
                    ))}
                </List>
            </Box>
        </Drawer>
    );
};

export default UserSlideOver;
