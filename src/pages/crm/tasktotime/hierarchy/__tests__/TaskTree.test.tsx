import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TaskTree } from '../TaskTree';
import { buildHierarchyTree } from '../utils';
import type { TaskDto } from '../../../../../api/tasktotimeApi';

describe('Hierarchy View', () => {
    describe('buildHierarchyTree', () => {
        it('transforms flat list into tree', () => {
            const flatTasks = [
                { id: '1', title: 'Root A', parentTaskId: undefined } as unknown as TaskDto,
                { id: '2', title: 'Child A1', parentTaskId: '1' } as unknown as TaskDto,
                { id: '3', title: 'Root B', parentTaskId: undefined } as unknown as TaskDto,
                { id: '4', title: 'Child B1', parentTaskId: '3' } as unknown as TaskDto,
                { id: '5', title: 'Grandchild B1.1', parentTaskId: '4' } as unknown as TaskDto, // Though max depth is 2, algorithm should handle any depth
            ];

            const tree = buildHierarchyTree(flatTasks);

            expect(tree.length).toBe(2);
            expect(tree[0].id).toBe('1');
            expect(tree[0].children.length).toBe(1);
            expect(tree[0].children[0].id).toBe('2');

            expect(tree[1].id).toBe('3');
            expect(tree[1].children.length).toBe(1);
            expect(tree[1].children[0].id).toBe('4');
            expect(tree[1].children[0].children.length).toBe(1);
            expect(tree[1].children[0].children[0].id).toBe('5');
        });

        it('handles orphan subtasks as roots', () => {
            const flatTasks = [
                { id: '2', title: 'Orphan Child', parentTaskId: 'missing-root' } as unknown as TaskDto,
            ];

            const tree = buildHierarchyTree(flatTasks);

            expect(tree.length).toBe(1);
            expect(tree[0].id).toBe('2');
        });
    });

    describe('TaskTree Component', () => {
        it('renders tree items correctly', () => {
            const mockData = [
                {
                    id: 'root-1',
                    taskNumber: 'TSK-001',
                    title: 'Test Root Task',
                    lifecycle: 'ready',
                    priority: 'high',
                    children: [
                        {
                            id: 'child-1',
                            taskNumber: 'TSK-002',
                            title: 'Test Subtask',
                            lifecycle: 'draft',
                            priority: 'low',
                            children: [],
                        } as any
                    ]
                } as any
            ];

            const onTaskClick = jest.fn();

            render(<TaskTree data={mockData} onTaskClick={onTaskClick} />);

            expect(screen.getByText('TSK-001 • Test Root Task')).toBeInTheDocument();
            expect(screen.getByText('TSK-002 • Test Subtask')).toBeInTheDocument();
            expect(screen.getByText('ready')).toBeInTheDocument();
            expect(screen.getByText('draft')).toBeInTheDocument();
        });
    });
});
