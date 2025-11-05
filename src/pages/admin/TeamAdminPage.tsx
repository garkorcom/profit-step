import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  Tabs,
  Tab,
} from '@mui/material';
import {
  MoreVert as MoreVertIcon,
  PersonAdd as PersonAddIcon,
} from '@mui/icons-material';
import { useAuth } from '../../auth/AuthContext';
import { UserProfile, UserRole } from '../../types/user.types';
import {
  updateUserRole,
  deactivateUser,
  activateUser,
  adminDeleteUser,
} from '../../api/userManagementApi';
import UserProfileModal from '../../components/admin/UserProfileModal';
import InviteUserDialog from '../../components/admin/InviteUserDialog';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';
import { collection, query, where, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { useSearchParams } from 'react-router-dom';

/**
 * Страница управления командой (только для Admin)
 * Позволяет просматривать, редактировать и управлять пользователями компании
 */
type StatusFilter = 'all' | 'active' | 'pending' | 'active_today' | 'new_month' | 'inactive';

const TeamAdminPage: React.FC = () => {
  const { userProfile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Модальное окно редактирования профиля
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);

  // Диалог подтверждения удаления
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<UserProfile | null>(null);

  // Диалог приглашения пользователя
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);

  // Меню действий для каждого пользователя
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [menuUser, setMenuUser] = useState<UserProfile | null>(null);

  // Получаем фильтр из URL
  const statusFilter = (searchParams.get('status') as StatusFilter) || 'all';

  // Проверка прав доступа
  const isAdmin = userProfile?.role === 'admin';

  // Мемоизируем companyId для избежания лишних вызовов
  const companyId = useMemo(() => userProfile?.companyId, [userProfile?.companyId]);

  // Функция для смены фильтра
  const handleFilterChange = (event: React.SyntheticEvent, newValue: StatusFilter) => {
    if (newValue === 'all') {
      setSearchParams({});
    } else {
      setSearchParams({ status: newValue });
    }
  };

  // Real-time подписка на список пользователей компании с фильтрацией
  useEffect(() => {
    if (!companyId) {
      setError('Не удалось определить компанию. Пожалуйста, перезагрузите страницу.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    // Создаем базовый запрос
    // НЕ используем orderBy в Firestore, чтобы избежать необходимости создавать составные индексы
    // Вместо этого сортируем на клиенте после получения данных
    let usersQuery = query(
      collection(db, 'users'),
      where('companyId', '==', companyId)
    );

    // Применяем фильтры на уровне Firestore
    if (statusFilter === 'active') {
      usersQuery = query(usersQuery, where('status', '==', 'active'));
    } else if (statusFilter === 'pending') {
      usersQuery = query(usersQuery, where('status', '==', 'pending'));
    } else if (statusFilter === 'inactive') {
      usersQuery = query(usersQuery, where('status', '==', 'inactive'));
    }

    // Подписываемся на изменения в реальном времени
    const unsubscribe = onSnapshot(
      usersQuery,
      (snapshot) => {
        let companyUsers = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as UserProfile[];

        // Применяем клиентские фильтры для "active_today" и "new_month"
        if (statusFilter === 'active_today') {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          companyUsers = companyUsers.filter((user) => {
            if (!user.lastSeen) return false;
            const lastSeenDate = typeof user.lastSeen === 'string'
              ? new Date(user.lastSeen)
              : (user.lastSeen as Timestamp).toDate();
            return lastSeenDate >= today;
          });
        } else if (statusFilter === 'new_month') {
          const now = new Date();
          const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
          companyUsers = companyUsers.filter((user) => {
            if (!user.createdAt) return false;
            const createdDate = typeof user.createdAt === 'string'
              ? new Date(user.createdAt)
              : (user.createdAt as Timestamp).toDate();
            return createdDate >= firstDayOfMonth;
          });
        }

        // Клиентская сортировка по дате создания (от новых к старым)
        companyUsers.sort((a, b) => {
          const aDate = a.createdAt
            ? typeof a.createdAt === 'string'
              ? new Date(a.createdAt)
              : (a.createdAt as Timestamp).toDate()
            : new Date(0);
          const bDate = b.createdAt
            ? typeof b.createdAt === 'string'
              ? new Date(b.createdAt)
              : (b.createdAt as Timestamp).toDate()
            : new Date(0);
          return bDate.getTime() - aDate.getTime(); // Descending order
        });

        setUsers(companyUsers);
        setLoading(false);
      },
      (err) => {
        console.error('❌ Error loading users:', err);
        setError('Не удалось загрузить список пользователей: ' + err.message);
        setLoading(false);
      }
    );

    // Отписываемся при размонтировании
    return () => unsubscribe();
  }, [companyId, statusFilter]);

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

  // Мемоизируем обработчики
  const handleRoleChange = useCallback(
    async (userId: string, event: SelectChangeEvent<UserRole>) => {
      const newRole = event.target.value as UserRole;

      // Запретить пользователю менять свою собственную роль
      if (userId === userProfile?.id) {
        setError('Вы не можете изменить свою собственную роль');
        return;
      }

      try {
        await updateUserRole(userId, newRole);
        // Список обновится автоматически через onSnapshot
      } catch (err: any) {
        console.error('Error changing role:', err);
        setError('Не удалось изменить роль: ' + err.message);
      }
    },
    [userProfile?.id]
  );

  // Деактивация пользователя
  const handleDeactivate = useCallback(
    async (user: UserProfile) => {
      try {
        await deactivateUser(user.id);
        handleMenuClose();
        // Список обновится автоматически через onSnapshot
      } catch (err: any) {
        console.error('Error deactivating user:', err);
        setError('Не удалось деактивировать пользователя');
      }
    },
    []
  );

  // Активация пользователя
  const handleActivate = useCallback(
    async (user: UserProfile) => {
      try {
        await activateUser(user.id);
        handleMenuClose();
        // Список обновится автоматически через onSnapshot
      } catch (err: any) {
        console.error('Error activating user:', err);
        setError('Не удалось активировать пользователя');
      }
    },
    []
  );

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

      // Список обновится автоматически через onSnapshot

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

  // Получаем текст для текущего фильтра
  const getFilterLabel = () => {
    switch (statusFilter) {
      case 'active':
        return 'Активные участники';
      case 'pending':
        return 'Ожидающие приглашения';
      case 'active_today':
        return 'Активные сегодня';
      case 'new_month':
        return 'Новые за месяц';
      case 'inactive':
        return 'Неактивные';
      default:
        return 'Все участники';
    }
  };

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      {/* Заголовок */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4">Управление командой</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {getFilterLabel()} • {users.length} чел.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<PersonAddIcon />}
          onClick={() => setInviteDialogOpen(true)}
        >
          Пригласить участника
        </Button>
      </Box>

      {/* Фильтры в виде табов */}
      <Paper sx={{ mb: 3 }}>
        <Tabs
          value={statusFilter}
          onChange={handleFilterChange}
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab label="Все" value="all" />
          <Tab label="Активные" value="active" />
          <Tab label="Ожидают приглашения" value="pending" />
          <Tab label="Активные сегодня" value="active_today" />
          <Tab label="Новые за месяц" value="new_month" />
          <Tab label="Неактивные" value="inactive" />
        </Tabs>
      </Paper>

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
        onSuccess={() => {
          // Список обновится автоматически через onSnapshot
        }}
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

      {/* Диалог приглашения пользователя */}
      <InviteUserDialog
        open={inviteDialogOpen}
        onClose={() => setInviteDialogOpen(false)}
        onSuccess={() => {
          // Список обновится автоматически через onSnapshot
        }}
      />
    </Container>
  );
};

export default TeamAdminPage;
