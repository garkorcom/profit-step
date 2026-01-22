import React, { useState, useEffect } from 'react';
import {
    Box,
    Typography,
    Container,
    Button,
    Chip,
    List,
    ListItem,
    ListItemText,
    ListItemIcon,
    Checkbox,
    IconButton,
    Paper,
    Divider,
    CircularProgress,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import AssignmentIcon from '@mui/icons-material/Assignment';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import DeleteIcon from '@mui/icons-material/Delete';
import GTDBoard from '../../components/gtd/GTDBoard';
import { collection, query, where, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { useAuth } from '../../auth/AuthContext';
import { ShoppingList, toggleItemCompleted } from '../../services/shoppingListService';

type ViewMode = 'tasks' | 'shopping';

const GTDPage: React.FC = () => {
    const navigate = useNavigate();
    const { currentUser } = useAuth();
    const [viewMode, setViewMode] = useState<ViewMode>('tasks');
    const [shoppingLists, setShoppingLists] = useState<ShoppingList[]>([]);
    const [loading, setLoading] = useState(false);

    // Subscribe to shopping lists
    useEffect(() => {
        if (!currentUser?.uid || viewMode !== 'shopping') return;

        setLoading(true);
        const q = query(
            collection(db, 'shopping_lists'),
            where('status', '==', 'active')
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
    }, [currentUser?.uid, viewMode]);

    // Toggle item completion
    const handleToggleItem = async (listId: string, itemId: string, completed: boolean) => {
        await toggleItemCompleted(listId, itemId, !completed);
    };

    // Count total items
    const totalItems = shoppingLists.reduce((acc, list) => acc + (list.items?.length || 0), 0);
    const completedItems = shoppingLists.reduce((acc, list) =>
        acc + (list.items?.filter(i => i.completed)?.length || 0), 0
    );

    return (
        <Container maxWidth={false} sx={{ height: '100vh', display: 'flex', flexDirection: 'column', py: 2 }}>
            <Box mb={2} display="flex" justifyContent="space-between" alignItems="center">
                <Box>
                    <Typography variant="h4" fontWeight="bold">Lookahead Schedule</Typography>
                    <Typography variant="body2" color="text.secondary">
                        {viewMode === 'tasks'
                            ? 'GTD Planning: Drag tasks across stages. Move to \'Next Actions\' to start working.'
                            : `Списки закупок: ${totalItems} товаров (${completedItems} куплено)`
                        }
                    </Typography>
                </Box>

                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    {/* View Mode Chips */}
                    <Chip
                        icon={<AssignmentIcon />}
                        label="Задачи"
                        variant={viewMode === 'tasks' ? 'filled' : 'outlined'}
                        color={viewMode === 'tasks' ? 'primary' : 'default'}
                        onClick={() => setViewMode('tasks')}
                    />
                    <Chip
                        icon={<ShoppingCartIcon />}
                        label={`Покупки${totalItems > 0 ? ` (${totalItems - completedItems})` : ''}`}
                        variant={viewMode === 'shopping' ? 'filled' : 'outlined'}
                        color={viewMode === 'shopping' ? 'success' : 'default'}
                        onClick={() => setViewMode('shopping')}
                    />

                    <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />

                    <Button
                        variant="outlined"
                        startIcon={<CalendarMonthIcon />}
                        onClick={() => navigate('/crm/calendar')}
                    >
                        Calendar
                    </Button>

                    {viewMode === 'shopping' && (
                        <Button
                            variant="outlined"
                            color="success"
                            startIcon={<OpenInNewIcon />}
                            onClick={() => navigate('/crm/shopping')}
                        >
                            Полный вид
                        </Button>
                    )}
                </Box>
            </Box>

            <Box flexGrow={1} sx={{ overflow: 'hidden' }}>
                {viewMode === 'tasks' ? (
                    <GTDBoard />
                ) : (
                    /* Shopping Lists View */
                    <Box sx={{ height: '100%', overflow: 'auto' }}>
                        {loading ? (
                            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                                <CircularProgress />
                            </Box>
                        ) : shoppingLists.length === 0 ? (
                            <Paper sx={{ p: 4, textAlign: 'center' }}>
                                <ShoppingCartIcon sx={{ fontSize: 48, color: 'grey.400', mb: 2 }} />
                                <Typography variant="h6" color="text.secondary">
                                    Нет активных списков закупок
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                    Нажмите "+" и выберите "🛒 Купить" чтобы создать список
                                </Typography>
                            </Paper>
                        ) : (
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                                {shoppingLists.map((list) => (
                                    <Paper
                                        key={list.id}
                                        sx={{
                                            width: { xs: '100%', sm: 'calc(50% - 8px)', md: 'calc(33.33% - 11px)' },
                                            p: 2
                                        }}
                                    >
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                            <Typography variant="h6" fontWeight={600}>
                                                🛒 {list.clientName || 'Без клиента'}
                                            </Typography>
                                            <Chip
                                                size="small"
                                                label={`${list.items?.filter(i => i.completed).length || 0}/${list.items?.length || 0}`}
                                                color={list.items?.every(i => i.completed) ? 'success' : 'default'}
                                            />
                                        </Box>

                                        <List dense disablePadding>
                                            {list.items?.map((item) => (
                                                <ListItem
                                                    key={item.id}
                                                    disablePadding
                                                    sx={{
                                                        bgcolor: item.isUrgent && !item.completed ? 'error.50' : 'transparent',
                                                        borderRadius: 1,
                                                        mb: 0.5,
                                                    }}
                                                    secondaryAction={
                                                        item.isUrgent && !item.completed && (
                                                            <Chip label="Срочно" size="small" color="error" sx={{ height: 20 }} />
                                                        )
                                                    }
                                                >
                                                    <ListItemIcon sx={{ minWidth: 36 }}>
                                                        <Checkbox
                                                            edge="start"
                                                            checked={item.completed}
                                                            onChange={() => handleToggleItem(list.id, item.id, item.completed)}
                                                            size="small"
                                                        />
                                                    </ListItemIcon>
                                                    <ListItemText
                                                        primary={item.name}
                                                        secondary={`×${item.quantity}`}
                                                        sx={{
                                                            textDecoration: item.completed ? 'line-through' : 'none',
                                                            color: item.completed ? 'text.secondary' : 'text.primary',
                                                        }}
                                                    />
                                                </ListItem>
                                            ))}
                                        </List>
                                    </Paper>
                                ))}
                            </Box>
                        )}
                    </Box>
                )}
            </Box>
        </Container>
    );
};

export default GTDPage;
