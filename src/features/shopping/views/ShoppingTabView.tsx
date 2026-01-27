/**
 * @fileoverview Shopping Tab View
 * 
 * Self-contained shopping view for embedding in GTD page.
 * Uses useShoppingLists hook for all data and actions.
 */

import React, { useState } from 'react';
import {
    Box,
    Paper,
    Typography,
    CircularProgress,
} from '@mui/material';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import { nanoid } from 'nanoid';
import { useShoppingLists } from '../hooks/useShoppingLists';
import { ShoppingItem } from '../types';
import ShoppingListCard from '../components/ShoppingListCard';
import EditItemDialog from '../components/EditItemDialog';
import SelectClientDialog from '../components/SelectClientDialog';

const ShoppingTabView: React.FC = () => {
    const {
        lists,
        loading,
        toggleItem,
        updateItem,
        deleteItem,
        addItems,
        updateClient,
    } = useShoppingLists();

    // Edit dialog state
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<ShoppingItem | null>(null);
    const [editingListId, setEditingListId] = useState<string | null>(null);

    // Client dialog state
    const [clientDialogOpen, setClientDialogOpen] = useState(false);
    const [clientEditListId, setClientEditListId] = useState<string | null>(null);
    const [clientEditCurrentName, setClientEditCurrentName] = useState('');

    // Handler for editing item
    const handleEditItem = (listId: string, item: ShoppingItem) => {
        setEditingListId(listId);
        setEditingItem(item);
        setEditDialogOpen(true);
    };

    // Handler for saving item
    const handleSaveItem = async (updates: Partial<ShoppingItem>) => {
        if (!editingListId || !editingItem) return;
        await updateItem(editingListId, editingItem.id, updates);
    };

    // Handler for deleting item from dialog
    const handleDeleteItemFromDialog = async () => {
        if (!editingListId || !editingItem) return;
        await deleteItem(editingListId, editingItem.id);
    };

    // Handler for adding new item
    const handleAddItem = async (listId: string) => {
        const newItem: ShoppingItem = {
            id: nanoid(),
            name: 'Новый товар',
            quantity: 1,
            isUrgent: false,
            completed: false,
        };
        await addItems(listId, [newItem]);
        // Open edit dialog for the new item
        setEditingListId(listId);
        setEditingItem(newItem);
        setEditDialogOpen(true);
    };

    // Handler for editing client
    const handleEditClient = (listId: string, currentName: string) => {
        setClientEditListId(listId);
        setClientEditCurrentName(currentName);
        setClientDialogOpen(true);
    };

    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress />
            </Box>
        );
    }

    if (lists.length === 0) {
        return (
            <Paper sx={{ p: 4, textAlign: 'center' }}>
                <ShoppingCartIcon sx={{ fontSize: 48, color: 'grey.400', mb: 2 }} />
                <Typography variant="h6" color="text.secondary">
                    Нет активных списков закупок
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    Нажмите "+" и выберите "🛒 Купить" чтобы создать список
                </Typography>
            </Paper>
        );
    }

    return (
        <>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                {lists.map((list) => (
                    <ShoppingListCard
                        key={list.id}
                        list={list}
                        onToggleItem={(itemId, completed) => toggleItem(list.id, itemId, completed)}
                        onEditItem={(item) => handleEditItem(list.id, item)}
                        onDeleteItem={(itemId) => deleteItem(list.id, itemId)}
                        onAddItem={() => handleAddItem(list.id)}
                        onEditClient={() => handleEditClient(list.id, list.clientName || '')}
                    />
                ))}
            </Box>

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
        </>
    );
};

export default ShoppingTabView;
