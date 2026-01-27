/**
 * @fileoverview Shopping Item Row
 * 
 * Individual item row with checkbox, actions on hover.
 */

import React from 'react';
import {
    ListItem,
    ListItemIcon,
    ListItemText,
    Checkbox,
    IconButton,
    Chip,
    Box,
    Tooltip,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { ShoppingItem } from '../types';

interface ShoppingItemRowProps {
    item: ShoppingItem;
    onToggle: () => void;
    onEdit: () => void;
    onDelete: () => void;
}

const ShoppingItemRow: React.FC<ShoppingItemRowProps> = ({
    item,
    onToggle,
    onEdit,
    onDelete,
}) => {
    return (
        <ListItem
            disablePadding
            sx={{
                bgcolor: item.isUrgent && !item.completed ? 'error.50' : 'transparent',
                borderRadius: 1,
                mb: 0.5,
                '&:hover .item-actions': { opacity: 1 },
            }}
            secondaryAction={
                <Box
                    className="item-actions"
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5,
                        opacity: 0,
                        transition: 'opacity 0.2s',
                    }}
                >
                    {item.isUrgent && !item.completed && (
                        <Chip label="Срочно" size="small" color="error" sx={{ height: 20 }} />
                    )}
                    <Tooltip title="Редактировать">
                        <IconButton size="small" onClick={onEdit}>
                            <EditIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Удалить">
                        <IconButton size="small" color="error" onClick={onDelete}>
                            <DeleteIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Box>
            }
        >
            <ListItemIcon sx={{ minWidth: 36 }}>
                <Checkbox
                    edge="start"
                    checked={item.completed}
                    onChange={onToggle}
                    size="small"
                />
            </ListItemIcon>
            <ListItemText
                primary={item.name}
                secondary={`×${item.quantity}${item.unit ? ' ' + item.unit : ''}`}
                sx={{
                    textDecoration: item.completed ? 'line-through' : 'none',
                    color: item.completed ? 'text.secondary' : 'text.primary',
                }}
            />
        </ListItem>
    );
};

export default ShoppingItemRow;
