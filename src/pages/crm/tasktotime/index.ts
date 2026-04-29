/**
 * @fileoverview Tasktotime page barrel.
 *
 * Re-exports the shell + the views the AppRouter wires. As more views land
 * (board, gantt, wiki editor, etc.), add them here so the router file stays
 * a flat list of imports.
 */

export { default as TasktotimeLayout } from './TasktotimeLayout';
export { default as TaskListPage } from './TaskListPage';
export { default as TaskDetailPage } from './TaskDetailPage';
export { default as BoardPage } from './BoardPage';
export { default as ComingSoonView } from './ComingSoonView';
export { default as HierarchyPage } from './HierarchyPage';
export { default as CalendarPage } from './CalendarPage';
// Phase 4.5 — dependency graph view (lazy-loaded by AppRouter via its own
// dynamic import to keep @xyflow/react out of the main bundle; barrel
// re-export here for symmetry with the other views).
export { default as GraphPage } from './GraphPage';
export { default as GanttPage } from './GanttPage';
export { default as WikiPage } from './WikiPage';
export { useDrawerOpenState } from './useDrawerOpenState';
