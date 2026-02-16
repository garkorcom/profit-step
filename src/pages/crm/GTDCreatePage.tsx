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

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    Box,
    Typography,
    TextField,
    Button,
    IconButton,
    Paper,
    Chip,
    Avatar,
    Switch,
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
    Search as SearchIcon,
    OpenInNew as OpenInNewIcon,
    Mic as MicIcon,
    MicOff as MicOffIcon,
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { ru } from 'date-fns/locale';
import { format, addDays, nextMonday, endOfDay } from 'date-fns';
import { collection, addDoc, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { useAuth } from '../../auth/AuthContext';
import { parseSmartInput } from '../../api/aiApi';
import { useAiTask } from '../../hooks/useAiTask';
import AiDraftPreview from '../../components/tasks/AiDraftPreview';
import { AiGenerateButton } from '../../components/tasks/AiGenerateButton';
import { useClientUsageHistory } from '../../hooks/useClientUsageHistory';
import { useTeamProjectHistory } from '../../hooks/useTeamProjectHistory';
import {
    GTDStatus,
    GTDPriority,
    TaskType,
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

/** Map Gemini Smart Input types → TASK_TYPES_UI ids */
const SMART_INPUT_TYPE_MAP: Record<string, string> = {
    buy: 'buy', fix: 'fix', meet: 'meet', check: 'check',
    install: 'fix', setup: 'fix', bring: 'deliver', pickup: 'deliver',
    move: 'deliver', handover: 'meet', discuss: 'meet',
    measure: 'measure', sign: 'sign', service: 'service',
    other: 'fix',
};

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

    // AI Task Generation (Claude) — full state machine via hook
    const ai = useAiTask();

    // Data
    const [clients, setClients] = useState<Client[]>([]);
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [newSubtask, setNewSubtask] = useState('');
    const [clientSearch, setClientSearch] = useState('');
    const [showAllClients, setShowAllClients] = useState(false);
    const [showAllTeam, setShowAllTeam] = useState(false);
    const [showDatePicker, setShowDatePicker] = useState(false);
    const { trackUsage, sortClients } = useClientUsageHistory(currentUser?.uid);
    const { trackAssignment, getTopTeamForProject } = useTeamProjectHistory(currentUser?.uid);

    // Voice Input states
    const [isListening, setIsListening] = useState(false);
    const [voiceSupported] = useState(() => {
        return typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
    });
    const recognitionRef = useRef<any>(null);

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
                available: true // TODO: check active sessions for real availability
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
                const mapped = SMART_INPUT_TYPE_MAP[result.suggestedType];
                suggestedType = (mapped || null) as TaskType | null;
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
    // AI TASK GENERATION (Claude) — via useAiTask hook
    // ═══════════════════════════════════════

    const handleAiGenerate = async () => {
        if (!formData.title || !formData.clientId) return;

        await ai.generate({
            userInput: formData.title + (formData.description ? '\n' + formData.description : ''),
            projectId: formData.clientId,
            inputMethod: isListening ? 'voice' : 'text',
        });
    };

    // When AI draft confirms, auto-fill form for fallback usage
    useEffect(() => {
        if (ai.status !== 'preview' || !ai.draft) return;

        const draft = ai.draft;
        setFormData(prev => ({
            ...prev,
            priority: (draft.priority === 'urgent' ? 'high' : draft.priority) as GTDPriority,
            assignees: draft.assigneeIds.filter(id => users.some(u => u.id === id)),
            deadline: draft.dueDate ? new Date(draft.dueDate) : prev.deadline,
            description: prev.description || (draft.zone ? `Зона: ${draft.zone}\n${draft.description || ''}` : draft.description || ''),
            subtasks: (draft.checklist || []).map((item, i) => ({
                id: `ai_sub_${Date.now()}_${i}`,
                text: item.title,
                done: false,
            })),
        }));

        if (aiSuggestions.type) {
            setFormData(prev => ({ ...prev, type: aiSuggestions.type }));
        }
        // Don't jump to step 4 — AiDraftPreview replaces the wizard entirely
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ai.status]);

    // Confirm handler for AiDraftPreview
    const handleAiConfirm = async (scopeDecision?: string) => {
        const result: any = await ai.confirm(scopeDecision);

        if (formData.clientId) {
            trackUsage(formData.clientId);
            formData.assignees.forEach(assigneeId => {
                trackAssignment(formData.clientId!, assigneeId);
            });
        }

        if (result?.taskId) {
            navigate(`/crm/gtd/${result.taskId}`);
        } else {
            // Confirmed but no taskId — just go back to board
            navigate('/crm/gtd');
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
            // If AI draft exists, use confirmAiTask for audit trail
            if (ai.isPreview && ai.draft && ai.auditLogId) {
                const result: any = await ai.confirm(
                    ai.analysis?.scopeStatus
                );

                // Track client usage
                if (formData.clientId) {
                    trackUsage(formData.clientId);
                    formData.assignees.forEach(assigneeId => {
                        trackAssignment(formData.clientId!, assigneeId);
                    });
                }

                if (result?.taskId) {
                    navigate(`/crm/gtd/${result.taskId}`);
                }
                return;
            }

            // Standard (non-AI) task creation
            const checklistItems: ChecklistItem[] = formData.subtasks.map(s => ({
                id: s.id,
                text: s.text,
                completed: false,
                createdAt: Timestamp.now(),
            }));

            const coAssigneeUsers = formData.assignees.slice(1).map(id => {
                const u = users.find(user => user.id === id);
                return { id, name: u?.displayName || '', role: 'executor' as const };
            });

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
                coAssignees: coAssigneeUsers.length > 0 ? coAssigneeUsers : [],
                coAssigneeIds: coAssigneeUsers.map(c => c.id),
                checklistItems: checklistItems.length > 0 ? checklistItems : null,
                context: '@office',
                source: 'web',
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
            };

            const docRef = await addDoc(collection(db, 'gtd_tasks'), taskData);

            if (formData.clientId) {
                trackUsage(formData.clientId);
                formData.assignees.forEach(assigneeId => {
                    trackAssignment(formData.clientId!, assigneeId);
                });
            }

            navigate(`/crm/gtd/${docRef.id}`);
        } catch (err) {
            console.error('Error creating task:', err);
            alert('Ошибка создания задачи');
        } finally {
            setLoading(false);
        }
    };

    const handleClose = () => {
        // Stop voice input if active
        if (recognitionRef.current) {
            recognitionRef.current.stop();
            setIsListening(false);
        }
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

    // Progress is tracked by step indicator in the header

    // ═══════════════════════════════════════
    // VOICE INPUT HANDLER
    // ═══════════════════════════════════════

    const toggleVoiceInput = useCallback(() => {
        if (!voiceSupported) return;

        if (isListening) {
            recognitionRef.current?.stop();
            setIsListening(false);
            if ('vibrate' in navigator) navigator.vibrate(30);
            return;
        }

        const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        const recognition = new SpeechRecognitionAPI();
        recognition.lang = 'ru-RU';
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        let finalTranscript = formData.title;

        recognition.onresult = (event: any) => {
            let interim = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += (finalTranscript ? ' ' : '') + transcript;
                    setFormData(prev => ({ ...prev, title: finalTranscript }));
                } else {
                    interim = transcript;
                }
            }
            if (interim) {
                setFormData(prev => ({ ...prev, title: finalTranscript + (finalTranscript ? ' ' : '') + interim }));
            }
        };

        recognition.onerror = (event: any) => {
            console.warn('Speech recognition error:', event.error);
            setIsListening(false);
            if (event.error === 'not-allowed') {
                alert('Разрешите доступ к микрофону в настройках браузера');
            }
        };

        recognition.onend = () => {
            setIsListening(false);
        };

        recognitionRef.current = recognition;
        recognition.start();
        setIsListening(true);
        if ('vibrate' in navigator) navigator.vibrate([50, 30, 50]);
    }, [voiceSupported, isListening, formData.title]);

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

                {/* ════════════════════════════════════════════
                    AI Status Views — replace wizard when active
                ════════════════════════════════════════════ */}

                {/* Loading: Skeleton shimmer */}
                {ai.status === 'loading' && (
                    <Fade in>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
                            {[1, 2, 3, 4].map(i => (
                                <Box
                                    key={i}
                                    sx={{
                                        height: i === 4 ? 120 : 48,
                                        borderRadius: 3,
                                        bgcolor: 'action.disabledBackground',
                                        animation: 'pulse 1.5s infinite ease-in-out',
                                        '@keyframes pulse': {
                                            '0%, 100%': { opacity: 0.4 },
                                            '50%': { opacity: 0.8 },
                                        },
                                    }}
                                />
                            ))}
                            <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{ textAlign: 'center', mt: 2 }}
                            >
                                🤖 Анализирую смету и историю...
                            </Typography>
                            <AiGenerateButton onClick={() => { }} loading={true} />
                        </Box>
                    </Fade>
                )}

                {/* Preview: AiDraftPreview replaces the wizard */}
                {(ai.status === 'preview' || ai.status === 'confirming') && ai.draft && ai.analysis && (
                    <Fade in>
                        <Box>
                            <AiDraftPreview
                                draft={ai.draft}
                                analysis={ai.analysis}
                                latencyMs={ai.latencyMs}
                                employees={users.map(u => ({ id: u.id, name: u.displayName || u.email || u.id }))}
                                projects={clients.map(c => ({ id: c.id, name: c.name }))}
                                onEditField={ai.editDraft}
                                onConfirm={handleAiConfirm}
                                onCancel={ai.cancel}
                                isConfirming={ai.isConfirming}
                            />
                        </Box>
                    </Fade>
                )}

                {/* Error: retry / manual fallback */}
                {ai.status === 'error' && (
                    <Fade in>
                        <Paper
                            sx={{
                                p: 3,
                                mt: 2,
                                borderRadius: 3,
                                bgcolor: alpha(theme.palette.error.main, 0.06),
                                border: 1,
                                borderColor: alpha(theme.palette.error.main, 0.3),
                            }}
                        >
                            <Typography variant="body2" color="error" sx={{ mb: 2, fontWeight: 500 }}>
                                ⚠️ {ai.error || 'AI генерация не удалась'}
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 1.5 }}>
                                <Button
                                    fullWidth
                                    variant="outlined"
                                    onClick={ai.reset}
                                    sx={{ borderRadius: 3, textTransform: 'none', fontWeight: 600 }}
                                >
                                    Попробовать снова
                                </Button>
                                <Button
                                    fullWidth
                                    variant="contained"
                                    color="error"
                                    onClick={() => { ai.reset(); }}
                                    sx={{ borderRadius: 3, textTransform: 'none', fontWeight: 600 }}
                                >
                                    Заполнить вручную
                                </Button>
                            </Box>
                        </Paper>
                    </Fade>
                )}

                {/* Confirmed: success toast */}
                {ai.status === 'confirmed' && (
                    <Fade in>
                        <Paper
                            sx={{
                                p: 3,
                                mt: 2,
                                borderRadius: 3,
                                bgcolor: alpha(theme.palette.success.main, 0.08),
                                border: 1,
                                borderColor: alpha(theme.palette.success.main, 0.3),
                                display: 'flex',
                                alignItems: 'center',
                                gap: 2,
                            }}
                        >
                            <Box
                                sx={{
                                    width: 40, height: 40, borderRadius: '50%',
                                    bgcolor: 'success.main',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}
                            >
                                <CheckIcon sx={{ color: '#fff', fontSize: 24 }} />
                            </Box>
                            <Box>
                                <Typography fontWeight="bold" color="success.dark">
                                    Задача создана!
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                    AI • {(ai.latencyMs / 1000).toFixed(1)}s
                                </Typography>
                            </Box>
                        </Paper>
                    </Fade>
                )}

                {/* ════════════════════════════════════════════
                    Wizard Steps — only show when AI is idle
                ════════════════════════════════════════════ */}

                {/* Step 1: What needs to be done */}
                <Fade in={step === 1 && ai.status === 'idle'} unmountOnExit>
                    <Box sx={{ display: step === 1 ? 'block' : 'none' }}>
                        <Box sx={{ mb: 3 }}>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                                Что нужно сделать? *
                                {isListening && (
                                    <Box component="span" sx={{ color: 'error.main', fontWeight: 600, ml: 1, animation: 'pulse 1.5s infinite', '@keyframes pulse': { '0%': { opacity: 1 }, '50%': { opacity: 0.5 }, '100%': { opacity: 1 } } }}>
                                        🔴 Слушаю...
                                    </Box>
                                )}
                            </Typography>
                            <TextField
                                fullWidth
                                value={formData.title}
                                onChange={e => setFormData(prev => ({ ...prev, title: e.target.value }))}
                                placeholder={isListening ? 'Говорите...' : 'Например: Установить 6 розеток в гостиной'}
                                autoFocus
                                InputProps={{
                                    endAdornment: voiceSupported ? (
                                        <InputAdornment position="end">
                                            <IconButton
                                                onClick={toggleVoiceInput}
                                                sx={{
                                                    color: isListening ? '#fff' : 'text.secondary',
                                                    bgcolor: isListening ? 'error.main' : 'transparent',
                                                    animation: isListening ? 'voicePulse 1.5s infinite' : 'none',
                                                    '&:hover': {
                                                        bgcolor: isListening ? 'error.dark' : 'action.hover',
                                                    },
                                                    '@keyframes voicePulse': {
                                                        '0%': { boxShadow: '0 0 0 0 rgba(244, 67, 54, 0.4)' },
                                                        '70%': { boxShadow: '0 0 0 10px rgba(244, 67, 54, 0)' },
                                                        '100%': { boxShadow: '0 0 0 0 rgba(244, 67, 54, 0)' },
                                                    },
                                                    transition: 'all 0.2s',
                                                }}
                                            >
                                                {isListening ? <MicOffIcon /> : <MicIcon />}
                                            </IconButton>
                                        </InputAdornment>
                                    ) : undefined,
                                }}
                                sx={{
                                    '& .MuiOutlinedInput-root': {
                                        borderRadius: 3,
                                        fontSize: '1.1rem',
                                        bgcolor: isListening ? 'rgba(244, 67, 54, 0.04)' : undefined,
                                    },
                                    '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': isListening ? {
                                        borderColor: 'error.main',
                                        borderWidth: 2,
                                    } : {},
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

                        {/* AI Generate Button */}
                        {formData.title.length > 5 && formData.clientId && ai.status === 'idle' && (
                            <Box sx={{ mb: 3 }}>
                                <AiGenerateButton
                                    onClick={handleAiGenerate}
                                    loading={false}
                                />
                            </Box>
                        )}

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
                                    {!aiLoading && aiSuggestions.type && (() => {
                                        const matchedType = TASK_TYPES_UI.find(t => t.id === aiSuggestions.type);
                                        const matchedPriority = aiSuggestions.priority ? PRIORITIES.find(p => p.id === aiSuggestions.priority) : null;
                                        return (
                                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                                {matchedType && (
                                                    <Chip
                                                        label={`${matchedType.icon} ${matchedType.name} + Применить`}
                                                        onClick={() => setFormData(prev => ({ ...prev, type: aiSuggestions.type }))}
                                                        sx={{
                                                            bgcolor: alpha(theme.palette.secondary.main, 0.15),
                                                            '&:hover': { bgcolor: alpha(theme.palette.secondary.main, 0.25) }
                                                        }}
                                                    />
                                                )}
                                                {matchedPriority && (
                                                    <Chip
                                                        label={`${matchedPriority.icon} ${matchedPriority.name} + Применить`}
                                                        onClick={() => setFormData(prev => ({ ...prev, priority: aiSuggestions.priority! }))}
                                                        sx={{
                                                            bgcolor: alpha(theme.palette.secondary.main, 0.15),
                                                            '&:hover': { bgcolor: alpha(theme.palette.secondary.main, 0.25) }
                                                        }}
                                                    />
                                                )}
                                            </Box>
                                        );
                                    })()}
                                </Paper>
                            </Collapse>
                        )}

                        {/* Checklist - Available from Step 1 */}
                        <Box sx={{ mb: 3 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                <Typography variant="body2" color="text.secondary">
                                    📋 Чек-лист (опционально)
                                </Typography>
                            </Box>

                            {formData.subtasks.length > 0 && (
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 1 }}>
                                    {formData.subtasks.map((s, i) => (
                                        <Paper key={s.id} sx={{ p: 1, borderRadius: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <Typography color="text.secondary" sx={{ width: 24, fontSize: '0.85rem' }}>{i + 1}</Typography>
                                            <Typography sx={{ flex: 1, fontSize: '0.9rem' }}>{s.text}</Typography>
                                            <IconButton size="small" onClick={() => removeSubtask(s.id)}>
                                                <DeleteIcon fontSize="small" />
                                            </IconButton>
                                        </Paper>
                                    ))}
                                </Box>
                            )}

                            <TextField
                                fullWidth
                                size="small"
                                value={newSubtask}
                                onChange={e => setNewSubtask(e.target.value)}
                                placeholder="Добавить пункт чек-листа..."
                                onKeyDown={e => e.key === 'Enter' && addSubtask()}
                                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
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

                        {/* Project/Client Selection */}
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                            Проект (опционально)
                        </Typography>

                        {/* Client Search */}
                        {clients.length > 5 && (
                            <TextField
                                fullWidth
                                size="small"
                                value={clientSearch}
                                onChange={e => setClientSearch(e.target.value)}
                                placeholder="Поиск проекта..."
                                sx={{ mb: 1, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
                                InputProps={{
                                    startAdornment: (
                                        <InputAdornment position="start">
                                            <SearchIcon fontSize="small" color="action" />
                                        </InputAdornment>
                                    ),
                                    endAdornment: clientSearch ? (
                                        <InputAdornment position="end">
                                            <IconButton size="small" onClick={() => setClientSearch('')}>
                                                <CloseIcon fontSize="small" />
                                            </IconButton>
                                        </InputAdornment>
                                    ) : null
                                }}
                            />
                        )}

                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            {(() => {
                                const sorted = sortClients(clients);
                                const filtered = sorted.filter(c => !clientSearch || c.name.toLowerCase().includes(clientSearch.toLowerCase()));
                                const visible = showAllClients ? filtered : filtered.slice(0, 5);
                                const hidden = filtered.length - visible.length;
                                return (
                                    <>
                                        {visible.map(client => (
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
                                        {hidden > 0 && (
                                            <Button
                                                variant="text"
                                                onClick={() => setShowAllClients(true)}
                                                sx={{ alignSelf: 'flex-start', textTransform: 'none', borderRadius: 2 }}
                                            >
                                                Ещё {hidden} проектов
                                            </Button>
                                        )}
                                    </>
                                );
                            })()}

                            {/* Add New Project Link */}
                            <Paper
                                onClick={() => navigate('/crm/clients/new')}
                                sx={{
                                    p: 2,
                                    borderRadius: 2,
                                    cursor: 'pointer',
                                    border: 2,
                                    borderColor: 'divider',
                                    borderStyle: 'dashed',
                                    bgcolor: 'background.paper',
                                    transition: 'all 0.2s',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1,
                                    '&:hover': { borderColor: 'primary.main', bgcolor: alpha(theme.palette.primary.main, 0.04) },
                                    '&:active': { transform: 'scale(0.98)' }
                                }}
                            >
                                <AddIcon color="primary" fontSize="small" />
                                <Typography fontWeight="medium" color="primary.main">Добавить проект</Typography>
                                <OpenInNewIcon fontSize="small" color="action" sx={{ ml: 'auto' }} />
                            </Paper>
                        </Box>
                    </Box>
                </Fade>

                {/* Step 2: Type and Priority */}
                <Fade in={step === 2 && ai.status === 'idle'} unmountOnExit>
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
                        {/* Quick Date Chips */}
                        {(() => {
                            const now = new Date();
                            const isEvening = now.getHours() >= 17;
                            const todayDate = endOfDay(now);
                            const tomorrowDate = endOfDay(addDays(now, 1));
                            const nextMon = endOfDay(nextMonday(now));

                            const chips: { key: string; label: string; hint?: string; date: Date; color: string; activeColor: string }[] = [
                                { key: 'today', label: '☀️ Сегодня', date: todayDate, color: '#fef2f2', activeColor: '#ef4444' },
                                { key: 'tomorrow', label: '🌅 Завтра', hint: isEvening ? 'рекомендуем' : undefined, date: tomorrowDate, color: '#fff7ed', activeColor: '#f59e0b' },
                                { key: 'next_week', label: '📅 Нед', date: nextMon, color: '#eff6ff', activeColor: '#3b82f6' },
                            ];

                            const isActive = (d: Date) =>
                                formData.deadline &&
                                format(formData.deadline, 'yyyy-MM-dd') === format(d, 'yyyy-MM-dd');

                            const isCustom = formData.deadline &&
                                !chips.some(c => format(formData.deadline!, 'yyyy-MM-dd') === format(c.date, 'yyyy-MM-dd'));

                            return (
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 3 }}>
                                    {chips.map(c => (
                                        <Chip
                                            key={c.key}
                                            label={
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                    {c.label}
                                                    {c.hint && (
                                                        <Typography
                                                            component="span"
                                                            variant="caption"
                                                            sx={{
                                                                fontSize: '0.6rem',
                                                                bgcolor: alpha(c.activeColor, 0.15),
                                                                color: c.activeColor,
                                                                px: 0.5,
                                                                borderRadius: 1,
                                                                fontWeight: 600,
                                                            }}
                                                        >
                                                            {c.hint}
                                                        </Typography>
                                                    )}
                                                </Box>
                                            }
                                            onClick={() => {
                                                if (isActive(c.date)) {
                                                    setFormData(prev => ({ ...prev, deadline: null }));
                                                } else {
                                                    setFormData(prev => ({ ...prev, deadline: c.date }));
                                                }
                                            }}
                                            sx={{
                                                px: 1.5,
                                                py: 2.5,
                                                fontSize: '0.95rem',
                                                fontWeight: 600,
                                                borderRadius: '20px',
                                                border: 2,
                                                borderColor: isActive(c.date) ? c.activeColor : 'divider',
                                                bgcolor: isActive(c.date) ? alpha(c.activeColor, 0.12) : c.color,
                                                color: isActive(c.date) ? c.activeColor : 'text.primary',
                                                transition: 'all 0.2s',
                                                cursor: 'pointer',
                                                '&:hover': {
                                                    bgcolor: alpha(c.activeColor, 0.08),
                                                },
                                                '&:active': { transform: 'scale(0.95)' },
                                            }}
                                        />
                                    ))}

                                    {/* Custom date chip */}
                                    <Chip
                                        label={isCustom
                                            ? `🗓️ ${format(formData.deadline!, 'dd MMM', { locale: ru })}`
                                            : '🗓️ Другое...'
                                        }
                                        onClick={() => setShowDatePicker(true)}
                                        sx={{
                                            px: 1.5,
                                            py: 2.5,
                                            fontSize: '0.95rem',
                                            fontWeight: 600,
                                            borderRadius: '20px',
                                            border: 2,
                                            borderColor: isCustom ? 'primary.main' : 'divider',
                                            bgcolor: isCustom ? alpha(theme.palette.primary.main, 0.12) : '#f3f4f6',
                                            color: isCustom ? 'primary.main' : 'text.secondary',
                                            transition: 'all 0.2s',
                                            cursor: 'pointer',
                                            '&:hover': {
                                                bgcolor: alpha(theme.palette.primary.main, 0.08),
                                            },
                                            '&:active': { transform: 'scale(0.95)' },
                                        }}
                                    />
                                </Box>
                            );
                        })()}

                        {/* DatePicker fallback for custom date */}
                        <Collapse in={showDatePicker}>
                            <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={ru}>
                                <DatePicker
                                    value={formData.deadline}
                                    onChange={(date) => {
                                        setFormData(prev => ({ ...prev, deadline: date as Date | null }));
                                        setShowDatePicker(false);
                                    }}
                                    slotProps={{
                                        textField: {
                                            fullWidth: true,
                                            sx: { mb: 3, '& .MuiOutlinedInput-root': { borderRadius: 3 } }
                                        }
                                    }}
                                />
                            </LocalizationProvider>
                        </Collapse>

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

                {/* Step 3: Assignees — Smart Team + Full List */}
                <Fade in={step === 3 && ai.status === 'idle'} unmountOnExit>
                    <Box sx={{ display: step === 3 ? 'block' : 'none' }}>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                            Назначить исполнителя *
                        </Typography>

                        {/* Smart Team Row — top 4 for selected project */}
                        {(() => {
                            const { top, rest } = getTopTeamForProject(formData.clientId, users, 4);
                            const hasSmartTeam = top.length > 0;

                            return (
                                <>
                                    {hasSmartTeam && (
                                        <Box sx={{ mb: 3 }}>
                                            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                                                ⭐ Частые исполнители по проекту
                                            </Typography>
                                            <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-start' }}>
                                                {top.map(user => {
                                                    const isSelected = formData.assignees.includes(user.id);
                                                    return (
                                                        <Box
                                                            key={user.id}
                                                            onClick={() => user.available !== false && toggleAssignee(user.id)}
                                                            sx={{
                                                                display: 'flex',
                                                                flexDirection: 'column',
                                                                alignItems: 'center',
                                                                gap: 0.5,
                                                                cursor: user.available !== false ? 'pointer' : 'not-allowed',
                                                                opacity: user.available === false ? 0.5 : 1,
                                                                transition: 'all 0.2s',
                                                                '&:active': { transform: 'scale(0.92)' },
                                                            }}
                                                        >
                                                            <Avatar
                                                                src={user.avatarUrl}
                                                                sx={{
                                                                    width: 56,
                                                                    height: 56,
                                                                    bgcolor: isSelected ? 'primary.main' : 'grey.300',
                                                                    border: 3,
                                                                    borderColor: isSelected ? 'primary.main' : 'transparent',
                                                                    boxShadow: isSelected ? `0 0 0 3px ${alpha(theme.palette.primary.main, 0.3)}` : 'none',
                                                                    transition: 'all 0.2s',
                                                                    fontSize: '1.25rem',
                                                                }}
                                                            >
                                                                {user.displayName?.[0] || '👷'}
                                                            </Avatar>
                                                            <Typography
                                                                variant="caption"
                                                                sx={{
                                                                    fontWeight: isSelected ? 700 : 500,
                                                                    color: isSelected ? 'primary.main' : 'text.secondary',
                                                                    maxWidth: 72,
                                                                    textAlign: 'center',
                                                                    overflow: 'hidden',
                                                                    textOverflow: 'ellipsis',
                                                                    whiteSpace: 'nowrap',
                                                                }}
                                                            >
                                                                {user.displayName?.split(' ')[0] || user.email?.split('@')[0]}
                                                            </Typography>
                                                            {isSelected && (
                                                                <CheckIcon sx={{ fontSize: 16, color: 'primary.main' }} />
                                                            )}
                                                        </Box>
                                                    );
                                                })}
                                            </Box>
                                        </Box>
                                    )}

                                    {/* Divider + Expand */}
                                    {hasSmartTeam && (
                                        <Box sx={{ mb: 2 }}>
                                            <Button
                                                variant="text"
                                                onClick={() => setShowAllTeam(prev => !prev)}
                                                sx={{ textTransform: 'none', borderRadius: 2, color: 'text.secondary' }}
                                            >
                                                {showAllTeam
                                                    ? 'Скрыть остальных'
                                                    : `Ещё ${rest.length} сотрудников`}
                                            </Button>
                                        </Box>
                                    )}

                                    {/* Full team list — shown when expanded or no smart team */}
                                    <Collapse in={showAllTeam || !hasSmartTeam}>
                                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 3 }}>
                                            {(hasSmartTeam ? rest : users).map(user => (
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
                                    </Collapse>
                                </>
                            );
                        })()}

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
                <Fade in={step === 4 && ai.status === 'idle'} unmountOnExit>
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

            {/* Sticky Footer — only show when AI is idle (wizard mode) */}
            {ai.status === 'idle' && (
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
            )}
        </Box>
    );
};

export default GTDCreatePage;
