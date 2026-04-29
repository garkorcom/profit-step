import React, { useState, useCallback, Suspense } from 'react';
import { Box, Typography, Paper, CircularProgress, Alert, Stack, Button, Skeleton, Chip, TextField, InputAdornment, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, IconButton, Tooltip } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import CloseIcon from '@mui/icons-material/Close';
import DescriptionIcon from '@mui/icons-material/Description';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SearchIcon from '@mui/icons-material/Search';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';

import { useAuth } from '../../../auth/AuthContext';
import { useHierarchyTree } from '../../../hooks/useHierarchyTree';
import { TaskTree } from './hierarchy/TaskTree';
import { useTask, useUpdateWiki } from '../../../hooks/useTasktotime';
import { formatDate } from '../../../utils/dateFormatters';
import { FALLBACK_CHIP, LIFECYCLE_COLORS, PRIORITY_COLORS, resolvePriorityKey } from '../../../components/tasktotime/visualTokens';

const WikiEditor = React.lazy(() => import('../../../components/tasktotime/WikiEditor'));

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function placeholderAttachmentUpload(file: File): Promise<string> {
    await sleep(500);
    return 'https://placehold.co/600x400';
}

interface WikiDetailViewProps {
    taskId: string;
    companyId: string;
    onDirtyStateChange: (isDirty: boolean) => void;
    isFullScreen: boolean;
    onToggleFullScreen: () => void;
}

const WikiDetailView: React.FC<WikiDetailViewProps> = ({ taskId, companyId, onDirtyStateChange, isFullScreen, onToggleFullScreen }) => {
    const { task, loading, error, refetch } = useTask(taskId, companyId);
    const updateWiki = useUpdateWiki();

    const [wikiEditing, setWikiEditing] = useState<boolean>(false);
    const [wikiDraft, setWikiDraft] = useState<string>('');
    const [wikiSaveError, setWikiSaveError] = useState<string | null>(null);

    // Notify parent about dirty state
    React.useEffect(() => {
        if (!wikiEditing) {
            onDirtyStateChange(false);
        } else {
            const isDirty = wikiDraft !== (task?.wiki?.contentMd ?? '');
            onDirtyStateChange(isDirty);
        }
    }, [wikiEditing, wikiDraft, task?.wiki?.contentMd, onDirtyStateChange]);

    const handleWikiEditStart = useCallback(() => {
        setWikiDraft(task?.wiki?.contentMd ?? '');
        setWikiSaveError(null);
        updateWiki.reset();
        setWikiEditing(true);
    }, [task, updateWiki]);

    const handleWikiCancel = useCallback(() => {
        setWikiEditing(false);
        setWikiDraft('');
        setWikiSaveError(null);
        updateWiki.reset();
    }, [updateWiki]);

    const handleWikiSave = useCallback(async () => {
        if (!task || !companyId) return;
        setWikiSaveError(null);
        try {
            await updateWiki.mutate({
                taskId: task.id,
                companyId,
                input: {
                    contentMd: wikiDraft,
                    expectedVersion: task.wiki?.version ?? 0,
                },
            });
            setWikiEditing(false);
            setWikiDraft('');
            refetch();
        } catch (err) {
            if (err instanceof Error && !updateWiki.conflict) {
                setWikiSaveError(err.message);
            } else if (!(err instanceof Error)) {
                setWikiSaveError(String(err));
            }
        }
    }, [companyId, refetch, task, updateWiki, wikiDraft]);

    const handleWikiReload = useCallback(() => {
        updateWiki.reset();
        setWikiEditing(false);
        setWikiDraft('');
        setWikiSaveError(null);
        refetch();
    }, [refetch, updateWiki]);

    if (loading && !task) {
        return (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4 }}>
                <CircularProgress />
            </Box>
        );
    }

    if (error && !task) {
        return (
            <Alert severity="error" action={<Button onClick={refetch}>Retry</Button>}>
                Failed to load task details.
            </Alert>
        );
    }

    if (!task) return null;

    const lifecycleStyle = LIFECYCLE_COLORS[task.lifecycle] ?? FALLBACK_CHIP;
    const priorityKey = resolvePriorityKey(task.priority);
    const priorityStyle = (priorityKey && PRIORITY_COLORS[priorityKey]) ?? FALLBACK_CHIP;

    return (
        <Box sx={{ maxWidth: '1000px', mx: 'auto' }}>
            <Box sx={{ mb: 4 }}>
                <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                    <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary', fontWeight: 600 }}>
                        {task.taskNumber}
                    </Typography>
                    <Chip label={task.lifecycle} size="small" sx={{ bgcolor: lifecycleStyle.bg, color: lifecycleStyle.fg, fontWeight: 600, height: 20 }} />
                    <Chip label={priorityKey || task.priority} size="small" sx={{ bgcolor: priorityStyle.bg, color: priorityStyle.fg, fontWeight: 600, height: 20 }} />
                </Stack>
                <Typography variant="h4" fontWeight={700} gutterBottom>
                    {task.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    {task.description || 'No description provided.'}
                </Typography>
            </Box>

            <Paper elevation={0} sx={{ p: { xs: 2, md: 3 }, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
                    <Stack direction="row" alignItems="center" spacing={1.5}>
                        <Typography variant="h6" fontWeight={600}>Wiki Document</Typography>
                        {task.wiki && task.wiki.version > 0 && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>
                                v{task.wiki.version} · updated {formatDate(task.wiki.updatedAt)}
                            </Typography>
                        )}
                    </Stack>
                    
                    <Stack direction="row" spacing={1} alignItems="center">
                        <Tooltip title={isFullScreen ? "Exit Full Screen" : "Full Screen"}>
                            <IconButton onClick={onToggleFullScreen} size="small">
                                {isFullScreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
                            </IconButton>
                        </Tooltip>
                        {wikiEditing ? (
                            <Stack direction="row" spacing={1}>
                                <Button size="small" color="inherit" onClick={handleWikiCancel} disabled={updateWiki.loading} startIcon={<CloseIcon fontSize="small" />}>
                                    Cancel
                                </Button>
                                <Button size="small" variant="contained" onClick={handleWikiSave} disabled={updateWiki.loading} startIcon={updateWiki.loading ? <CircularProgress size={14} color="inherit" /> : <SaveIcon fontSize="small" />}>
                                    Save
                                </Button>
                            </Stack>
                        ) : (
                            <Button size="small" variant="outlined" onClick={handleWikiEditStart} startIcon={<EditIcon fontSize="small" />}>
                                Edit Wiki
                            </Button>
                        )}
                    </Stack>
                </Stack>

                {updateWiki.conflict && (
                    <Alert severity="warning" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={handleWikiReload}>Reload</Button>}>
                        Wiki was edited by someone else. Reload to pick up the latest version.
                    </Alert>
                )}

                {wikiSaveError && !updateWiki.conflict && (
                    <Alert severity="error" sx={{ mb: 2 }} onClose={() => setWikiSaveError(null)}>
                        {wikiSaveError}
                    </Alert>
                )}

                {!wikiEditing && (!task.wiki || !task.wiki.contentMd) && (
                    <Box sx={{ py: 6, textAlign: 'center', bgcolor: '#F8FAFC', borderRadius: 2, border: '1px dashed', borderColor: 'divider' }}>
                        <DescriptionIcon sx={{ color: 'text.disabled', fontSize: 56, mb: 2, opacity: 0.5 }} />
                        <Typography variant="h6" color="text.primary" gutterBottom fontWeight={600}>
                            No Documentation Yet
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 400, mx: 'auto' }}>
                            Start building a knowledge base for this task. Your notes, decisions, and documentation will be available to the whole team.
                        </Typography>
                        <Button variant="contained" onClick={handleWikiEditStart} startIcon={<AddCircleOutlineIcon />} disableElevation sx={{ borderRadius: 2, px: 3 }}>
                            Create Wiki Page
                        </Button>
                    </Box>
                )}

                {(wikiEditing || (task.wiki && task.wiki.contentMd)) && (
                    <Suspense fallback={<Skeleton variant="rectangular" height={280} />}>
                        <Box sx={{ mt: 2 }}>
                            <WikiEditor
                                value={wikiEditing ? wikiDraft : task.wiki?.contentMd ?? ''}
                                onChange={setWikiDraft}
                                readOnly={!wikiEditing}
                                onAttachmentUpload={placeholderAttachmentUpload}
                            />
                        </Box>
                    </Suspense>
                )}
            </Paper>
        </Box>
    );
};

const WikiPage: React.FC = () => {
    const { userProfile } = useAuth();
    const companyId = userProfile?.companyId;

    const { tree, loading, error } = useHierarchyTree(companyId);
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

    // New states for UX improvements
    const [searchQuery, setSearchQuery] = useState('');
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);

    // Local search filter
    const filteredTree = React.useMemo(() => {
        if (!searchQuery.trim()) return tree;
        const lowerQuery = searchQuery.toLowerCase();
        
        // Recursive filter
        const filterNodes = (nodes: any[]): any[] => {
            return nodes.map(node => {
                const matches = node.title.toLowerCase().includes(lowerQuery) || node.taskNumber.toLowerCase().includes(lowerQuery);
                const filteredChildren = filterNodes(node.children);
                if (matches || filteredChildren.length > 0) {
                    return { ...node, children: filteredChildren };
                }
                return null;
            }).filter(Boolean);
        };
        return filterNodes(tree);
    }, [tree, searchQuery]);

    const handleTaskSelect = (taskId: string | null) => {
        if (hasUnsavedChanges && taskId !== selectedTaskId) {
            setPendingTaskId(taskId || '__clear__');
        } else {
            setSelectedTaskId(taskId);
        }
    };

    const handleConfirmDiscard = () => {
        setHasUnsavedChanges(false);
        if (pendingTaskId) {
            setSelectedTaskId(pendingTaskId === '__clear__' ? null : pendingTaskId);
        }
        setPendingTaskId(null);
    };

    return (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ p: { xs: 2, sm: 3 }, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
                <Typography variant="h4" component="h1" fontWeight={700}>
                    Knowledge Base
                </Typography>
                <Typography variant="body1" color="text.secondary">
                    Select a task from the hierarchy to view and edit its documentation.
                </Typography>
            </Box>

            <Box sx={{ flexGrow: 1, display: 'flex', overflow: 'hidden' }}>
                {/* Left Sidebar: Task Tree */}
                <Box 
                    sx={{ 
                        width: { xs: '100%', md: 350 }, 
                        flexShrink: 0, 
                        borderRight: '1px solid', 
                        borderColor: 'divider', 
                        display: { xs: selectedTaskId ? 'none' : 'flex', md: isFullScreen ? 'none' : 'flex' },
                        flexDirection: 'column',
                        bgcolor: 'background.paper',
                        transition: 'width 0.2s ease',
                    }}
                >
                    <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
                        <TextField
                            fullWidth
                            size="small"
                            placeholder="Search tasks..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            InputProps={{
                                startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
                            }}
                        />
                    </Box>

                    {loading && tree.length === 0 ? (
                        <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}><CircularProgress /></Box>
                    ) : error ? (
                        <Alert severity="error" sx={{ m: 2 }}>Failed to load hierarchy</Alert>
                    ) : filteredTree.length === 0 ? (
                        <Box sx={{ p: 4, textAlign: 'center' }}><Typography color="text.secondary">No tasks found.</Typography></Box>
                    ) : (
                        <Box sx={{ p: 2, flexGrow: 1, overflowY: 'auto' }}>
                            <TaskTree data={filteredTree} onTaskClick={handleTaskSelect} selectedTaskId={selectedTaskId} />
                        </Box>
                    )}
                </Box>

                {/* Right Content Area: Wiki Editor */}
                <Box 
                    sx={{ 
                        flexGrow: 1, 
                        overflowY: 'auto', 
                        bgcolor: '#F9FAFB', 
                        display: { xs: !selectedTaskId ? 'none' : 'block', md: 'block' }
                    }}
                >
                    {selectedTaskId && companyId ? (
                        <Box sx={{ p: { xs: 2, sm: 3, md: isFullScreen ? 2 : 4 }, maxWidth: isFullScreen ? 'none' : 1200, mx: 'auto', transition: 'all 0.2s ease' }}>
                            {/* Mobile back button */}
                            <Box sx={{ display: { xs: 'block', md: 'none' }, mb: 2 }}>
                                <Button startIcon={<ArrowBackIcon />} onClick={() => handleTaskSelect(null)}>
                                    Back to Tasks
                                </Button>
                            </Box>
                            <WikiDetailView 
                                taskId={selectedTaskId} 
                                companyId={companyId} 
                                onDirtyStateChange={setHasUnsavedChanges}
                                isFullScreen={isFullScreen}
                                onToggleFullScreen={() => setIsFullScreen(prev => !prev)}
                            />
                        </Box>
                    ) : (
                        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 4 }}>
                            <DescriptionIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
                            <Typography variant="h6" color="text.secondary" gutterBottom>
                                No Task Selected
                            </Typography>
                            <Typography variant="body2" color="text.disabled">
                                Select a task from the sidebar to view its Wiki documentation.
                            </Typography>
                        </Box>
                    )}
                </Box>
            </Box>

            {/* Unsaved Changes Dialog */}
            <Dialog open={Boolean(pendingTaskId)} onClose={() => setPendingTaskId(null)}>
                <DialogTitle>Unsaved Changes</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        You have unsaved changes in the current wiki. Are you sure you want to switch tasks? Your changes will be lost.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setPendingTaskId(null)} color="inherit">Cancel</Button>
                    <Button onClick={handleConfirmDiscard} color="error" variant="contained" disableElevation>Discard Changes</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default WikiPage;
