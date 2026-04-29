import React from 'react';
import { Box, Typography, Chip, LinearProgress, IconButton } from '@mui/material';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import { TreeItem } from '@mui/x-tree-view/TreeItem';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { HierarchyNode } from './utils';
import type { TaskLifecycle, TaskPriority } from '../../../../api/tasktotimeApi';

const LIFECYCLE_COLORS: Record<TaskLifecycle, { bg: string; fg: string }> = {
    draft: { bg: '#F3F4F6', fg: '#6B7280' },
    ready: { bg: '#DBEAFE', fg: '#1E40AF' },
    started: { bg: '#FEF3C7', fg: '#92400E' },
    blocked: { bg: '#FEE2E2', fg: '#991B1B' },
    completed: { bg: '#DCFCE7', fg: '#166534' },
    accepted: { bg: '#D1FAE5', fg: '#064E3B' },
    cancelled: { bg: '#E5E7EB', fg: '#374151' },
};

const PRIORITY_COLORS: Record<TaskPriority, { bg: string; fg: string }> = {
    critical: { bg: '#FEE2E2', fg: '#991B1B' },
    high: { bg: '#FED7AA', fg: '#9A3412' },
    medium: { bg: '#FEF3C7', fg: '#92400E' },
    low: { bg: '#E0F2FE', fg: '#075985' },
};

const FALLBACK_CHIP = { bg: '#E5E7EB', fg: '#374151' };

const PRIORITY_INT_TO_STRING: Record<number, TaskPriority> = {
    0: 'low',
    1: 'medium',
    2: 'high',
    3: 'critical',
};

function resolvePriorityKey(p: TaskPriority | number | undefined): TaskPriority | undefined {
    if (typeof p === 'number') return PRIORITY_INT_TO_STRING[p];
    if (typeof p === 'string' && PRIORITY_COLORS[p as TaskPriority]) return p as TaskPriority;
    return undefined;
}

interface TaskTreeNodeProps {
    node: HierarchyNode;
    onTaskClick: (taskId: string) => void;
    selectedTaskId?: string | null;
}

export const TaskTreeNode: React.FC<TaskTreeNodeProps> = ({ node, onTaskClick, selectedTaskId }) => {
    const { attributes, listeners, setNodeRef: setDraggableRef, isDragging } = useDraggable({
        id: node.id,
        data: { node },
    });

    const { setNodeRef: setDroppableRef, isOver } = useDroppable({
        id: node.id,
    });

    const lifecycle = LIFECYCLE_COLORS[node.lifecycle] ?? FALLBACK_CHIP;
    const priorityKey = resolvePriorityKey(node.priority);
    const priority = priorityKey ? PRIORITY_COLORS[priorityKey] : FALLBACK_CHIP;

    // We only show progress bar if it's a parent task with subtaskRollup
    const hasSubtasks = node.subtaskIds && node.subtaskIds.length > 0;
    const progress = hasSubtasks && node.subtaskRollup ? node.subtaskRollup.completedFraction * 100 : undefined;

    return (
        <TreeItem
            itemId={node.id}
            ref={setDroppableRef}
            label={
                <Box 
                    sx={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        p: 0.5, 
                        pr: 0,
                        bgcolor: selectedTaskId === node.id ? 'action.selected' : isOver ? 'action.hover' : 'transparent',
                        outline: isOver ? '2px dashed #3B82F6' : 'none',
                        outlineOffset: -2,
                        opacity: isDragging ? 0.5 : 1,
                        borderRadius: 1,
                    }}
                    onClick={(e) => {
                        e.stopPropagation();
                        onTaskClick(node.id);
                    }}
                >
                    <Box 
                        ref={setDraggableRef} 
                        {...listeners} 
                        {...attributes}
                        onClick={(e) => e.stopPropagation()}
                        sx={{ 
                            cursor: 'grab', 
                            display: 'flex', 
                            alignItems: 'center', 
                            mr: 1, 
                            color: 'action.active' 
                        }}
                    >
                        <DragIndicatorIcon fontSize="small" />
                    </Box>
                    <Typography variant="body2" sx={{ fontWeight: 'inherit', flexGrow: 1, mr: 2 }}>
                        {node.taskNumber} • {node.title}
                    </Typography>
                    
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Chip
                            label={node.lifecycle}
                            size="small"
                            sx={{
                                height: 20,
                                fontSize: '0.65rem',
                                fontWeight: 600,
                                textTransform: 'uppercase',
                                bgcolor: lifecycle.bg,
                                color: lifecycle.fg,
                            }}
                        />
                        <Box
                            sx={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                bgcolor: priority.fg,
                            }}
                            title={`Priority: ${priorityKey}`}
                        />
                        {progress !== undefined && (
                            <Box sx={{ width: 60, ml: 1 }}>
                                <LinearProgress 
                                    variant="determinate" 
                                    value={progress} 
                                    sx={{ 
                                        height: 6, 
                                        borderRadius: 3,
                                        bgcolor: '#E5E7EB',
                                        '& .MuiLinearProgress-bar': {
                                            bgcolor: progress === 100 ? '#10B981' : '#3B82F6'
                                        }
                                    }} 
                                    title={`Progress: ${Math.round(progress)}%`}
                                />
                            </Box>
                        )}
                    </Box>
                </Box>
            }
        >
            {node.children.map((child) => (
                <TaskTreeNode key={child.id} node={child} onTaskClick={onTaskClick} selectedTaskId={selectedTaskId} />
            ))}
        </TreeItem>
    );
};
