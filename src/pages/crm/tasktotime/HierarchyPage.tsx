import React, { useCallback, useMemo } from 'react';
import { Box, Typography, Paper, CircularProgress, Alert } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../../../auth/AuthContext';
import { useHierarchyTree } from '../../../hooks/useHierarchyTree';
import { tasktotimeApi } from '../../../api/tasktotimeApi';
import { HierarchyNode } from './hierarchy/utils';
import { TaskTree } from './hierarchy/TaskTree';

const HierarchyPage: React.FC = () => {
    const { userProfile } = useAuth();
    const navigate = useNavigate();
    const companyId = userProfile?.companyId;

    const { tree, loading, error, refetch } = useHierarchyTree(companyId);

    const handleTaskClick = useCallback((taskId: string) => {
        navigate(`/crm/tasktotime/tasks/${taskId}`);
    }, [navigate]);

    const handleTaskDrop = useCallback(async (taskId: string, targetParentId: string) => {
        if (!companyId) return;
        try {
            await tasktotimeApi.updateTask({
                companyId,
                taskId,
                updates: { parentTaskId: targetParentId }
            });
            toast.success('Task moved');
            refetch();
        } catch (err) {
            console.error('Failed to move task:', err);
            toast.error('Failed to move task — reverting');
            // Re-fetch so the optimistic visual revert matches server state.
            refetch();
        }
    }, [companyId, refetch]);

    const stats = useMemo(() => {
        let total = 0;
        let completedOrAccepted = 0;
        const traverse = (nodes: HierarchyNode[]) => {
            for (const node of nodes) {
                total++;
                if (node.lifecycle === 'completed' || node.lifecycle === 'accepted') {
                    completedOrAccepted++;
                }
                traverse(node.children);
            }
        };
        traverse(tree);
        return { total, completedOrAccepted };
    }, [tree]);

    return (
        <Box sx={{ p: { xs: 2, sm: 3 }, height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                    <Typography variant="h4" component="h1" gutterBottom fontWeight={700}>
                        Hierarchy View
                    </Typography>
                    <Typography variant="body1" color="text.secondary">
                        Drag and drop tasks to reorganize them.
                    </Typography>
                </Box>
                {stats.total > 0 && (
                    <Paper sx={{ p: 2, bgcolor: stats.total === stats.completedOrAccepted ? 'success.light' : 'background.paper', border: '1px solid', borderColor: 'divider' }}>
                        <Typography variant="body2" fontWeight={600} color={stats.total === stats.completedOrAccepted ? 'success.contrastText' : 'text.primary'}>
                            {stats.total === stats.completedOrAccepted ? 'All tasks accepted/completed!' : `Progress: ${stats.completedOrAccepted} / ${stats.total} completed`}
                        </Typography>
                    </Paper>
                )}
            </Box>

            <Paper 
                elevation={0} 
                sx={{ 
                    flexGrow: 1, 
                    display: 'flex', 
                    flexDirection: 'column', 
                    border: '1px solid', 
                    borderColor: 'divider',
                    borderRadius: 2,
                    overflow: 'hidden'
                }}
            >
                {loading && tree.length === 0 ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexGrow: 1 }}>
                        <CircularProgress />
                    </Box>
                ) : error ? (
                    <Box sx={{ p: 3 }}>
                        <Alert severity="error">{error.message || 'Failed to load hierarchy'}</Alert>
                    </Box>
                ) : tree.length === 0 ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexGrow: 1 }}>
                        <Typography color="text.secondary">No tasks found</Typography>
                    </Box>
                ) : (
                    <Box sx={{ p: 2, flexGrow: 1, overflowY: 'auto' }}>
                        <TaskTree data={tree} onTaskClick={handleTaskClick} onTaskDrop={handleTaskDrop} />
                    </Box>
                )}
            </Paper>
        </Box>
    );
};

export default HierarchyPage;
