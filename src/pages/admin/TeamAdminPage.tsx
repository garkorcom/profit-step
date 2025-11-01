import React, { useState, useEffect } from 'react';
import {
  Container,
  Typography,
  Box,
  Paper,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Avatar,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Select,
  FormControl,
  SelectChangeEvent,
  CircularProgress,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import {
  MoreVert as MoreVertIcon,
  PersonAdd as PersonAddIcon,
} from '@mui/icons-material';
import { useAuth } from '../../auth/AuthContext';
import { UserProfile, UserRole } from '../../types/user.types';
import {
  getCompanyUsers,
  updateUserRole,
  deactivateUser,
  activateUser,
  adminDeleteUser,
} from '../../api/userManagementApi';
import UserProfileModal from '../../components/admin/UserProfileModal';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';

/**
 * Страница управления командой (только для Admin)
 * Позволяет просматривать, редактировать и управлять пользователями компании
 */
const TeamAdminPage: React.FC = () => {
  const { userProfile } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Модальное окно редактирования профиля
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);

  // Диалог подтверждения удаления
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<UserProfile | null>(null);

  // Меню действий для каждого пользователя
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [menuUser, setMenuUser] = useState<UserProfile | null>(null);

  // Проверка прав доступа
  const isAdmin = userProfile?.role === 'admin';

  // Загрузка списка пользователей
  const loadUsers = async () => {
    if (!userProfile?.companyId) {
      console.log('❌ No companyId in userProfile:', userProfile);
      setError('Не удалось определить компанию. Пожалуйста, перезагрузите страницу.');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      console.log('🔍 Loading users for company:', userProfile.companyId);
      const companyUsers = await getCompanyUsers(userProfile.companyId);
      console.log('✅ Loaded users:', companyUsers.length, companyUsers);
      setUsers(companyUsers);
    } catch (err: any) {
      console.error('❌ Error loading users:', err);
      setError('Не удалось загрузить список пользователей: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    console.log('🔄 TeamAdminPage mounted/updated, userProfile:', userProfile);
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProfile]);

  // Открытие меню действий
  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, user: UserProfile) => {
    setAnchorEl(event.currentTarget);
    setMenuUser(user);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setMenuUser(null);
  };

  // Открытие модального окна редактирования
  const handleEditProfile = (user: UserProfile) => {
    setSelectedUser(user);
    setEditModalOpen(true);
    handleMenuClose();
  };

  // Смена роли пользователя
  const handleRoleChange = async (userId: string, event: SelectChangeEvent<UserRole>) => {
    const newRole = event.target.value as UserRole;

    // Запретить пользователю менять свою собственную роль
    if (userId === userProfile?.id) {
      setError('Вы не можете изменить свою собственную роль');
      return;
    }

    try {
      await updateUserRole(userId, newRole);
      await loadUsers(); // Перезагрузить список
    } catch (err: any) {
      console.error('Error changing role:', err);
      setError('Не удалось изменить роль: ' + err.message);
    }
  };

  // Деактивация пользователя
  const handleDeactivate = async (user: UserProfile) => {
    try {
      await deactivateUser(user.id);
      await loadUsers();
      handleMenuClose();
    } catch (err: any) {
      console.error('Error deactivating user:', err);
      setError('Не удалось деактивировать пользователя');
    }
  };

  // Активация пользователя
  const handleActivate = async (user: UserProfile) => {
    try {
      await activateUser(user.id);
      await loadUsers();
      handleMenuClose();
    } catch (err: any) {
      console.error('Error activating user:', err);
      setError('Не удалось активировать пользователя');
    }
  };

  // Открытие диалога удаления
  const handleDeleteClick = (user: UserProfile) => {
    setUserToDelete(user);
    setDeleteDialogOpen(true);
    handleMenuClose();
  };

  // Подтверждение удаления
  const handleDeleteConfirm = async () => {
    if (!userToDelete) return;

    try {
      // Вызываем Cloud Function для безопасного удаления
      const result = await adminDeleteUser(userToDelete.id);
      console.log('✅ User deleted:', result);

      // Перезагружаем список пользователей
      await loadUsers();

      setDeleteDialogOpen(false);
      setUserToDelete(null);
    } catch (err: any) {
      console.error('Error deleting user:', err);
      setError('Не удалось удалить пользователя: ' + err.message);
      setDeleteDialogOpen(false);
    }
  };

  // Форматирование даты последнего входа
  const formatLastSeen = (lastSeen?: string | any) => {
    if (!lastSeen) return 'Никогда';

    try {
      const date = typeof lastSeen === 'string' ? new Date(lastSeen) : new Date();
      return formatDistanceToNow(date, { addSuffix: true, locale: ru });
    } catch {
      return 'Неизвестно';
    }
  };

  // Проверка прав доступа
  if (!isAdmin) {
    return (
      <Container maxWidth="lg" sx={{ mt: 4 }}>
        <Alert severity="error">
          У вас нет прав доступа к этой странице. Только администраторы могут управлять командой.
        </Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      {/* Заголовок */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Управление командой</Typography>
        <Button
          variant="contained"
          startIcon={<PersonAddIcon />}
          onClick={() => {
            // TODO: Открыть диалог приглашения пользователя
            alert('Функция приглашения будет реализована позже');
          }}
        >
          Пригласить участника
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Таблица пользователей */}
      <Paper>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Пользователь</TableCell>
                  <TableCell>Должность</TableCell>
                  <TableCell>Роль</TableCell>
                  <TableCell>Последний вход</TableCell>
                  <TableCell>Статус</TableCell>
                  <TableCell align="right">Действия</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    {/* Пользователь (Avatar + displayName + email) */}
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Avatar src={user.photoURL} alt={user.displayName}>
                          {user.displayName.charAt(0).toUpperCase()}
                        </Avatar>
                        <Box>
                          <Typography variant="body1">{user.displayName}</Typography>
                          <Typography variant="body2" color="text.secondary">
                            {user.email}
                          </Typography>
                        </Box>
                      </Box>
                    </TableCell>

                    {/* Должность */}
                    <TableCell>{user.title || '—'}</TableCell>

                    {/* Роль (редактируемый выпадающий список) */}
                    <TableCell>
                      <FormControl size="small" fullWidth>
                        <Select
                          value={user.role}
                          onChange={(e) => handleRoleChange(user.id, e)}
                          disabled={user.id === userProfile?.id}
                        >
                          <MenuItem value="admin">Admin</MenuItem>
                          <MenuItem value="manager">Manager</MenuItem>
                          <MenuItem value="estimator">Estimator</MenuItem>
                          <MenuItem value="guest">Guest</MenuItem>
                        </Select>
                      </FormControl>
                    </TableCell>

                    {/* Последний вход */}
                    <TableCell>{formatLastSeen(user.lastSeen)}</TableCell>

                    {/* Статус */}
                    <TableCell>
                      <Chip
                        label={user.status === 'active' ? 'Активен' : 'Неактивен'}
                        color={user.status === 'active' ? 'success' : 'default'}
                        size="small"
                      />
                    </TableCell>

                    {/* Действия */}
                    <TableCell align="right">
                      <IconButton onClick={(e) => handleMenuOpen(e, user)}>
                        <MoreVertIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}

                {users.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} align="center">
                      <Typography color="text.secondary">
                        Нет пользователей в вашей компании
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      {/* Меню действий */}
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleMenuClose}>
        <MenuItem onClick={() => menuUser && handleEditProfile(menuUser)}>
          Редактировать профиль
        </MenuItem>
        {menuUser?.status === 'active' ? (
          <MenuItem onClick={() => menuUser && handleDeactivate(menuUser)}>
            Деактивировать
          </MenuItem>
        ) : (
          <MenuItem onClick={() => menuUser && handleActivate(menuUser)}>Активировать</MenuItem>
        )}
        <MenuItem
          onClick={() => menuUser && handleDeleteClick(menuUser)}
          sx={{ color: 'error.main' }}
        >
          Удалить
        </MenuItem>
      </Menu>

      {/* Модальное окно редактирования профиля */}
      <UserProfileModal
        open={editModalOpen}
        user={selectedUser}
        onClose={() => {
          setEditModalOpen(false);
          setSelectedUser(null);
        }}
        onSuccess={loadUsers}
      />

      {/* Диалог подтверждения удаления */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Удалить пользователя?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Вы уверены? Это действие необратимо и удалит логин пользователя. Все его сметы и
            проекты будут переданы вам.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Отмена</Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained">
            Удалить
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default TeamAdminPage;
