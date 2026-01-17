/**
 * @fileoverview Страница управления ролями и правами доступа
 * 
 * Отображает:
 * - Список ролей слева
 * - Матрицу прав для выбранной роли справа
 * - Field-Level Security настройки
 */

import React, { useState, useEffect } from 'react';
import {
    Container,
    Grid,
    Paper,
    Typography,
    List,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    Box,
    Chip,
    Divider,
    Button,
    Alert,
    CircularProgress,
    Card,
    CardContent,
    FormGroup,
    FormControlLabel,
    Checkbox,
    Tooltip,
} from '@mui/material';
import {
    Security as SecurityIcon,
    Edit as EditIcon,
    Lock as LockIcon,
    Add as AddIcon,
} from '@mui/icons-material';
import { useAuth } from '../../auth/AuthContext';
import PermissionMatrix from '../../components/rbac/PermissionMatrix';
import {
    Permission,
    PermissionEntity,
    FieldRestriction,
    SensitiveField,
    DEFAULT_ROLE_PERMISSIONS,
    DEFAULT_FIELD_RESTRICTIONS,
} from '../../types/rbac.types';
import { UserRole } from '../../types/user.types';
import toast from 'react-hot-toast';

// Системные роли с описаниями
const SYSTEM_ROLES: Array<{
    id: UserRole;
    name: string;
    description: string;
    isSystem: boolean;
}> = [
        { id: 'superadmin', name: 'Super Admin', description: 'Полный доступ ко всем компаниям', isSystem: true },
        { id: 'company_admin', name: 'Company Admin', description: 'Полный доступ к компании', isSystem: true },
        { id: 'admin', name: 'Администратор', description: 'Управление командой и настройками', isSystem: true },
        { id: 'manager', name: 'Менеджер', description: 'Доступ к данным команды', isSystem: true },
        { id: 'user', name: 'Пользователь', description: 'Базовый доступ к своим данным', isSystem: true },
        { id: 'estimator', name: 'Сметчик', description: 'Доступ к сметам и калькуляторам', isSystem: true },
        { id: 'guest', name: 'Гость', description: 'Только просмотр разрешённых данных', isSystem: true },
    ];

const SENSITIVE_FIELDS: Array<{ field: SensitiveField; label: string; description: string }> = [
    { field: 'cost', label: 'Себестоимость', description: 'Закупочные цены и затраты' },
    { field: 'margin', label: 'Маржинальность', description: 'Процент наценки и прибыли' },
    { field: 'discount', label: 'Скидки', description: 'Размер скидок для клиентов' },
    { field: 'hourlyRate', label: 'Почасовая ставка', description: 'Ставка сотрудника' },
    { field: 'salary', label: 'Зарплата', description: 'Размер заработной платы' },
];

const RolesPage: React.FC = () => {
    const { userProfile } = useAuth();
    const [selectedRole, setSelectedRole] = useState<UserRole>('user');
    const [permissions, setPermissions] = useState<Permission[]>([]);
    const [fieldRestrictions, setFieldRestrictions] = useState<FieldRestriction[]>([]);
    const [loading, setLoading] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);

    // Загружаем дефолтные права при смене роли
    useEffect(() => {
        const defaultPerms = DEFAULT_ROLE_PERMISSIONS[selectedRole];
        if (defaultPerms) {
            // Преобразуем Partial<Permission> в Permission
            const fullPerms: Permission[] = (Object.keys({
                deals: 1, contacts: 1, tasks: 1, estimates: 1, finance: 1, team: 1, reports: 1
            }) as PermissionEntity[]).map(entity => {
                const partial = defaultPerms.find(p => p.entity === entity);
                return {
                    entity,
                    read: partial?.read || 'none',
                    create: partial?.create || false,
                    update: partial?.update || 'none',
                    delete: partial?.delete || false,
                    export: partial?.export || false,
                };
            });
            setPermissions(fullPerms);
        }

        // Field restrictions
        if (selectedRole === 'user' || selectedRole === 'estimator' || selectedRole === 'guest') {
            setFieldRestrictions(DEFAULT_FIELD_RESTRICTIONS);
        } else {
            setFieldRestrictions([]);
        }

        setHasChanges(false);
    }, [selectedRole]);

    const handlePermissionsChange = (newPerms: Permission[]) => {
        setPermissions(newPerms);
        setHasChanges(true);
    };

    const handleFieldRestrictionToggle = (field: SensitiveField, type: 'hidden' | 'readOnly') => {
        setFieldRestrictions(prev => {
            const existing = prev.find(r => r.field === field);
            if (existing) {
                return prev.map(r =>
                    r.field === field ? { ...r, [type]: !r[type] } : r
                );
            } else {
                return [...prev, { field, hidden: type === 'hidden', readOnly: type === 'readOnly' }];
            }
        });
        setHasChanges(true);
    };

    const isFieldRestricted = (field: SensitiveField, type: 'hidden' | 'readOnly'): boolean => {
        const restriction = fieldRestrictions.find(r => r.field === field);
        return restriction ? restriction[type] : false;
    };

    const handleSave = async () => {
        setLoading(true);
        try {
            // TODO: Сохранение в Firestore (кастомные роли)
            // Для системных ролей — только логирование
            console.log('Saving role permissions:', { selectedRole, permissions, fieldRestrictions });
            toast.success('Права сохранены (demo)');
            setHasChanges(false);
        } catch (err) {
            toast.error('Ошибка сохранения');
        } finally {
            setLoading(false);
        }
    };

    const selectedRoleInfo = SYSTEM_ROLES.find(r => r.id === selectedRole);
    const isSystemRole = selectedRoleInfo?.isSystem || false;

    // Проверка прав доступа к странице
    if (userProfile?.role !== 'admin' && userProfile?.role !== 'superadmin' && userProfile?.role !== 'company_admin') {
        return (
            <Container maxWidth="lg" sx={{ py: 4 }}>
                <Alert severity="error">
                    У вас нет доступа к этой странице
                </Alert>
            </Container>
        );
    }

    return (
        <Container maxWidth="xl" sx={{ py: 3 }}>
            {/* Header */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <SecurityIcon sx={{ fontSize: 32, color: 'primary.main' }} />
                    <Typography variant="h4" component="h1">
                        Роли и права доступа
                    </Typography>
                </Box>

                <Box sx={{ display: 'flex', gap: 2 }}>
                    {hasChanges && (
                        <Button
                            variant="contained"
                            onClick={handleSave}
                            disabled={loading}
                        >
                            {loading ? <CircularProgress size={20} /> : 'Сохранить'}
                        </Button>
                    )}
                    <Tooltip title="Создание кастомных ролей будет доступно в следующей версии">
                        <span>
                            <Button variant="outlined" startIcon={<AddIcon />} disabled>
                                Создать роль
                            </Button>
                        </span>
                    </Tooltip>
                </Box>
            </Box>

            <Grid container spacing={3}>
                {/* Left Panel: Roles List */}
                <Grid size={{ xs: 12, md: 3 }}>
                    <Paper sx={{ p: 2 }}>
                        <Typography variant="h6" sx={{ mb: 2 }}>
                            Роли
                        </Typography>
                        <List>
                            {SYSTEM_ROLES.map((role) => (
                                <ListItemButton
                                    key={role.id}
                                    selected={selectedRole === role.id}
                                    onClick={() => setSelectedRole(role.id)}
                                    sx={{ borderRadius: 1, mb: 0.5 }}
                                >
                                    <ListItemIcon>
                                        {role.isSystem ? <LockIcon /> : <EditIcon />}
                                    </ListItemIcon>
                                    <ListItemText
                                        primary={role.name}
                                        secondary={role.description}
                                        secondaryTypographyProps={{ variant: 'caption' }}
                                    />
                                    {role.isSystem && (
                                        <Chip label="System" size="small" variant="outlined" />
                                    )}
                                </ListItemButton>
                            ))}
                        </List>
                    </Paper>
                </Grid>

                {/* Right Panel: Permissions */}
                <Grid size={{ xs: 12, md: 9 }}>
                    {/* Role Info */}
                    <Paper sx={{ p: 3, mb: 3 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                            <Typography variant="h5">
                                {selectedRoleInfo?.name}
                            </Typography>
                            {isSystemRole && (
                                <Chip
                                    icon={<LockIcon />}
                                    label="Системная роль"
                                    size="small"
                                    color="primary"
                                    variant="outlined"
                                />
                            )}
                        </Box>
                        <Typography variant="body2" color="text.secondary">
                            {selectedRoleInfo?.description}
                        </Typography>
                        {isSystemRole && (
                            <Alert severity="info" sx={{ mt: 2 }}>
                                Это системная роль. Изменения применятся ко всем пользователям с этой ролью.
                            </Alert>
                        )}
                    </Paper>

                    {/* Permissions Matrix */}
                    <Card sx={{ mb: 3 }}>
                        <CardContent>
                            <Typography variant="h6" sx={{ mb: 2 }}>
                                Права доступа к сущностям
                            </Typography>
                            <PermissionMatrix
                                permissions={permissions}
                                onChange={handlePermissionsChange}
                                readOnly={false}
                            />
                        </CardContent>
                    </Card>

                    {/* Field-Level Security */}
                    <Card>
                        <CardContent>
                            <Typography variant="h6" sx={{ mb: 2 }}>
                                Скрытие чувствительных полей
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                Настройте доступ к финансовым данным для этой роли
                            </Typography>

                            <Divider sx={{ my: 2 }} />

                            <Grid container spacing={2}>
                                {SENSITIVE_FIELDS.map(({ field, label, description }) => (
                                    <Grid size={{ xs: 12, sm: 6 }} key={field}>
                                        <Box sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 2 }}>
                                            <Typography variant="subtitle2">{label}</Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {description}
                                            </Typography>
                                            <FormGroup row sx={{ mt: 1 }}>
                                                <FormControlLabel
                                                    control={
                                                        <Checkbox
                                                            checked={isFieldRestricted(field, 'hidden')}
                                                            onChange={() => handleFieldRestrictionToggle(field, 'hidden')}
                                                            size="small"
                                                        />
                                                    }
                                                    label="Скрыть"
                                                />
                                                <FormControlLabel
                                                    control={
                                                        <Checkbox
                                                            checked={isFieldRestricted(field, 'readOnly')}
                                                            onChange={() => handleFieldRestrictionToggle(field, 'readOnly')}
                                                            size="small"
                                                        />
                                                    }
                                                    label="Только чтение"
                                                />
                                            </FormGroup>
                                        </Box>
                                    </Grid>
                                ))}
                            </Grid>
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>
        </Container>
    );
};

export default RolesPage;
