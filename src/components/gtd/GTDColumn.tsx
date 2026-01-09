import React, { useState } from 'react';
import { Box, Typography, Paper, TextField, Button, IconButton } from '@mui/material';
import { Droppable } from '@hello-pangea/dnd';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { GTDTask, GTDStatus } from '../../types/gtd.types';
import { Client } from '../../types/crm.types';
import GTDTaskCard from './GTDTaskCard';

interface GTDColumnProps {
    columnId: GTDStatus;
    title: string;
    tasks: GTDTask[];
    clientsMap: Record<string, Client>;
    onTaskClick: (task: GTDTask) => void;
    onAddTask?: (title: string, columnId: GTDStatus) => void;
    onStartSession?: (task: GTDTask) => void;
}

// Column specific colors
const COLUMN_STYLES: Record<GTDStatus, { bg: string; headerBg: string; icon?: React.ReactNode }> = {
    inbox: { bg: '#ebecf0', headerBg: '#e2e4e9' },
    next_action: { bg: '#fef3c7', headerBg: '#fde68a' },
    projects: { bg: '#dbeafe', headerBg: '#bfdbfe' },
    waiting: { bg: '#fce7f3', headerBg: '#fbcfe8' },
    someday: { bg: '#e0e7ff', headerBg: '#c7d2fe' },
    done: { bg: '#d1fae5', headerBg: '#a7f3d0', icon: <CheckCircleIcon sx={{ fontSize: 18, color: '#059669', mr: 0.5 }} /> }
};

const GTDColumn: React.FC<GTDColumnProps> = ({ columnId, title, tasks, clientsMap, onTaskClick, onAddTask, onStartSession }) => {
    const [newTitle, setNewTitle] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const isDone = columnId === 'done';
    const styles = COLUMN_STYLES[columnId];

    const handleAdd = () => {
        if (!newTitle.trim() || !onAddTask) return;
        onAddTask(newTitle, columnId);
        setNewTitle('');
        setIsAdding(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleAdd();
        if (e.key === 'Escape') {
            setNewTitle('');
            setIsAdding(false);
        }
    };

    return (
        <Paper
            data-column-id={columnId}
            elevation={0}
            sx={{
                width: 280,
                minWidth: 280,
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                bgcolor: styles.bg,
                borderRadius: 2,
                maxHeight: 'calc(100vh - 180px)',
                transition: 'all 0.2s ease'
            }}
        >
            {/* Header */}
            <Box
                px={2}
                py={1.5}
                sx={{
                    bgcolor: styles.headerBg,
                    borderTopLeftRadius: 8,
                    borderTopRightRadius: 8,
                    display: 'flex',
                    alignItems: 'center'
                }}
            >
                {styles.icon}
                <Typography variant="subtitle2" fontWeight="bold" sx={{ flex: 1 }}>
                    {title}
                </Typography>
                <Typography
                    component="span"
                    variant="caption"
                    sx={{
                        bgcolor: 'rgba(0,0,0,0.1)',
                        px: 1,
                        py: 0.25,
                        borderRadius: 10,
                        fontWeight: 600
                    }}
                >
                    {tasks.length}
                </Typography>
            </Box>

            {/* Tasks List (Droppable) */}
            <Droppable droppableId={columnId}>
                {(provided, snapshot) => (
                    <Box
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        sx={{
                            p: 1,
                            flexGrow: 1,
                            overflowY: 'auto',
                            transition: 'background-color 0.2s ease',
                            bgcolor: snapshot.isDraggingOver ? 'rgba(0,0,0,0.08)' : 'transparent',
                            minHeight: 80
                        }}
                    >
                        {tasks.map((task, index) => (
                            <GTDTaskCard
                                key={task.id}
                                task={task}
                                index={index}
                                clientName={task.clientId ? clientsMap[task.clientId]?.name : undefined}
                                onClick={onTaskClick}
                                onStartSession={onStartSession}
                            />
                        ))}
                        {provided.placeholder}
                    </Box>
                )}
            </Droppable>

            {/* Quick Add - Available for ALL columns */}\n            <Box px={1} pb={1} sx={{ flexShrink: 0 }}>
                {isAdding ? (
                    <Box>
                        <TextField
                            autoFocus
                            fullWidth
                            size="small"
                            placeholder="Task title..."
                            value={newTitle}
                            onChange={(e) => setNewTitle(e.target.value)}
                            onKeyDown={handleKeyDown}
                            sx={{
                                bgcolor: 'white',
                                mb: 1,
                                '& .MuiOutlinedInput-root': {
                                    borderRadius: 1.5
                                }
                            }}
                        />
                        <Box display="flex" gap={0.5}>
                            <Button
                                variant="contained"
                                size="small"
                                onClick={handleAdd}
                                sx={{ textTransform: 'none', borderRadius: 1.5 }}
                            >
                                Add
                            </Button>
                            <IconButton size="small" onClick={() => { setNewTitle(''); setIsAdding(false); }}>
                                <CloseIcon fontSize="small" />
                            </IconButton>
                        </Box>
                    </Box>
                ) : (
                    <Button
                        fullWidth
                        startIcon={<AddIcon />}
                        aria-label="add-task"
                        sx={{
                            justifyContent: 'flex-start',
                            color: 'text.secondary',
                            textTransform: 'none',
                            borderRadius: 1.5,
                            py: 0.5,
                            '&:hover': {
                                bgcolor: 'rgba(0,0,0,0.05)'
                            }
                        }}
                        onClick={() => setIsAdding(true)}
                    >
                        {isDone ? 'Add completed' : 'Add a card'}
                    </Button>
                )}
            </Box>
        </Paper>
    );
};

export default GTDColumn;
