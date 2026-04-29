import React, { useMemo } from 'react';
import { SimpleTreeView } from '@mui/x-tree-view/SimpleTreeView';
import { DndContext, DragEndEvent, closestCenter, useSensor, useSensors, PointerSensor } from '@dnd-kit/core';
import { HierarchyNode } from './utils';
import { TaskTreeNode } from './TaskTreeNode';

interface TaskTreeProps {
    data: HierarchyNode[];
    onTaskClick: (taskId: string) => void;
    selectedTaskId?: string | null;
    onTaskDrop?: (taskId: string, targetParentId: string) => void;
}

export const TaskTree: React.FC<TaskTreeProps> = ({ data, onTaskClick, selectedTaskId, onTaskDrop }) => {
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
    );

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            onTaskDrop?.(String(active.id), String(over.id));
        }
    };

    // Collect all IDs to expand by default
    const allIds = useMemo(() => {
        const ids: string[] = [];
        const traverse = (nodes: HierarchyNode[]) => {
            for (const node of nodes) {
                ids.push(node.id);
                if (node.children.length > 0) traverse(node.children);
            }
        };
        traverse(data);
        return ids;
    }, [data]);

    return (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SimpleTreeView
            defaultExpandedItems={allIds}
            sx={{
                flexGrow: 1,
                overflowY: 'auto',
                // Make hover state distinct
                '& .MuiTreeItem-content': {
                    padding: '2px 8px',
                    borderRadius: 1,
                },
            }}
        >
            {data.map((node) => (
                <TaskTreeNode key={node.id} node={node} onTaskClick={onTaskClick} selectedTaskId={selectedTaskId} />
            ))}
            </SimpleTreeView>
        </DndContext>
    );
};
