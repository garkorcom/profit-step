/**
 * @fileoverview Tasktotime — Layout shell.
 *
 * Hosts a left sidebar (top-level navigation between the eventual 10 views)
 * and an `<Outlet />` content slot. Phase 4.0 only ships ONE working view
 * (Task List) — the rest of the items are placeholders that point back to
 * the list with a "Coming soon" UI inside the page itself.
 *
 * Style mirrors the existing house pattern in `UnifiedTasksPage`:
 *   - white surface, single-pixel border-bottom on header
 *   - SF Pro / system font in the title
 *   - flex column with `overflow: hidden` so internal scroll containers can
 *     own their own viewport without bleeding into the parent
 */

import React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
    Box,
    Drawer,
    List,
    ListItem,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    Toolbar,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import ViewListIcon from '@mui/icons-material/ViewList';
import ViewKanbanIcon from '@mui/icons-material/ViewKanban';
import TimelineIcon from '@mui/icons-material/Timeline';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import HubIcon from '@mui/icons-material/Hub';
import InboxIcon from '@mui/icons-material/Inbox';
import DescriptionIcon from '@mui/icons-material/Description';
import ArchitectureIcon from '@mui/icons-material/Architecture';
import AssessmentIcon from '@mui/icons-material/Assessment';

const SIDEBAR_WIDTH = 220;

interface NavItem {
    to: string;
    label: string;
    icon: React.ReactNode;
    /**
     * `true` when this view is wired up. Phase 4.0 only has the list; later
     * PRs will flip these to `true` as the views land.
     */
    enabled: boolean;
}

const NAV_ITEMS: NavItem[] = [
    { to: 'list', label: 'List', icon: <ViewListIcon />, enabled: true },
    { to: 'inbox', label: 'Inbox', icon: <InboxIcon />, enabled: false },
    { to: 'board', label: 'Board', icon: <ViewKanbanIcon />, enabled: false },
    { to: 'timeline', label: 'Timeline', icon: <TimelineIcon />, enabled: false },
    { to: 'calendar', label: 'Calendar', icon: <CalendarMonthIcon />, enabled: false },
    { to: 'gantt', label: 'Gantt', icon: <ArchitectureIcon />, enabled: false },
    { to: 'graph', label: 'Graph', icon: <HubIcon />, enabled: false },
    { to: 'hierarchy', label: 'Hierarchy', icon: <AccountTreeIcon />, enabled: false },
    { to: 'wiki', label: 'Wiki', icon: <DescriptionIcon />, enabled: false },
    { to: 'reports', label: 'Reports', icon: <AssessmentIcon />, enabled: false },
];

/**
 * Sidebar — vertical nav. Disabled items render with reduced opacity but
 * still navigate (the target page renders a "Coming soon" placeholder so the
 * user gets feedback; saves us from hard-disabled routes that are confusing
 * when shared via URL).
 */
const TasktotimeSidebar: React.FC = () => {
    const location = useLocation();
    return (
        <List dense disablePadding sx={{ pt: 1 }}>
            {NAV_ITEMS.map((item) => {
                const isActive =
                    location.pathname.endsWith(`/tasktotime/${item.to}`) ||
                    (item.to === 'list' && location.pathname.endsWith('/tasktotime'));
                return (
                    <ListItem key={item.to} disablePadding>
                        <ListItemButton
                            component={NavLink}
                            to={item.to}
                            selected={isActive}
                            sx={{
                                opacity: item.enabled ? 1 : 0.55,
                                py: 0.75,
                                '&.Mui-selected': {
                                    bgcolor: '#E3F2FD',
                                    '&:hover': { bgcolor: '#E3F2FD' },
                                },
                            }}
                        >
                            <ListItemIcon sx={{ minWidth: 36, color: isActive ? '#007AFF' : '#6B7280' }}>
                                {item.icon}
                            </ListItemIcon>
                            <ListItemText
                                primary={item.label}
                                primaryTypographyProps={{
                                    fontSize: '0.875rem',
                                    fontWeight: isActive ? 600 : 500,
                                    color: isActive ? '#007AFF' : '#374151',
                                }}
                            />
                        </ListItemButton>
                    </ListItem>
                );
            })}
        </List>
    );
};

const TasktotimeLayout: React.FC = () => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    return (
        <Box sx={{ display: 'flex', flex: 1, height: '100%', overflow: 'hidden', bgcolor: '#FAFBFC' }}>
            {/* Sidebar — hidden on mobile (Phase 4.0 — mobile drawer toggle is a follow-up) */}
            {!isMobile && (
                <Drawer
                    variant="permanent"
                    sx={{
                        width: SIDEBAR_WIDTH,
                        flexShrink: 0,
                        '& .MuiDrawer-paper': {
                            width: SIDEBAR_WIDTH,
                            boxSizing: 'border-box',
                            position: 'relative',
                            borderRight: '1px solid #E0E0E0',
                            bgcolor: '#FFFFFF',
                        },
                    }}
                >
                    <Toolbar
                        sx={{
                            minHeight: 56,
                            px: 2,
                            borderBottom: '1px solid #E0E0E0',
                        }}
                        disableGutters
                    >
                        <Typography
                            variant="subtitle1"
                            fontWeight={700}
                            sx={{
                                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
                                pl: 2,
                            }}
                        >
                            Tasktotime
                        </Typography>
                    </Toolbar>
                    <TasktotimeSidebar />
                </Drawer>
            )}

            {/* Content slot */}
            <Box
                component="main"
                sx={{
                    flex: 1,
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                }}
            >
                <Outlet />
            </Box>
        </Box>
    );
};

export default TasktotimeLayout;
