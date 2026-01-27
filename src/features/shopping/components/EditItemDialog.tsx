/**
 * @fileoverview Edit Item Dialog
 * 
 * Dialog for editing shopping item properties.
 */

import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    Box,
    IconButton,
    Typography,
    FormControlLabel,
    Switch,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import DeleteIcon from '@mui/icons-material/Delete';
import { ShoppingItem, ShoppingUnit } from '../types';
import { SHOPPING_UNITS } from '../constants';

interface EditItemDialogProps {
    open: boolean;
    item: ShoppingItem | null;
    onSave: (updates: Partial<ShoppingItem>) => void;
    onDelete: () => void;
    onClose: () => void;
}

const EditItemDialog: React.FC<EditItemDialogProps> = ({
    open,
    item,
    onSave,
    onDelete,
    onClose,
}) => {
    const [name, setName] = useState('');
    const [quantity, setQuantity] = useState(1);
    const [unit, setUnit] = useState<ShoppingUnit>('шт');
    const [isUrgent, setIsUrgent] = useState(false);

    useEffect(() => {
        if (item) {
            setName(item.name || '');
            setQuantity(item.quantity || 1);
            setUnit((item.unit || 'шт') as ShoppingUnit);
            setIsUrgent(item.isUrgent || false);
        }
    }, [item]);

    const handleSave = () => {
        onSave({ name, quantity, unit, isUrgent });
        onClose();
    };

    const handleDelete = () => {
        onDelete();
        onClose();
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle>Редактировать товар</DialogTitle>
            <DialogContent>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
                    <TextField
                        label="Название"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        fullWidth
                        autoFocus
                    />

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <IconButton
                                size="small"
                                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                            >
                                <RemoveIcon />
                            </IconButton>
                            <Typography variant="h6" sx={{ minWidth: 40, textAlign: 'center' }}>
                                {quantity}
                            </Typography>
                            <IconButton size="small" onClick={() => setQuantity(quantity + 1)}>
                                <AddIcon />
                            </IconButton>
                        </Box>

                        <FormControl size="small" sx={{ minWidth: 100 }}>
                            <InputLabel>Ед.</InputLabel>
                            <Select
                                value={unit}
                                label="Ед."
                                onChange={(e) => setUnit(e.target.value as ShoppingUnit)}
                            >
                                {SHOPPING_UNITS.map((u) => (
                                    <MenuItem key={u} value={u}>{u}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Box>

                    <FormControlLabel
                        control={
                            <Switch
                                checked={isUrgent}
                                onChange={(e) => setIsUrgent(e.target.checked)}
                                color="error"
                            />
                        }
                        label="🔴 Срочно"
                    />
                </Box>
            </DialogContent>
            <DialogActions sx={{ justifyContent: 'space-between', px: 3, pb: 2 }}>
                <Button color="error" startIcon={<DeleteIcon />} onClick={handleDelete}>
                    Удалить
                </Button>
                <Box>
                    <Button onClick={onClose}>Отмена</Button>
                    <Button variant="contained" onClick={handleSave}>
                        Сохранить
                    </Button>
                </Box>
            </DialogActions>
        </Dialog>
    );
};

export default EditItemDialog;
