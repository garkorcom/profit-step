import React, { useState } from 'react';
import {
  AppBar,
  Toolbar,
  Container,
  Typography,
  Button,
  Box,
  IconButton,
  Avatar,
  Menu,
  MenuItem,
  Divider,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Collapse,
} from '@mui/material';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import {
  Dashboard as DashboardIcon,
  People as PeopleIcon,
  Business as BusinessIcon,
  Description as DescriptionIcon,
  Settings as SettingsIcon,
  Logout as LogoutIcon,
  Person as PersonIcon,
  Menu as MenuIcon,
  Close as CloseIcon,
  Contacts as ContactsIcon,
  ViewWeek as KanbanIcon,
  Assignment as TaskIcon,
  Calculate as CalculateIcon,
  CalendarMonth as CalendarIcon,
  AttachMoney as AttachMoneyIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  ExpandLess,
  ExpandMore,
  Campaign as MarketingIcon,
  Build as ToolsIcon,
  ShoppingCart as ShoppingCartIcon,
  SmartToy as AIIcon,
  AccountBalance as BankIcon,
  Inventory as InventoryIcon,
  Info as InfoIcon,
  Folder as FolderIcon,
  Dns as DnsIcon,
} from '@mui/icons-material';
import { useActiveSession } from '../../hooks/useActiveSession';
import ActiveSessionIndicator from './ActiveSessionIndicator';

/**
 * Header компонент с навигацией и меню пользователя
 */
const Header: React.FC = () => {
  const { userProfile, currentUser, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // User Menu State
  const [anchorElUser, setAnchorElUser] = useState<null | HTMLElement>(null);

  // Nav Menus State
  const [anchorElTasks, setAnchorElTasks] = useState<null | HTMLElement>(null);
  const [anchorElFinance, setAnchorElFinance] = useState<null | HTMLElement>(null);
  const [anchorElOperations, setAnchorElOperations] = useState<null | HTMLElement>(null);
  const [anchorElCRM, setAnchorElCRM] = useState<null | HTMLElement>(null);
  const [anchorElEstimates, setAnchorElEstimates] = useState<null | HTMLElement>(null);
  const [anchorElAdmin, setAnchorElAdmin] = useState<null | HTMLElement>(null);

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Mobile Collapse States
  const [mobileOpenTasks, setMobileOpenTasks] = useState(false);
  const [mobileOpenFinance, setMobileOpenFinance] = useState(false);
  const [mobileOpenOperations, setMobileOpenOperations] = useState(false);
  const [mobileOpenCRM, setMobileOpenCRM] = useState(false);
  const [mobileOpenEstimates, setMobileOpenEstimates] = useState(false);
  const [mobileOpenAdmin, setMobileOpenAdmin] = useState(false);

  const handleUserMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorElUser(event.currentTarget);
  };

  const handleUserMenuClose = () => {
    setAnchorElUser(null);
  };

  const handleLogout = async () => {
    try {
      await signOut();
      navigate('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
    handleUserMenuClose();
  };

  const handleProfileClick = () => {
    navigate('/profile');
    handleUserMenuClose();
  };

  const handleSettingsClick = () => {
    navigate('/settings');
    handleUserMenuClose();
  };

  const toggleMobileMenu = () => {
    setMobileMenuOpen(!mobileMenuOpen);
  };

  const handleMobileMenuClose = () => {
    setMobileMenuOpen(false);
  };

  // --- Handlers for Desktop Dropdowns ---
  const handleOpenTasks = (event: React.MouseEvent<HTMLElement>) => setAnchorElTasks(event.currentTarget);
  const handleCloseTasks = () => setAnchorElTasks(null);

  const handleOpenFinance = (event: React.MouseEvent<HTMLElement>) => setAnchorElFinance(event.currentTarget);
  const handleCloseFinance = () => setAnchorElFinance(null);

  const handleOpenOperations = (event: React.MouseEvent<HTMLElement>) => setAnchorElOperations(event.currentTarget);
  const handleCloseOperations = () => setAnchorElOperations(null);

  const handleOpenCRM = (event: React.MouseEvent<HTMLElement>) => setAnchorElCRM(event.currentTarget);
  const handleCloseCRM = () => setAnchorElCRM(null);

  const handleOpenEstimates = (event: React.MouseEvent<HTMLElement>) => setAnchorElEstimates(event.currentTarget);
  const handleCloseEstimates = () => setAnchorElEstimates(null);

  const handleOpenAdmin = (event: React.MouseEvent<HTMLElement>) => setAnchorElAdmin(event.currentTarget);
  const handleCloseAdmin = () => setAnchorElAdmin(null);

  // --- Navigation Structure ---
  const getNavStructure = () => {
    if (!userProfile) return { dashboard: [], tasks: [], finance: [], operations: [], crm: [], estimates: [], admin: [] };

    const isAdmin = userProfile.role === 'admin';

    const dashboardLink = { path: '/admin/dashboard', label: 'Дашборд', icon: <DashboardIcon sx={{ mr: 0.5 }} /> };

    const tasksLinks = [
      { path: '/crm/tasks?view=board', label: 'GTD Board (Kanban)', icon: <KanbanIcon sx={{ mr: 0.5 }} /> },
      { path: '/crm/tasks?view=calendar', label: 'Calendar', icon: <CalendarIcon sx={{ mr: 0.5 }} /> },
      { path: '/crm/time-tracking', label: 'Time Tracking', icon: <DescriptionIcon sx={{ mr: 0.5 }} /> },
      { path: '/crm/shopping', label: 'Shopping', icon: <ShoppingCartIcon sx={{ mr: 0.5 }} /> },
    ];

    const financeLinks = [
      { path: '/crm/finance', label: 'Payroll', icon: <AttachMoneyIcon sx={{ mr: 0.5 }} /> },
      { path: '/crm/finance?tab=2', label: 'Expenses', icon: <AttachMoneyIcon sx={{ mr: 0.5 }} /> },
      { path: '/crm/finance?tab=1', label: 'Invoices', icon: <AttachMoneyIcon sx={{ mr: 0.5 }} /> },
      { path: '/crm/bank-statements', label: 'Bank & Reconciliation', icon: <BankIcon sx={{ mr: 0.5 }} /> },
      { path: '/crm/finance?tab=3', label: 'P&L Reports', icon: <AttachMoneyIcon sx={{ mr: 0.5 }} /> },
    ];

    // Server Dashboard link is env-gated because the upstream service (Infra
    // Dashboard on :8001) is Denis's local/LAN infrastructure. Without
    // VITE_SERVER_DASHBOARD_URL set, the menu item is hidden rather than
    // dangling at a private IP. On the new server, set the env to the
    // deployed infra-dashboard origin to restore the link.
    const serverDashboardUrl = import.meta.env.VITE_SERVER_DASHBOARD_URL;
    const operationsLinks = [
      { path: '/crm/inventory', label: 'Inventory', icon: <InventoryIcon sx={{ mr: 0.5 }} /> },
      { path: '/ai-reports', label: 'AI Reports', icon: <AIIcon sx={{ mr: 0.5 }} /> },
      ...(serverDashboardUrl
        ? [{ path: `EXTERNAL:${serverDashboardUrl}`, label: 'Server Dashboard', icon: <DnsIcon sx={{ mr: 0.5 }} /> }]
        : []),
    ];

    const crmLinks = [
      { path: '/crm/clients', label: 'Clients', icon: <BusinessIcon sx={{ mr: 0.5 }} /> },
      { path: '/crm/contacts', label: 'Contacts', icon: <ContactsIcon sx={{ mr: 0.5 }} /> },
      { path: '/crm/deals', label: 'Deals', icon: <KanbanIcon sx={{ mr: 0.5 }} /> },
      { path: '/crm/landings', label: 'Landing Pages', icon: <MarketingIcon sx={{ mr: 0.5 }} /> },
    ];

    const estimatesLinks = [
      { path: '/estimates/projects', label: 'Project Library', icon: <FolderIcon sx={{ mr: 0.5 }} /> },
      { path: '/estimates/electrical', label: 'Calculator', icon: <CalculateIcon sx={{ mr: 0.5 }} /> },
    ];

    const adminLinks = [
      { path: '/crm/tasks', label: 'Tasks', icon: <TaskIcon sx={{ mr: 0.5 }} /> },
      { path: '/about', label: 'About', icon: <InfoIcon sx={{ mr: 0.5 }} /> },
    ];

    if (isAdmin) {
      adminLinks.unshift(
        { path: '/admin/team', label: 'Team', icon: <PeopleIcon sx={{ mr: 0.5 }} /> },
        { path: '/admin/companies', label: 'Companies', icon: <BusinessIcon sx={{ mr: 0.5 }} /> }
      );
    }

    return {
      dashboard: [dashboardLink],
      tasks: tasksLinks,
      finance: financeLinks,
      operations: operationsLinks,
      crm: crmLinks,
      estimates: estimatesLinks,
      admin: adminLinks,
    };
  };

  const navStruct = getNavStructure();

  const isActive = (path: string) => {
    // Handle paths with query strings (e.g., /crm/tasks?view=board)
    const qIndex = path.indexOf('?');
    if (qIndex !== -1) {
      const pathPart = path.substring(0, qIndex);
      const queryPart = path.substring(qIndex + 1);
      if (location.pathname !== pathPart) return false;
      const params = new URLSearchParams(queryPart);
      const currentParams = new URLSearchParams(location.search);
      let match = true;
      params.forEach((value, key) => {
        if (currentParams.get(key) !== value) match = false;
      });
      return match;
    }
    return location.pathname === path;
  };
  const isGroupActive = (links: { path: string }[]) => links.some(link => isActive(link.path));

  // Helper to render Desktop Menu
  const renderDesktopMenu = (
    label: string,
    icon: React.ReactNode,
    items: { path: string, label: string, icon: React.ReactNode }[],
    anchorEl: HTMLElement | null,
    onOpen: (e: React.MouseEvent<HTMLElement>) => void,
    onClose: () => void
  ) => {
    if (items.length === 0) return null;

    return (
      <>
        <Button
          onClick={onOpen}
          endIcon={<KeyboardArrowDownIcon />}
          startIcon={icon}
          sx={{
            color: isGroupActive(items) ? 'primary.main' : 'text.primary',
            fontWeight: isGroupActive(items) ? 600 : 400,
            borderBottom: isGroupActive(items) ? 2 : 0,
            borderColor: 'primary.main',
            borderRadius: 0,
            px: 2,
            '&:hover': { backgroundColor: 'action.hover' },
          }}
        >
          {label}
        </Button>
        <Menu
          anchorEl={anchorEl}
          open={Boolean(anchorEl)}
          onClose={onClose}
        >
          {items.map((item) => {
            if (item.path.startsWith('EXTERNAL:')) {
              const url = item.path.replace('EXTERNAL:', '');
              return (
                <MenuItem
                  key={item.path}
                  component="a"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={onClose}
                >
                  {item.icon}
                  {item.label}
                  <span style={{ marginLeft: 'auto', opacity: 0.5, fontSize: '0.8em', paddingLeft: 8 }}>↗</span>
                </MenuItem>
              );
            }
            return (
              <MenuItem
                key={item.path}
                component={Link}
                to={item.path}
                onClick={onClose}
                selected={isActive(item.path)}
              >
                {item.icon}
                {item.label}
              </MenuItem>
            );
          })}
        </Menu>
      </>
    );
  };

  return (
    <AppBar position="sticky" color="default" elevation={1}>
      <Container maxWidth="xl">
        <Toolbar disableGutters sx={{ justifyContent: 'space-between' }}>
          {/* Logo & Mobile Toggle */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <IconButton
              color="inherit"
              edge="start"
              onClick={toggleMobileMenu}
              sx={{ display: { xs: 'flex', md: 'none' } }}
            >
              <MenuIcon />
            </IconButton>

            <Link
              to="/admin/dashboard"
              style={{
                textDecoration: 'none',
                color: 'inherit',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <DescriptionIcon sx={{ mr: 1, fontSize: 28, color: 'primary.main' }} />
              <Typography
                variant="h6"
                component="div"
                sx={{
                  fontWeight: 700,
                  color: 'primary.main',
                  letterSpacing: 0.5,
                  display: { xs: 'none', sm: 'block' },
                }}
              >
                Profit Step
              </Typography>
            </Link>
          </Box>

          {/* Desktop Navigation */}
          <Box sx={{ display: { xs: 'none', md: 'flex' }, gap: 1 }}>
            {/* Dashboard (Single Link) */}
            {navStruct.dashboard.map(link => (
              <Button
                key={link.path}
                component={Link}
                to={link.path}
                startIcon={link.icon}
                sx={{
                  color: isActive(link.path) ? 'primary.main' : 'text.primary',
                  fontWeight: isActive(link.path) ? 600 : 400,
                  borderBottom: isActive(link.path) ? 2 : 0,
                  borderColor: 'primary.main',
                  borderRadius: 0,
                  px: 2,
                }}
              >
                {link.label}
              </Button>
            ))}

            {/* Groups */}
            {renderDesktopMenu("Tasks & Work", <TaskIcon sx={{ mr: 0.5 }} />, navStruct.tasks, anchorElTasks, handleOpenTasks, handleCloseTasks)}
            {renderDesktopMenu("Finance", <AttachMoneyIcon sx={{ mr: 0.5 }} />, navStruct.finance, anchorElFinance, handleOpenFinance, handleCloseFinance)}
            {renderDesktopMenu("Operations", <ToolsIcon sx={{ mr: 0.5 }} />, navStruct.operations, anchorElOperations, handleOpenOperations, handleCloseOperations)}
            {renderDesktopMenu("CRM", <BusinessIcon sx={{ mr: 0.5 }} />, navStruct.crm, anchorElCRM, handleOpenCRM, handleCloseCRM)}
            {renderDesktopMenu("Estimates", <CalculateIcon sx={{ mr: 0.5 }} />, navStruct.estimates, anchorElEstimates, handleOpenEstimates, handleCloseEstimates)}
            {renderDesktopMenu("Admin", <SettingsIcon sx={{ mr: 0.5 }} />, navStruct.admin, anchorElAdmin, handleOpenAdmin, handleCloseAdmin)}
          </Box>

          {/* Active Session Indicator */}
          {userProfile && currentUser && (
            <SessionWrapper userId={(userProfile.telegramId && !isNaN(Number(userProfile.telegramId))) ? Number(userProfile.telegramId) : currentUser.uid} />
          )}

          {/* User Menu */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ display: { xs: 'none', sm: 'block' }, textAlign: 'right' }}>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {userProfile?.displayName || 'Пользователь'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {userProfile?.role === 'admin' ? 'Администратор' : 'Сотрудник'}
              </Typography>
            </Box>

            <IconButton onClick={handleUserMenuOpen} size="small">
              <Avatar src={userProfile?.photoURL || undefined} sx={{ width: 40, height: 40 }}>
                {userProfile?.displayName?.charAt(0).toUpperCase() || 'U'}
              </Avatar>
            </IconButton>

            <Menu
              anchorEl={anchorElUser}
              open={Boolean(anchorElUser)}
              onClose={handleUserMenuClose}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
              <MenuItem onClick={handleProfileClick}>
                <PersonIcon sx={{ mr: 1 }} /> Профиль
              </MenuItem>
              <MenuItem onClick={handleSettingsClick}>
                <SettingsIcon sx={{ mr: 1 }} /> Настройки профиля
              </MenuItem>
              <Divider />
              <MenuItem onClick={handleLogout} sx={{ color: 'error.main' }}>
                <LogoutIcon sx={{ mr: 1 }} /> Выйти
              </MenuItem>
            </Menu>
          </Box>
        </Toolbar>
      </Container>

      {/* Mobile Drawer */}
      <Drawer
        anchor="left"
        open={mobileMenuOpen}
        onClose={handleMobileMenuClose}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': { width: 280 },
        }}
      >
        <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6" sx={{ color: 'primary.main' }}>Profit Step</Typography>
          <IconButton onClick={handleMobileMenuClose}><CloseIcon /></IconButton>
        </Box>
        <Divider />
        <List>
          {/* Dashboard */}
          {navStruct.dashboard.map(link => (
            <ListItem key={link.path} disablePadding>
              <ListItemButton component={Link} to={link.path} onClick={handleMobileMenuClose} selected={isActive(link.path)}>
                <ListItemIcon>{link.icon}</ListItemIcon>
                <ListItemText primary={link.label} />
              </ListItemButton>
            </ListItem>
          ))}

          {/* Tasks & Work */}
          <ListItemButton onClick={() => setMobileOpenTasks(!mobileOpenTasks)}>
            <ListItemIcon><TaskIcon /></ListItemIcon>
            <ListItemText primary="Tasks & Work" />
            {mobileOpenTasks ? <ExpandLess /> : <ExpandMore />}
          </ListItemButton>
          <Collapse in={mobileOpenTasks} timeout="auto" unmountOnExit>
            <List component="div" disablePadding>
              {navStruct.tasks.map(link => (
                <ListItemButton key={link.path} sx={{ pl: 4 }} component={Link} to={link.path} onClick={handleMobileMenuClose} selected={isActive(link.path)}>
                  <ListItemIcon>{link.icon}</ListItemIcon>
                  <ListItemText primary={link.label} />
                </ListItemButton>
              ))}
            </List>
          </Collapse>

          {/* Finance */}
          <ListItemButton onClick={() => setMobileOpenFinance(!mobileOpenFinance)}>
            <ListItemIcon><AttachMoneyIcon /></ListItemIcon>
            <ListItemText primary="Finance" />
            {mobileOpenFinance ? <ExpandLess /> : <ExpandMore />}
          </ListItemButton>
          <Collapse in={mobileOpenFinance} timeout="auto" unmountOnExit>
            <List component="div" disablePadding>
              {navStruct.finance.map(link => (
                <ListItemButton key={link.path} sx={{ pl: 4 }} component={Link} to={link.path} onClick={handleMobileMenuClose} selected={isActive(link.path)}>
                  <ListItemIcon>{link.icon}</ListItemIcon>
                  <ListItemText primary={link.label} />
                </ListItemButton>
              ))}
            </List>
          </Collapse>

          {/* Operations */}
          <ListItemButton onClick={() => setMobileOpenOperations(!mobileOpenOperations)}>
            <ListItemIcon><ToolsIcon /></ListItemIcon>
            <ListItemText primary="Operations" />
            {mobileOpenOperations ? <ExpandLess /> : <ExpandMore />}
          </ListItemButton>
          <Collapse in={mobileOpenOperations} timeout="auto" unmountOnExit>
            <List component="div" disablePadding>
              {navStruct.operations.map(link => (
                <ListItemButton key={link.path} sx={{ pl: 4 }} component={Link} to={link.path} onClick={handleMobileMenuClose} selected={isActive(link.path)}>
                  <ListItemIcon>{link.icon}</ListItemIcon>
                  <ListItemText primary={link.label} />
                </ListItemButton>
              ))}
            </List>
          </Collapse>

          {/* CRM */}
          <ListItemButton onClick={() => setMobileOpenCRM(!mobileOpenCRM)}>
            <ListItemIcon><BusinessIcon /></ListItemIcon>
            <ListItemText primary="CRM" />
            {mobileOpenCRM ? <ExpandLess /> : <ExpandMore />}
          </ListItemButton>
          <Collapse in={mobileOpenCRM} timeout="auto" unmountOnExit>
            <List component="div" disablePadding>
              {navStruct.crm.map(link => (
                <ListItemButton key={link.path} sx={{ pl: 4 }} component={Link} to={link.path} onClick={handleMobileMenuClose} selected={isActive(link.path)}>
                  <ListItemIcon>{link.icon}</ListItemIcon>
                  <ListItemText primary={link.label} />
                </ListItemButton>
              ))}
            </List>
          </Collapse>

          {/* Estimates */}
          <ListItemButton onClick={() => setMobileOpenEstimates(!mobileOpenEstimates)}>
            <ListItemIcon><CalculateIcon /></ListItemIcon>
            <ListItemText primary="Estimates" />
            {mobileOpenEstimates ? <ExpandLess /> : <ExpandMore />}
          </ListItemButton>
          <Collapse in={mobileOpenEstimates} timeout="auto" unmountOnExit>
            <List component="div" disablePadding>
              {navStruct.estimates.map(link => (
                <ListItemButton key={link.path} sx={{ pl: 4 }} component={Link} to={link.path} onClick={handleMobileMenuClose} selected={isActive(link.path)}>
                  <ListItemIcon>{link.icon}</ListItemIcon>
                  <ListItemText primary={link.label} />
                </ListItemButton>
              ))}
            </List>
          </Collapse>

          {/* Admin */}
          <ListItemButton onClick={() => setMobileOpenAdmin(!mobileOpenAdmin)}>
            <ListItemIcon><SettingsIcon /></ListItemIcon>
            <ListItemText primary="Admin" />
            {mobileOpenAdmin ? <ExpandLess /> : <ExpandMore />}
          </ListItemButton>
          <Collapse in={mobileOpenAdmin} timeout="auto" unmountOnExit>
            <List component="div" disablePadding>
              {navStruct.admin.map(link => (
                <ListItemButton key={link.path} sx={{ pl: 4 }} component={Link} to={link.path} onClick={handleMobileMenuClose} selected={isActive(link.path)}>
                  <ListItemIcon>{link.icon}</ListItemIcon>
                  <ListItemText primary={link.label} />
                </ListItemButton>
              ))}
            </List>
          </Collapse>
        </List>
        <Divider />
        {/* User Actions */}
        <List>
          <ListItemButton onClick={handleProfileClick}>
            <ListItemIcon><PersonIcon /></ListItemIcon>
            <ListItemText primary="Профиль" />
          </ListItemButton>
          <ListItemButton onClick={handleSettingsClick}>
            <ListItemIcon><SettingsIcon /></ListItemIcon>
            <ListItemText primary="Настройки профиля" />
          </ListItemButton>
          <ListItemButton onClick={handleLogout} sx={{ color: 'error.main' }}>
            <ListItemIcon sx={{ color: 'error.main' }}><LogoutIcon /></ListItemIcon>
            <ListItemText primary="Выйти" />
          </ListItemButton>
        </List>
      </Drawer>
    </AppBar>
  );
};

export default Header;

// Helper component to use hook inside Header (since Header uses hook too, but conditional logic is cleaner here)
// Actually Header is a functional component so I can just use hook at top level.
// Wait, I can't put hook in conditional.
// I'll put hook in Header execution body.

const SessionWrapper: React.FC<{ userId: string | number }> = ({ userId }) => {
  const { activeSession } = useActiveSession(userId);
  if (!activeSession) return null;
  return <ActiveSessionIndicator session={activeSession} />;
};
