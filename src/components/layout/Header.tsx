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
} from '@mui/icons-material';

/**
 * Header компонент с навигацией и меню пользователя
 */
const Header: React.FC = () => {
  const { userProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

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
        { path: '/admin/clients', label: 'Клиенты', icon: <BusinessIcon sx={{ mr: 0.5 }} /> },
      ];
    }

    return commonLinks;
  };

  const navLinks = getNavLinks();

  return (
    <AppBar position="sticky" color="default" elevation={1}>
      <Container maxWidth="xl">
        <Toolbar disableGutters sx={{ justifyContent: 'space-between' }}>
          {/* Логотип */}
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
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
    </AppBar>
  );
};

export default Header;
