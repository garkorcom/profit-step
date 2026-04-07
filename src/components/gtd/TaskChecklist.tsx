import React, { useState } from 'react';
import {
    Box, Typography, Checkbox, TextField, IconButton, LinearProgress,
    List, ListItem, ListItemIcon, ListItemText, Tooltip
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';

import { ChecklistItem } from '../../types/gtd.types';
import { Timestamp } from 'firebase/firestore';

interface TaskChecklistProps {
    items: ChecklistItem[];
    onUpdate: (items: ChecklistItem[]) => void;
    readOnly?: boolean;
}

/**
 * Interactive Checklist Component
 * 
 * Features:
 * - Add new items
 * - Toggle completion
 * - Delete items
 * - Progress indicator
 * - Inline editing
 */
const TaskChecklist: React.FC<TaskChecklistProps> = ({ items, onUpdate, readOnly = false }) => {
    const [newItemText, setNewItemText] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editText, setEditText] = useState('');

    // Generate unique ID
    const generateId = () => Math.random().toString(36).substr(2, 9);

    // Calculate progress
    const completedCount = items.filter(item => item.completed).length;
    const totalCount = items.length;
    const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

    // Add new item
    const handleAddItem = () => {
        if (!newItemText.trim()) return;

        const newItem: ChecklistItem = {
            id: generateId(),
            text: newItemText.trim(),
            completed: false,
            createdAt: Timestamp.now()
        };

        onUpdate([...items, newItem]);
        setNewItemText('');
    };

    // Toggle item completion
    const handleToggle = (id: string) => {
        const updatedItems = items.map(item => {
            if (item.id === id) {
                return {
                    ...item,
                    completed: !item.completed,
                    completedAt: !item.completed ? Timestamp.now() : undefined
                };
            }
            return item;
        });
        onUpdate(updatedItems);
    };

    // Delete item
    const handleDelete = (id: string) => {
        onUpdate(items.filter(item => item.id !== id));
    };

    // Start editing
    const handleStartEdit = (item: ChecklistItem) => {
        setEditingId(item.id);
        setEditText(item.text);
    };

    // Save edit
    const handleSaveEdit = () => {
        if (!editingId || !editText.trim()) {
            setEditingId(null);
            return;
        }

        const updatedItems = items.map(item => {
            if (item.id === editingId) {
                return { ...item, text: editText.trim() };
            }
            return item;
        });

        onUpdate(updatedItems);
        setEditingId(null);
        setEditText('');
    };

    // Handle key press in input fields
    const handleKeyDown = (e: React.KeyboardEvent, action: 'add' | 'edit') => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (action === 'add') {
                handleAddItem();
            } else {
                handleSaveEdit();
            }
        }
        if (e.key === 'Escape') {
            setEditingId(null);
            setEditText('');
        }
    };

    return (
        <Box>
            {/* Progress Header */}
            {totalCount > 0 && (
                <Box mb={2}>
                    <Box display="flex" alignItems="center" justifyContent="space-between" mb={0.5}>
                        <Typography variant="caption" color="text.secondary">
                            Прогресс
                        </Typography>
                        <Typography variant="caption" fontWeight={600} color={progress === 100 ? 'success.main' : 'text.secondary'}>
                            {completedCount}/{totalCount}
                        </Typography>
                    </Box>
                    <LinearProgress
                        variant="determinate"
                        value={progress}
                        sx={{
                            height: 6,
                            borderRadius: 3,
                            bgcolor: '#e2e8f0',
                            '& .MuiLinearProgress-bar': {
                                bgcolor: progress === 100 ? '#22c55e' : '#3b82f6',
                                borderRadius: 3
                            }
                        }}
                    />
                </Box>
            )}

            {/* Checklist Items */}
            <List disablePadding>
                {items.map((item) => (
                    <ListItem
                        key={item.id}
                        disablePadding
                        sx={{
                            py: 0.5,
                            px: 1,
                            borderRadius: 1,
                            '&:hover': { bgcolor: '#f8fafc' },
                            '&:hover .delete-btn': { opacity: 1 }
                        }}
                    >
                        <ListItemIcon sx={{ minWidth: 36 }}>
                            <Checkbox
                                edge="start"
                                checked={item.completed}
                                onChange={() => handleToggle(item.id)}
                                disabled={readOnly}
                                icon={<RadioButtonUncheckedIcon sx={{ color: '#cbd5e1' }} />}
                                checkedIcon={<CheckCircleIcon sx={{ color: '#22c55e' }} />}
                                sx={{ p: 0.5 }}
                            />
                        </ListItemIcon>

                        {editingId === item.id ? (
                            <TextField
                                fullWidth
                                size="small"
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                onBlur={handleSaveEdit}
                                onKeyDown={(e) => handleKeyDown(e, 'edit')}
                                autoFocus
                                variant="standard"
                                InputProps={{ disableUnderline: true }}
                                sx={{ py: 0.5 }}
                            />
                        ) : (
                            <ListItemText
                                primary={item.text}
                                onClick={() => !readOnly && handleStartEdit(item)}
                                primaryTypographyProps={{
                                    sx: {
                                        textDecoration: item.completed ? 'line-through' : 'none',
                                        color: item.completed ? 'text.disabled' : 'text.primary',
                                        cursor: readOnly ? 'default' : 'text',
                                        fontSize: '0.95rem'
                                    }
                                }}
                            />
                        )}

                        {!readOnly && (
                            <Tooltip title="Удалить">
                                <IconButton
                                    size="small"
                                    className="delete-btn"
                                    onClick={() => handleDelete(item.id)}
                                    sx={{
                                        opacity: 0,
                                        transition: 'opacity 0.2s',
                                        color: '#94a3b8',
                                        '&:hover': { color: '#ef4444' }
                                    }}
                                >
                                    <DeleteOutlineIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        )}
                    </ListItem>
                ))}
            </List>

            {/* Add New Item */}
            {!readOnly && (
                <Box display="flex" alignItems="center" gap={1} mt={1} px={1}>
                    <IconButton
                        size="small"
                        onClick={handleAddItem}
                        disabled={!newItemText.trim()}
                        sx={{ color: newItemText.trim() ? 'primary.main' : '#cbd5e1' }}
                    >
                        <AddIcon fontSize="small" />
                    </IconButton>
                    <TextField
                        fullWidth
                        size="small"
                        placeholder="Добавить пункт..."
                        value={newItemText}
                        onChange={(e) => setNewItemText(e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, 'add')}
                        variant="standard"
                        InputProps={{ disableUnderline: true }}
                        sx={{
                            '& input': { py: 0.5 }
                        }}
                    />
                </Box>
            )}

            {/* Empty State */}
            {items.length === 0 && !newItemText && (
                <Typography variant="body2" color="text.disabled" textAlign="center" py={2}>
                    Нет пунктов чек-листа
                </Typography>
            )}
        </Box>
    );
};

export default TaskChecklist;
