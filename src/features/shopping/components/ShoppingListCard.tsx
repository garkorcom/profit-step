/**
 * @fileoverview Shopping List Card
 * 
 * Card component for displaying a shopping list with items.
 */

import React from 'react';
import {
    Paper,
    Box,
    Typography,
    Chip,
    IconButton,
    List,
    Tooltip,
    Avatar,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import AddIcon from '@mui/icons-material/Add';
import PersonIcon from '@mui/icons-material/Person';
import { ShoppingList, ShoppingItem } from '../types';
import ShoppingItemRow from './ShoppingItemRow';

interface ShoppingListCardProps {
    list: ShoppingList;
    onToggleItem: (itemId: string, completed: boolean) => void;
    onEditItem: (item: ShoppingItem) => void;
    onDeleteItem: (itemId: string) => void;
    onAddItem: () => void;
    onEditClient: () => void;
    onAssign?: () => void;
}

const ShoppingListCard: React.FC<ShoppingListCardProps> = ({
    list,
    onToggleItem,
    onEditItem,
    onDeleteItem,
    onAddItem,
    onEditClient,
    onAssign,
}) => {
    const completedCount = list.items?.filter(i => i.completed).length || 0;
    const totalCount = list.items?.length || 0;
    const allCompleted = totalCount > 0 && completedCount === totalCount;
    const hasUrgent = list.items?.some(i => i.isUrgent && !i.completed);

    const statusColor = list.status === 'completed' ? 'success'
        : list.status === 'in_progress' ? 'primary'
            : 'default';

    return (
        <Paper
            sx={{
                /**
                 * MOBILE-FIRST (2026-01-26):
                 * Changed from responsive columns (50%/33%) to full-width
                 * Parent container handles centering via maxWidth="sm"
                 */
                width: '100%',
                p: 2,
                border: hasUrgent ? '2px solid' : 'none',
                borderColor: 'error.light',
            }}
        >
            {/* Header */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="h6" fontWeight={600}>
                        🛒 {list.clientName || 'Без клиента'}
                    </Typography>
                    <Tooltip title="Изменить клиента">
                        <IconButton size="small" onClick={onEditClient}>
                            <EditIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip
                        size="small"
                        label={`${completedCount}/${totalCount}`}
                        color={allCompleted ? 'success' : statusColor}
                    />
                    <Tooltip title="Добавить товар">
                        <IconButton size="small" color="primary" onClick={onAddItem}>
                            <AddIcon />
                        </IconButton>
                    </Tooltip>
                </Box>
            </Box>

            {/* Assignee Row */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                {list.assignedToName ? (
                    <Chip
                        size="small"
                        avatar={<Avatar sx={{ width: 20, height: 20 }}>{list.assignedToName[0]}</Avatar>}
                        label={list.assignedToName}
                        variant="outlined"
                        color="primary"
                    />
                ) : onAssign && (
                    <Chip
                        size="small"
                        icon={<PersonIcon />}
                        label="Назначить"
                        variant="outlined"
                        onClick={onAssign}
                        sx={{ cursor: 'pointer' }}
                    />
                )}
                {hasUrgent && (
                    <Chip size="small" label="🔴 Срочные" color="error" variant="outlined" />
                )}
            </Box>

            {/* Items List */}
            <List dense disablePadding>
                {list.items?.map((item) => (
                    <ShoppingItemRow
                        key={item.id}
                        item={item}
                        onToggle={() => onToggleItem(item.id, item.completed)}
                        onEdit={() => onEditItem(item)}
                        onDelete={() => onDeleteItem(item.id)}
                    />
                ))}
            </List>
        </Paper>
    );
};

export default ShoppingListCard;

