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
 *   - viewport <  md       : `<SwipeableDrawer>` (MUI v7) with native swipe-
 *                            to-open/close gestures + backdrop tap to close.
 *                            The hamburger IconButton mounted inside this
 *                            layout (not in the global Header — keeps the
 *                            scope local to tasktotime) toggles it
 *                            programmatically. Open state persists under
 *                            localStorage key `tasktotime.drawer.open` via
 *                            `useDrawerOpenState` (lazy initializer pattern,
 *                            defensive about Safari private mode / SSR).
 *
 * Phase 4.0 punted the mobile drawer toggle (`isMobile && return null`) which
 * left phone users stuck on whatever view they landed on. PR #86 fixed that
 * with `<Drawer variant="temporary">`. This module is the Phase 4.0 follow-up
 * polish:
 *   - swap `<Drawer variant="temporary">` for `<SwipeableDrawer>` (native
 *     swipe gesture)
 *   - persist open state to localStorage (in-memory still works as fallback)
 *   - make the brand header a clickable link back to `/crm/tasktotime/list`
 *   - keep desktop + mobile pointed at the same `NAV_ITEMS` + same
 *     active-route detection so the two sidebars never drift
 */

import React, { useCallback, useMemo } from 'react';
import { Link as RouterLink, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
    Box,
    IconButton,
    List,
    ListItem,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    SwipeableDrawer,
    Drawer,
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

import { useDrawerOpenState } from './useDrawerOpenState';

const SIDEBAR_WIDTH = 220;
const MOBILE_TOPBAR_HEIGHT = 48;
const TASKTOTIME_HOME = '/crm/tasktotime/list';

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
    { to: 'inbox', label: 'Inbox', icon: <InboxIcon />, enabled: true },
    { to: 'board', label: 'Board', icon: <ViewKanbanIcon />, enabled: true },
    { to: 'timeline', label: 'Timeline', icon: <TimelineIcon />, enabled: false },
    { to: 'calendar', label: 'Calendar', icon: <CalendarMonthIcon />, enabled: true },
    { to: 'gantt', label: 'Gantt', icon: <ArchitectureIcon />, enabled: true },
    { to: 'graph', label: 'Graph', icon: <HubIcon />, enabled: true },
    { to: 'hierarchy', label: 'Hierarchy', icon: <AccountTreeIcon />, enabled: true },
    { to: 'wiki', label: 'Wiki', icon: <DescriptionIcon />, enabled: true },
    { to: 'reports', label: 'Reports', icon: <AssessmentIcon />, enabled: false },
];

/**
 * Single source of truth for "which nav item is active given a pathname".
 *
 * Both the desktop (permanent Drawer) and mobile (SwipeableDrawer) branches
 * call into the same `<TasktotimeSidebar />` so they automatically share this
 * detection — but extracting it to a named function makes the contract
 * explicit and easy to grep when future views (board, timeline, etc.) flip
 * `enabled: true`.
 */
const isItemActive = (pathname: string, slug: string): boolean =>
    pathname.endsWith(`/tasktotime/${slug}`) ||
    (slug === 'list' && pathname.endsWith('/tasktotime'));

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
                const isActive = isItemActive(location.pathname, item.to);
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

interface SidebarHeaderProps {
    /**
     * When set, renders a close (×) button. Mobile passes a handler so the
     * drawer can be dismissed from inside as well as via swipe / backdrop.
     */
    onClose?: () => void;
    /**
     * When `true`, the brand title behaves as a tap target that navigates back
     * to the tasktotime home (`/crm/tasktotime/list`). Mobile branch passes
     * `true` so phone users can recover from a deep coming-soon placeholder
     * with a single tap on the title; desktop keeps it static because the
     * permanent sidebar already shows "List" highlighted in the nav.
     */
    asHomeLink?: boolean;
}

/**
 * Drawer header — shared between the permanent (desktop) and SwipeableDrawer
 * (mobile) variants. On mobile a close button is rendered so the drawer can
 * be dismissed from inside as well as via swipe / backdrop tap, AND the
 * brand title becomes a `RouterLink` back to the list view.
 */
const SidebarHeader: React.FC<SidebarHeaderProps> = ({ onClose, asHomeLink }) => {
    // Title content, optionally wrapped in a RouterLink. Underline removed via
    // `sx` since MUI Typography → RouterLink doesn't get our default link
    // styling, and we want the visual to stay identical to the static text
    // version on desktop.
    const titleNode = (
        <Typography
            variant="subtitle1"
            fontWeight={700}
            sx={{
                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
                pl: 2,
                color: 'inherit',
                textDecoration: 'none',
            }}
        >
            Tasktotime
        </Typography>
    );

    return (
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
            {asHomeLink ? (
                <Box
                    component={RouterLink}
                    to={TASKTOTIME_HOME}
                    onClick={onClose}
                    aria-label="Tasktotime home"
                    sx={{
                        // Make the whole left chunk tappable (≥ 44px high
                        // counts toward WCAG 2.2 §2.5.8 target size).
                        display: 'flex',
                        alignItems: 'center',
                        flex: 1,
                        minHeight: 44,
                        textDecoration: 'none',
                        color: 'inherit',
                        borderRadius: 1,
                        // Subtle hover/active affordance so the link is
                        // discoverable on touch + on stylus tap.
                        '&:hover': { bgcolor: 'rgba(0, 122, 255, 0.04)' },
                        '&:focus-visible': {
                            outline: '2px solid #007AFF',
                            outlineOffset: 2,
                        },
                    }}
                >
                    {titleNode}
                </Box>
            ) : (
                titleNode
            )}
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
};

/**
 * Detect iOS once per render so SwipeableDrawer can pick the right
 * gesture-recognition mode. MUI's docs recommend:
 *   - `disableBackdropTransition={!iOS}` — Android benefits from skipping
 *     the backdrop transition (cheaper paint), iOS wants it
 *   - `disableDiscovery={iOS}` — iOS users get edge-swipe-back from the OS,
 *     so the SwipeableDrawer's own discovery tooltip would conflict
 */
const detectIOS = (): boolean => {
    if (typeof navigator === 'undefined') return false;
    return /iPad|iPhone|iPod/.test(navigator.userAgent);
};

const TasktotimeLayout: React.FC = () => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const { open: mobileOpen, handleOpen, handleClose, setOpen } = useDrawerOpenState();

    // iOS detection is stable across the component lifetime — useMemo so we
    // don't re-run the regex on every render.
    const iOS = useMemo(detectIOS, []);

    // Close drawer after navigation on mobile; desktop passes undefined so
    // selecting an item is a no-op for drawer state.
    const handleNavigate = useCallback(() => {
        if (isMobile) setOpen(false);
    }, [isMobile, setOpen]);

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

            {/* Mobile sidebar — SwipeableDrawer; opens via hamburger, swipe,
                or programmatic restore from localStorage. Closes via swipe,
                backdrop tap, close button, or nav-item tap. */}
            {isMobile && (
                <SwipeableDrawer
                    anchor="left"
                    open={mobileOpen}
                    onOpen={handleOpen}
                    onClose={handleClose}
                    // MUI-recommended platform tuning for swipe gesture:
                    disableBackdropTransition={!iOS}
                    disableDiscovery={iOS}
                    ModalProps={{
                        // Keeps the DOM mounted so route transitions inside the
                        // drawer don't unmount NavLink active state, and so the
                        // restore-from-localStorage open state on mount doesn't
                        // race the first paint.
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
                    <SidebarHeader onClose={handleClose} asHomeLink />
                    <TasktotimeSidebar onNavigate={handleNavigate} />
                </SwipeableDrawer>
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
                            component={RouterLink}
                            to={TASKTOTIME_HOME}
                            variant="subtitle1"
                            fontWeight={700}
                            sx={{
                                ml: 1,
                                fontFamily:
                                    '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
                                color: 'inherit',
                                textDecoration: 'none',
                                // WCAG 2.2 target size — pad the inline link so
                                // a tap on the title hits ≥ 44px tall.
                                py: 1,
                                pr: 1,
                                '&:focus-visible': {
                                    outline: '2px solid #007AFF',
                                    outlineOffset: 2,
                                    borderRadius: 4,
                                },
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
