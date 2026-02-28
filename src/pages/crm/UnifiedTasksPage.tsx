/**
 * @fileoverview UnifiedTasksPage - Master view wrapper for all CRM tasks
 *
 * Provides a unified header and layout shell that switches views (Board, Timeline, Calendar, Table, Map)
 * based on the `?view=` URL parameter.
 * Stores the user's preferred view in localStorage.
 */

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Typography, ToggleButtonGroup, ToggleButton, useMediaQuery, useTheme } from '@mui/material';
import ViewListIcon from '@mui/icons-material/ViewList'; // Board
import ViewTimelineIcon from '@mui/icons-material/ViewTimeline'; // Timeline
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'; // Calendar
import TableViewIcon from '@mui/icons-material/TableView'; // Table
import MapIcon from '@mui/icons-material/Map'; // Map
import { useAuth } from '../../auth/AuthContext';
import { useGTDTasks } from '../../hooks/useGTDTasks';

// We import the views directly or via lazy loading. 
// For now, we'll try to directly import the components, or assume they are exported correctly.
import GTDBoard from '../../components/gtd/GTDBoard';
// Assuming TasksMasonryPage and CalendarPage can work without their headers, 
// or we will modify them to hide headers when inside UnifiedTasksPage.
// We will need to adjust those pages later, but for now we render them.
import TasksMasonryPage from './TasksMasonryPage';
import CalendarPage from './CalendarPage';
import TasksTableView from '../../components/tasks-unified/TasksTableView';
import TasksMapView from '../../components/tasks-unified/TasksMapView';

const VALID_VIEWS = ['board', 'timeline', 'calendar', 'table', 'map'] as const;
type ViewType = typeof VALID_VIEWS[number];

const UnifiedTasksPage: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

    const viewParam = searchParams.get('view') as ViewType | null;
    const { currentUser } = useAuth();
    const { columns, loading } = useGTDTasks(currentUser, true); // true to show all tasks
    const tasksCount = Object.values(columns).reduce((acc, col) => acc + col.length, 0);

    const [currentView, setCurrentView] = useState<ViewType>(() => {
        const urlView = searchParams.get('view') as ViewType | null;
        if (urlView && VALID_VIEWS.includes(urlView)) return urlView;

        const storedView = localStorage.getItem('preferredTaskView') as ViewType | null;
        if (storedView && VALID_VIEWS.includes(storedView)) return storedView;

        return 'board';
    });

    useEffect(() => {
        if (viewParam && VALID_VIEWS.includes(viewParam) && viewParam !== currentView) {
            setCurrentView(viewParam);
            localStorage.setItem('preferredTaskView', viewParam);
        } else if (!viewParam) {
            // Push active view to URL if missing
            setSearchParams({ view: currentView }, { replace: true });
        }
    }, [viewParam, currentView, setSearchParams]);

    const handleViewChange = (event: React.MouseEvent<HTMLElement>, newView: ViewType | null) => {
        if (newView !== null) {
            setCurrentView(newView);
            localStorage.setItem('preferredTaskView', newView);
            setSearchParams({ view: newView });
        }
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            {/* Unified Header */}
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                px: { xs: 2, md: 3 },
                py: { xs: 1.5, md: 1 },
                borderBottom: '1px solid #E0E0E0',
                bgcolor: '#FFFFFF',
                flexShrink: 0,
                minHeight: { xs: 'auto', md: 56 }
            }}>
                <Box display="flex" alignItems="center" gap={1.5}>
                    <Typography variant="h6" fontWeight={700} sx={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif' }}>
                        Tasks & Projects
                    </Typography>

                    {!loading && (
                        <Box sx={{
                            bgcolor: '#F3F4F6',
                            color: '#6B7280',
                            px: 1,
                            py: 0.25,
                            borderRadius: '12px',
                            fontSize: '0.75rem',
                            fontWeight: 600
                        }}>
                            {tasksCount} tasks
                        </Box>
                    )}
                </Box>

                {!isMobile && (
                    <ToggleButtonGroup
                        value={currentView}
                        exclusive
                        onChange={handleViewChange}
                        aria-label="Task views"
                        size="small"
                        sx={{
                            '& .MuiToggleButton-root': {
                                px: 1.5,
                                py: 0.5,
                                border: '1px solid #E0E0E0',
                                textTransform: 'none',
                                fontWeight: 500,
                                color: '#6B7280',
                                '&.Mui-selected': {
                                    bgcolor: '#E3F2FD',
                                    color: '#007AFF',
                                    borderColor: '#BBDEFB',
                                    boxShadow: 'none'
                                }
                            }
                        }}
                    >
                        <ToggleButton value="board" aria-label="board view"><ViewListIcon sx={{ mr: 0.5, fontSize: 18 }} /> Board</ToggleButton>
                        <ToggleButton value="timeline" aria-label="timeline view"><ViewTimelineIcon sx={{ mr: 0.5, fontSize: 18 }} /> Timeline</ToggleButton>
                        <ToggleButton value="calendar" aria-label="calendar view"><CalendarMonthIcon sx={{ mr: 0.5, fontSize: 18 }} /> Calendar</ToggleButton>
                        <ToggleButton value="table" aria-label="table view"><TableViewIcon sx={{ mr: 0.5, fontSize: 18 }} /> Table</ToggleButton>
                        <ToggleButton value="map" aria-label="map view"><MapIcon sx={{ mr: 0.5, fontSize: 18 }} /> Map</ToggleButton>
                    </ToggleButtonGroup>
                )}
            </Box>

            {/* Mobile View Switcher (Scrollable if necessary) */}
            {isMobile && (
                <Box sx={{
                    px: 2,
                    py: 1,
                    borderBottom: '1px solid #E0E0E0',
                    bgcolor: '#FAFAFA',
                    overflowX: 'auto',
                    whiteSpace: 'nowrap',
                    '&::-webkit-scrollbar': { display: 'none' }
                }}>
                    <ToggleButtonGroup
                        value={currentView}
                        exclusive
                        onChange={handleViewChange}
                        size="small"
                        sx={{
                            display: 'flex',
                            '& .MuiToggleButton-root': {
                                flex: '0 0 auto',
                                px: 1.5,
                                py: 0.5,
                                mx: 0.5,
                                border: '1px solid #E0E0E0 !important', // Force separate rounded borders
                                borderRadius: '16px !important',
                                textTransform: 'none',
                                '&.Mui-selected': {
                                    bgcolor: '#E3F2FD',
                                    color: '#007AFF',
                                    borderColor: '#BBDEFB !important'
                                }
                            }
                        }}
                    >
                        <ToggleButton value="board"><ViewListIcon sx={{ mr: 0.5, fontSize: 18 }} /> Board</ToggleButton>
                        <ToggleButton value="timeline"><ViewTimelineIcon sx={{ mr: 0.5, fontSize: 18 }} /> Timeline</ToggleButton>
                        <ToggleButton value="calendar"><CalendarMonthIcon sx={{ mr: 0.5, fontSize: 18 }} /> Calendar</ToggleButton>
                        <ToggleButton value="table"><TableViewIcon sx={{ mr: 0.5, fontSize: 18 }} /> Table</ToggleButton>
                        <ToggleButton value="map"><MapIcon sx={{ mr: 0.5, fontSize: 18 }} /> Map</ToggleButton>
                    </ToggleButtonGroup>
                </Box>
            )}

            {/* Rendered View Component */}
            <Box sx={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                {currentView === 'board' && <GTDBoard />}
                {currentView === 'timeline' && <TasksMasonryPage hideHeader={true} />}
                {currentView === 'calendar' && <CalendarPage hideHeader={true} />}
                {currentView === 'table' && <TasksTableView tasks={Object.values(columns).flat()} />}
                {currentView === 'map' && <TasksMapView />}
            </Box>
        </Box>
    );
};

export default UnifiedTasksPage;
