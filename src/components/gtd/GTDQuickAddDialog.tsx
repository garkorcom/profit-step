/**
 * @fileoverview Premium Mobile-First GTD Task Creation Dialog
 * 
 * Features:
 * - Quick date chips (Сегодня, Завтра, Пн-Пт)
 * - Quick time presets (Утро, День, Вечер)
 * - Duration selector (1-7 дней)
 * - Crew size stepper with +/- buttons
 * - Auto-cost calculation from hours
 * - Progress bar for form completion
 * - Save & Add More with persistent fields
 * - Undo banner for quick reversal
 * - Client suggestions from recent
 * - Full-screen on mobile, dialog on desktop
 */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
    Dialog,
    Box,
    Typography,
    TextField,
    Button,
    IconButton,
    Chip,
    ToggleButton,
    ToggleButtonGroup,
    FormControl,
    FormControlLabel,
    Checkbox,
    InputLabel,
    Select,
    MenuItem,
    CircularProgress,
    useTheme,
    useMediaQuery,
    InputAdornment,
    LinearProgress,
    Snackbar,
    Alert,
    Autocomplete,
    Paper,
    Slide,
} from '@mui/material';
import {
    Close as CloseIcon,
    Person as PersonIcon,
    People as PeopleIcon,
    Add as AddIcon,
    Remove as RemoveIcon,
    CalendarToday as CalendarIcon,
    AccessTime as TimeIcon,
    Mic as MicIcon,
    MicOff as MicOffIcon,
    Clear as ClearIcon,
    AutoAwesome as AutoAwesomeIcon,
    Warning as WarningIcon,
    ExpandMore as ExpandMoreIcon, // Added missing icon
} from '@mui/icons-material';
import { estimateTask, parseSmartInput } from '../../api/aiApi';
import { AIEstimateResponse } from '../../types/aiEstimate.types';
import { format, addDays, startOfWeek, isToday, isTomorrow } from 'date-fns';
import { ru } from 'date-fns/locale';

import { GTDStatus, GTDPriority, TaskType, TASK_TYPE_CONFIG, ACTION_GROUPS } from '../../types/gtd.types';
import { Client } from '../../types/crm.types';
import { useClientUsageHistory } from '../../hooks/useClientUsageHistory';
import { UserProfile } from '../../types/user.types';
import DynamicFormField from './DynamicFormField';
import ShoppingListInput, { ShoppingItem } from './ShoppingListInput';
import { saveShoppingList } from '../../features/shopping';
import AuditTaskInput, { AuditTaskPayload } from './AuditTaskInput';
import RepairTicketInput, { RepairTicketPayload } from './RepairTicketInput';

/** Data from AI estimation to save with task */
export interface AIEstimateData {
    estimatedHours?: number;
    estimatedCost?: number;
    crewSize?: number;
    aiMaterials?: string[];
    selectedMaterials?: string[];
    aiTools?: string[];
    selectedTools?: string[];
    aiReasoning?: string;
}

interface GTDQuickAddDialogProps {
    open: boolean;
    onClose: () => void;
    onAdd: (
        title: string,
        columnId: GTDStatus,
        clientId?: string,
        assigneeId?: string,
        priority?: GTDPriority,
        aiData?: AIEstimateData
    ) => void;
    targetColumn: GTDStatus;
    clients: Client[];
    users: UserProfile[];
    currentUser?: any;
}

// Helper: Generate quick date options
const getQuickDates = () => {
    const today = new Date();
    const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const dates = [];

    for (let i = 0; i < 7; i++) {
        const date = addDays(today, i);
        const dayName = days[date.getDay()];
        dates.push({
            id: i === 0 ? 'today' : i === 1 ? 'tomorrow' : dayName.toLowerCase(),
            label: i === 0 ? 'Сегодня' : i === 1 ? 'Завтра' : dayName,
            sub: format(date, 'd MMM', { locale: ru }),
            date: format(date, 'yyyy-MM-dd'),
            dateObj: date,
        });
    }
    return dates;
};

// Quick time presets
const QUICK_TIMES = [
    { id: 'morning', emoji: '🌅', time: '08:00', name: 'Утро' },
    { id: 'day', emoji: '☀️', time: '12:00', name: 'День' },
    { id: 'evening', emoji: '🌆', time: '17:00', name: 'Вечер' },
];

// Duration options
const DURATION_OPTIONS = [
    { days: 1, label: '1 день' },
    { days: 2, label: '2 дня' },
    { days: 3, label: '3 дня' },
    { days: 5, label: '5 дней' },
    { days: 7, label: '1 нед' },
];

// Hourly rate for auto-calculation
const HOURLY_RATE = 95;

const GTDQuickAddDialog: React.FC<GTDQuickAddDialogProps> = ({
    open,
    onClose,
    onAdd,
    targetColumn,
    clients,
    users,
    currentUser,
}) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const scrollRef = useRef<HTMLDivElement>(null);

    // ═══════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════

    // Assignee
    const [assigneeType, setAssigneeType] = useState<'self' | 'employee'>('self');
    const [assigneeId, setAssigneeId] = useState('');
    const [resourcesExpanded, setResourcesExpanded] = useState(false); // New state for accordion

    // Client
    const [clientInput, setClientInput] = useState('');
    const [selectedClient, setSelectedClient] = useState<Client | null>(null);
    const [showAllClients, setShowAllClients] = useState(false);
    const { trackUsage, getTopClients } = useClientUsageHistory(currentUser?.uid);

    // Task details
    const [description, setDescription] = useState('');
    const [crewSize, setCrewSize] = useState(2);
    const [hours, setHours] = useState('1');
    const [cost, setCost] = useState('');

    // Planning
    const [selectedQuickDate, setSelectedQuickDate] = useState('today');
    const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [startTime, setStartTime] = useState('');
    const [durationMode, setDurationMode] = useState<'days' | 'date'>('days');
    const [durationDays, setDurationDays] = useState(1);
    const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [planningMode, setPlanningMode] = useState<'quick' | 'custom'>('quick');

    // UI State
    const [saving, setSaving] = useState(false);
    const [tasksCreated, setTasksCreated] = useState(0);
    const [showUndo, setShowUndo] = useState(false);
    const [showToast, setShowToast] = useState(false);

    // Priority (minimal, still available)
    const [priority, setPriority] = useState<GTDPriority>('none');

    // AI Estimation State
    const [aiLoading, setAiLoading] = useState(false);
    const [aiEstimate, setAiEstimate] = useState<AIEstimateResponse | null>(null);
    const [selectedMaterials, setSelectedMaterials] = useState<string[]>([]);
    const [selectedTools, setSelectedTools] = useState<string[]>([]);
    const [needsEstimate, setNeedsEstimate] = useState(false);
    const [taskType, setTaskType] = useState<TaskType | null>(null);
    const [dynamicValues, setDynamicValues] = useState<Record<string, any>>({});
    const [shoppingMode, setShoppingMode] = useState(false);
    const [auditMode, setAuditMode] = useState(false);
    const [repairMode, setRepairMode] = useState(false);

    // NEW: Simplified UI states
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [selectedColumn, setSelectedColumn] = useState<GTDStatus>(targetColumn || 'inbox');

    // AI Smart Input states
    const [smartSuggestedType, setSmartSuggestedType] = useState<TaskType | null>(null);
    const [smartSuggestedDate, setSmartSuggestedDate] = useState<string | null>(null);
    const [smartSuggestedTime, setSmartSuggestedTime] = useState<string | null>(null);
    const [smartDatePhrase, setSmartDatePhrase] = useState<string | null>(null);
    const [smartSuggestedClient, setSmartSuggestedClient] = useState<string | null>(null);
    const [smartSuggestedPriority, setSmartSuggestedPriority] = useState<'low' | 'medium' | 'high' | null>(null);
    const [smartPriorityPhrase, setSmartPriorityPhrase] = useState<string | null>(null);
    const [smartDuplicates, setSmartDuplicates] = useState<Array<{ taskTitle: string; similarity: number }>>([]);
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    // Voice Input states
    const [isListening, setIsListening] = useState(false);
    const [voiceSupported] = useState(() => {
        return typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
    });
    const recognitionRef = useRef<any>(null);

    // Quick dates memoized
    const quickDates = useMemo(() => getQuickDates(), []);

    // ═══════════════════════════════════════
    // COMPUTED
    // ═══════════════════════════════════════

    // Auto-calculated cost
    const estimatedCost = hours ? parseInt(hours) * crewSize * HOURLY_RATE : 0;

    // Suggested duration from hours
    const suggestedDuration = hours ? Math.ceil(parseInt(hours) / 8) : null;

    // Progress (for progress bar)
    const progress = useMemo(() => {
        const fields = [selectedClient, description, hours || cost, startDate];
        return fields.filter(Boolean).length;
    }, [selectedClient, description, hours, cost, startDate]);
    const progressPercent = (progress / 4) * 100;

    // ═══════════════════════════════════════
    // SMART INPUT EFFECT (AI Analysis)
    // ═══════════════════════════════════════

    useEffect(() => {
        // Only analyze if description is long enough
        if (description.trim().length < 5) {
            setSmartSuggestedType(null);
            setSmartSuggestedDate(null);
            setSmartSuggestedTime(null);
            setSmartDatePhrase(null);
            setSmartSuggestedClient(null);
            setSmartSuggestedPriority(null);
            setSmartPriorityPhrase(null);
            setSmartDuplicates([]);
            return;
        }

        // Debounce the API call
        const timeoutId = setTimeout(async () => {
            setIsAnalyzing(true);
            try {
                // Pass client names for matching
                const clientNames = clients.map(c => c.name);
                const result = await parseSmartInput(description.trim(), undefined, clientNames);

                // Update suggested type (if confident enough)
                if (result.suggestedType && result.typeConfidence > 0.6) {
                    setSmartSuggestedType(result.suggestedType as TaskType);
                } else {
                    setSmartSuggestedType(null);
                }

                // Update suggested date/time
                setSmartSuggestedDate(result.suggestedDate || null);
                setSmartSuggestedTime(result.suggestedTime || null);
                setSmartDatePhrase(result.datePhrase || null);

                // Update suggested client
                setSmartSuggestedClient(result.suggestedClientName || null);

                // Update suggested priority
                setSmartSuggestedPriority(result.suggestedPriority || null);
                setSmartPriorityPhrase(result.priorityPhrase || null);

                // Update duplicates
                setSmartDuplicates(result.possibleDuplicates || []);
            } catch (error) {
                console.warn('Smart Input failed:', error);
                // Silent failure - suggestions are optional
            } finally {
                setIsAnalyzing(false);
            }
        }, 600); // 600ms debounce

        return () => clearTimeout(timeoutId);
    }, [description, clients]);

    // ═══════════════════════════════════════
    // HANDLERS
    // ═══════════════════════════════════════

    const handleQuickDateSelect = (qd: typeof quickDates[0]) => {
        setSelectedQuickDate(qd.id);
        setStartDate(qd.date);
        setPlanningMode('quick');

        // Auto-update end date based on duration
        const newEnd = addDays(qd.dateObj, durationDays - 1);
        setEndDate(format(newEnd, 'yyyy-MM-dd'));
    };

    const handleDurationChange = (days: number) => {
        setDurationDays(days);
        const start = new Date(startDate);
        const end = addDays(start, days - 1);
        setEndDate(format(end, 'yyyy-MM-dd'));
    };

    const handleTimeSelect = (time: string) => {
        setStartTime(startTime === time ? '' : time);
    };

    // ═══════════════════════════════════════
    // VOICE INPUT HANDLER
    // ═══════════════════════════════════════

    const toggleVoiceInput = useCallback(() => {
        if (!voiceSupported) return;

        if (isListening) {
            // Stop listening
            recognitionRef.current?.stop();
            setIsListening(false);
            if ('vibrate' in navigator) navigator.vibrate(30);
            return;
        }

        // Start listening
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        recognition.lang = 'ru-RU';
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        let finalTranscript = description;

        recognition.onresult = (event: any) => {
            let interim = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += (finalTranscript ? ' ' : '') + transcript;
                    setDescription(finalTranscript);
                } else {
                    interim = transcript;
                }
            }
            // Show interim results as preview
            if (interim) {
                setDescription(finalTranscript + (finalTranscript ? ' ' : '') + interim);
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

        // Haptic feedback
        if ('vibrate' in navigator) navigator.vibrate([50, 30, 50]);
    }, [voiceSupported, isListening, description]);

    // AI Estimation Handler
    const handleAIEstimate = async () => {
        if (!description.trim()) return;

        // Get selected employee's role and rate
        const selectedEmployee = users.find(u => u.id === assigneeId);
        const employeeRole = selectedEmployee?.title || selectedEmployee?.role || 'Worker';
        const employeeRate = selectedEmployee?.hourlyRate || HOURLY_RATE;

        setAiLoading(true);
        setAiEstimate(null);

        try {
            const estimate = await estimateTask({
                task_description: description,
                employee_role: employeeRole,
                employee_hourly_rate: employeeRate,
                currency: 'USD',
                employee_id: assigneeType === 'employee' ? assigneeId : undefined,
                target_date: startDate,
            });

            setAiEstimate(estimate);
            setHours(String(estimate.estimated_hours));
            setCost(String(estimate.calculated_cost));
            setSelectedMaterials([]);
            setSelectedTools([]);

            // Haptic feedback
            if ('vibrate' in navigator) {
                navigator.vibrate([50, 30, 50]);
            }
        } catch (error) {
            console.error('AI Estimation failed:', error);
        } finally {
            setAiLoading(false);
        }
    };

    const toggleMaterial = (material: string) => {
        setSelectedMaterials(prev =>
            prev.includes(material)
                ? prev.filter(m => m !== material)
                : [...prev, material]
        );
    };

    const toggleTool = (tool: string) => {
        setSelectedTools(prev =>
            prev.includes(tool)
                ? prev.filter(t => t !== tool)
                : [...prev, tool]
        );
    };

    // Task Type Selection Handler
    const handleTaskTypeSelect = (type: TaskType) => {
        console.log('🎯 handleTaskTypeSelect called with type:', type);
        setTaskType(type);
        const config = TASK_TYPE_CONFIG[type];

        // Special handling for shopping mode
        if (type === 'buy') {
            setShoppingMode(true);
            setAuditMode(false);
            setRepairMode(false);
            if ('vibrate' in navigator) {
                navigator.vibrate([30, 20, 30]);
            }
            return;
        }

        // Special handling for audit mode
        if (type === 'check') {
            setAuditMode(true);
            setShoppingMode(false);
            setRepairMode(false);
            if ('vibrate' in navigator) {
                navigator.vibrate([30, 20, 30]);
            }
            return;
        }

        // Special handling for repair mode
        if (type === 'fix') {
            console.log('🔧 [FIX] Repair mode trigger - type:', type, 'selectedClient:', selectedClient?.name);
            setRepairMode(true);
            setShoppingMode(false);
            setAuditMode(false);
            console.log('🔧 [FIX] States set: repairMode=true');
            if ('vibrate' in navigator) {
                navigator.vibrate([30, 20, 30]);
            }
            return;
        }

        // Apply smart defaults
        if (config.defaults.estimatedDurationMinutes) {
            const hours = config.defaults.estimatedDurationMinutes / 60;
            setHours(String(hours));
        }
        if (config.defaults.crewSize) {
            setCrewSize(config.defaults.crewSize);
        }
        if (config.defaults.needsEstimate) {
            setNeedsEstimate(true);
        }
        if (config.defaults.priority && config.defaults.priority !== 'none') {
            setPriority(config.defaults.priority);
        }

        // Pre-fill description with task type label
        if (!description.trim()) {
            setDescription(config.label + ': ');
        }

        // Haptic feedback
        if ('vibrate' in navigator) {
            navigator.vibrate(30);
        }
    };

    // Handle shopping list completion
    const handleShoppingComplete = async (items: ShoppingItem[]) => {
        if (!currentUser?.uid) return;

        setSaving(true);
        try {
            await saveShoppingList(
                items,
                selectedClient?.id || 'no_client',
                currentUser.uid,
                undefined, // locationId
                undefined  // locationName
            );

            setTasksCreated(prev => prev + items.length);
            setShowToast(true);

            // Reset
            setShoppingMode(false);
            setTaskType(null);

            // Haptic feedback
            if ('vibrate' in navigator) {
                navigator.vibrate([50, 30, 50]);
            }
        } catch (error) {
            console.error('Failed to save shopping list:', error);
        } finally {
            setSaving(false);
        }
    };

    const handleShoppingCancel = () => {
        setShoppingMode(false);
        setTaskType(null);
    };

    // Handle audit task completion
    const handleAuditComplete = async (payload: AuditTaskPayload) => {
        if (!currentUser?.uid) return;

        setSaving(true);
        try {
            // Create task description from template
            const taskDescription = `${payload.templateName}: ${selectedClient?.name || 'Проверка'}`;

            // Build AI data with checklist
            const aiData: AIEstimateData = {
                estimatedHours: payload.estimatedMinutes / 60,
                crewSize: 1,
            };

            await onAdd(
                taskDescription,
                payload.deadlineType === 'urgent' ? 'next_action' : 'inbox',
                selectedClient?.id,
                payload.assigneeId,
                payload.deadlineType === 'urgent' ? 'high' : 'medium',
                aiData
            );

            setTasksCreated(prev => prev + 1);
            setShowToast(true);

            // Reset
            setAuditMode(false);
            setTaskType(null);

            // Haptic feedback
            if ('vibrate' in navigator) {
                navigator.vibrate([50, 30, 50]);
            }
        } catch (error) {
            console.error('Failed to create audit task:', error);
        } finally {
            setSaving(false);
        }
    };

    const handleAuditCancel = () => {
        setAuditMode(false);
        setTaskType(null);
    };

    // Handle repair ticket completion
    const handleRepairComplete = async (payload: RepairTicketPayload) => {
        if (!currentUser?.uid) return;

        setSaving(true);
        try {
            // Create task description from category
            const taskDescription = `Ремонт (${payload.categoryName}): ${selectedClient?.name || 'Заявка'}`;

            await onAdd(
                taskDescription,
                payload.severity === 'critical' ? 'next_action' : 'inbox',
                selectedClient?.id,
                undefined, // Will be auto-assigned by routing
                payload.severity === 'critical' ? 'high' : 'medium',
                undefined
            );

            setTasksCreated(prev => prev + 1);
            setShowToast(true);

            // Reset
            setRepairMode(false);
            setTaskType(null);

            // Haptic feedback
            if ('vibrate' in navigator) {
                navigator.vibrate([50, 30, 50]);
            }
        } catch (error) {
            console.error('Failed to create repair ticket:', error);
        } finally {
            setSaving(false);
        }
    };

    const handleRepairCancel = () => {
        setRepairMode(false);
        setTaskType(null);
    };

    const handleSave = async (addMore: boolean) => {
        if (!description.trim()) return;

        setSaving(true);
        try {
            // Build AI data if estimation was used
            const aiData: AIEstimateData | undefined = aiEstimate ? {
                estimatedHours: aiEstimate.estimated_hours,
                estimatedCost: aiEstimate.calculated_cost,
                crewSize: crewSize,
                aiMaterials: aiEstimate.suggested_materials,
                selectedMaterials: selectedMaterials.length > 0 ? selectedMaterials : undefined,
                aiTools: aiEstimate.suggested_tools,
                selectedTools: selectedTools.length > 0 ? selectedTools : undefined,
                aiReasoning: aiEstimate.reasoning,
            } : undefined;

            await onAdd(
                description.trim(),
                needsEstimate ? 'estimate' : selectedColumn,
                selectedClient?.id,
                assigneeType === 'employee' ? assigneeId : (assigneeType === 'self' ? currentUser?.uid : undefined),
                priority !== 'none' ? priority : undefined,
                aiData
            );

            // Track client usage for smart sorting
            if (selectedClient?.id) {
                trackUsage(selectedClient.id);
            }

            if (addMore) {
                // Save & Add More
                setTasksCreated(prev => prev + 1);
                setShowUndo(true);
                setShowToast(true);

                // Haptic feedback
                if ('vibrate' in navigator) {
                    navigator.vibrate(50);
                }

                setTimeout(() => setShowToast(false), 2500);
                setTimeout(() => setShowUndo(false), 6000);

                // Reset non-persistent fields
                setDescription('');
                setHours('1');
                setCost('');
                setAssigneeType('self');
                setAssigneeId('');
                setStartTime('');
                setPriority('none');
                setNeedsEstimate(false);

                // Scroll to top
                scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
                handleClose();
            }
        } catch (error) {
            console.error('Failed to add task:', error);
        } finally {
            setSaving(false);
        }
    };

    const handleClose = () => {
        // Stop voice input if active
        if (recognitionRef.current) {
            recognitionRef.current.stop();
            setIsListening(false);
        }
        // Reset all state
        setDescription('');
        setSelectedClient(null);
        setClientInput('');
        setShowAllClients(false);
        setCrewSize(2);
        setHours('1');
        setCost('');
        setAssigneeType('self');
        setAssigneeId('');
        setSelectedQuickDate('today');
        setStartDate(format(new Date(), 'yyyy-MM-dd'));
        setStartTime('');
        setDurationDays(1);
        setPriority('none');
        setTasksCreated(0);
        setShowUndo(false);
        onClose();
    };

    // Reset on open
    useEffect(() => {
        if (open) {
            setSelectedQuickDate('today');
            setStartDate(format(new Date(), 'yyyy-MM-dd'));
        }
    }, [open]);



    const getColumnName = (col: GTDStatus): string => {
        const names: Record<GTDStatus, string> = {
            inbox: 'Inbox',
            next_action: 'Next Actions',
            waiting: 'Waiting For',
            projects: 'Projects',
            estimate: '📐 Estimate',
            someday: 'Someday',
            done: 'Done',
        };
        return names[col] || col;
    };

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            fullScreen={isMobile}
            maxWidth="sm"
            fullWidth
            PaperProps={{
                sx: {
                    m: isMobile ? 0 : 2,
                    borderRadius: isMobile ? 0 : 3,
                    maxHeight: isMobile ? '100%' : '90vh',
                    overflow: 'hidden',
                }
            }}
        >
            {/* ═══════════════════════════════════════
                HEADER
            ═══════════════════════════════════════ */}
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                px: 2,
                py: 1.5,
                borderBottom: 1,
                borderColor: 'divider',
            }}>
                <IconButton onClick={handleClose} edge="start">
                    <CloseIcon />
                </IconButton>

                <Box sx={{ textAlign: 'center' }}>
                    <Typography variant="subtitle1" fontWeight={600}>
                        Новая задача
                    </Typography>
                    {tasksCreated > 0 && (
                        <Typography variant="caption" color="success.main">
                            +{tasksCreated} создано
                        </Typography>
                    )}
                </Box>

                <Box sx={{ width: 40 }} /> {/* Spacer */}
            </Box>

            {/* Progress Bar */}
            <LinearProgress
                variant="determinate"
                value={progressPercent}
                sx={{ height: 3 }}
            />

            {/* ═══════════════════════════════════════
                SCROLLABLE CONTENT
            ═══════════════════════════════════════ */}
            <Box
                ref={scrollRef}
                sx={{
                    flex: 1,
                    overflow: 'auto',
                    p: 2,
                    pb: 16, // Space for sticky footer
                }}
            >
                {/* Shopping Mode - Show dedicated shopping input */}
                {shoppingMode ? (
                    <ShoppingListInput
                        onComplete={handleShoppingComplete}
                        onCancel={handleShoppingCancel}
                        clientName={selectedClient?.name}
                    />
                ) : auditMode ? (
                    <AuditTaskInput
                        onComplete={handleAuditComplete}
                        onCancel={handleAuditCancel}
                        clientId={selectedClient?.id || ''}
                        clientName={selectedClient?.name || 'Без клиента'}
                        locationId={undefined}
                    />
                ) : repairMode ? (
                    <RepairTicketInput
                        onComplete={handleRepairComplete}
                        onCancel={handleRepairCancel}
                        clientId={selectedClient?.id || ''}
                        clientName={selectedClient?.name || 'Без клиента'}
                        locationId={undefined}
                    />
                ) : (
                    <>
                        {/* ═══════════════════════════════════════
                            SIMPLIFIED FORM - Description First
                        ═══════════════════════════════════════ */}

                        {/* 1. DESCRIPTION - Most Important */}
                        <Box sx={{ mb: 3 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>
                                    📝 Что нужно сделать? <Box component="span" sx={{ color: 'error.main' }}>*</Box>
                                </Typography>
                                {isListening && (
                                    <Typography variant="caption" sx={{ color: 'error.main', fontWeight: 600, animation: 'pulse 1.5s infinite' }}>
                                        🔴 Слушаю...
                                    </Typography>
                                )}
                            </Box>
                            <TextField
                                fullWidth
                                multiline
                                rows={3}
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder={isListening ? 'Говорите...' : 'Описание задачи...'}
                                autoFocus
                                InputProps={{
                                    endAdornment: voiceSupported ? (
                                        <InputAdornment position="end" sx={{ alignSelf: 'flex-end', mb: 1 }}>
                                            <IconButton
                                                onClick={toggleVoiceInput}
                                                sx={{
                                                    color: isListening ? '#fff' : 'text.secondary',
                                                    bgcolor: isListening ? 'error.main' : 'transparent',
                                                    animation: isListening ? 'pulse 1.5s infinite' : 'none',
                                                    '&:hover': {
                                                        bgcolor: isListening ? 'error.dark' : 'action.hover',
                                                    },
                                                    '@keyframes pulse': {
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
                                        bgcolor: isListening ? 'rgba(244, 67, 54, 0.04)' : 'background.paper',
                                        fontSize: '1rem',
                                        borderColor: isListening ? 'error.main' : undefined,
                                    },
                                    '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': isListening ? {
                                        borderColor: 'error.main',
                                        borderWidth: 2,
                                    } : {},
                                }}
                            />
                        </Box>

                        {/* AI Smart Input Suggestions */}
                        {(smartSuggestedType || smartSuggestedDate || smartDuplicates.length > 0 || isAnalyzing) && (
                            <Box sx={{ mb: 2, display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                                {isAnalyzing && (
                                    <Chip
                                        size="small"
                                        label="🔍 Анализ..."
                                        sx={{ bgcolor: 'grey.200', animation: 'pulse 1s infinite' }}
                                    />
                                )}

                                {/* Type suggestion */}
                                {smartSuggestedType && !taskType && (
                                    <Chip
                                        size="small"
                                        icon={<span>{TASK_TYPE_CONFIG[smartSuggestedType].emoji}</span>}
                                        label={TASK_TYPE_CONFIG[smartSuggestedType].label}
                                        onClick={() => {
                                            setTaskType(smartSuggestedType);
                                            setSmartSuggestedType(null);
                                        }}
                                        sx={{
                                            bgcolor: 'primary.50',
                                            borderColor: 'primary.200',
                                            border: '1px dashed',
                                            cursor: 'pointer',
                                            '&:hover': { bgcolor: 'primary.100' }
                                        }}
                                    />
                                )}

                                {/* Date suggestion */}
                                {smartSuggestedDate && (
                                    <Chip
                                        size="small"
                                        icon={<span>📅</span>}
                                        label={smartDatePhrase || smartSuggestedDate}
                                        onClick={() => {
                                            setStartDate(smartSuggestedDate);
                                            if (smartSuggestedTime) {
                                                setStartTime(smartSuggestedTime);
                                            }
                                            setSmartSuggestedDate(null);
                                            setSmartDatePhrase(null);
                                        }}
                                        sx={{
                                            bgcolor: 'success.50',
                                            borderColor: 'success.200',
                                            border: '1px dashed',
                                            cursor: 'pointer',
                                            '&:hover': { bgcolor: 'success.100' }
                                        }}
                                    />
                                )}

                                {/* Client suggestion */}
                                {smartSuggestedClient && !selectedClient && (
                                    <Chip
                                        size="small"
                                        icon={<span>🏢</span>}
                                        label={smartSuggestedClient}
                                        onClick={() => {
                                            const matchedClient = clients.find(c => c.name === smartSuggestedClient);
                                            if (matchedClient) {
                                                setSelectedClient(matchedClient);
                                            }
                                            setSmartSuggestedClient(null);
                                        }}
                                        sx={{
                                            bgcolor: 'info.50',
                                            borderColor: 'info.200',
                                            border: '1px dashed',
                                            cursor: 'pointer',
                                            '&:hover': { bgcolor: 'info.100' }
                                        }}
                                    />
                                )}

                                {/* Priority suggestion */}
                                {smartSuggestedPriority && (
                                    <Chip
                                        size="small"
                                        icon={<span>{smartSuggestedPriority === 'high' ? '🔥' : smartSuggestedPriority === 'medium' ? '⚡' : '📌'}</span>}
                                        label={smartPriorityPhrase || (smartSuggestedPriority === 'high' ? 'Высокий' : smartSuggestedPriority === 'medium' ? 'Средний' : 'Низкий')}
                                        onClick={() => {
                                            setPriority(smartSuggestedPriority);
                                            setSmartSuggestedPriority(null);
                                            setSmartPriorityPhrase(null);
                                        }}
                                        sx={{
                                            bgcolor: smartSuggestedPriority === 'high' ? 'error.50' : smartSuggestedPriority === 'medium' ? 'warning.50' : 'grey.100',
                                            borderColor: smartSuggestedPriority === 'high' ? 'error.200' : smartSuggestedPriority === 'medium' ? 'warning.200' : 'grey.300',
                                            border: '1px dashed',
                                            cursor: 'pointer',
                                            '&:hover': { bgcolor: smartSuggestedPriority === 'high' ? 'error.100' : smartSuggestedPriority === 'medium' ? 'warning.100' : 'grey.200' }
                                        }}
                                    />
                                )}

                                {/* Duplicate warning */}
                                {smartDuplicates.length > 0 && smartDuplicates[0].similarity > 0.7 && (
                                    <Chip
                                        size="small"
                                        icon={<WarningIcon sx={{ fontSize: 16 }} />}
                                        label={`Похоже: ${smartDuplicates[0].taskTitle.substring(0, 25)}...`}
                                        sx={{
                                            bgcolor: 'warning.50',
                                            borderColor: 'warning.300',
                                            border: '1px solid',
                                            color: 'warning.dark',
                                        }}
                                    />
                                )}
                            </Box>
                        )}

                        {/* 2. CLIENT — Smart sorted chips + expand */}
                        <Box sx={{ mb: 3 }}>
                            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block', textTransform: 'uppercase', letterSpacing: 1 }}>
                                👤 Клиент
                            </Typography>

                            {/* Selected client display */}
                            {selectedClient && (
                                <Chip
                                    label={`${selectedClient.type === 'company' ? '🏢' : '👤'} ${selectedClient.name}`}
                                    onDelete={() => { setSelectedClient(null); setShowAllClients(false); }}
                                    sx={{
                                        mb: 1.5,
                                        bgcolor: '#e8f5e9',
                                        fontWeight: 600,
                                        fontSize: '0.85rem',
                                        height: 36,
                                    }}
                                />
                            )}

                            {/* Top clients chips */}
                            {!selectedClient && (() => {
                                const { top, rest } = getTopClients(clients, 5);
                                const hasTop = top.length > 0;
                                return (
                                    <>
                                        {hasTop && (
                                            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1.5 }}>
                                                {top.map(c => (
                                                    <Chip
                                                        key={c.id}
                                                        label={`${c.type === 'company' ? '🏢' : '👤'} ${c.name}`}
                                                        variant="outlined"
                                                        onClick={() => { setSelectedClient(c); setShowAllClients(false); }}
                                                        sx={{
                                                            cursor: 'pointer',
                                                            borderColor: 'grey.300',
                                                            '&:hover': { bgcolor: 'grey.100', borderColor: 'primary.main' },
                                                            transition: 'all 0.15s',
                                                        }}
                                                    />
                                                ))}
                                                {rest.length > 0 && !showAllClients && (
                                                    <Chip
                                                        label={`Ещё ${rest.length}`}
                                                        variant="outlined"
                                                        onClick={() => setShowAllClients(true)}
                                                        sx={{
                                                            cursor: 'pointer',
                                                            borderStyle: 'dashed',
                                                            color: 'text.secondary',
                                                            '&:hover': { bgcolor: 'grey.50' },
                                                        }}
                                                    />
                                                )}
                                            </Box>
                                        )}

                                        {/* Full autocomplete: shown when expanded or no history */}
                                        {(showAllClients || !hasTop) && (
                                            <Autocomplete
                                                options={hasTop ? rest : clients}
                                                getOptionLabel={(c) => c.name}
                                                value={null}
                                                onChange={(_, val) => { if (val) { setSelectedClient(val); setShowAllClients(false); } }}
                                                inputValue={clientInput}
                                                onInputChange={(_, val) => setClientInput(val)}
                                                renderInput={(params) => (
                                                    <TextField
                                                        {...params}
                                                        placeholder="Поиск клиента..."
                                                        size="small"
                                                        autoFocus={showAllClients}
                                                    />
                                                )}
                                                renderOption={(props, option) => (
                                                    <li {...props}>
                                                        {option.type === 'company' ? '🏢' : '👤'} {option.name}
                                                    </li>
                                                )}
                                            />
                                        )}
                                    </>
                                );
                            })()}
                        </Box>

                        {/* 3. COLUMN PICKER - New Feature */}
                        <Box sx={{ mb: 3 }}>
                            <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block', textTransform: 'uppercase', letterSpacing: 1 }}>
                                📍 Куда добавить?
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                {[
                                    { id: 'inbox' as GTDStatus, label: '📥 Inbox', color: '#6b7280' },
                                    { id: 'next_action' as GTDStatus, label: '▶️ Next', color: '#3b82f6' },
                                    { id: 'projects' as GTDStatus, label: '📁 Projects', color: '#8b5cf6' },
                                    { id: 'estimate' as GTDStatus, label: '📐 Estimate', color: '#f59e0b' },
                                ].map((col) => (
                                    <Chip
                                        key={col.id}
                                        label={col.label}
                                        variant={selectedColumn === col.id ? 'filled' : 'outlined'}
                                        onClick={() => setSelectedColumn(col.id)}
                                        sx={{
                                            cursor: 'pointer',
                                            fontWeight: selectedColumn === col.id ? 600 : 400,
                                            bgcolor: selectedColumn === col.id ? col.color : 'transparent',
                                            color: selectedColumn === col.id ? 'white' : 'text.primary',
                                            borderColor: col.color,
                                            '&:hover': {
                                                bgcolor: selectedColumn === col.id ? col.color : `${col.color}20`,
                                            },
                                            transition: 'all 0.15s ease',
                                        }}
                                    />
                                ))}
                            </Box>
                        </Box>

                        {/* 4. ADVANCED OPTIONS - Collapsible */}
                        <Box sx={{ mb: 3, border: '1px solid #e0e0e0', borderRadius: 2, overflow: 'hidden' }}>
                            <Box
                                onClick={() => setShowAdvanced(!showAdvanced)}
                                sx={{
                                    p: 2,
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    cursor: 'pointer',
                                    bgcolor: showAdvanced ? 'grey.100' : 'grey.50',
                                    '&:hover': { bgcolor: 'grey.100' },
                                }}
                            >
                                <Typography variant="body2" color="text.secondary" fontWeight={500}>
                                    ⚙️ Дополнительно {taskType && `• ${TASK_TYPE_CONFIG[taskType].label}`}
                                </Typography>
                                <IconButton size="small" sx={{ transform: showAdvanced ? 'rotate(180deg)' : 'none', transition: '0.2s' }}>
                                    <ExpandMoreIcon />
                                </IconButton>
                            </Box>

                            {showAdvanced && (
                                <Box sx={{ p: 2 }}>
                                    {/* Task Type Grid - Full Labels */}
                                    <Box sx={{ mb: 3 }}>
                                        <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block', textTransform: 'uppercase', letterSpacing: 1 }}>
                                            🎯 Тип задачи
                                        </Typography>

                                        {ACTION_GROUPS.map((group) => (
                                            <Box key={group.id} sx={{ mb: 2 }}>
                                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, fontSize: '0.7rem' }}>
                                                    {group.emoji} {group.label}
                                                </Typography>
                                                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                                    {group.types.map((type) => {
                                                        const config = TASK_TYPE_CONFIG[type];
                                                        const isSelected = taskType === type;
                                                        return (
                                                            <Chip
                                                                key={type}
                                                                label={`${config.emoji} ${config.label}`}
                                                                variant={isSelected ? 'filled' : 'outlined'}
                                                                onClick={() => handleTaskTypeSelect(type)}
                                                                sx={{
                                                                    cursor: 'pointer',
                                                                    fontWeight: isSelected ? 600 : 400,
                                                                    bgcolor: isSelected ? 'primary.main' : 'transparent',
                                                                    color: isSelected ? 'white' : 'text.primary',
                                                                    '&:hover': {
                                                                        bgcolor: isSelected ? 'primary.dark' : 'grey.100',
                                                                    },
                                                                }}
                                                            />
                                                        );
                                                    })}
                                                </Box>
                                            </Box>
                                        ))}

                                        {/* Show selected route info */}
                                        {taskType && (
                                            <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                                                <Typography variant="caption" color="text.secondary">
                                                    → {TASK_TYPE_CONFIG[taskType].route === 'shopping' ? '🛒 Shopping List' :
                                                        TASK_TYPE_CONFIG[taskType].route === 'calendar' ? '📅 Calendar' :
                                                            TASK_TYPE_CONFIG[taskType].route === 'route' ? '🗺️ Route List' :
                                                                TASK_TYPE_CONFIG[taskType].route === 'tickets' ? '🎫 Tickets' :
                                                                    TASK_TYPE_CONFIG[taskType].route === 'crm' ? '📊 CRM' : '📋 Board'}
                                                </Typography>
                                            </Box>
                                        )}
                                    </Box>

                                    <Box sx={{ mb: 3 }}>
                                        <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block', textTransform: 'uppercase', letterSpacing: 1 }}>
                                            Описание <Box component="span" sx={{ color: 'error.main' }}>*</Box>
                                        </Typography>
                                        <TextField
                                            fullWidth
                                            multiline
                                            rows={2}
                                            value={description}
                                            onChange={(e) => setDescription(e.target.value)}
                                            placeholder="Что нужно сделать?"
                                        />
                                    </Box>

                                    {/* 2.5. Dynamic Fields based on Task Type */}
                                    {taskType && TASK_TYPE_CONFIG[taskType].fields.length > 0 && (
                                        <Box sx={{ mb: 3, p: 2, bgcolor: 'grey.50', borderRadius: 2 }}>
                                            <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block', textTransform: 'uppercase', letterSpacing: 1 }}>
                                                ⚙️ Поля для «{TASK_TYPE_CONFIG[taskType].label}»
                                            </Typography>
                                            {TASK_TYPE_CONFIG[taskType].fields.map((field, idx) => (
                                                <DynamicFormField
                                                    key={idx}
                                                    config={field}
                                                    value={dynamicValues[field.label] || ''}
                                                    onChange={(val) => setDynamicValues(prev => ({ ...prev, [field.label]: val }))}
                                                />
                                            ))}
                                        </Box>
                                    )}

                                    {/* 2. Resources & Finance (Accordion) */}
                                    <Box sx={{ mb: 3, border: '1px solid #e0e0e0', borderRadius: 2, overflow: 'hidden' }}>
                                        <Box
                                            onClick={() => setResourcesExpanded(!resourcesExpanded)}
                                            sx={{
                                                p: 2,
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center',
                                                cursor: 'pointer',
                                                bgcolor: 'grey.50'
                                            }}
                                        >
                                            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1, fontWeight: 'bold' }}>
                                                Ресурсы и финансы
                                            </Typography>
                                            <IconButton size="small" sx={{ transform: resourcesExpanded ? 'rotate(180deg)' : 'none', transition: '0.2s' }}>
                                                <ExpandMoreIcon />
                                            </IconButton>
                                        </Box>

                                        {resourcesExpanded && (
                                            <Box sx={{ p: 2 }}>
                                                {/* Assignee (Moved Inside) */}
                                                <Box sx={{ mb: 3 }}>
                                                    <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block', textTransform: 'uppercase', letterSpacing: 1 }}>
                                                        Исполнитель
                                                    </Typography>
                                                    <ToggleButtonGroup
                                                        value={assigneeType}
                                                        exclusive
                                                        onChange={(_, val) => val && setAssigneeType(val)}
                                                        fullWidth
                                                        sx={{
                                                            bgcolor: 'grey.100',
                                                            borderRadius: 2,
                                                            p: 0.5,
                                                            '& .MuiToggleButton-root': {
                                                                border: 0,
                                                                borderRadius: 1.5,
                                                                py: 1.5,
                                                                '&.Mui-selected': {
                                                                    bgcolor: 'background.paper',
                                                                    boxShadow: 1,
                                                                }
                                                            }
                                                        }}
                                                    >
                                                        <ToggleButton value="self">👤 Я</ToggleButton>
                                                        <ToggleButton value="employee">👥 Сотрудник</ToggleButton>
                                                    </ToggleButtonGroup>

                                                    {assigneeType === 'employee' && (
                                                        <Autocomplete
                                                            options={users}
                                                            getOptionLabel={(u) => u.displayName || ''}
                                                            value={users.find(u => u.id === assigneeId) || null}
                                                            onChange={(_, val) => setAssigneeId(val?.id || '')}
                                                            renderInput={(params) => (
                                                                <TextField
                                                                    {...params}
                                                                    placeholder="Имя сотрудника..."
                                                                    size="small"
                                                                    sx={{ mt: 1.5 }}
                                                                />
                                                            )}
                                                        />
                                                    )}
                                                </Box>

                                                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                                                    {/* Crew Size Stepper */}
                                                    <Paper variant="outlined" sx={{ display: 'flex', alignItems: 'center', borderRadius: 2 }}>
                                                        <IconButton
                                                            onClick={() => setCrewSize(Math.max(1, crewSize - 1))}
                                                            disabled={crewSize <= 1}
                                                        >
                                                            <RemoveIcon />
                                                        </IconButton>
                                                        <Box sx={{ flex: 1, textAlign: 'center' }}>
                                                            <Typography variant="h6" fontWeight={700}>{crewSize}</Typography>
                                                            <Typography variant="caption" color="text.secondary">человек</Typography>
                                                        </Box>
                                                        <IconButton onClick={() => setCrewSize(Math.min(20, crewSize + 1))}>
                                                            <AddIcon />
                                                        </IconButton>
                                                    </Paper>

                                                    {/* Hours */}
                                                    <TextField
                                                        type="number"
                                                        inputMode="numeric"
                                                        value={hours}
                                                        onChange={(e) => setHours(e.target.value)}
                                                        placeholder="Часы"
                                                        InputProps={{
                                                            endAdornment: <InputAdornment position="end">ч</InputAdornment>
                                                        }}
                                                    />

                                                    {/* Cost - Full Width */}
                                                    <Box sx={{ gridColumn: 'span 2' }}>
                                                        <TextField
                                                            fullWidth
                                                            type="number"
                                                            inputMode="decimal"
                                                            value={cost}
                                                            onChange={(e) => setCost(e.target.value)}
                                                            placeholder="Стоимость"
                                                            InputProps={{
                                                                startAdornment: <InputAdornment position="start">$</InputAdornment>
                                                            }}
                                                        />
                                                        {!cost && hours && (
                                                            <Button
                                                                size="small"
                                                                onClick={() => setCost(String(estimatedCost))}
                                                                sx={{ mt: 0.5, color: 'warning.main', textTransform: 'none' }}
                                                            >
                                                                💡 Авто: ${estimatedCost.toLocaleString()} ({crewSize} чел × {hours}ч × ${HOURLY_RATE})
                                                            </Button>
                                                        )}
                                                    </Box>
                                                </Box>
                                            </Box>
                                        )}
                                    </Box>

                                    {/* 3. Estimate Button */}
                                    <Box sx={{ mb: 3 }}>
                                        <Button
                                            variant={needsEstimate ? "contained" : "outlined"}
                                            color="secondary"
                                            fullWidth
                                            onClick={() => setNeedsEstimate(!needsEstimate)}
                                            startIcon={<span style={{ fontSize: '1.2rem' }}>📐</span>}
                                            sx={{ borderStyle: 'dashed', py: 1 }}
                                        >
                                            {needsEstimate ? 'Отправлено на просчёт' : 'Требует просчёт (отправить в Estimate)'}
                                        </Button>
                                    </Box>

                                    {/* ═══════════════════════════════════════
                    AI ESTIMATION SECTION
                ═══════════════════════════════════════ */}
                                    <Box sx={{ mb: 3 }}>
                                        {/* AI Estimate Button */}
                                        <Button
                                            fullWidth
                                            variant="outlined"
                                            onClick={handleAIEstimate}
                                            disabled={!description.trim() || aiLoading}
                                            startIcon={aiLoading ? <CircularProgress size={18} /> : <AutoAwesomeIcon />}
                                            sx={{
                                                py: 1.5,
                                                borderRadius: 2,
                                                borderStyle: 'dashed',
                                                borderColor: aiEstimate ? 'success.main' : 'primary.main',
                                                bgcolor: aiEstimate ? 'success.50' : 'transparent',
                                                color: aiEstimate ? 'success.dark' : 'primary.main',
                                                '&:hover': {
                                                    bgcolor: aiEstimate ? 'success.100' : 'primary.50',
                                                }
                                            }}
                                        >
                                            {aiLoading ? 'AI анализирует...' : aiEstimate ? (aiEstimate.fromTemplate ? '📋 Шаблон' : aiEstimate.fromCache ? '⚡ Cached' : '✓ AI расчет выполнен') : '✨ AI-расчет'}
                                        </Button>

                                        {/* AI Reasoning */}
                                        {aiEstimate?.reasoning && (
                                            <Paper
                                                variant="outlined"
                                                sx={{
                                                    mt: 1.5,
                                                    p: 1.5,
                                                    borderRadius: 2,
                                                    bgcolor: 'info.50',
                                                    borderColor: 'info.200'
                                                }}
                                            >
                                                <Typography variant="caption" color="info.dark" fontWeight={500}>
                                                    💡 {aiEstimate.reasoning}
                                                </Typography>
                                            </Paper>
                                        )}

                                        {/* Conflict Warning */}
                                        {aiEstimate?.has_conflict && (
                                            <Alert
                                                severity="warning"
                                                icon={<WarningIcon />}
                                                sx={{ mt: 1.5, borderRadius: 2 }}
                                            >
                                                <Typography variant="body2" fontWeight={500}>
                                                    ⚠️ {aiEstimate.conflict_message}
                                                </Typography>
                                            </Alert>
                                        )}

                                        {/* Materials Chips */}
                                        {aiEstimate?.suggested_materials && aiEstimate.suggested_materials.length > 0 && (
                                            <Box sx={{ mt: 2 }}>
                                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                                    <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1 }}>
                                                        📦 Материалы (предложено ИИ)
                                                    </Typography>
                                                    <Button
                                                        size="small"
                                                        onClick={() => setSelectedMaterials([...aiEstimate.suggested_materials])}
                                                        sx={{ fontSize: '0.7rem' }}
                                                    >
                                                        Выбрать все
                                                    </Button>
                                                </Box>
                                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                                                    {aiEstimate.suggested_materials.map((material, i) => (
                                                        <Chip
                                                            key={i}
                                                            label={material}
                                                            onClick={() => toggleMaterial(material)}
                                                            color={selectedMaterials.includes(material) ? 'primary' : 'default'}
                                                            variant={selectedMaterials.includes(material) ? 'filled' : 'outlined'}
                                                            sx={{
                                                                borderRadius: 1.5,
                                                                '&:hover': { bgcolor: selectedMaterials.includes(material) ? 'primary.dark' : 'grey.200' }
                                                            }}
                                                        />
                                                    ))}
                                                </Box>
                                            </Box>
                                        )}

                                        {/* Tools Chips */}
                                        {aiEstimate?.suggested_tools && aiEstimate.suggested_tools.length > 0 && (
                                            <Box sx={{ mt: 2 }}>
                                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                                    <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1 }}>
                                                        🔧 Инструменты (предложено ИИ)
                                                    </Typography>
                                                    <Button
                                                        size="small"
                                                        onClick={() => setSelectedTools([...aiEstimate.suggested_tools])}
                                                        sx={{ fontSize: '0.7rem' }}
                                                    >
                                                        Выбрать все
                                                    </Button>
                                                </Box>
                                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                                                    {aiEstimate.suggested_tools.map((tool, i) => (
                                                        <Chip
                                                            key={i}
                                                            label={tool}
                                                            onClick={() => toggleTool(tool)}
                                                            color={selectedTools.includes(tool) ? 'secondary' : 'default'}
                                                            variant={selectedTools.includes(tool) ? 'filled' : 'outlined'}
                                                            sx={{
                                                                borderRadius: 1.5,
                                                                '&:hover': { bgcolor: selectedTools.includes(tool) ? 'secondary.dark' : 'grey.200' }
                                                            }}
                                                        />
                                                    ))}
                                                </Box>
                                            </Box>
                                        )}
                                    </Box>

                                    {/* ═══════════════════════════════════════
                    PLANNING SECTION
                ═══════════════════════════════════════ */}
                                    <Box sx={{ mb: 3 }}>
                                        <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block', textTransform: 'uppercase', letterSpacing: 1 }}>
                                            Когда
                                        </Typography>

                                        {/* Quick Date Chips */}
                                        <Box sx={{
                                            display: 'flex',
                                            gap: 1,
                                            overflowX: 'auto',
                                            pb: 1.5,
                                            mx: -2,
                                            px: 2,
                                            '&::-webkit-scrollbar': { display: 'none' },
                                        }}>
                                            {quickDates.map((qd) => (
                                                <Chip
                                                    key={qd.id}
                                                    onClick={() => handleQuickDateSelect(qd)}
                                                    label={
                                                        <Box sx={{ textAlign: 'center' }}>
                                                            <Typography variant="caption" fontWeight={600} display="block">
                                                                {qd.label}
                                                            </Typography>
                                                            <Typography variant="caption" sx={{ opacity: 0.7 }}>
                                                                {qd.sub}
                                                            </Typography>
                                                        </Box>
                                                    }
                                                    sx={{
                                                        minWidth: 56,
                                                        height: 'auto',
                                                        py: 1,
                                                        borderRadius: 2,
                                                        bgcolor: selectedQuickDate === qd.id ? 'primary.main' : 'grey.100',
                                                        color: selectedQuickDate === qd.id ? 'white' : 'text.primary',
                                                        '& .MuiChip-label': { px: 1.5 },
                                                        boxShadow: selectedQuickDate === qd.id ? 3 : 0,
                                                    }}
                                                />
                                            ))}
                                            <Chip
                                                onClick={() => setPlanningMode('custom')}
                                                label={
                                                    <Box sx={{ textAlign: 'center' }}>
                                                        <Typography variant="body2">📅</Typography>
                                                        <Typography variant="caption">Другая</Typography>
                                                    </Box>
                                                }
                                                variant="outlined"
                                                sx={{
                                                    minWidth: 56,
                                                    height: 'auto',
                                                    py: 1,
                                                    borderRadius: 2,
                                                    borderStyle: 'dashed',
                                                }}
                                            />
                                        </Box>

                                        {/* Custom Date Picker */}
                                        {planningMode === 'custom' && (
                                            <TextField
                                                type="date"
                                                fullWidth
                                                value={startDate}
                                                onChange={(e) => setStartDate(e.target.value)}
                                                sx={{ mb: 1.5 }}
                                            />
                                        )}

                                        {/* Quick Time */}
                                        <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                                            Время начала (опционально)
                                        </Typography>
                                        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                                            {QUICK_TIMES.map((qt) => (
                                                <Button
                                                    key={qt.id}
                                                    variant={startTime === qt.time ? 'contained' : 'outlined'}
                                                    onClick={() => handleTimeSelect(qt.time)}
                                                    sx={{
                                                        flex: 1,
                                                        flexDirection: 'column',
                                                        py: 1.5,
                                                        borderRadius: 2,
                                                    }}
                                                >
                                                    <Typography variant="body1">{qt.emoji}</Typography>
                                                    <Typography variant="caption">{qt.time}</Typography>
                                                </Button>
                                            ))}
                                        </Box>
                                        <TextField
                                            type="time"
                                            fullWidth
                                            size="small"
                                            value={startTime}
                                            onChange={(e) => setStartTime(e.target.value)}
                                            InputLabelProps={{ shrink: true }}
                                            sx={{ mb: 2 }}
                                        />

                                        {/* Duration */}
                                        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: 'grey.50' }}>
                                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                                                <Typography variant="caption" fontWeight={500}>Длительность</Typography>
                                                <ToggleButtonGroup
                                                    value={durationMode}
                                                    exclusive
                                                    onChange={(_, val) => val && setDurationMode(val)}
                                                    size="small"
                                                >
                                                    <ToggleButton value="days" sx={{ px: 1.5 }}>Дни</ToggleButton>
                                                    <ToggleButton value="date" sx={{ px: 1.5 }}>Дата</ToggleButton>
                                                </ToggleButtonGroup>
                                            </Box>

                                            {durationMode === 'days' ? (
                                                <>
                                                    <Box sx={{ display: 'flex', gap: 1 }}>
                                                        {DURATION_OPTIONS.map((opt) => (
                                                            <Button
                                                                key={opt.days}
                                                                variant={durationDays === opt.days ? 'contained' : 'outlined'}
                                                                size="small"
                                                                onClick={() => handleDurationChange(opt.days)}
                                                                sx={{ flex: 1, borderRadius: 1.5 }}
                                                            >
                                                                {opt.label}
                                                            </Button>
                                                        ))}
                                                    </Box>
                                                    {hours && suggestedDuration && suggestedDuration !== durationDays && (
                                                        <Button
                                                            size="small"
                                                            onClick={() => handleDurationChange(suggestedDuration)}
                                                            sx={{ mt: 1, color: 'warning.main', textTransform: 'none' }}
                                                        >
                                                            💡 {hours}ч работы ≈ {suggestedDuration} {suggestedDuration === 1 ? 'день' : suggestedDuration < 5 ? 'дня' : 'дней'} (по 8ч/день)
                                                        </Button>
                                                    )}
                                                </>
                                            ) : (
                                                <TextField
                                                    type="date"
                                                    fullWidth
                                                    size="small"
                                                    value={endDate}
                                                    inputProps={{ min: startDate }}
                                                    onChange={(e) => setEndDate(e.target.value)}
                                                />
                                            )}

                                            {/* Summary */}
                                            <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between' }}>
                                                <Typography variant="caption" color="text.secondary">Итого:</Typography>
                                                <Typography variant="body2" fontWeight={600}>
                                                    {quickDates.find(q => q.id === selectedQuickDate)?.sub || startDate} → {
                                                        durationMode === 'days'
                                                            ? `+${durationDays} ${durationDays === 1 ? 'день' : durationDays < 5 ? 'дня' : 'дней'}`
                                                            : format(new Date(endDate), 'd MMM', { locale: ru })
                                                    }
                                                    {startTime && ` в ${startTime}`}
                                                </Typography>
                                            </Box>
                                        </Paper>
                                    </Box>
                                </Box>
                            )}
                        </Box>

                        {/* ═══════════════════════════════════════
                UNDO BANNER
            ═══════════════════════════════════════ */}
                        <Slide direction="up" in={showUndo} mountOnEnter unmountOnExit>
                            <Paper
                                elevation={8}
                                sx={{
                                    position: 'absolute',
                                    left: 16,
                                    right: 16,
                                    bottom: 100,
                                    bgcolor: 'grey.800',
                                    borderRadius: 3,
                                    px: 2,
                                    py: 1.5,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    zIndex: 30,
                                }}
                            >
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                    <Box sx={{
                                        width: 32,
                                        height: 32,
                                        bgcolor: 'success.main',
                                        borderRadius: '50%',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}>
                                        ✓
                                    </Box>
                                    <Typography color="white" fontWeight={500}>
                                        Задача #{tasksCreated}
                                    </Typography>
                                </Box>
                                <Button sx={{ color: 'warning.main', fontWeight: 700 }}>
                                    ОТМЕНА
                                </Button>
                            </Paper>
                        </Slide>

                        {/* ═══════════════════════════════════════
                TOAST
            ═══════════════════════════════════════ */}
                        <Snackbar
                            open={showToast}
                            autoHideDuration={2500}
                            onClose={() => setShowToast(false)}
                            anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
                            sx={{ top: 80 }}
                        >
                            <Alert severity="success" variant="filled" sx={{ width: '100%' }}>
                                ✨ Форма готова к следующей задаче
                            </Alert>
                        </Snackbar>

                        {/* ═══════════════════════════════════════
                STICKY FOOTER
            ═══════════════════════════════════════ */}
                        <Box
                            sx={{
                                position: 'absolute',
                                bottom: 0,
                                left: 0,
                                right: 0,
                                bgcolor: 'background.paper',
                                borderTop: 1,
                                borderColor: 'divider',
                                p: 2,
                                pb: isMobile ? 4 : 2,
                                display: 'flex',
                                gap: 1.5,
                                zIndex: 20,
                            }}
                        >
                            <Button
                                variant="outlined"
                                onClick={() => handleSave(false)}
                                disabled={!description.trim() || saving}
                                sx={{
                                    flex: 1,
                                    py: 1.5,
                                    borderRadius: 3,
                                }}
                            >
                                Сохранить
                            </Button>
                            <Button
                                variant="contained"
                                onClick={() => handleSave(true)}
                                disabled={!description.trim() || saving}
                                sx={{
                                    flex: 1,
                                    py: 1.5,
                                    borderRadius: 3,
                                    boxShadow: 3,
                                }}
                            >
                                {saving ? (
                                    <CircularProgress size={20} color="inherit" />
                                ) : (
                                    <>
                                        <Typography variant="h6" component="span" sx={{ mr: 0.5 }}>+</Typography>
                                        Ещё задачу
                                    </>
                                )}
                            </Button>
                        </Box>
                    </>
                )}
            </Box>
        </Dialog>
    );
};

export default GTDQuickAddDialog;

