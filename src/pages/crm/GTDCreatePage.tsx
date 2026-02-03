/**
 * @fileoverview GTD Create Page - 4-Step Wizard for Task Creation
 * 
 * Mobile-first wizard with:
 * - Step 1: Title + AI analysis + Project
 * - Step 2: Task Type + Priority + Deadline + needsEstimate
 * - Step 3: Assignee multi-select
 * - Step 4: AI subtasks + AI materials + Summary
 * 
 * Features: Progress bar, animations, AI suggestions, sticky header/footer
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    Box,
    Container,
    Typography,
    TextField,
    Button,
    IconButton,
    Paper,
    Chip,
    Avatar,
    LinearProgress,
    Switch,
    FormControlLabel,
    Divider,
    Card,
    CardContent,
    CircularProgress,
    Fade,
    Collapse,
    InputAdornment,
    alpha,
    useTheme,
} from '@mui/material';
import {
    Close as CloseIcon,
    ArrowBack as ArrowBackIcon,
    ArrowForward as ArrowForwardIcon,
    Check as CheckIcon,
    AutoAwesome as AIIcon,
    Add as AddIcon,
    Delete as DeleteIcon,
    CalendarMonth as CalendarIcon,
    AccessTime as TimeIcon,
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { ru } from 'date-fns/locale';
import { format, addDays, isToday, isTomorrow, startOfWeek } from 'date-fns';
import { collection, addDoc, getDocs, query, where, orderBy, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { useAuth } from '../../auth/AuthContext';
import { parseSmartInput, estimateTask } from '../../api/aiApi';
import {
    GTDStatus,
    GTDPriority,
    TaskType,
    TASK_TYPE_CONFIG,
    ACTION_GROUPS,
    ChecklistItem
} from '../../types/gtd.types';

// ═══════════════════════════════════════
// TYPES
// ═══════════════════════════════════════

interface CreateState {
    title: string;
    description: string;
    type: TaskType | null;
    priority: GTDPriority;
    assignees: string[];
    projectId: string | null;
    clientId: string | null;
    clientName: string | null;
    deadline: Date | null;
    needsEstimate: boolean;
    subtasks: { id: string; text: string; done: boolean }[];
    materials: { id: string; name: string; qty: number; unit: string; price: number }[];
}

interface UserProfile {
    id: string;
    displayName?: string;
    email?: string;
    role?: string;
    avatarUrl?: string;
    available?: boolean;
}

interface Client {
    id: string;
    name: string;
    address?: string;
}

// ═══════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════

const TOTAL_STEPS = 4;

const TASK_TYPES_UI = [
    { id: 'fix', icon: '🔧', name: 'Работа', desc: 'Сделать на объекте' },
    { id: 'measure', icon: '📊', name: 'Просчёт', desc: 'Нужен расчёт' },
    { id: 'buy', icon: '🛒', name: 'Купить', desc: 'Закупка материалов' },
    { id: 'deliver', icon: '🚚', name: 'Привезти', desc: 'Доставка/логистика' },
    { id: 'meet', icon: '👥', name: 'Встреча', desc: 'Созвон/выезд' },
    { id: 'check', icon: '🔍', name: 'Инспекция', desc: 'Проверка/осмотр' },
    { id: 'sign', icon: '📑', name: 'Документы', desc: 'Пермиты/бумаги' },
    { id: 'service', icon: '⚠️', name: 'Проблема', desc: 'Блокер/issue' },
] as const;

const PRIORITIES = [
    { id: 'high' as GTDPriority, icon: '🔴', name: 'Срочно', color: '#ef4444' },
    { id: 'medium' as GTDPriority, icon: '🟠', name: 'Высокий', color: '#f59e0b' },
    { id: 'low' as GTDPriority, icon: '🟡', name: 'Средний', color: '#eab308' },
    { id: 'none' as GTDPriority, icon: '🟢', name: 'Низкий', color: '#22c55e' },
];

// ═══════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════

const GTDCreatePage: React.FC = () => {
    const theme = useTheme();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { currentUser } = useAuth();

    // State
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [aiLoading, setAiLoading] = useState(false);

    const [formData, setFormData] = useState<CreateState>({
        title: '',
        description: '',
        type: null,
        priority: 'none',
        assignees: [],
        projectId: null,
        clientId: null,
        clientName: null,
        deadline: null,
        needsEstimate: false,
        subtasks: [],
        materials: [],
    });

    const [aiSuggestions, setAiSuggestions] = useState<{
        type: TaskType | null;
        priority: GTDPriority | null;
    }>({ type: null, priority: null });

    // Data
    const [clients, setClients] = useState<Client[]>([]);
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [newSubtask, setNewSubtask] = useState('');

    // Target column from URL
    const targetColumn = (searchParams.get('column') as GTDStatus) || 'inbox';

    // ═══════════════════════════════════════
    // DATA LOADING
    // ═══════════════════════════════════════

    useEffect(() => {
        loadClients();
        loadUsers();
    }, []);

    const loadClients = async () => {
        try {
            const snapshot = await getDocs(collection(db, 'clients'));
            setClients(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client)));
        } catch (err) {
            console.error('Error loading clients:', err);
        }
    };

    const loadUsers = async () => {
        try {
            const snapshot = await getDocs(collection(db, 'users'));
            setUsers(snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                available: Math.random() > 0.3 // Demo: random availability
            } as UserProfile)));
        } catch (err) {
            console.error('Error loading users:', err);
        }
    };

    // ═══════════════════════════════════════
    // AI ANALYSIS
    // ═══════════════════════════════════════

    useEffect(() => {
        if (formData.title.length > 5) {
            const timer = setTimeout(() => analyzeWithAI(formData.title), 500);
            return () => clearTimeout(timer);
        }
    }, [formData.title]);

    const analyzeWithAI = async (text: string) => {
        setAiLoading(true);
        try {
            const result = await parseSmartInput(text, [], clients.map(c => c.name));

            let suggestedType: TaskType | null = null;
            if (result.suggestedType) {
                suggestedType = result.suggestedType as TaskType;
            }

            setAiSuggestions({
                type: suggestedType,
                priority: result.suggestedPriority || null,
            });

            // Auto-apply client if matched
            if (result.suggestedClientName) {
                const matchedClient = clients.find(c =>
                    c.name.toLowerCase().includes(result.suggestedClientName!.toLowerCase())
                );
                if (matchedClient) {
                    setFormData(prev => ({
                        ...prev,
                        clientId: matchedClient.id,
                        clientName: matchedClient.name,
                    }));
                }
            }
        } catch (err) {
            console.error('AI analysis error:', err);
        } finally {
            setAiLoading(false);
        }
    };

    const generateSubtasks = async () => {
        setAiLoading(true);
        try {
            // Simple AI simulation for subtasks
            const text = formData.title.toLowerCase();
            let subtasks: string[] = [];

            if (text.includes('розетк')) {
                subtasks = [
                    'Разметка точек установки',
                    'Штробление стен под кабель',
                    'Прокладка кабеля',
                    'Установка подрозетников',
                    'Монтаж розеток',
                    'Подключение и тест'
                ];
            } else if (text.includes('светильник') || text.includes('свет')) {
                subtasks = [
                    'Разметка точек крепления',
                    'Прокладка кабеля',
                    'Установка крепежа',
                    'Монтаж светильников',
                    'Подключение',
                    'Тест'
                ];
            } else {
                subtasks = [
                    'Подготовка рабочего места',
                    'Основные работы',
                    'Проверка качества',
                    'Уборка'
                ];
            }

            setFormData(prev => ({
                ...prev,
                subtasks: subtasks.map((text, i) => ({
                    id: `sub_${Date.now()}_${i}`,
                    text,
                    done: false
                }))
            }));
        } finally {
            setAiLoading(false);
        }
    };

    const generateMaterials = async () => {
        setAiLoading(true);
        try {
            const text = formData.title.toLowerCase();
            let materials: CreateState['materials'] = [];

            if (text.includes('розетк')) {
                const qty = parseInt(text.match(/\d+/)?.[0] || '4');
                materials = [
                    { id: 'm1', name: 'Розетка Legrand Valena', qty, unit: 'шт', price: 12.50 },
                    { id: 'm2', name: 'Подрозетник 68мм', qty, unit: 'шт', price: 2.80 },
                    { id: 'm3', name: 'Кабель ВВГнг 3×2.5', qty: qty * 5, unit: 'м', price: 2.20 },
                    { id: 'm4', name: 'Гофра ПВХ 20мм', qty: qty * 5, unit: 'м', price: 0.80 },
                ];
            } else {
                materials = [
                    { id: 'm1', name: 'Материал 1', qty: 1, unit: 'шт', price: 10 },
                    { id: 'm2', name: 'Материал 2', qty: 1, unit: 'шт', price: 20 },
                ];
            }

            setFormData(prev => ({ ...prev, materials }));
        } finally {
            setAiLoading(false);
        }
    };

    // ═══════════════════════════════════════
    // HANDLERS
    // ═══════════════════════════════════════

    const toggleAssignee = (userId: string) => {
        setFormData(prev => ({
            ...prev,
            assignees: prev.assignees.includes(userId)
                ? prev.assignees.filter(id => id !== userId)
                : [...prev.assignees, userId]
        }));
    };

    const addSubtask = () => {
        if (!newSubtask.trim()) return;
        setFormData(prev => ({
            ...prev,
            subtasks: [...prev.subtasks, {
                id: `sub_${Date.now()}`,
                text: newSubtask.trim(),
                done: false
            }]
        }));
        setNewSubtask('');
    };

    const removeSubtask = (id: string) => {
        setFormData(prev => ({
            ...prev,
            subtasks: prev.subtasks.filter(s => s.id !== id)
        }));
    };

    const canProceed = useMemo(() => {
        switch (step) {
            case 1: return formData.title.length >= 3;
            case 2: return formData.type && formData.priority;
            case 3: return formData.assignees.length > 0;
            default: return true;
        }
    }, [step, formData]);

    const handleCreate = async () => {
        if (!currentUser) return;

        setLoading(true);
        try {
            // Build checklist items
            const checklistItems: ChecklistItem[] = formData.subtasks.map(s => ({
                id: s.id,
                text: s.text,
                completed: false,
                createdAt: Timestamp.now(),
            }));

            // Create task
            const taskData = {
                ownerId: currentUser.uid,
                ownerName: currentUser.displayName || currentUser.email || 'User',
                title: formData.title,
                description: formData.description || '',
                status: formData.needsEstimate ? 'estimate' : targetColumn,
                priority: formData.priority,
                taskType: formData.type,
                clientId: formData.clientId,
                clientName: formData.clientName,
                dueDate: formData.deadline ? Timestamp.fromDate(formData.deadline) : null,
                needsEstimate: formData.needsEstimate,
                assigneeId: formData.assignees[0] || null,
                assigneeName: formData.assignees[0]
                    ? users.find(u => u.id === formData.assignees[0])?.displayName
                    : null,
                checklistItems: checklistItems.length > 0 ? checklistItems : null,
                context: '@office',
                source: 'web',
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
            };

            const docRef = await addDoc(collection(db, 'gtd_tasks'), taskData);

            // Navigate to created task
            navigate(`/crm/gtd/${docRef.id}`);
        } catch (err) {
            console.error('Error creating task:', err);
            alert('Ошибка создания задачи');
        } finally {
            setLoading(false);
        }
    };

    const handleClose = () => {
        navigate('/crm/gtd');
    };

    const handleSkipToSummary = () => {
        if (canProceed) setStep(4);
    };

    // ═══════════════════════════════════════
    // COMPUTED
    // ═══════════════════════════════════════

    const materialsTotal = useMemo(() =>
        formData.materials.reduce((sum, m) => sum + m.qty * m.price, 0),
        [formData.materials]
    );

    const progressPercent = (step / TOTAL_STEPS) * 100;

    // ═══════════════════════════════════════
    // RENDER
    // ═══════════════════════════════════════

    return (
        <Box sx={{
            minHeight: '100vh',
            bgcolor: 'background.default',
            display: 'flex',
            flexDirection: 'column'
        }}>
            {/* Sticky Header */}
            <Paper
                elevation={0}
                sx={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 10,
                    borderBottom: 1,
                    borderColor: 'divider',
                    bgcolor: alpha(theme.palette.background.paper, 0.95),
                    backdropFilter: 'blur(8px)',
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2 }}>
                    <IconButton onClick={handleClose}>
                        <CloseIcon />
                    </IconButton>
                    <Box sx={{ textAlign: 'center' }}>
                        <Typography variant="h6" fontWeight="bold">Новая задача</Typography>
                        <Typography variant="caption" color="text.secondary">
                            Шаг {step} из {TOTAL_STEPS}
                        </Typography>
                    </Box>
                    <Box sx={{ width: 40 }} />
                </Box>

                {/* Progress Bar */}
                <Box sx={{ display: 'flex', gap: 0.5, px: 2, pb: 2 }}>
                    {[1, 2, 3, 4].map(s => (
                        <Box
                            key={s}
                            sx={{
                                flex: 1,
                                height: 6,
                                borderRadius: 1,
                                bgcolor: s <= step ? 'primary.main' : 'action.disabledBackground',
                                transition: 'all 0.3s ease',
                            }}
                        />
                    ))}
                </Box>
            </Paper>

            {/* Content */}
            <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>

                {/* Step 1: What needs to be done */}
                <Fade in={step === 1} unmountOnExit>
                    <Box sx={{ display: step === 1 ? 'block' : 'none' }}>
                        <Box sx={{ mb: 3 }}>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                                Что нужно сделать? *
                            </Typography>
                            <TextField
                                fullWidth
                                value={formData.title}
                                onChange={e => setFormData(prev => ({ ...prev, title: e.target.value }))}
                                placeholder="Например: Установить 6 розеток в гостиной"
                                autoFocus
                                sx={{
                                    '& .MuiOutlinedInput-root': {
                                        borderRadius: 3,
                                        fontSize: '1.1rem',
                                    }
                                }}
                            />
                        </Box>

                        <Box sx={{ mb: 3 }}>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                                Подробности (опционально)
                            </Typography>
                            <TextField
                                fullWidth
                                multiline
                                rows={3}
                                value={formData.description}
                                onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
                                placeholder="Дополнительная информация..."
                                sx={{
                                    '& .MuiOutlinedInput-root': { borderRadius: 3 }
                                }}
                            />
                        </Box>

                        {/* AI Suggestions */}
                        {formData.title.length > 5 && (
                            <Collapse in>
                                <Paper
                                    sx={{
                                        p: 2,
                                        mb: 3,
                                        borderRadius: 3,
                                        bgcolor: alpha(theme.palette.secondary.main, 0.08),
                                        border: 1,
                                        borderColor: alpha(theme.palette.secondary.main, 0.2),
                                    }}
                                >
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                                        {aiLoading ? <CircularProgress size={20} /> : <AIIcon color="secondary" />}
                                        <Typography fontWeight="medium" color="secondary">
                                            AI анализ
                                        </Typography>
                                    </Box>
                                    {!aiLoading && aiSuggestions.type && (
                                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                            <Chip
                                                label={`${TASK_TYPES_UI.find(t => t.id === aiSuggestions.type)?.icon} ${TASK_TYPES_UI.find(t => t.id === aiSuggestions.type)?.name} + Применить`}
                                                onClick={() => setFormData(prev => ({ ...prev, type: aiSuggestions.type }))}
                                                sx={{
                                                    bgcolor: alpha(theme.palette.secondary.main, 0.15),
                                                    '&:hover': { bgcolor: alpha(theme.palette.secondary.main, 0.25) }
                                                }}
                                            />
                                            {aiSuggestions.priority && (
                                                <Chip
                                                    label={`${PRIORITIES.find(p => p.id === aiSuggestions.priority)?.icon} ${PRIORITIES.find(p => p.id === aiSuggestions.priority)?.name} + Применить`}
                                                    onClick={() => setFormData(prev => ({ ...prev, priority: aiSuggestions.priority! }))}
                                                    sx={{
                                                        bgcolor: alpha(theme.palette.secondary.main, 0.15),
                                                        '&:hover': { bgcolor: alpha(theme.palette.secondary.main, 0.25) }
                                                    }}
                                                />
                                            )}
                                        </Box>
                                    )}
                                </Paper>
                            </Collapse>
                        )}

                        {/* Project/Client Selection */}
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                            Проект (опционально)
                        </Typography>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            {clients.slice(0, 5).map(client => (
                                <Paper
                                    key={client.id}
                                    onClick={() => setFormData(prev => ({
                                        ...prev,
                                        clientId: prev.clientId === client.id ? null : client.id,
                                        clientName: prev.clientId === client.id ? null : client.name,
                                    }))}
                                    sx={{
                                        p: 2,
                                        borderRadius: 2,
                                        cursor: 'pointer',
                                        border: 2,
                                        borderColor: formData.clientId === client.id
                                            ? 'primary.main'
                                            : 'divider',
                                        bgcolor: formData.clientId === client.id
                                            ? alpha(theme.palette.primary.main, 0.08)
                                            : 'background.paper',
                                        transition: 'all 0.2s',
                                        '&:active': { transform: 'scale(0.98)' }
                                    }}
                                >
                                    <Typography fontWeight="medium">{client.name}</Typography>
                                    {client.address && (
                                        <Typography variant="caption" color="text.secondary">
                                            {client.address}
                                        </Typography>
                                    )}
                                </Paper>
                            ))}
                        </Box>
                    </Box>
                </Fade>

                {/* Step 2: Type and Priority */}
                <Fade in={step === 2} unmountOnExit>
                    <Box sx={{ display: step === 2 ? 'block' : 'none' }}>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                            Тип задачи *
                        </Typography>
                        <Box sx={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(2, 1fr)',
                            gap: 1.5,
                            mb: 4
                        }}>
                            {TASK_TYPES_UI.map(t => (
                                <Paper
                                    key={t.id}
                                    onClick={() => setFormData(prev => ({ ...prev, type: t.id as TaskType }))}
                                    sx={{
                                        p: 2,
                                        borderRadius: 3,
                                        cursor: 'pointer',
                                        border: 2,
                                        borderColor: formData.type === t.id ? 'primary.main' : 'divider',
                                        bgcolor: formData.type === t.id
                                            ? alpha(theme.palette.primary.main, 0.08)
                                            : 'background.paper',
                                        transition: 'all 0.2s',
                                        '&:active': { transform: 'scale(0.95)' }
                                    }}
                                >
                                    <Typography fontSize="1.5rem" mb={0.5}>{t.icon}</Typography>
                                    <Typography fontWeight="medium">{t.name}</Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        {t.desc}
                                    </Typography>
                                </Paper>
                            ))}
                        </Box>

                        <Typography variant="body2" color="text.secondary" gutterBottom>
                            Приоритет *
                        </Typography>
                        <Box sx={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(4, 1fr)',
                            gap: 1,
                            mb: 3
                        }}>
                            {PRIORITIES.map(p => (
                                <Paper
                                    key={p.id}
                                    onClick={() => setFormData(prev => ({ ...prev, priority: p.id }))}
                                    sx={{
                                        p: 2,
                                        borderRadius: 3,
                                        cursor: 'pointer',
                                        textAlign: 'center',
                                        border: 2,
                                        borderColor: formData.priority === p.id
                                            ? p.color
                                            : 'divider',
                                        bgcolor: formData.priority === p.id
                                            ? alpha(p.color, 0.1)
                                            : 'background.paper',
                                        transition: 'all 0.2s',
                                        '&:active': { transform: 'scale(0.95)' }
                                    }}
                                >
                                    <Typography fontSize="1.5rem" mb={0.5}>{p.icon}</Typography>
                                    <Typography variant="caption">{p.name}</Typography>
                                </Paper>
                            ))}
                        </Box>

                        <Typography variant="body2" color="text.secondary" gutterBottom>
                            Дедлайн (опционально)
                        </Typography>
                        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={ru}>
                            <DatePicker
                                value={formData.deadline}
                                onChange={(date) => setFormData(prev => ({ ...prev, deadline: date as Date | null }))}
                                slotProps={{
                                    textField: {
                                        fullWidth: true,
                                        sx: { mb: 3, '& .MuiOutlinedInput-root': { borderRadius: 3 } }
                                    }
                                }}
                            />
                        </LocalizationProvider>

                        <Paper sx={{
                            p: 2,
                            borderRadius: 3,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between'
                        }}>
                            <Box>
                                <Typography fontWeight="medium">Требует просчёт</Typography>
                                <Typography variant="caption" color="text.secondary">
                                    Отправить в очередь Estimate
                                </Typography>
                            </Box>
                            <Switch
                                checked={formData.needsEstimate}
                                onChange={e => setFormData(prev => ({
                                    ...prev,
                                    needsEstimate: e.target.checked
                                }))}
                                color="primary"
                            />
                        </Paper>
                    </Box>
                </Fade>

                {/* Step 3: Assignees */}
                <Fade in={step === 3} unmountOnExit>
                    <Box sx={{ display: step === 3 ? 'block' : 'none' }}>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                            Назначить исполнителя *
                        </Typography>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 3 }}>
                            {users.map(user => (
                                <Paper
                                    key={user.id}
                                    onClick={() => user.available !== false && toggleAssignee(user.id)}
                                    sx={{
                                        p: 2,
                                        borderRadius: 3,
                                        cursor: user.available !== false ? 'pointer' : 'not-allowed',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 2,
                                        opacity: user.available === false ? 0.5 : 1,
                                        border: 2,
                                        borderColor: formData.assignees.includes(user.id)
                                            ? 'primary.main'
                                            : 'divider',
                                        bgcolor: formData.assignees.includes(user.id)
                                            ? alpha(theme.palette.primary.main, 0.08)
                                            : 'background.paper',
                                        transition: 'all 0.2s',
                                        '&:active': user.available !== false ? { transform: 'scale(0.98)' } : {}
                                    }}
                                >
                                    <Avatar sx={{ bgcolor: 'primary.main' }}>
                                        {user.displayName?.[0] || '👷'}
                                    </Avatar>
                                    <Box sx={{ flex: 1 }}>
                                        <Typography fontWeight="medium">
                                            {user.displayName || user.email}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {user.role || 'Сотрудник'}
                                        </Typography>
                                    </Box>
                                    {user.available === false && (
                                        <Chip label="Занят" size="small" color="error" variant="outlined" />
                                    )}
                                    {formData.assignees.includes(user.id) && (
                                        <CheckIcon color="primary" />
                                    )}
                                </Paper>
                            ))}
                        </Box>

                        {formData.assignees.length > 0 && (
                            <Paper sx={{ p: 2, borderRadius: 3 }}>
                                <Typography variant="caption" color="text.secondary" gutterBottom>
                                    Выбрано: {formData.assignees.length}
                                </Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
                                    {formData.assignees.map(id => {
                                        const user = users.find(u => u.id === id);
                                        return (
                                            <Chip
                                                key={id}
                                                label={user?.displayName || user?.email}
                                                onDelete={() => toggleAssignee(id)}
                                                avatar={<Avatar>{user?.displayName?.[0]}</Avatar>}
                                            />
                                        );
                                    })}
                                </Box>
                            </Paper>
                        )}
                    </Box>
                </Fade>

                {/* Step 4: Details & Summary */}
                <Fade in={step === 4} unmountOnExit>
                    <Box sx={{ display: step === 4 ? 'block' : 'none' }}>
                        {/* Subtasks */}
                        <Box sx={{ mb: 3 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                <Typography variant="body2" color="text.secondary">
                                    Чек-лист работ
                                </Typography>
                                <Button
                                    size="small"
                                    startIcon={aiLoading ? <CircularProgress size={16} /> : <AIIcon />}
                                    onClick={generateSubtasks}
                                    disabled={aiLoading}
                                    sx={{ borderRadius: 2 }}
                                >
                                    AI генерация
                                </Button>
                            </Box>

                            {formData.subtasks.length > 0 ? (
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                    {formData.subtasks.map((s, i) => (
                                        <Paper key={s.id} sx={{ p: 1.5, borderRadius: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <Typography color="text.secondary" sx={{ width: 24 }}>{i + 1}</Typography>
                                            <Typography sx={{ flex: 1 }}>{s.text}</Typography>
                                            <IconButton size="small" onClick={() => removeSubtask(s.id)}>
                                                <DeleteIcon fontSize="small" />
                                            </IconButton>
                                        </Paper>
                                    ))}
                                </Box>
                            ) : (
                                <Paper
                                    variant="outlined"
                                    sx={{
                                        p: 3,
                                        borderRadius: 2,
                                        textAlign: 'center',
                                        borderStyle: 'dashed'
                                    }}
                                >
                                    <Typography color="text.secondary">
                                        Нажмите "AI генерация" или добавьте вручную
                                    </Typography>
                                </Paper>
                            )}

                            <TextField
                                fullWidth
                                size="small"
                                value={newSubtask}
                                onChange={e => setNewSubtask(e.target.value)}
                                placeholder="Добавить пункт..."
                                onKeyDown={e => e.key === 'Enter' && addSubtask()}
                                sx={{ mt: 1, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
                                InputProps={{
                                    endAdornment: (
                                        <InputAdornment position="end">
                                            <IconButton size="small" onClick={addSubtask}>
                                                <AddIcon />
                                            </IconButton>
                                        </InputAdornment>
                                    )
                                }}
                            />
                        </Box>

                        {/* Materials */}
                        <Box sx={{ mb: 3 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                <Typography variant="body2" color="text.secondary">
                                    Материалы
                                </Typography>
                                <Button
                                    size="small"
                                    startIcon={aiLoading ? <CircularProgress size={16} /> : <AIIcon />}
                                    onClick={generateMaterials}
                                    disabled={aiLoading}
                                    sx={{ borderRadius: 2 }}
                                >
                                    AI подбор
                                </Button>
                            </Box>

                            {formData.materials.length > 0 ? (
                                <Paper sx={{ borderRadius: 2, overflow: 'hidden' }}>
                                    {formData.materials.map((m, i) => (
                                        <Box
                                            key={m.id}
                                            sx={{
                                                p: 1.5,
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                borderTop: i > 0 ? 1 : 0,
                                                borderColor: 'divider'
                                            }}
                                        >
                                            <Box>
                                                <Typography>{m.name}</Typography>
                                                <Typography variant="caption" color="text.secondary">
                                                    {m.qty} {m.unit} × ${m.price}
                                                </Typography>
                                            </Box>
                                            <Typography fontWeight="medium">
                                                ${(m.qty * m.price).toFixed(2)}
                                            </Typography>
                                        </Box>
                                    ))}
                                    <Box sx={{
                                        p: 1.5,
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        bgcolor: 'action.hover',
                                        borderTop: 1,
                                        borderColor: 'divider'
                                    }}>
                                        <Typography fontWeight="medium">Итого материалы</Typography>
                                        <Typography fontWeight="bold" color="warning.main">
                                            ${materialsTotal.toFixed(2)}
                                        </Typography>
                                    </Box>
                                </Paper>
                            ) : (
                                <Paper
                                    variant="outlined"
                                    sx={{ p: 2, borderRadius: 2, textAlign: 'center', borderStyle: 'dashed' }}
                                >
                                    <Typography color="text.secondary">Нажмите "AI подбор"</Typography>
                                </Paper>
                            )}
                        </Box>

                        {/* Summary */}
                        <Paper
                            sx={{
                                p: 2,
                                borderRadius: 3,
                                background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)}, ${alpha(theme.palette.secondary.main, 0.1)})`,
                                border: 1,
                                borderColor: alpha(theme.palette.primary.main, 0.2),
                            }}
                        >
                            <Typography variant="subtitle2" color="primary" gutterBottom>
                                📋 Сводка
                            </Typography>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <Typography variant="body2" color="text.secondary">Задача</Typography>
                                    <Typography variant="body2" fontWeight="medium" sx={{ maxWidth: 200, textAlign: 'right' }} noWrap>
                                        {formData.title}
                                    </Typography>
                                </Box>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <Typography variant="body2" color="text.secondary">Тип</Typography>
                                    <Typography variant="body2">
                                        {TASK_TYPES_UI.find(t => t.id === formData.type)?.icon} {TASK_TYPES_UI.find(t => t.id === formData.type)?.name}
                                    </Typography>
                                </Box>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <Typography variant="body2" color="text.secondary">Приоритет</Typography>
                                    <Typography variant="body2">
                                        {PRIORITIES.find(p => p.id === formData.priority)?.icon} {PRIORITIES.find(p => p.id === formData.priority)?.name}
                                    </Typography>
                                </Box>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <Typography variant="body2" color="text.secondary">Исполнители</Typography>
                                    <Typography variant="body2">{formData.assignees.length} чел.</Typography>
                                </Box>
                                {formData.subtasks.length > 0 && (
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <Typography variant="body2" color="text.secondary">Подзадачи</Typography>
                                        <Typography variant="body2">{formData.subtasks.length} шт.</Typography>
                                    </Box>
                                )}
                                {formData.materials.length > 0 && (
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <Typography variant="body2" color="text.secondary">Материалы</Typography>
                                        <Typography variant="body2">${materialsTotal.toFixed(2)}</Typography>
                                    </Box>
                                )}
                                {formData.needsEstimate && (
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <Typography variant="body2" color="warning.main">💰 Требует просчёт</Typography>
                                        <Typography variant="body2" color="warning.main">Да</Typography>
                                    </Box>
                                )}
                            </Box>
                        </Paper>
                    </Box>
                </Fade>
            </Box>

            {/* Sticky Footer */}
            <Paper
                elevation={0}
                sx={{
                    position: 'sticky',
                    bottom: 0,
                    p: 2,
                    borderTop: 1,
                    borderColor: 'divider',
                    bgcolor: alpha(theme.palette.background.paper, 0.95),
                    backdropFilter: 'blur(8px)',
                }}
            >
                <Box sx={{ display: 'flex', gap: 1.5 }}>
                    {step > 1 && (
                        <Button
                            variant="outlined"
                            fullWidth
                            onClick={() => setStep(step - 1)}
                            startIcon={<ArrowBackIcon />}
                            sx={{
                                py: 1.5,
                                borderRadius: 3,
                                fontWeight: 'bold'
                            }}
                        >
                            Назад
                        </Button>
                    )}

                    {step < TOTAL_STEPS ? (
                        <Button
                            variant="contained"
                            fullWidth
                            onClick={() => canProceed && setStep(step + 1)}
                            disabled={!canProceed}
                            endIcon={<ArrowForwardIcon />}
                            sx={{
                                py: 1.5,
                                borderRadius: 3,
                                fontWeight: 'bold'
                            }}
                        >
                            Далее
                        </Button>
                    ) : (
                        <Button
                            variant="contained"
                            color="success"
                            fullWidth
                            onClick={handleCreate}
                            disabled={loading}
                            startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <CheckIcon />}
                            sx={{
                                py: 1.5,
                                borderRadius: 3,
                                fontWeight: 'bold'
                            }}
                        >
                            {loading ? 'Создание...' : 'Создать задачу'}
                        </Button>
                    )}
                </Box>

                {step === 1 && (
                    <Button
                        fullWidth
                        onClick={handleSkipToSummary}
                        disabled={!canProceed}
                        sx={{ mt: 1, color: 'text.secondary' }}
                    >
                        Пропустить детали →
                    </Button>
                )}
            </Paper>
        </Box>
    );
};

export default GTDCreatePage;
