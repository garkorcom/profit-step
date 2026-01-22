/**
 * @fileoverview Shopping Lists Page
 * 
 * Full-featured shopping list management with:
 * - Group by client
 * - Mark items as purchased
 * - Archive completed lists
 * - Assign to procurement team
 */

import React, { useState, useEffect } from 'react';
import {
    Box,
    Typography,
    Container,
    Paper,
    List,
    ListItem,
    ListItemText,
    ListItemIcon,
    Checkbox,
    IconButton,
    Chip,
    Button,
    Divider,
    CircularProgress,
    Menu,
    MenuItem,
    Tabs,
    Tab,
    Badge,
} from '@mui/material';
import {
    ShoppingCart as ShoppingCartIcon,
    MoreVert as MoreVertIcon,
    Check as CheckIcon,
    Archive as ArchiveIcon,
    Delete as DeleteIcon,
    ArrowBack as ArrowBackIcon,
    Person as PersonIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, onSnapshot, doc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { useAuth } from '../../auth/AuthContext';
import { ShoppingList, toggleItemCompleted, completeShoppingList } from '../../services/shoppingListService';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

type TabValue = 'active' | 'completed';

const ShoppingPage: React.FC = () => {
    const navigate = useNavigate();
    const { currentUser } = useAuth();
    const [tabValue, setTabValue] = useState<TabValue>('active');
    const [shoppingLists, setShoppingLists] = useState<ShoppingList[]>([]);
    const [loading, setLoading] = useState(true);
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const [selectedListId, setSelectedListId] = useState<string | null>(null);

    // Subscribe to shopping lists
    useEffect(() => {
        if (!currentUser?.uid) return;

        const status = tabValue === 'active' ? 'active' : 'completed';
        const q = query(
            collection(db, 'shopping_lists'),
            where('status', '==', status)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const lists = snapshot.docs.map(d => ({
                id: d.id,
                ...d.data()
            } as ShoppingList));
            setShoppingLists(lists);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [currentUser?.uid, tabValue]);

    // Handle menu
    const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, listId: string) => {
        setAnchorEl(event.currentTarget);
        setSelectedListId(listId);
    };

    const handleMenuClose = () => {
        setAnchorEl(null);
        setSelectedListId(null);
    };

    // Actions
    const handleToggleItem = async (listId: string, itemId: string, completed: boolean) => {
        await toggleItemCompleted(listId, itemId, !completed);
    };

    const handleCompleteList = async () => {
        if (selectedListId) {
            await completeShoppingList(selectedListId);
        }
        handleMenuClose();
    };

    const handleDeleteList = async () => {
        if (selectedListId) {
            await deleteDoc(doc(db, 'shopping_lists', selectedListId));
        }
        handleMenuClose();
    };

    // Stats
    const totalItems = shoppingLists.reduce((acc, list) => acc + (list.items?.length || 0), 0);
    const completedItems = shoppingLists.reduce((acc, list) =>
        acc + (list.items?.filter(i => i.completed)?.length || 0), 0
    );
    const urgentItems = shoppingLists.reduce((acc, list) =>
        acc + (list.items?.filter(i => i.isUrgent && !i.completed)?.length || 0), 0
    );

    return (
        <Container maxWidth="lg" sx={{ py: 3 }}>
            {/* Header */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                <IconButton onClick={() => navigate('/crm/gtd')}>
                    <ArrowBackIcon />
                </IconButton>
                <Box sx={{ flex: 1 }}>
                    <Typography variant="h4" fontWeight="bold">
                        🛒 Списки закупок
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        {tabValue === 'active'
                            ? `${totalItems} товаров • ${completedItems} куплено • ${urgentItems} срочных`
                            : `${shoppingLists.length} завершённых списков`
                        }
                    </Typography>
                </Box>
                <Button
                    variant="contained"
                    startIcon={<ShoppingCartIcon />}
                    onClick={() => navigate('/crm/gtd')}
                >
                    Добавить список
                </Button>
            </Box>

            {/* Tabs */}
            <Tabs
                value={tabValue}
                onChange={(_, v) => setTabValue(v)}
                sx={{ mb: 3 }}
            >
                <Tab
                    label={
                        <Badge badgeContent={urgentItems} color="error">
                            Активные
                        </Badge>
                    }
                    value="active"
                />
                <Tab label="Завершённые" value="completed" />
            </Tabs>

            {/* Content */}
            {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                    <CircularProgress />
                </Box>
            ) : shoppingLists.length === 0 ? (
                <Paper sx={{ p: 6, textAlign: 'center' }}>
                    <ShoppingCartIcon sx={{ fontSize: 64, color: 'grey.300', mb: 2 }} />
                    <Typography variant="h6" color="text.secondary" gutterBottom>
                        {tabValue === 'active'
                            ? 'Нет активных списков закупок'
                            : 'Нет завершённых списков'
                        }
                    </Typography>
                    {tabValue === 'active' && (
                        <Typography variant="body2" color="text.secondary">
                            Перейдите в GTD → нажмите "+" → выберите "🛒 Купить"
                        </Typography>
                    )}
                </Paper>
            ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {shoppingLists.map((list) => {
                        const listCompleted = list.items?.filter(i => i.completed).length || 0;
                        const listTotal = list.items?.length || 0;
                        const allDone = listCompleted === listTotal && listTotal > 0;

                        return (
                            <Paper key={list.id} sx={{ p: 2 }}>
                                {/* List Header */}
                                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                                    <ShoppingCartIcon
                                        sx={{
                                            mr: 1.5,
                                            color: allDone ? 'success.main' : 'primary.main'
                                        }}
                                    />
                                    <Box sx={{ flex: 1 }}>
                                        <Typography variant="h6" fontWeight={600}>
                                            {list.clientName || 'Без клиента'}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {list.createdAt && format(
                                                new Date(list.createdAt.seconds * 1000),
                                                'd MMM yyyy, HH:mm',
                                                { locale: ru }
                                            )}
                                        </Typography>
                                    </Box>

                                    <Chip
                                        label={`${listCompleted}/${listTotal}`}
                                        color={allDone ? 'success' : 'default'}
                                        size="small"
                                        sx={{ mr: 1 }}
                                    />

                                    {tabValue === 'active' && (
                                        <IconButton
                                            size="small"
                                            onClick={(e) => handleMenuOpen(e, list.id)}
                                        >
                                            <MoreVertIcon />
                                        </IconButton>
                                    )}
                                </Box>

                                <Divider sx={{ mb: 1 }} />

                                {/* Items */}
                                <List dense disablePadding>
                                    {list.items?.map((item) => (
                                        <ListItem
                                            key={item.id}
                                            disablePadding
                                            sx={{
                                                bgcolor: item.isUrgent && !item.completed ? 'error.50' : 'transparent',
                                                borderRadius: 1,
                                                mb: 0.5,
                                                pr: item.isUrgent && !item.completed ? 10 : 0,
                                            }}
                                            secondaryAction={
                                                item.isUrgent && !item.completed && (
                                                    <Chip
                                                        label="Срочно"
                                                        size="small"
                                                        color="error"
                                                        sx={{ height: 20 }}
                                                    />
                                                )
                                            }
                                        >
                                            <ListItemIcon sx={{ minWidth: 36 }}>
                                                <Checkbox
                                                    edge="start"
                                                    checked={item.completed}
                                                    onChange={() => handleToggleItem(list.id, item.id, item.completed)}
                                                    size="small"
                                                    disabled={tabValue === 'completed'}
                                                />
                                            </ListItemIcon>
                                            <ListItemText
                                                primary={
                                                    <Typography
                                                        variant="body2"
                                                        sx={{
                                                            textDecoration: item.completed ? 'line-through' : 'none',
                                                            color: item.completed ? 'text.disabled' : 'text.primary',
                                                        }}
                                                    >
                                                        {item.name}
                                                    </Typography>
                                                }
                                                secondary={`×${item.quantity}`}
                                            />
                                        </ListItem>
                                    ))}
                                </List>

                                {/* Quick Actions for Active Lists */}
                                {tabValue === 'active' && allDone && (
                                    <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
                                        <Button
                                            variant="contained"
                                            color="success"
                                            size="small"
                                            startIcon={<CheckIcon />}
                                            onClick={() => {
                                                setSelectedListId(list.id);
                                                handleCompleteList();
                                            }}
                                        >
                                            Завершить список
                                        </Button>
                                    </Box>
                                )}
                            </Paper>
                        );
                    })}
                </Box>
            )}

            {/* Context Menu */}
            <Menu
                anchorEl={anchorEl}
                open={Boolean(anchorEl)}
                onClose={handleMenuClose}
            >
                <MenuItem onClick={handleCompleteList}>
                    <ArchiveIcon sx={{ mr: 1 }} /> Завершить
                </MenuItem>
                <MenuItem onClick={handleDeleteList} sx={{ color: 'error.main' }}>
                    <DeleteIcon sx={{ mr: 1 }} /> Удалить
                </MenuItem>
            </Menu>
        </Container>
    );
};

export default ShoppingPage;
