/**
 * @fileoverview Визард безопасного увольнения (Offboarding)
 * 
 * 2-step модал:
 * 1. Подтверждение блокировки
 * 2. Перераспределение активов (сделки, контакты, задачи)
 */

import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Box,
    Typography,
    Stepper,
    Step,
    StepLabel,
    Alert,
    CircularProgress,
    List,
    ListItem,
    ListItemIcon,
    ListItemText,
    Avatar,
    Chip,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    FormControlLabel,
    Checkbox,
} from '@mui/material';
import {
    Warning as WarningIcon,
    Assignment as TaskIcon,
    People as ContactsIcon,
    TrendingUp as DealsIcon,
    Event as EventIcon,
} from '@mui/icons-material';
import { collection, query, where, getDocs, writeBatch, doc } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { useAuth } from '../../auth/AuthContext';
import { UserProfile } from '../../types/user.types';
import { deactivateUser } from '../../api/userManagementApi';
import toast from 'react-hot-toast';

interface UserAssets {
    deals: number;
    contacts: number;
    tasks: number;
    gtdTasks: number;
    loading: boolean;
}

interface OffboardingWizardProps {
    open: boolean;
    user: UserProfile | null;
    onClose: () => void;
    onSuccess: () => void;
}

const STEPS = ['Подтверждение', 'Передача дел'];

const OffboardingWizard: React.FC<OffboardingWizardProps> = ({
    open,
    user,
    onClose,
    onSuccess,
}) => {
    const { userProfile, currentUser } = useAuth();
    const [activeStep, setActiveStep] = useState(0);
    const [loading, setLoading] = useState(false);
    const [assets, setAssets] = useState<UserAssets>({
        deals: 0,
        contacts: 0,
        tasks: 0,
        gtdTasks: 0,
        loading: true,
    });

    // Кому передать дела
    const [reassignTo, setReassignTo] = useState('');
    const [transferCalendar, setTransferCalendar] = useState(true);

    // Список сотрудников для передачи
    const [colleagues, setColleagues] = useState<UserProfile[]>([]);

    // E-01: Защита от удаления последнего админа
    const [isLastAdmin, setIsLastAdmin] = useState(false);
    const isSelf = user?.id === currentUser?.uid;

    // Загрузка активов пользователя
    useEffect(() => {
        const loadAssets = async () => {
            if (!user || !userProfile?.companyId) return;

            setAssets(prev => ({ ...prev, loading: true }));

            try {
                // Сделки
                const dealsQuery = query(
                    collection(db, 'deals'),
                    where('assignedTo', '==', user.id),
                    where('status', '==', 'open')
                );
                const dealsSnap = await getDocs(dealsQuery);

                // Контакты
                const contactsQuery = query(
                    collection(db, 'clients'),
                    where('assignedTo', '==', user.id)
                );
                const contactsSnap = await getDocs(contactsQuery);

                // CRM Задачи
                const tasksQuery = query(
                    collection(db, 'tasks'),
                    where('assignedTo', '==', user.id),
                    where('status', 'in', ['todo', 'in_progress'])
                );
                const tasksSnap = await getDocs(tasksQuery);

                // GTD Задачи
                const gtdQuery = query(
                    collection(db, 'gtd_tasks'),
                    where('ownerId', '==', user.id),
                    where('status', '!=', 'done')
                );
                const gtdSnap = await getDocs(gtdQuery);

                setAssets({
                    deals: dealsSnap.size,
                    contacts: contactsSnap.size,
                    tasks: tasksSnap.size,
                    gtdTasks: gtdSnap.size,
                    loading: false,
                });

            } catch (err) {
                console.error('Error loading user assets:', err);
                setAssets(prev => ({ ...prev, loading: false }));
            }
        };

        // Загрузка коллег + проверка последнего админа
        const loadColleagues = async () => {
            if (!userProfile?.companyId) return;

            const colleaguesQuery = query(
                collection(db, 'users'),
                where('companyId', '==', userProfile.companyId),
                where('status', '==', 'active')
            );
            const snap = await getDocs(colleaguesQuery);
            const allUsers = snap.docs
                .map(d => ({ id: d.id, ...d.data() } as UserProfile));

            // E-01: Проверка последнего админа
            if (user && ['admin', 'company_admin', 'superadmin'].includes(user.role)) {
                const adminCount = allUsers.filter(u =>
                    ['admin', 'company_admin', 'superadmin'].includes(u.role)
                ).length;
                setIsLastAdmin(adminCount <= 1);
            } else {
                setIsLastAdmin(false);
            }

            const result = allUsers.filter(u => u.id !== user?.id); // Исключаем увольняемого
            setColleagues(result);

            // По умолчанию передаём текущему пользователю (админу)
            if (userProfile.id !== user?.id) {
                setReassignTo(userProfile.id);
            } else if (result.length > 0) {
                setReassignTo(result[0].id);
            }
        };

        if (open && user) {
            loadAssets();
            loadColleagues();
        }
    }, [open, user, userProfile?.companyId, userProfile?.id]);

    // Сброс при закрытии
    useEffect(() => {
        if (!open) {
            setActiveStep(0);
            setReassignTo('');
            setTransferCalendar(true);
        }
    }, [open]);

    const totalAssets = assets.deals + assets.contacts + assets.tasks + assets.gtdTasks;

    const handleNext = () => {
        if (activeStep === 0) {
            // Если нет активов — сразу блокируем
            if (totalAssets === 0) {
                handleBlock();
            } else {
                setActiveStep(1);
            }
        }
    };

    const handleBack = () => {
        setActiveStep(0);
    };

    const handleBlock = async () => {
        if (!user) return;

        setLoading(true);

        try {
            // Если есть активы — сначала переводим
            if (totalAssets > 0 && reassignTo) {
                await transferAssets(user.id, reassignTo);
            }

            // Блокируем пользователя
            await deactivateUser(user.id);

            toast.success('Пользователь заблокирован');
            onSuccess();
            onClose();
        } catch (err: any) {
            console.error('Error blocking user:', err);
            toast.error('Ошибка: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    /**
     * Перевод активов на другого пользователя
     */
    const transferAssets = async (fromId: string, toId: string) => {
        const batch = writeBatch(db);

        // Deals
        const dealsQuery = query(
            collection(db, 'deals'),
            where('assignedTo', '==', fromId)
        );
        const dealsSnap = await getDocs(dealsQuery);
        dealsSnap.forEach(d => {
            batch.update(doc(db, 'deals', d.id), { assignedTo: toId });
        });

        // Clients
        const clientsQuery = query(
            collection(db, 'clients'),
            where('assignedTo', '==', fromId)
        );
        const clientsSnap = await getDocs(clientsQuery);
        clientsSnap.forEach(d => {
            batch.update(doc(db, 'clients', d.id), { assignedTo: toId });
        });

        // Tasks
        const tasksQuery = query(
            collection(db, 'tasks'),
            where('assignedTo', '==', fromId)
        );
        const tasksSnap = await getDocs(tasksQuery);
        tasksSnap.forEach(d => {
            batch.update(doc(db, 'tasks', d.id), { assignedTo: toId });
        });

        // GTD Tasks
        const gtdQuery = query(
            collection(db, 'gtd_tasks'),
            where('ownerId', '==', fromId)
        );
        const gtdSnap = await getDocs(gtdQuery);
        gtdSnap.forEach(d => {
            batch.update(doc(db, 'gtd_tasks', d.id), {
                ownerId: toId,
                ownerName: colleagues.find(c => c.id === toId)?.displayName
            });
        });

        await batch.commit();
        console.log('✅ Assets transferred successfully');
    };

    if (!user) return null;

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <WarningIcon color="warning" />
                    Блокировка пользователя
                </Box>
            </DialogTitle>

            <DialogContent>
                {/* Stepper */}
                <Stepper activeStep={activeStep} sx={{ mb: 3 }}>
                    {STEPS.map((label) => (
                        <Step key={label}>
                            <StepLabel>{label}</StepLabel>
                        </Step>
                    ))}
                </Stepper>

                {/* Step 1: Подтверждение */}
                {activeStep === 0 && (
                    <Box>
                        {/* E-01: Блокировка если это последний админ */}
                        {isLastAdmin && (
                            <Alert severity="error" sx={{ mb: 2 }}>
                                <strong>Невозможно заблокировать!</strong><br />
                                Это последний администратор компании. Сначала назначьте другого администратора.
                            </Alert>
                        )}

                        {/* Блокировка если пытаемся заблокировать себя */}
                        {isSelf && (
                            <Alert severity="error" sx={{ mb: 2 }}>
                                <strong>Невозможно заблокировать!</strong><br />
                                Вы не можете заблокировать свой собственный аккаунт.
                            </Alert>
                        )}

                        {!isLastAdmin && !isSelf && (
                            <Alert severity="warning" sx={{ mb: 2 }}>
                                Вы собираетесь заблокировать пользователя <strong>{user.displayName}</strong>.
                                После блокировки он не сможет войти в систему.
                            </Alert>
                        )}

                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3, p: 2, bgcolor: 'grey.100', borderRadius: 2 }}>
                            <Avatar src={user.photoURL} sx={{ width: 56, height: 56 }}>
                                {user.displayName?.charAt(0)}
                            </Avatar>
                            <Box>
                                <Typography variant="h6">{user.displayName}</Typography>
                                <Typography variant="body2" color="text.secondary">
                                    {user.email}
                                </Typography>
                                <Chip label={user.role} size="small" sx={{ mt: 0.5 }} />
                            </Box>
                        </Box>

                        {/* Активы */}
                        {assets.loading ? (
                            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                                <CircularProgress size={24} />
                            </Box>
                        ) : totalAssets > 0 ? (
                            <Box>
                                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                                    У пользователя найдены активные данные:
                                </Typography>
                                <List dense>
                                    {assets.deals > 0 && (
                                        <ListItem>
                                            <ListItemIcon><DealsIcon /></ListItemIcon>
                                            <ListItemText primary={`${assets.deals} активных сделок`} />
                                        </ListItem>
                                    )}
                                    {assets.contacts > 0 && (
                                        <ListItem>
                                            <ListItemIcon><ContactsIcon /></ListItemIcon>
                                            <ListItemText primary={`${assets.contacts} контактов`} />
                                        </ListItem>
                                    )}
                                    {assets.tasks > 0 && (
                                        <ListItem>
                                            <ListItemIcon><TaskIcon /></ListItemIcon>
                                            <ListItemText primary={`${assets.tasks} незавершённых задач`} />
                                        </ListItem>
                                    )}
                                    {assets.gtdTasks > 0 && (
                                        <ListItem>
                                            <ListItemIcon><EventIcon /></ListItemIcon>
                                            <ListItemText primary={`${assets.gtdTasks} GTD задач`} />
                                        </ListItem>
                                    )}
                                </List>
                            </Box>
                        ) : (
                            <Alert severity="info">
                                У пользователя нет активных данных для передачи.
                            </Alert>
                        )}
                    </Box>
                )}

                {/* Step 2: Перераспределение */}
                {activeStep === 1 && (
                    <Box>
                        <Typography variant="body1" sx={{ mb: 2 }}>
                            Выберите, кому передать дела пользователя <strong>{user.displayName}</strong>:
                        </Typography>

                        <FormControl fullWidth sx={{ mb: 2 }}>
                            <InputLabel>Передать дела</InputLabel>
                            <Select
                                value={reassignTo}
                                onChange={(e) => setReassignTo(e.target.value)}
                                label="Передать дела"
                            >
                                {colleagues.map((colleague) => (
                                    <MenuItem key={colleague.id} value={colleague.id}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <Avatar src={colleague.photoURL} sx={{ width: 24, height: 24 }}>
                                                {colleague.displayName?.charAt(0)}
                                            </Avatar>
                                            {colleague.displayName}
                                            <Chip label={colleague.role} size="small" />
                                        </Box>
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={transferCalendar}
                                    onChange={(e) => setTransferCalendar(e.target.checked)}
                                />
                            }
                            label="Также перенести все запланированные события"
                        />

                        {/* Сводка */}
                        <Alert severity="info" sx={{ mt: 2 }}>
                            Будет передано:
                            <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
                                {assets.deals > 0 && <li>{assets.deals} сделок</li>}
                                {assets.contacts > 0 && <li>{assets.contacts} контактов</li>}
                                {assets.tasks > 0 && <li>{assets.tasks} задач</li>}
                                {assets.gtdTasks > 0 && <li>{assets.gtdTasks} GTD задач</li>}
                            </ul>
                        </Alert>
                    </Box>
                )}
            </DialogContent>

            <DialogActions>
                <Button onClick={onClose} disabled={loading}>
                    Отмена
                </Button>

                {activeStep === 1 && (
                    <Button onClick={handleBack} disabled={loading}>
                        Назад
                    </Button>
                )}

                {activeStep === 0 && totalAssets > 0 && !isLastAdmin && !isSelf && (
                    <Button
                        onClick={handleNext}
                        variant="contained"
                        disabled={loading || assets.loading}
                    >
                        Далее
                    </Button>
                )}

                {((activeStep === 0 && totalAssets === 0 && !isLastAdmin && !isSelf) || activeStep === 1) ? (
                    <Button
                        onClick={handleBlock}
                        variant="contained"
                        color="error"
                        disabled={loading || (activeStep === 1 && !reassignTo) || isLastAdmin || isSelf}
                    >
                        {loading ? (
                            <>
                                <CircularProgress size={20} sx={{ mr: 1 }} />
                                Блокировка...
                            </>
                        ) : (
                            'Заблокировать и передать дела'
                        )}
                    </Button>
                ) : null}
            </DialogActions>
        </Dialog>
    );
};

export default OffboardingWizard;
