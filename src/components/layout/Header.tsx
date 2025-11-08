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
} from '@mui/icons-material';

/**
 * Header компонент с навигацией и меню пользователя
 */
const Header: React.FC = () => {
  const { userProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = async () => {
    try {
      await signOut();
      navigate('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
    handleMenuClose();
  };

  const handleProfileClick = () => {
    navigate('/profile');
    handleMenuClose();
  };

  const handleSettingsClick = () => {
    navigate('/settings');
    handleMenuClose();
  };

  const toggleMobileMenu = () => {
    setMobileMenuOpen(!mobileMenuOpen);
  };

  const handleMobileMenuClose = () => {
    setMobileMenuOpen(false);
  };

  // Навигационные ссылки в зависимости от роли
  const getNavLinks = () => {
    if (!userProfile) return [];

    const commonLinks = [
      { path: '/admin/dashboard', label: 'Дашборд', icon: <DashboardIcon sx={{ mr: 0.5 }} /> },
    ];

    if (userProfile.role === 'admin') {
      return [
        ...commonLinks,
        { path: '/admin/team', label: 'Команда', icon: <PeopleIcon sx={{ mr: 0.5 }} /> },
        { path: '/admin/companies', label: 'Компании', icon: <BusinessIcon sx={{ mr: 0.5 }} /> },
      ];
    }

    return commonLinks;
  };

  const navLinks = getNavLinks();

  return (
    <AppBar position="sticky" color="default" elevation={1}>
      <Container maxWidth="xl">
        <Toolbar disableGutters sx={{ justifyContent: 'space-between' }}>
          {/* Логотип + Бургер-меню (мобильное) */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {/* Бургер-кнопка (только на мобильных) */}
            <IconButton
              color="inherit"
              aria-label="open menu"
              edge="start"
              onClick={toggleMobileMenu}
              sx={{ display: { xs: 'flex', md: 'none' } }}
            >
              <MenuIcon />
            </IconButton>

            {/* Логотип */}
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
                  display: { xs: 'none', sm: 'block' }, // Скрываем текст на очень маленьких экранах
                }}
              >
                Profit Step
              </Typography>
            </Link>
          </Box>

          {/* Центральная навигация */}
          <Box sx={{ display: { xs: 'none', md: 'flex' }, gap: 1 }}>
            {navLinks.map((link) => (
              <Button
                key={link.path}
                component={Link}
                to={link.path}
                startIcon={link.icon}
                sx={{
                  color: location.pathname === link.path ? 'primary.main' : 'text.primary',
                  fontWeight: location.pathname === link.path ? 600 : 400,
                  borderBottom: location.pathname === link.path ? 2 : 0,
                  borderColor: 'primary.main',
                  borderRadius: 0,
                  px: 2,
                  '&:hover': {
                    backgroundColor: 'action.hover',
                  },
                }}
              >
                {link.label}
              </Button>
            ))}
          </Box>

          {/* Меню пользователя */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ display: { xs: 'none', sm: 'block' }, textAlign: 'right' }}>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {userProfile?.displayName || 'Пользователь'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {userProfile?.role === 'admin'
                  ? 'Администратор'
                  : userProfile?.role === 'manager'
                  ? 'Менеджер'
                  : userProfile?.role === 'estimator'
                  ? 'Сметчик'
                  : 'Гость'}
              </Typography>
            </Box>

            <IconButton onClick={handleMenuOpen} size="small">
              <Avatar
                src={userProfile?.photoURL || undefined}
                alt={userProfile?.displayName || 'User'}
                sx={{ width: 40, height: 40 }}
              >
                {userProfile?.displayName?.charAt(0).toUpperCase() || 'U'}
              </Avatar>
            </IconButton>

            <Menu
              anchorEl={anchorEl}
              open={Boolean(anchorEl)}
              onClose={handleMenuClose}
              anchorOrigin={{
                vertical: 'bottom',
                horizontal: 'right',
              }}
              transformOrigin={{
                vertical: 'top',
                horizontal: 'right',
              }}
              PaperProps={{
                sx: { mt: 1, minWidth: 200 },
              }}
            >
              <MenuItem onClick={handleProfileClick}>
                <PersonIcon sx={{ mr: 1 }} />
                Профиль
              </MenuItem>
              <MenuItem onClick={handleSettingsClick}>
                <SettingsIcon sx={{ mr: 1 }} />
                Настройки
              </MenuItem>
              <Divider />
              <MenuItem onClick={handleLogout} sx={{ color: 'error.main' }}>
                <LogoutIcon sx={{ mr: 1 }} />
                Выйти
              </MenuItem>
            </Menu>
          </Box>
        </Toolbar>
      </Container>

      {/* Мобильное меню (Drawer) */}
      <Drawer
        anchor="left"
        open={mobileMenuOpen}
        onClose={handleMobileMenuClose}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': {
            width: 280,
          },
        }}
      >
        {/* Заголовок Drawer */}
        <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6" sx={{ fontWeight: 600, color: 'primary.main' }}>
            Profit Step
          </Typography>
          <IconButton onClick={handleMobileMenuClose}>
            <CloseIcon />
          </IconButton>
        </Box>
        <Divider />

        {/* Навигационные ссылки */}
        <List>
          {navLinks.map((link) => (
            <ListItem key={link.path} disablePadding>
              <ListItemButton
                component={Link}
                to={link.path}
                onClick={handleMobileMenuClose}
                selected={location.pathname === link.path}
                sx={{
                  '&.Mui-selected': {
                    backgroundColor: 'primary.light',
                    color: 'primary.main',
                    '&:hover': {
                      backgroundColor: 'primary.light',
                    },
                  },
                }}
              >
                <ListItemIcon sx={{ color: location.pathname === link.path ? 'primary.main' : 'inherit' }}>
                  {link.icon}
                </ListItemIcon>
                <ListItemText primary={link.label} />
              </ListItemButton>
            </ListItem>
          ))}
        </List>

        <Divider />

        {/* Профиль и настройки */}
        <List>
          <ListItem disablePadding>
            <ListItemButton
              onClick={() => {
                navigate('/profile');
                handleMobileMenuClose();
              }}
            >
              <ListItemIcon>
                <PersonIcon />
              </ListItemIcon>
              <ListItemText primary="Профиль" />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButton
              onClick={() => {
                navigate('/settings');
                handleMobileMenuClose();
              }}
            >
              <ListItemIcon>
                <SettingsIcon />
              </ListItemIcon>
              <ListItemText primary="Настройки" />
            </ListItemButton>
          </ListItem>
          <Divider />
          <ListItem disablePadding>
            <ListItemButton
              onClick={async () => {
                await signOut();
                navigate('/login');
                handleMobileMenuClose();
              }}
              sx={{ color: 'error.main' }}
            >
              <ListItemIcon sx={{ color: 'error.main' }}>
                <LogoutIcon />
              </ListItemIcon>
              <ListItemText primary="Выйти" />
            </ListItemButton>
          </ListItem>
        </List>
      </Drawer>
    </AppBar>
  );
};

export default Header;
