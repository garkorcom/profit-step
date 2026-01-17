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
    Box,
    Avatar,
    Tabs,
    Tab,
    Switch,
    FormControlLabel,
    Alert,
    Typography,
    Chip,
} from '@mui/material';
import {
    Visibility,
    VisibilityOff,
    Casino,
    PhotoCamera as PhotoCameraIcon,
} from '@mui/icons-material';
import { useForm, Controller } from 'react-hook-form';
import { httpsCallable } from 'firebase/functions';
import { collection, query, where, getDocs } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { functions, db } from '../../firebase/firebase';
import { useAuth } from '../../auth/AuthContext';
import {
    UserProfile,
    UserRole,
    Department,
    DEPARTMENT_LABELS,
} from '../../types/user.types';
import { uploadUserAvatar, updateUserExtendedProfile } from '../../api/userManagementApi';

/**
 * Объединённая форма создания/редактирования пользователя
 *
 * Features:
 * - Две вкладки: "Основное" и "Доступ и безопасность"
 * - Режим создания (с паролем) и редактирования
 * - Загрузка аватара
 * - Выбор роли с подсказкой о правах
 * - Выбор руководителя из иерархии
 * - Валидация форм
 */

interface UserFormData {
    displayName: string;
    email: string;
    password: string;
    phone: string;
    title: string;
    department: Department | '';
    role: UserRole;
    reportsTo: string;
    hourlyRate: string;
    telegramId: string;
    isActive: boolean;
}

interface UserFormDialogProps {
    open: boolean;
    user?: UserProfile | null; // null = create mode, defined = edit mode
    onClose: () => void;
    onSuccess?: () => void;
}

// Подсказки о правах для каждой роли
const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
    superadmin: 'Полный доступ ко всем компаниям и настройкам платформы',
    company_admin: 'Полный доступ к данным компании, включая управление пользователями',
    admin: 'Управление командой, доступ ко всем отчётам и настройкам',
    manager: 'Просмотр данных отдела, управление задачами подчинённых',
    user: 'Базовый доступ: личные задачи и отчёты',
    estimator: 'Доступ к сметам и калькуляторам',
    guest: 'Только просмотр разрешённых данных',
};

const UserFormDialog: React.FC<UserFormDialogProps> = ({
    open,
    user,
    onClose,
    onSuccess,
}) => {
    const { userProfile, currentUser } = useAuth();
    const isEditMode = !!user;

    // UI State
    const [activeTab, setActiveTab] = useState(0);
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [photoURL, setPhotoURL] = useState('');
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Managers list for "Reports To" field
    const [managers, setManagers] = useState<UserProfile[]>([]);
    const [loadingManagers, setLoadingManagers] = useState(false);

    // React Hook Form
    const {
        control,
        handleSubmit,
        reset,
        setValue,
        watch,
        formState: { errors, isValid },
    } = useForm<UserFormData>({
        defaultValues: {
            displayName: '',
            email: '',
            password: '',
            phone: '',
            title: '',
            department: '',
            role: 'user',
            reportsTo: '',
            hourlyRate: '',
            telegramId: '',
            isActive: true,
        },
        mode: 'onChange',
    });

    const watchRole = watch('role');

    // ============================================
    // EFFECT: Load user data in edit mode
    // ============================================
    useEffect(() => {
        if (open && user) {
            setPhotoURL(user.photoURL || '');
            reset({
                displayName: user.displayName || '',
                email: user.email || '',
                password: '', // Never show password
                phone: user.phone || '',
                title: user.title || '',
                department: user.department || '',
                role: user.role || 'user',
                reportsTo: user.reportsTo || '',
                hourlyRate: user.hourlyRate ? String(user.hourlyRate) : '',
                telegramId: user.telegramId || '',
                isActive: user.status === 'active',
            });
        } else if (open && !user) {
            // Reset form for create mode
            reset({
                displayName: '',
                email: '',
                password: '',
                phone: '',
                title: '',
                department: '',
                role: 'user',
                reportsTo: '',
                hourlyRate: '',
                telegramId: '',
                isActive: true,
            });
            setPhotoURL('');
        }
        setActiveTab(0);
        setError(null);
    }, [open, user, reset]);

    // ============================================
    // EFFECT: Load managers list
    // ============================================
    const loadManagers = useCallback(async () => {
        if (!userProfile?.companyId) return;

        setLoadingManagers(true);
        try {
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

            // Filter managers and admins
            const managersAndAdmins = allUsers.filter(
                (u) =>
                    u.role === 'manager' ||
                    u.role === 'admin' ||
                    u.role === 'company_admin'
            );

            setManagers(managersAndAdmins);
        } catch (err: any) {
            console.error('Error loading managers:', err);
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
    // HANDLERS
    // ============================================
    const generateRandomPassword = () => {
        const charset =
            'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
        let password = '';
        for (let i = 0; i < 12; i++) {
            password += charset.charAt(Math.floor(Math.random() * charset.length));
        }
        setValue('password', password);
        setShowPassword(true);
        toast.success('Пароль сгенерирован');
    };

    const handleAvatarUpload = async (
        event: React.ChangeEvent<HTMLInputElement>
    ) => {
        const file = event.target.files?.[0];
        if (!file || !user) return;

        if (!file.type.startsWith('image/')) {
            setError('Пожалуйста, выберите изображение');
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            setError('Размер файла не должен превышать 5MB');
            return;
        }

        try {
            setUploading(true);
            setError(null);
            const downloadURL = await uploadUserAvatar(user.id, file);
            setPhotoURL(downloadURL);
            toast.success('Аватар обновлён');
        } catch (err: any) {
            setError('Не удалось загрузить аватар: ' + err.message);
        } finally {
            setUploading(false);
        }
    };

    const onSubmit = async (data: UserFormData) => {
        setLoading(true);
        setError(null);

        try {
            if (isEditMode && user) {
                // UPDATE existing user
                await updateUserExtendedProfile(user.id, {
                    displayName: data.displayName.trim(),
                    title: data.title.trim() || undefined,
                    phone: data.phone.trim() || undefined,
                    department: data.department || undefined,
                    telegramId: data.telegramId.trim() || undefined,
                    hourlyRate: data.hourlyRate ? parseFloat(data.hourlyRate) : 0,
                    reportsTo: data.reportsTo || undefined,
                    // Role and status are updated separately via API
                });

                toast.success('Профиль обновлён');
            } else {
                // CREATE new user
                const createUser = httpsCallable(functions, 'admin_createUserWithPassword');
                await createUser({
                    email: data.email,
                    password: data.password,
                    displayName: data.displayName,
                    role: data.role,
                    reportsTo: data.reportsTo || null,
                    title: data.title || null,
                    phone: data.phone || null,
                    department: data.department || null,
                });

                toast.success('Пользователь создан!');
            }

            reset();
            onClose();
            if (onSuccess) onSuccess();
        } catch (err: any) {
            console.error('Error saving user:', err);

            let errorMessage = 'Не удалось сохранить данные';
            if (err.code === 'functions/already-exists') {
                errorMessage = 'Пользователь с таким email уже существует';
            } else if (err.message) {
                errorMessage = err.message;
            }

            setError(errorMessage);
            toast.error(errorMessage);
        } finally {
            setLoading(false);
        }
    };

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
            <DialogTitle>
                {isEditMode ? 'Редактирование профиля' : 'Создать пользователя'}
            </DialogTitle>

            <form onSubmit={handleSubmit(onSubmit)}>
                <DialogContent>
                    {error && (
                        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                            {error}
                        </Alert>
                    )}

                    {/* Tabs */}
                    <Tabs
                        value={activeTab}
                        onChange={(_, v) => setActiveTab(v)}
                        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
                    >
                        <Tab label="Основное" />
                        <Tab label="Доступ" />
                    </Tabs>

                    {/* TAB 0: Basic Info */}
                    {activeTab === 0 && (
                        <Box>
                            {/* Avatar (edit mode only) */}
                            {isEditMode && (
                                <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
                                    <Box sx={{ position: 'relative' }}>
                                        <Avatar
                                            src={photoURL}
                                            alt={user?.displayName}
                                            sx={{ width: 100, height: 100 }}
                                        >
                                            {user?.displayName?.charAt(0).toUpperCase()}
                                        </Avatar>
                                        <input
                                            accept="image/*"
                                            style={{ display: 'none' }}
                                            id="avatar-upload"
                                            type="file"
                                            onChange={handleAvatarUpload}
                                            disabled={uploading}
                                        />
                                        <label htmlFor="avatar-upload">
                                            <IconButton
                                                component="span"
                                                sx={{
                                                    position: 'absolute',
                                                    bottom: 0,
                                                    right: 0,
                                                    bgcolor: 'primary.main',
                                                    color: 'white',
                                                    '&:hover': { bgcolor: 'primary.dark' },
                                                }}
                                                disabled={uploading}
                                            >
                                                {uploading ? (
                                                    <CircularProgress size={20} color="inherit" />
                                                ) : (
                                                    <PhotoCameraIcon fontSize="small" />
                                                )}
                                            </IconButton>
                                        </label>
                                    </Box>
                                </Box>
                            )}

                            {/* Display Name */}
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

                            {/* Email */}
                            <Controller
                                name="email"
                                control={control}
                                rules={{
                                    required: !isEditMode ? 'Email обязателен' : false,
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
                                        helperText={
                                            isEditMode
                                                ? 'Email нельзя изменить'
                                                : errors.email?.message
                                        }
                                        disabled={loading || isEditMode}
                                    />
                                )}
                            />

                            {/* Password (create mode only) */}
                            {!isEditMode && (
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
                                            helperText={errors.password?.message}
                                            disabled={loading}
                                            InputProps={{
                                                endAdornment: (
                                                    <InputAdornment position="end">
                                                        <Tooltip title="Сгенерировать пароль">
                                                            <IconButton
                                                                onClick={generateRandomPassword}
                                                                disabled={loading}
                                                                color="primary"
                                                            >
                                                                <Casino />
                                                            </IconButton>
                                                        </Tooltip>
                                                        <IconButton
                                                            onClick={() => setShowPassword(!showPassword)}
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
                            )}

                            {/* Phone */}
                            <Controller
                                name="phone"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        label="Телефон"
                                        fullWidth
                                        margin="normal"
                                        placeholder="+7 (999) 123-45-67"
                                        disabled={loading}
                                    />
                                )}
                            />

                            {/* Title */}
                            <Controller
                                name="title"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        label="Должность"
                                        fullWidth
                                        margin="normal"
                                        placeholder="Например: Ведущий сметчик"
                                        disabled={loading}
                                    />
                                )}
                            />

                            {/* Department */}
                            <Controller
                                name="department"
                                control={control}
                                render={({ field }) => (
                                    <FormControl fullWidth margin="normal" disabled={loading}>
                                        <InputLabel>Отдел</InputLabel>
                                        <Select {...field} label="Отдел">
                                            <MenuItem value="">
                                                <em>Не указан</em>
                                            </MenuItem>
                                            {(Object.keys(DEPARTMENT_LABELS) as Department[]).map(
                                                (dept) => (
                                                    <MenuItem key={dept} value={dept}>
                                                        {DEPARTMENT_LABELS[dept]}
                                                    </MenuItem>
                                                )
                                            )}
                                        </Select>
                                    </FormControl>
                                )}
                            />
                        </Box>
                    )}

                    {/* TAB 1: Access & Security */}
                    {activeTab === 1 && (
                        <Box>
                            {/* Role */}
                            <Controller
                                name="role"
                                control={control}
                                rules={{ required: 'Роль обязательна' }}
                                render={({ field }) => (
                                    <FormControl
                                        fullWidth
                                        margin="normal"
                                        error={!!errors.role}
                                        disabled={loading || (isEditMode && user?.id === currentUser?.uid)}
                                    >
                                        <InputLabel>Роль *</InputLabel>
                                        <Select {...field} label="Роль *">
                                            <MenuItem value="guest">Guest (Гость)</MenuItem>
                                            <MenuItem value="user">User (Пользователь)</MenuItem>
                                            <MenuItem value="estimator">Estimator (Сметчик)</MenuItem>
                                            <MenuItem value="manager">Manager (Менеджер)</MenuItem>
                                            <MenuItem value="admin">Admin (Администратор)</MenuItem>
                                        </Select>
                                        {errors.role && (
                                            <FormHelperText>{errors.role.message}</FormHelperText>
                                        )}
                                    </FormControl>
                                )}
                            />

                            {/* Role Description */}
                            {watchRole && (
                                <Alert severity="info" sx={{ mt: 1, mb: 2 }}>
                                    <Typography variant="body2">
                                        <strong>Права доступа:</strong>{' '}
                                        {ROLE_DESCRIPTIONS[watchRole]}
                                    </Typography>
                                </Alert>
                            )}

                            {/* Reports To */}
                            <Controller
                                name="reportsTo"
                                control={control}
                                render={({ field }) => (
                                    <FormControl
                                        fullWidth
                                        margin="normal"
                                        disabled={loading || loadingManagers}
                                    >
                                        <InputLabel>Руководитель</InputLabel>
                                        <Select {...field} label="Руководитель">
                                            <MenuItem value="">
                                                <em>Без руководителя</em>
                                            </MenuItem>
                                            {managers
                                                .filter((m) => m.id !== user?.id)
                                                .map((manager) => (
                                                    <MenuItem key={manager.id} value={manager.id}>
                                                        {manager.displayName}{' '}
                                                        <Chip
                                                            label={manager.role}
                                                            size="small"
                                                            sx={{ ml: 1 }}
                                                        />
                                                    </MenuItem>
                                                ))}
                                        </Select>
                                        <FormHelperText>
                                            {loadingManagers
                                                ? 'Загрузка...'
                                                : 'Выберите непосредственного руководителя'}
                                        </FormHelperText>
                                    </FormControl>
                                )}
                            />

                            {/* Hourly Rate */}
                            <Controller
                                name="hourlyRate"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        label="Почасовая ставка"
                                        type="number"
                                        fullWidth
                                        margin="normal"
                                        InputProps={{
                                            startAdornment: (
                                                <InputAdornment position="start">$</InputAdornment>
                                            ),
                                        }}
                                        helperText="Используется для расчёта Payroll"
                                        disabled={loading}
                                    />
                                )}
                            />

                            {/* Telegram ID */}
                            <Controller
                                name="telegramId"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        label="Telegram ID"
                                        fullWidth
                                        margin="normal"
                                        placeholder="123456789"
                                        helperText="ID для привязки к Worker Bot"
                                        disabled={loading}
                                    />
                                )}
                            />

                            {/* Status Toggle (edit mode only) */}
                            {isEditMode && (
                                <Controller
                                    name="isActive"
                                    control={control}
                                    render={({ field }) => (
                                        <FormControlLabel
                                            control={
                                                <Switch
                                                    checked={field.value}
                                                    onChange={(e) => field.onChange(e.target.checked)}
                                                    disabled={loading || user?.id === currentUser?.uid}
                                                />
                                            }
                                            label={field.value ? 'Активен' : 'Заблокирован'}
                                            sx={{ mt: 2 }}
                                        />
                                    )}
                                />
                            )}
                        </Box>
                    )}
                </DialogContent>

                <DialogActions>
                    <Button onClick={handleClose} disabled={loading}>
                        Отмена
                    </Button>
                    <Button
                        type="submit"
                        variant="contained"
                        disabled={loading || (!isEditMode && !isValid)}
                    >
                        {loading ? (
                            <>
                                <CircularProgress size={20} sx={{ mr: 1 }} />
                                {isEditMode ? 'Сохранение...' : 'Создание...'}
                            </>
                        ) : isEditMode ? (
                            'Сохранить'
                        ) : (
                            'Создать'
                        )}
                    </Button>
                </DialogActions>
            </form>
        </Dialog>
    );
};

export default UserFormDialog;
