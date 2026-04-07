/**
 * @fileoverview Quick Shopping List Input Component
 * 
 * Stream-style input for fast item entry (5-10 items in 30 seconds).
 * Features:
 * - Auto-focus input field
 * - Enter to add item (chat-like flow)
 * - Quantity stepper
 * - Urgent toggle
 * - Photo capture button
 */

import React, { useState, useRef, useEffect } from 'react';
import {
    Box,
    Typography,
    TextField,
    IconButton,
    Button,
    List,
    ListItem,
    ListItemText,
    ListItemSecondaryAction,
    Checkbox,
    FormControlLabel,
    Chip,
} from '@mui/material';
import {
    Add as AddIcon,
    Remove as RemoveIcon,
    Delete as DeleteIcon,
    CameraAlt as CameraIcon,
    ShoppingCart as ShoppingCartIcon,
} from '@mui/icons-material';
import { nanoid } from 'nanoid';

import { ShoppingItem } from '../../features/shopping';

// Re-export for backward compatibility
export type { ShoppingItem };

interface ShoppingListInputProps {
    onComplete: (items: ShoppingItem[]) => void;
    onCancel: () => void;
    clientName?: string;
    locationName?: string;
}

const ShoppingListInput: React.FC<ShoppingListInputProps> = ({
    onComplete,
    onCancel,
    clientName,
    locationName,
}) => {
    const [items, setItems] = useState<ShoppingItem[]>([]);
    const [currentItem, setCurrentItem] = useState('');
    const [quantity, setQuantity] = useState(1);
    const [isUrgent, setIsUrgent] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // Auto-focus on mount
    useEffect(() => {
        setTimeout(() => inputRef.current?.focus(), 100);
    }, []);

    const handleAdd = () => {
        if (!currentItem.trim()) return;

        const newItem: ShoppingItem = {
            id: nanoid(),
            name: currentItem.trim(),
            quantity,
            isUrgent,
            completed: false,
        };

        setItems(prev => [...prev, newItem]);

        // Reset for next item
        setCurrentItem('');
        setQuantity(1);
        setIsUrgent(false);
        inputRef.current?.focus();

        // Haptic feedback
        if ('vibrate' in navigator) {
            navigator.vibrate(30);
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAdd();
        }
    };

    const handleRemoveItem = (id: string) => {
        setItems(prev => prev.filter(item => item.id !== id));
    };

    const handleComplete = () => {
        if (items.length === 0) return;

        // Haptic feedback
        if ('vibrate' in navigator) {
            navigator.vibrate([50, 30, 50]);
        }

        onComplete(items);
    };

    const urgentCount = items.filter(i => i.isUrgent).length;

    return (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                mb: 2,
                pb: 2,
                borderBottom: '1px solid #e0e0e0'
            }}>
                <ShoppingCartIcon color="primary" />
                <Box>
                    <Typography variant="h6" fontWeight={600}>
                        Закупка
                    </Typography>
                    {(clientName || locationName) && (
                        <Typography variant="caption" color="text.secondary">
                            {clientName}{locationName ? ` • ${locationName}` : ''}
                        </Typography>
                    )}
                </Box>
            </Box>

            {/* Input Row */}
            <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                <TextField
                    inputRef={inputRef}
                    fullWidth
                    size="small"
                    placeholder="Название товара..."
                    value={currentItem}
                    onChange={(e) => setCurrentItem(e.target.value)}
                    onKeyPress={handleKeyPress}
                    InputProps={{
                        endAdornment: (
                            <IconButton
                                size="small"
                                sx={{ color: 'grey.400' }}
                                onClick={() => {
                                    // TODO: Implement camera capture
                                    alert('📷 Camera capture coming soon');
                                }}
                            >
                                <CameraIcon fontSize="small" />
                            </IconButton>
                        ),
                    }}
                    sx={{
                        '& .MuiOutlinedInput-root': {
                            bgcolor: 'background.paper',
                        }
                    }}
                />
                <IconButton
                    color="primary"
                    onClick={handleAdd}
                    disabled={!currentItem.trim()}
                    sx={{
                        bgcolor: 'primary.main',
                        color: 'white',
                        '&:hover': { bgcolor: 'primary.dark' },
                        '&:disabled': { bgcolor: 'grey.300', color: 'grey.500' }
                    }}
                >
                    <AddIcon />
                </IconButton>
            </Box>

            {/* Quantity + Urgent Row */}
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                mb: 2,
                p: 1,
                bgcolor: 'grey.50',
                borderRadius: 1
            }}>
                {/* Quantity Stepper */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
                        Кол-во:
                    </Typography>
                    <IconButton
                        size="small"
                        onClick={() => setQuantity(q => Math.max(1, q - 1))}
                        disabled={quantity <= 1}
                    >
                        <RemoveIcon fontSize="small" />
                    </IconButton>
                    <Typography
                        sx={{
                            minWidth: 28,
                            textAlign: 'center',
                            fontWeight: 600,
                            fontSize: '1.1rem'
                        }}
                    >
                        {quantity}
                    </Typography>
                    <IconButton size="small" onClick={() => setQuantity(q => q + 1)}>
                        <AddIcon fontSize="small" />
                    </IconButton>
                </Box>

                {/* Urgent Toggle */}
                <FormControlLabel
                    control={
                        <Checkbox
                            checked={isUrgent}
                            onChange={(e) => setIsUrgent(e.target.checked)}
                            size="small"
                            sx={{
                                color: 'error.main',
                                '&.Mui-checked': { color: 'error.main' }
                            }}
                        />
                    }
                    label={
                        <Typography variant="body2" color={isUrgent ? 'error' : 'text.secondary'}>
                            🔴 Срочно
                        </Typography>
                    }
                />
            </Box>

            {/* Items List */}
            <Box sx={{ flex: 1, overflow: 'auto', mb: 2 }}>
                {items.length === 0 ? (
                    <Box sx={{
                        textAlign: 'center',
                        py: 4,
                        color: 'text.secondary'
                    }}>
                        <Typography variant="body2">
                            Введите название товара и нажмите Enter
                        </Typography>
                    </Box>
                ) : (
                    <List dense disablePadding>
                        {items.map((item, _idx) => (
                            <ListItem
                                key={item.id}
                                sx={{
                                    bgcolor: item.isUrgent ? 'error.50' : 'grey.50',
                                    borderRadius: 1,
                                    mb: 0.5,
                                    border: item.isUrgent ? '1px solid' : 'none',
                                    borderColor: 'error.200',
                                }}
                            >
                                <ListItemText
                                    primary={
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <Typography variant="body2" fontWeight={500}>
                                                {item.name}
                                            </Typography>
                                            {item.isUrgent && (
                                                <Chip
                                                    label="Срочно"
                                                    size="small"
                                                    color="error"
                                                    sx={{ height: 18, fontSize: '0.65rem' }}
                                                />
                                            )}
                                        </Box>
                                    }
                                    secondary={`×${item.quantity}`}
                                />
                                <ListItemSecondaryAction>
                                    <IconButton
                                        edge="end"
                                        size="small"
                                        onClick={() => handleRemoveItem(item.id)}
                                    >
                                        <DeleteIcon fontSize="small" />
                                    </IconButton>
                                </ListItemSecondaryAction>
                            </ListItem>
                        ))}
                    </List>
                )}
            </Box>

            {/* Footer: Stats + Submit */}
            <Box sx={{
                pt: 2,
                borderTop: '1px solid #e0e0e0',
                display: 'flex',
                gap: 1
            }}>
                <Button
                    variant="outlined"
                    onClick={onCancel}
                    sx={{ flex: 1 }}
                >
                    Отмена
                </Button>
                <Button
                    variant="contained"
                    size="large"
                    disabled={items.length === 0}
                    onClick={handleComplete}
                    sx={{
                        flex: 2,
                        py: 1.5,
                        fontSize: '1rem',
                        fontWeight: 600
                    }}
                >
                    ✅ Готово ({items.length} поз.{urgentCount > 0 ? `, ${urgentCount} срочн.` : ''})
                </Button>
            </Box>
        </Box>
    );
};

export default ShoppingListInput;
