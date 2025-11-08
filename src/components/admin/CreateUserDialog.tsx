import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  FormHelperText,
  CircularProgress,
  InputAdornment,
  IconButton,
  Tooltip,
} from '@mui/material';
import { Visibility, VisibilityOff, Casino } from '@mui/icons-material';
import { useForm, Controller } from 'react-hook-form';
import { httpsCallable } from 'firebase/functions';
import { collection, query, where, getDocs } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { functions, db } from '../../firebase/firebase';
import { useAuth } from '../../auth/AuthContext';
import { UserProfile, UserRole } from '../../types/user.types';

/**
 * Компонент: Создание пользователя администратором
 *
 * Features:
 * - Форма с валидацией (react-hook-form)
 * - Выбор роли (dropdown)
 * - Выбор руководителя из списка managers (иерархия)
 * - Вызов Cloud Function admin_createUserWithPassword
 * - Показ прогресса и ошибок
 */

interface CreateUserFormData {
  displayName: string;
  email: string;
  password: string;
  role: UserRole;
  reportsTo: string;
}

interface CreateUserDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const CreateUserDialog: React.FC<CreateUserDialogProps> = ({ open, onClose, onSuccess }) => {
  const { userProfile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Список менеджеров для выбора руководителя
  const [managers, setManagers] = useState<UserProfile[]>([]);
  const [loadingManagers, setLoadingManagers] = useState(false);

  // React Hook Form
  const {
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<CreateUserFormData>({
    defaultValues: {
      displayName: '',
      email: '',
      password: '',
      role: 'user',
      reportsTo: '',
    },
  });

  // ============================================
  // EFFECT: Загрузка списка managers
  // ============================================
  const loadManagers = useCallback(async () => {
    if (!userProfile?.companyId) return;

    setLoadingManagers(true);
    try {
      // Загружаем всех managers и admins из компании
      const managersQuery = query(
        collection(db, 'users'),
        where('companyId', '==', userProfile.companyId),
        where('status', '==', 'active')
      );

      const snapshot = await getDocs(managersQuery);
      const allUsers = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as UserProfile[];

      // Фильтруем только managers и admins
      const managersAndAdmins = allUsers.filter(
        (user) => user.role === 'manager' || user.role === 'admin' || user.role === 'company_admin'
      );

      setManagers(managersAndAdmins);
      console.log(`✅ Loaded ${managersAndAdmins.length} potential managers`);
    } catch (err: any) {
      console.error('Error loading managers:', err);
      toast.error('Не удалось загрузить список руководителей');
    } finally {
      setLoadingManagers(false);
    }
  }, [userProfile?.companyId]);

  useEffect(() => {
    if (open && userProfile?.companyId) {
      loadManagers();
    }
  }, [open, userProfile?.companyId, loadManagers]);

  // ============================================
  // HANDLER: Generate Random Password
  // ============================================
  const generateRandomPassword = () => {
    const length = 12;
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < length; i++) {
      password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    setValue('password', password);
    setShowPassword(true); // Показываем сгенерированный пароль
    toast.success('Пароль сгенерирован');
  };

  // ============================================
  // HANDLER: Submit Form
  // ============================================
  const onSubmit = async (data: CreateUserFormData) => {
    setLoading(true);

    try {
      console.log('📤 Creating user with data:', {
        ...data,
        password: '***', // Hide password in logs
      });

      // Вызов Cloud Function
      const createUser = httpsCallable(functions, 'admin_createUserWithPassword');
      const result = await createUser({
        email: data.email,
        password: data.password,
        displayName: data.displayName,
        role: data.role,
        reportsTo: data.reportsTo || null,
      });

      const response = result.data as { success: boolean; message: string; userId: string };

      console.log('✅ User created successfully:', response);

      toast.success('Пользователь успешно создан!');

      reset();
      onClose();
      if (onSuccess) onSuccess();
    } catch (err: any) {
      console.error('❌ Error creating user:', err);

      // Обработка Firebase errors
      let errorMessage = 'Не удалось создать пользователя';

      if (err.code === 'functions/permission-denied') {
        errorMessage = 'У вас нет прав для создания пользователей';
      } else if (err.code === 'functions/already-exists') {
        errorMessage = 'Пользователь с таким email уже существует';
      } else if (err.code === 'functions/invalid-argument') {
        errorMessage = err.message || 'Некорректные данные';
      } else if (err.code === 'functions/not-found') {
        errorMessage = 'Указанный руководитель не найден';
      } else if (err.message) {
        errorMessage = err.message;
      }

      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // HANDLER: Close Dialog
  // ============================================
  const handleClose = () => {
    if (!loading) {
      reset();
      onClose();
    }
  };

  // ============================================
  // RENDER
  // ============================================
  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Создать пользователя</DialogTitle>

      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogContent>
          {/* Field: Display Name */}
          <Controller
            name="displayName"
            control={control}
            rules={{
              required: 'Имя обязательно',
              minLength: { value: 2, message: 'Минимум 2 символа' },
            }}
            render={({ field }) => (
              <TextField
                {...field}
                label="Имя и Фамилия *"
                fullWidth
                margin="normal"
                error={!!errors.displayName}
                helperText={errors.displayName?.message}
                disabled={loading}
              />
            )}
          />

          {/* Field: Email */}
          <Controller
            name="email"
            control={control}
            rules={{
              required: 'Email обязателен',
              pattern: {
                value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                message: 'Некорректный формат email',
              },
            }}
            render={({ field }) => (
              <TextField
                {...field}
                label="Email *"
                type="email"
                fullWidth
                margin="normal"
                error={!!errors.email}
                helperText={errors.email?.message}
                disabled={loading}
              />
            )}
          />

          {/* Field: Password */}
          <Controller
            name="password"
            control={control}
            rules={{
              required: 'Пароль обязателен',
              minLength: { value: 6, message: 'Минимум 6 символов' },
            }}
            render={({ field }) => (
              <TextField
                {...field}
                label="Пароль *"
                type={showPassword ? 'text' : 'password'}
                fullWidth
                margin="normal"
                error={!!errors.password}
                helperText={errors.password?.message || 'Минимум 6 символов'}
                disabled={loading}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <Tooltip title="Сгенерировать случайный пароль">
                        <span>
                          <IconButton
                            onClick={generateRandomPassword}
                            disabled={loading}
                            color="primary"
                          >
                            <Casino />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <IconButton
                        onClick={() => setShowPassword(!showPassword)}
                        edge="end"
                        disabled={loading}
                      >
                        {showPassword ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
            )}
          />

          {/* Field: Role */}
          <Controller
            name="role"
            control={control}
            rules={{ required: 'Роль обязательна' }}
            render={({ field }) => (
              <FormControl fullWidth margin="normal" error={!!errors.role} disabled={loading}>
                <InputLabel>Роль *</InputLabel>
                <Select {...field} label="Роль *">
                  <MenuItem value="user">User (Пользователь)</MenuItem>
                  <MenuItem value="manager">Manager (Менеджер)</MenuItem>
                </Select>
                {errors.role && <FormHelperText>{errors.role.message}</FormHelperText>}
              </FormControl>
            )}
          />

          {/* Field: Reports To (Manager) */}
          <Controller
            name="reportsTo"
            control={control}
            render={({ field }) => (
              <FormControl fullWidth margin="normal" disabled={loading || loadingManagers}>
                <InputLabel>Руководитель (Reports To)</InputLabel>
                <Select {...field} label="Руководитель (Reports To)">
                  <MenuItem value="">
                    <em>Без руководителя</em>
                  </MenuItem>
                  {managers.map((manager) => (
                    <MenuItem key={manager.id} value={manager.id}>
                      {manager.displayName} ({manager.role}) - {manager.email}
                    </MenuItem>
                  ))}
                </Select>
                <FormHelperText>
                  {loadingManagers
                    ? 'Загрузка списка руководителей...'
                    : 'Выберите непосредственного руководителя'}
                </FormHelperText>
              </FormControl>
            )}
          />

        </DialogContent>

        <DialogActions>
          <Button onClick={handleClose} disabled={loading}>
            Отмена
          </Button>
          <Button type="submit" variant="contained" disabled={loading}>
            {loading ? (
              <>
                <CircularProgress size={20} sx={{ mr: 1 }} />
                Создание...
              </>
            ) : (
              'Создать пользователя'
            )}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};

export default CreateUserDialog;
