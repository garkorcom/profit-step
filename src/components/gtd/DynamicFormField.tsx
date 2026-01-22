/**
 * @fileoverview Dynamic Form Field Component
 * 
 * Renders form fields dynamically based on FieldConfig from TASK_TYPE_CONFIG.
 * Supports: text, number, date, time, select, camera, checklist, location
 */

import React, { useState } from 'react';
import {
    TextField,
    Box,
    Typography,
    IconButton,
    Chip,
    List,
    ListItem,
    ListItemText,
    ListItemSecondaryAction,
    Checkbox,
} from '@mui/material';
import {
    CameraAlt as CameraIcon,
    Add as AddIcon,
    Delete as DeleteIcon,
    MyLocation as LocationIcon,
} from '@mui/icons-material';
import { FieldConfig } from '../../types/gtd.types';

interface DynamicFormFieldProps {
    config: FieldConfig;
    value: any;
    onChange: (value: any) => void;
}

/**
 * Renders a single form field based on the FieldConfig type
 */
const DynamicFormField: React.FC<DynamicFormFieldProps> = ({ config, value, onChange }) => {
    const [newItem, setNewItem] = useState('');

    // Handle checklist item add
    const handleAddItem = () => {
        if (!newItem.trim()) return;
        const items = Array.isArray(value) ? value : [];
        onChange([...items, { text: newItem.trim(), completed: false }]);
        setNewItem('');
    };

    // Handle checklist item toggle
    const handleToggleItem = (index: number) => {
        const items = [...(value || [])];
        items[index] = { ...items[index], completed: !items[index].completed };
        onChange(items);
    };

    // Handle checklist item delete
    const handleDeleteItem = (index: number) => {
        const items = [...(value || [])];
        items.splice(index, 1);
        onChange(items);
    };

    switch (config.type) {
        case 'text':
            return (
                <TextField
                    fullWidth
                    size="small"
                    label={config.label}
                    placeholder={config.placeholder}
                    value={value || ''}
                    onChange={(e) => onChange(e.target.value)}
                    required={config.required}
                    sx={{ mb: 2 }}
                />
            );

        case 'number':
            return (
                <TextField
                    fullWidth
                    size="small"
                    type="number"
                    label={config.label}
                    placeholder={config.placeholder}
                    value={value || ''}
                    onChange={(e) => onChange(e.target.value)}
                    required={config.required}
                    sx={{ mb: 2 }}
                />
            );

        case 'date':
            return (
                <TextField
                    fullWidth
                    size="small"
                    type="date"
                    label={config.label}
                    value={value || ''}
                    onChange={(e) => onChange(e.target.value)}
                    required={config.required}
                    InputLabelProps={{ shrink: true }}
                    sx={{ mb: 2 }}
                />
            );

        case 'time':
            return (
                <TextField
                    fullWidth
                    size="small"
                    type="time"
                    label={config.label}
                    value={value || ''}
                    onChange={(e) => onChange(e.target.value)}
                    required={config.required}
                    InputLabelProps={{ shrink: true }}
                    sx={{ mb: 2 }}
                />
            );

        case 'checklist':
            const items = Array.isArray(value) ? value : [];
            return (
                <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                        {config.label} {config.required && <span style={{ color: 'red' }}>*</span>}
                    </Typography>

                    {/* Add new item */}
                    <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                        <TextField
                            size="small"
                            placeholder="Добавить пункт..."
                            value={newItem}
                            onChange={(e) => setNewItem(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleAddItem()}
                            sx={{ flex: 1 }}
                        />
                        <IconButton onClick={handleAddItem} color="primary" size="small">
                            <AddIcon />
                        </IconButton>
                    </Box>

                    {/* Items list */}
                    {items.length > 0 && (
                        <List dense sx={{ bgcolor: 'grey.50', borderRadius: 1, p: 0 }}>
                            {items.map((item: { text: string; completed: boolean }, idx: number) => (
                                <ListItem key={idx} sx={{ py: 0.5 }}>
                                    <Checkbox
                                        edge="start"
                                        checked={item.completed}
                                        onChange={() => handleToggleItem(idx)}
                                        size="small"
                                    />
                                    <ListItemText
                                        primary={item.text}
                                        sx={{
                                            textDecoration: item.completed ? 'line-through' : 'none',
                                            color: item.completed ? 'text.secondary' : 'text.primary',
                                        }}
                                    />
                                    <ListItemSecondaryAction>
                                        <IconButton edge="end" size="small" onClick={() => handleDeleteItem(idx)}>
                                            <DeleteIcon fontSize="small" />
                                        </IconButton>
                                    </ListItemSecondaryAction>
                                </ListItem>
                            ))}
                        </List>
                    )}
                </Box>
            );

        case 'camera':
            return (
                <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                        {config.label} {config.required && <span style={{ color: 'red' }}>*</span>}
                    </Typography>

                    {value ? (
                        <Box sx={{ position: 'relative', display: 'inline-block' }}>
                            <img
                                src={value}
                                alt="Captured"
                                style={{ maxWidth: '100%', maxHeight: 150, borderRadius: 8 }}
                            />
                            <IconButton
                                size="small"
                                sx={{ position: 'absolute', top: 4, right: 4, bgcolor: 'rgba(0,0,0,0.5)' }}
                                onClick={() => onChange(null)}
                            >
                                <DeleteIcon fontSize="small" sx={{ color: 'white' }} />
                            </IconButton>
                        </Box>
                    ) : (
                        <Box
                            sx={{
                                border: '2px dashed #e0e0e0',
                                borderRadius: 2,
                                p: 3,
                                textAlign: 'center',
                                cursor: 'pointer',
                                '&:hover': { borderColor: 'primary.main', bgcolor: 'primary.50' },
                            }}
                            onClick={() => {
                                // TODO: Implement camera capture
                                // For now, just simulate with a placeholder
                                onChange('https://via.placeholder.com/150?text=Photo');
                            }}
                        >
                            <CameraIcon sx={{ fontSize: 40, color: 'grey.400' }} />
                            <Typography variant="caption" color="text.secondary" display="block">
                                Нажмите для съёмки
                            </Typography>
                        </Box>
                    )}
                </Box>
            );

        case 'location':
            return (
                <Box sx={{ mb: 2 }}>
                    <TextField
                        fullWidth
                        size="small"
                        label={config.label}
                        placeholder="Введите адрес..."
                        value={value || ''}
                        onChange={(e) => onChange(e.target.value)}
                        required={config.required}
                        InputProps={{
                            endAdornment: (
                                <IconButton
                                    size="small"
                                    onClick={() => {
                                        // TODO: Implement geolocation
                                        onChange('Текущее местоположение');
                                    }}
                                >
                                    <LocationIcon />
                                </IconButton>
                            ),
                        }}
                    />
                </Box>
            );

        case 'select':
            // Generic select - specific options would be passed via config extension
            return (
                <TextField
                    fullWidth
                    size="small"
                    select
                    label={config.label}
                    value={value || ''}
                    onChange={(e) => onChange(e.target.value)}
                    required={config.required}
                    SelectProps={{ native: true }}
                    sx={{ mb: 2 }}
                >
                    <option value="">— Выберите —</option>
                    <option value="option1">Вариант 1</option>
                    <option value="option2">Вариант 2</option>
                </TextField>
            );

        default:
            return null;
    }
};

export default DynamicFormField;
