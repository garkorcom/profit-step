/**
 * @fileoverview Tasktotime — Layout shell.
 *
 * Hosts a left sidebar (top-level navigation between the eventual 10 views)
 * and an `<Outlet />` content slot. Phase 4.0 shipped ONE working view (Task
 * List) — the rest of the items are placeholders that point back to the list
 * with a "Coming soon" UI inside the page itself.
 *
 * Style mirrors the existing house pattern in `UnifiedTasksPage`:
 *   - white surface, single-pixel border-bottom on header
 *   - SF Pro / system font in the title
 *   - flex column with `overflow: hidden` so internal scroll containers can
 *     own their own viewport without bleeding into the parent
 *
 * Responsive behaviour:
 *   - viewport ≥ md (900px): permanent left Drawer, no hamburger.
 *   - viewport <  md       : Drawer is `variant="temporary"`, toggled by a
 *                            hamburger IconButton mounted inside this layout
 *                            (not in the global Header — keeps the scope
 *                            local to tasktotime). Tapping a nav item or the
 *                            backdrop closes the drawer. State lives in
 *                            component memory only — no localStorage.
 *
 * Phase 4.0 punted the mobile drawer toggle (`isMobile && return null`) which
 * left phone users stuck on whatever view they landed on. This module fixes
 * that without touching routing, hooks, the API client, WikiEditor, or the
 * Task pages.
 */

import React, { useCallback, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
    Box,
    Drawer,
    IconButton,
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
import MenuIcon from '@mui/icons-material/Menu';
import CloseIcon from '@mui/icons-material/Close';
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
const MOBILE_TOPBAR_HEIGHT = 48;

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
    { to: 'board', label: 'Board', icon: <ViewKanbanIcon />, enabled: true },
    { to: 'timeline', label: 'Timeline', icon: <TimelineIcon />, enabled: false },
    { to: 'calendar', label: 'Calendar', icon: <CalendarMonthIcon />, enabled: false },
    { to: 'gantt', label: 'Gantt', icon: <ArchitectureIcon />, enabled: false },
    { to: 'graph', label: 'Graph', icon: <HubIcon />, enabled: false },
    { to: 'hierarchy', label: 'Hierarchy', icon: <AccountTreeIcon />, enabled: false },
    { to: 'wiki', label: 'Wiki', icon: <DescriptionIcon />, enabled: false },
    { to: 'reports', label: 'Reports', icon: <AssessmentIcon />, enabled: false },
];

interface TasktotimeSidebarProps {
    /**
     * Fired after a nav item is selected. The mobile branch uses this to
     * close the temporary drawer; on desktop the parent passes a no-op.
     */
    onNavigate?: () => void;
}

/**
 * Sidebar — vertical nav. Disabled items render with reduced opacity but
 * still navigate (the target page renders a "Coming soon" placeholder so the
 * user gets feedback; saves us from hard-disabled routes that are confusing
 * when shared via URL).
 */
const TasktotimeSidebar: React.FC<TasktotimeSidebarProps> = ({ onNavigate }) => {
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
                            onClick={onNavigate}
                            // WCAG/ARIA: the Coming Soon items are visually
                            // dimmed but still navigate (target page renders a
                            // placeholder). Mark them `aria-disabled` so
                            // assistive tech announces the disabled state
                            // while we keep the click behaviour. Don't use
                            // the `disabled` prop — that would block the click
                            // entirely and leave the user wondering why
                            // nothing happened.
                            aria-disabled={item.enabled ? undefined : true}
                            sx={{
                                opacity: item.enabled ? 1 : 0.55,
                                py: 0.75,
                                // WCAG 2.2 — interactive target ≥ 24×24px (we're well above)
                                minHeight: 44,
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

/**
 * Drawer header — shared between the permanent (desktop) and temporary
 * (mobile) variants. On mobile a close button is rendered so the drawer can
 * be dismissed from inside as well as via backdrop tap.
 */
const SidebarHeader: React.FC<{ onClose?: () => void }> = ({ onClose }) => (
    <Toolbar
        sx={{
            minHeight: 56,
            px: 2,
            borderBottom: '1px solid #E0E0E0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
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
        {onClose && (
            <IconButton
                aria-label="Close navigation"
                onClick={onClose}
                size="small"
                sx={{ mr: 1 }}
            >
                <CloseIcon fontSize="small" />
            </IconButton>
        )}
    </Toolbar>
);

const TasktotimeLayout: React.FC = () => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const [mobileOpen, setMobileOpen] = useState(false);

    const handleOpen = useCallback(() => setMobileOpen(true), []);
    const handleClose = useCallback(() => setMobileOpen(false), []);
    // Close drawer after navigation on mobile; desktop passes undefined so
    // selecting an item is a no-op for drawer state.
    const handleNavigate = useCallback(() => {
        if (isMobile) setMobileOpen(false);
    }, [isMobile]);

    return (
        <Box sx={{ display: 'flex', flex: 1, height: '100%', overflow: 'hidden', bgcolor: '#FAFBFC' }}>
            {/* Desktop sidebar — permanent, always visible at ≥ md. */}
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
                    <SidebarHeader />
                    <TasktotimeSidebar />
                </Drawer>
            )}

            {/* Mobile sidebar — temporary; controlled by hamburger above. */}
            {isMobile && (
                <Drawer
                    variant="temporary"
                    open={mobileOpen}
                    onClose={handleClose}
                    ModalProps={{
                        // Keeps the DOM mounted so route transitions inside the
                        // drawer don't unmount NavLink active state.
                        keepMounted: true,
                    }}
                    sx={{
                        '& .MuiDrawer-paper': {
                            width: SIDEBAR_WIDTH,
                            boxSizing: 'border-box',
                            bgcolor: '#FFFFFF',
                        },
                    }}
                >
                    <SidebarHeader onClose={handleClose} />
                    <TasktotimeSidebar onNavigate={handleNavigate} />
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
                {/*
                 * Mobile-only top bar. We deliberately do NOT promote this to
                 * the global Header — tasktotime owns its own nav surface so
                 * the hamburger and the title can scroll/clip with this
                 * subtree (e.g. inside future modal-style detail views) and
                 * disappear cleanly when the user routes elsewhere.
                 */}
                {isMobile && (
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            minHeight: MOBILE_TOPBAR_HEIGHT,
                            px: 1,
                            borderBottom: '1px solid #E0E0E0',
                            bgcolor: '#FFFFFF',
                            flexShrink: 0,
                        }}
                    >
                        <IconButton
                            aria-label="Open navigation"
                            onClick={handleOpen}
                            edge="start"
                            // WCAG 2.2 §2.5.8 — minimum 24×24 target. IconButton
                            // default is 40×40 already, but pin minimums so a
                            // theme override can't shrink below threshold.
                            sx={{ minWidth: 40, minHeight: 40 }}
                        >
                            <MenuIcon />
                        </IconButton>
                        <Typography
                            variant="subtitle1"
                            fontWeight={700}
                            sx={{
                                ml: 1,
                                fontFamily:
                                    '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
                            }}
                        >
                            Tasktotime
                        </Typography>
                    </Box>
                )}

                <Outlet />
            </Box>
        </Box>
    );
};

export default TasktotimeLayout;
