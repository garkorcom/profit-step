/**
 * @fileoverview Shopping Page
 * 
 * Dedicated shopping lists management page.
 * Features:
 * - View active and completed lists
 * - Search and filter
 * - Create new lists directly
 * - Mark items as purchased
 * - Edit, delete, complete lists
 */

import React, { useState, useMemo } from 'react';
import {
    Box,
    Typography,
    Container,
    Paper,
    Button,
    Tabs,
    Tab,
    Badge,
    IconButton,
    CircularProgress,
    Menu,
    MenuItem,
    TextField,
    InputAdornment,
    Chip,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Autocomplete,
} from '@mui/material';
import {
    ShoppingCart as ShoppingCartIcon,
    ArrowBack as ArrowBackIcon,
    MoreVert as MoreVertIcon,
    Check as CheckIcon,
    Delete as DeleteIcon,
    Add as AddIcon,
    Search as SearchIcon,
    FilterList as FilterIcon,
    Close as CloseIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { nanoid } from 'nanoid';
import {
    useShoppingLists,
    ShoppingListCard,
    EditItemDialog,
    SelectClientDialog,
    ShoppingItem,
    archiveShoppingList,
    saveShoppingList,
} from '../../features/shopping';
import { ReceiptsTabView } from '../../features/shopping/views/ReceiptsTabView';
import { useClients } from '../../features/shopping/hooks/useClients';
import { useAuth } from '../../auth/AuthContext';

type TabValue = 'active' | 'completed' | 'receipts';

const ShoppingPage: React.FC = () => {
    const navigate = useNavigate();
    const { currentUser } = useAuth();
    const [tabValue, setTabValue] = useState<TabValue>('active');
    const [searchQuery, setSearchQuery] = useState('');
    const [showUrgentOnly, setShowUrgentOnly] = useState(false);

    // Use hooks for active and completed lists
    const activeLists = useShoppingLists({ statusFilter: 'active' });
    const completedLists = useShoppingLists({ statusFilter: 'completed' });

    // Current lists based on tab
    const currentHook = tabValue === 'active' ? activeLists : completedLists;
    const { lists, loading, stats: _stats, toggleItem, updateItem, deleteItem, addItems, updateClient, completeList } = currentHook;

    // Create dialog state
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [newListClient, setNewListClient] = useState<{ id: string; name: string } | null>(null);
    const [newItems, setNewItems] = useState<ShoppingItem[]>([]);
    const [newItemName, setNewItemName] = useState('');
    const [creating, setCreating] = useState(false);
    const { clients } = useClients();

    // Edit dialog state
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<ShoppingItem | null>(null);
    const [editingListId, setEditingListId] = useState<string | null>(null);

    // Client dialog state
    const [clientDialogOpen, setClientDialogOpen] = useState(false);
    const [clientEditListId, setClientEditListId] = useState<string | null>(null);
    const [clientEditCurrentName, setClientEditCurrentName] = useState('');

    // Menu state
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const [selectedListId, setSelectedListId] = useState<string | null>(null);

    // Filter lists by search and urgent filter
    const filteredLists = useMemo(() => {
        let result = lists;

        // Search filter
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            result = result.filter(list =>
                list.clientName?.toLowerCase().includes(query) ||
                list.items?.some(item => item.name.toLowerCase().includes(query))
            );
        }

        // Urgent filter
        if (showUrgentOnly) {
            result = result.filter(list =>
                list.items?.some(item => item.isUrgent && !item.completed)
            );
        }

        return result;
    }, [lists, searchQuery, showUrgentOnly]);

    // Stats for badges
    const urgentItems = activeLists.lists.reduce(
        (acc, list) => acc + (list.items?.filter(i => i.isUrgent && !i.completed)?.length || 0),
        0
    );

    // Handlers
    const handleEditItem = (listId: string, item: ShoppingItem) => {
        setEditingListId(listId);
        setEditingItem(item);
        setEditDialogOpen(true);
    };

    const handleSaveItem = async (updates: Partial<ShoppingItem>) => {
        if (!editingListId || !editingItem) return;
        await updateItem(editingListId, editingItem.id, updates);
    };

    const handleDeleteItemFromDialog = async () => {
        if (!editingListId || !editingItem) return;
        await deleteItem(editingListId, editingItem.id);
    };

    const handleAddItem = async (listId: string) => {
        const newItem: ShoppingItem = {
            id: nanoid(),
            name: 'Новый товар',
            quantity: 1,
            isUrgent: false,
            completed: false,
        };
        await addItems(listId, [newItem]);
        setEditingListId(listId);
        setEditingItem(newItem);
        setEditDialogOpen(true);
    };

    const handleEditClient = (listId: string, currentName: string) => {
        setClientEditListId(listId);
        setClientEditCurrentName(currentName);
        setClientDialogOpen(true);
    };

    const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, listId: string) => {
        setAnchorEl(event.currentTarget);
        setSelectedListId(listId);
    };

    const handleMenuClose = () => {
        setAnchorEl(null);
        setSelectedListId(null);
    };

    const handleCompleteList = async () => {
        if (selectedListId) {
            await completeList(selectedListId);
        }
        handleMenuClose();
    };

    const handleDeleteList = async () => {
        if (selectedListId) {
            await archiveShoppingList(selectedListId);
        }
        handleMenuClose();
    };

    // Create dialog handlers
    const handleAddNewItem = () => {
        if (!newItemName.trim()) return;
        const item: ShoppingItem = {
            id: nanoid(),
            name: newItemName.trim(),
            quantity: 1,
            isUrgent: false,
            completed: false,
        };
        setNewItems(prev => [...prev, item]);
        setNewItemName('');
    };

    const handleCreateList = async () => {
        if (!newListClient || newItems.length === 0 || !currentUser?.uid) return;

        setCreating(true);
        try {
            await saveShoppingList(
                newItems,
                newListClient.id,
                currentUser.uid
            );
            setCreateDialogOpen(false);
            setNewListClient(null);
            setNewItems([]);
        } catch (error) {
            console.error('Failed to create list:', error);
        } finally {
            setCreating(false);
        }
    };

    return (
        /**
         * MOBILE-FIRST LAYOUT (2026-01-26):
         * - Container maxWidth="sm" = 600px centered
         * - Single-column card layout (flexDirection: column)
         * - Sticky header with search/tabs for easy navigation
         * - Cards use width: 100% (see ShoppingListCard.tsx)
         */
        <Container maxWidth="sm" sx={{ py: 3 }}>
            {/* Header Section */}
            <Box sx={{
                position: 'sticky',
                top: 64,
                bgcolor: 'background.default',
                zIndex: 10,
                pb: 2
            }}>
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
                                ? `${activeLists.stats.totalItems} товаров • ${activeLists.stats.completedItems} куплено • ${urgentItems} срочных`
                                : `${completedLists.stats.totalLists} завершённых списков`
                            }
                        </Typography>
                    </Box>
                    <Button
                        variant="contained"
                        startIcon={<AddIcon />}
                        onClick={() => setCreateDialogOpen(true)}
                    >
                        Новый список
                    </Button>
                </Box>

                {/* Search & Filters */}
                <Box sx={{ display: 'flex', gap: 2, mb: 3, alignItems: 'center' }}>
                    <TextField
                        size="small"
                        placeholder="Поиск по клиенту или товару..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        sx={{ flex: 1 }}
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <SearchIcon color="action" />
                                </InputAdornment>
                            ),
                            endAdornment: searchQuery && (
                                <InputAdornment position="end">
                                    <IconButton size="small" onClick={() => setSearchQuery('')}>
                                        <CloseIcon fontSize="small" />
                                    </IconButton>
                                </InputAdornment>
                            ),
                        }}
                    />
                    <Chip
                        icon={<FilterIcon />}
                        label="🔴 Срочные"
                        variant={showUrgentOnly ? 'filled' : 'outlined'}
                        color={showUrgentOnly ? 'error' : 'default'}
                        onClick={() => setShowUrgentOnly(!showUrgentOnly)}
                    />
                </Box>

                <Tabs
                    value={tabValue}
                    onChange={(_, v) => setTabValue(v)}
                    sx={{ mb: 3 }}
                >
                    <Tab
                        label={
                            <Badge badgeContent={urgentItems} color="error">
                                Активные ({activeLists.stats.totalLists})
                            </Badge>
                        }
                        value="active"
                    />
                    <Tab
                        label={`Завершённые (${completedLists.stats.totalLists})`}
                        value="completed"
                    />
                    <Tab
                        label="💰 Чеки"
                        value="receipts"
                    />
                </Tabs>
            </Box>

            {/* Content */}
            {tabValue === 'receipts' ? (
                <ReceiptsTabView />
            ) : loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                    <CircularProgress />
                </Box>
            ) : filteredLists.length === 0 ? (
                <Paper sx={{ p: 6, textAlign: 'center' }}>
                    <ShoppingCartIcon sx={{ fontSize: 64, color: 'grey.300', mb: 2 }} />
                    <Typography variant="h6" color="text.secondary" gutterBottom>
                        {searchQuery || showUrgentOnly
                            ? 'Ничего не найдено'
                            : tabValue === 'active'
                                ? 'Нет активных списков закупок'
                                : 'Нет завершённых списков'
                        }
                    </Typography>
                    {tabValue === 'active' && !searchQuery && !showUrgentOnly && (
                        <Button
                            variant="contained"
                            startIcon={<AddIcon />}
                            onClick={() => setCreateDialogOpen(true)}
                            sx={{ mt: 2 }}
                        >
                            Создать первый список
                        </Button>
                    )}
                </Paper>
            ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {filteredLists.map((list) => (
                        <Box key={list.id} sx={{ position: 'relative', width: '100%' }}>
                            <ShoppingListCard
                                list={list}
                                onToggleItem={(itemId, completed) => toggleItem(list.id, itemId, completed)}
                                onEditItem={(item) => handleEditItem(list.id, item)}
                                onDeleteItem={(itemId) => deleteItem(list.id, itemId)}
                                onAddItem={() => handleAddItem(list.id)}
                                onEditClient={() => handleEditClient(list.id, list.clientName || '')}
                            />
                            {/* Actions menu */}
                            <IconButton
                                size="small"
                                sx={{ position: 'absolute', top: 48, right: 8 }}
                                onClick={(e) => handleMenuOpen(e, list.id)}
                            >
                                <MoreVertIcon />
                            </IconButton>
                        </Box>
                    ))}
                </Box>
            )}

            {/* Context Menu */}
            <Menu
                anchorEl={anchorEl}
                open={Boolean(anchorEl)}
                onClose={handleMenuClose}
            >
                {tabValue === 'active' && (
                    <MenuItem onClick={handleCompleteList}>
                        <CheckIcon sx={{ mr: 1 }} /> Завершить
                    </MenuItem>
                )}
                <MenuItem onClick={handleDeleteList} sx={{ color: 'error.main' }}>
                    <DeleteIcon sx={{ mr: 1 }} /> Удалить
                </MenuItem>
            </Menu>

            {/* Create List Dialog */}
            <Dialog
                open={createDialogOpen}
                onClose={() => setCreateDialogOpen(false)}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle>Новый список закупок</DialogTitle>
                <DialogContent>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
                        <Autocomplete
                            options={clients}
                            getOptionLabel={(c) => c.name}
                            value={newListClient}
                            onChange={(_, val) => setNewListClient(val)}
                            renderInput={(params) => (
                                <TextField {...params} label="Клиент" placeholder="Выберите клиента..." />
                            )}
                        />

                        <Box sx={{ display: 'flex', gap: 1 }}>
                            <TextField
                                fullWidth
                                size="small"
                                placeholder="Добавить товар..."
                                value={newItemName}
                                onChange={(e) => setNewItemName(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && handleAddNewItem()}
                            />
                            <IconButton
                                color="primary"
                                onClick={handleAddNewItem}
                                disabled={!newItemName.trim()}
                            >
                                <AddIcon />
                            </IconButton>
                        </Box>

                        {newItems.length > 0 && (
                            <Paper variant="outlined" sx={{ p: 1 }}>
                                {newItems.map((item, idx) => (
                                    <Box key={item.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
                                        <Typography variant="body2" sx={{ flex: 1 }}>
                                            {idx + 1}. {item.name}
                                        </Typography>
                                        <IconButton
                                            size="small"
                                            onClick={() => setNewItems(prev => prev.filter(i => i.id !== item.id))}
                                        >
                                            <CloseIcon fontSize="small" />
                                        </IconButton>
                                    </Box>
                                ))}
                            </Paper>
                        )}
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setCreateDialogOpen(false)}>Отмена</Button>
                    <Button
                        variant="contained"
                        onClick={handleCreateList}
                        disabled={!newListClient || newItems.length === 0 || creating}
                    >
                        {creating ? <CircularProgress size={20} /> : `Создать (${newItems.length} поз.)`}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Edit Item Dialog */}
            <EditItemDialog
                open={editDialogOpen}
                item={editingItem}
                onSave={handleSaveItem}
                onDelete={handleDeleteItemFromDialog}
                onClose={() => {
                    setEditDialogOpen(false);
                    setEditingItem(null);
                    setEditingListId(null);
                }}
            />

            {/* Select Client Dialog */}
            <SelectClientDialog
                open={clientDialogOpen}
                currentClientName={clientEditCurrentName}
                onSelect={async (clientId, clientName) => {
                    if (clientEditListId) {
                        await updateClient(clientEditListId, clientId, clientName);
                    }
                }}
                onClose={() => {
                    setClientDialogOpen(false);
                    setClientEditListId(null);
                    setClientEditCurrentName('');
                }}
            />
        </Container>
    );
};

export default ShoppingPage;
