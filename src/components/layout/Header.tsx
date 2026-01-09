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
  AccessTime as TimeManagementIcon,
  Campaign as MarketingIcon,
  Build as ToolsIcon,
} from '@mui/icons-material';

/**
 * Header компонент с навигацией и меню пользователя
 */
const Header: React.FC = () => {
  const { userProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // User Menu State
  const [anchorElUser, setAnchorElUser] = useState<null | HTMLElement>(null);

  // Nav Menus State
  const [anchorElTime, setAnchorElTime] = useState<null | HTMLElement>(null);
  const [anchorElMarketing, setAnchorElMarketing] = useState<null | HTMLElement>(null);
  const [anchorElSettings, setAnchorElSettings] = useState<null | HTMLElement>(null);

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Mobile Collapse States
  const [mobileOpenTime, setMobileOpenTime] = useState(false);
  const [mobileOpenMarketing, setMobileOpenMarketing] = useState(false);
  const [mobileOpenSettings, setMobileOpenSettings] = useState(false);

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
  const handleOpenTime = (event: React.MouseEvent<HTMLElement>) => setAnchorElTime(event.currentTarget);
  const handleCloseTime = () => setAnchorElTime(null);

  const handleOpenMarketing = (event: React.MouseEvent<HTMLElement>) => setAnchorElMarketing(event.currentTarget);
  const handleCloseMarketing = () => setAnchorElMarketing(null);

  const handleOpenSettings = (event: React.MouseEvent<HTMLElement>) => setAnchorElSettings(event.currentTarget);
  const handleCloseSettings = () => setAnchorElSettings(null);

  // --- Navigation Structure ---
  const getNavStructure = () => {
    if (!userProfile) return { dashboard: [], time: [], marketing: [], settings: [] };

    const isAdmin = userProfile.role === 'admin';
    // const isManager = userProfile.role === 'manager';

    const dashboardLink = { path: '/admin/dashboard', label: 'Дашборд', icon: <DashboardIcon sx={{ mr: 0.5 }} /> };

    const timeMgmtLinks = [
      { path: '/crm/calendar', label: 'Календарь', icon: <CalendarIcon sx={{ mr: 0.5 }} /> },
      { path: '/crm/time-tracking', label: 'Time Tracking', icon: <DescriptionIcon sx={{ mr: 0.5 }} /> },
      { path: '/crm/finance', label: 'Финансы', icon: <AttachMoneyIcon sx={{ mr: 0.5 }} /> },
    ];

    const marketingLinks = [
      { path: '/crm/clients', label: 'Клиенты', icon: <ContactsIcon sx={{ mr: 0.5 }} /> },
      { path: '/crm/deals', label: 'Сделки', icon: <KanbanIcon sx={{ mr: 0.5 }} /> },
    ];

    // "Settings" group as requested (Team, Companies, Tasks, Calculator)
    const settingsGroupLinks = [
      { path: '/crm/tasks', label: 'Задачи', icon: <TaskIcon sx={{ mr: 0.5 }} /> },
      { path: '/crm/gtd', label: 'Lookahead', icon: <TaskIcon sx={{ mr: 0.5 }} /> },
      { path: '/estimates/electrical', label: 'Калькулятор', icon: <CalculateIcon sx={{ mr: 0.5 }} /> },
    ];

    if (isAdmin) {
      settingsGroupLinks.unshift(
        { path: '/admin/team', label: 'Команда', icon: <PeopleIcon sx={{ mr: 0.5 }} /> },
        { path: '/admin/companies', label: 'Компании', icon: <BusinessIcon sx={{ mr: 0.5 }} /> }
      );
    }

    return {
      dashboard: [dashboardLink],
      time: timeMgmtLinks,
      marketing: marketingLinks,
      settings: settingsGroupLinks // Named "settings" in code, label will be "Настройки"
    };
  };

  const navStruct = getNavStructure();

  const isActive = (path: string) => location.pathname === path;
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
          {items.map((item) => (
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
          ))}
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
            {renderDesktopMenu("Управление временем", <TimeManagementIcon sx={{ mr: 0.5 }} />, navStruct.time, anchorElTime, handleOpenTime, handleCloseTime)}
            {renderDesktopMenu("Маркетинг", <MarketingIcon sx={{ mr: 0.5 }} />, navStruct.marketing, anchorElMarketing, handleOpenMarketing, handleCloseMarketing)}
            {renderDesktopMenu("Настройки", <SettingsIcon sx={{ mr: 0.5 }} />, navStruct.settings, anchorElSettings, handleOpenSettings, handleCloseSettings)}
          </Box>

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

          {/* Time Management */}
          <ListItemButton onClick={() => setMobileOpenTime(!mobileOpenTime)}>
            <ListItemIcon><TimeManagementIcon /></ListItemIcon>
            <ListItemText primary="Управление временем" />
            {mobileOpenTime ? <ExpandLess /> : <ExpandMore />}
          </ListItemButton>
          <Collapse in={mobileOpenTime} timeout="auto" unmountOnExit>
            <List component="div" disablePadding>
              {navStruct.time.map(link => (
                <ListItemButton key={link.path} sx={{ pl: 4 }} component={Link} to={link.path} onClick={handleMobileMenuClose} selected={isActive(link.path)}>
                  <ListItemIcon>{link.icon}</ListItemIcon>
                  <ListItemText primary={link.label} />
                </ListItemButton>
              ))}
            </List>
          </Collapse>

          {/* Marketing */}
          <ListItemButton onClick={() => setMobileOpenMarketing(!mobileOpenMarketing)}>
            <ListItemIcon><MarketingIcon /></ListItemIcon>
            <ListItemText primary="Маркетинг" />
            {mobileOpenMarketing ? <ExpandLess /> : <ExpandMore />}
          </ListItemButton>
          <Collapse in={mobileOpenMarketing} timeout="auto" unmountOnExit>
            <List component="div" disablePadding>
              {navStruct.marketing.map(link => (
                <ListItemButton key={link.path} sx={{ pl: 4 }} component={Link} to={link.path} onClick={handleMobileMenuClose} selected={isActive(link.path)}>
                  <ListItemIcon>{link.icon}</ListItemIcon>
                  <ListItemText primary={link.label} />
                </ListItemButton>
              ))}
            </List>
          </Collapse>

          {/* Settings */}
          <ListItemButton onClick={() => setMobileOpenSettings(!mobileOpenSettings)}>
            <ListItemIcon><SettingsIcon /></ListItemIcon>
            <ListItemText primary="Настройки" />
            {mobileOpenSettings ? <ExpandLess /> : <ExpandMore />}
          </ListItemButton>
          <Collapse in={mobileOpenSettings} timeout="auto" unmountOnExit>
            <List component="div" disablePadding>
              {navStruct.settings.map(link => (
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
