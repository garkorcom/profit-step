import type { TaskDto } from '../../../../api/tasktotimeApi';

export interface HierarchyNode extends TaskDto {
    children: HierarchyNode[];
}

export function buildHierarchyTree(tasks: TaskDto[]): HierarchyNode[] {
    const nodeMap = new Map<string, HierarchyNode>();
    const roots: HierarchyNode[] = [];

    // Initialize node map
    for (const task of tasks) {
        nodeMap.set(task.id, { ...task, children: [] });
    }

    // Build hierarchy
    for (const task of tasks) {
        const node = nodeMap.get(task.id)!;
        if (task.parentTaskId && nodeMap.has(task.parentTaskId)) {
            nodeMap.get(task.parentTaskId)!.children.push(node);
        } else {
            // Roots are either tasks without parentTaskId or tasks whose parent is missing
            roots.push(node);
        }
    }

    return roots;
}
