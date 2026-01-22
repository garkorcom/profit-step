/**
 * @fileoverview Audit Task Input Component
 * 
 * 3-click task configurator for inspections:
 * Block A: WHAT to check? (Template chips)
 * Block B: WHEN? (Quick deadline buttons)
 * Block C: WHO? (Assignee avatars)
 * 
 * Goal: Create inspection task in 10 seconds without keyboard
 */

import React, { useState, useEffect } from 'react';
import {
    Box,
    Typography,
    Chip,
    Button,
    Avatar,
    IconButton,
    Divider,
    Tooltip,
} from '@mui/material';
import {
    CalendarMonth as CalendarIcon,
    LocalFireDepartment as UrgentIcon,
    WbSunny as MorningIcon,
    Schedule as TimeIcon,
    CheckCircle as CheckIcon,
    Close as CloseIcon,
    PhotoCamera as PhotoIcon,
    LocationOn as LocationIcon,
} from '@mui/icons-material';
import { useAuth } from '../../auth/AuthContext';

// Audit templates with checklist items
export interface AuditTemplate {
    id: string;
    name: string;
    emoji: string;
    estimatedMinutes: number;
    requirePhoto: boolean;
    requireGps: boolean;
    items: ChecklistItem[];
}

export interface ChecklistItem {
    id: string;
    text: string;
    category?: string;
    canAddToShopping: boolean;
}

export interface AuditTaskPayload {
    templateId: string;
    templateName: string;
    deadline: Date;
    deadlineType: 'urgent' | 'end_of_day' | 'tomorrow' | 'custom';
    assigneeId: string;
    assigneeName?: string;
    requirePhoto: boolean;
    requireGps: boolean;
    checklistItems: ChecklistItem[];
    estimatedMinutes: number;
}

// Default templates (hardcoded for now, later from Firestore)
const DEFAULT_TEMPLATES: AuditTemplate[] = [
    {
        id: 'open_shift',
        name: 'Открытие смены',
        emoji: '🌅',
        estimatedMinutes: 15,
        requirePhoto: true,
        requireGps: true,
        items: [
            { id: '1', text: 'Помещение открыто вовремя', canAddToShopping: false },
            { id: '2', text: 'Освещение работает', canAddToShopping: true },
            { id: '3', text: 'Кондиционер включён', canAddToShopping: true },
            { id: '4', text: 'Чистота на входе', canAddToShopping: false },
            { id: '5', text: 'Сотрудники на месте', canAddToShopping: false },
        ],
    },
    {
        id: 'fire_safety',
        name: 'Пожарная безопасность',
        emoji: '🧯',
        estimatedMinutes: 20,
        requirePhoto: true,
        requireGps: true,
        items: [
            { id: '1', text: 'Огнетушители на месте', canAddToShopping: true },
            { id: '2', text: 'Срок годности не истёк', canAddToShopping: false },
            { id: '3', text: 'Эвакуационные выходы свободны', canAddToShopping: false },
            { id: '4', text: 'Планы эвакуации видны', canAddToShopping: true },
        ],
    },
    {
        id: 'cleanliness',
        name: 'Чистота зала',
        emoji: '🧹',
        estimatedMinutes: 10,
        requirePhoto: true,
        requireGps: false,
        items: [
            { id: '1', text: 'Полы чистые', canAddToShopping: false },
            { id: '2', text: 'Витрины протёрты', canAddToShopping: false },
            { id: '3', text: 'Мусор убран', canAddToShopping: false },
            { id: '4', text: 'Туалет чистый', canAddToShopping: false },
        ],
    },
    {
        id: 'equipment',
        name: 'Оборудование',
        emoji: '🔧',
        estimatedMinutes: 25,
        requirePhoto: true,
        requireGps: true,
        items: [
            { id: '1', text: 'Все устройства работают', canAddToShopping: true },
            { id: '2', text: 'Провода в порядке', canAddToShopping: true },
            { id: '3', text: 'Нет физических повреждений', canAddToShopping: false },
        ],
    },
    {
        id: 'cash_register',
        name: 'Касса',
        emoji: '💰',
        estimatedMinutes: 10,
        requirePhoto: false,
        requireGps: true,
        items: [
            { id: '1', text: 'Касса открыта', canAddToShopping: false },
            { id: '2', text: 'Размен в достаточном количестве', canAddToShopping: false },
            { id: '3', text: 'Чековая лента есть', canAddToShopping: true },
        ],
    },
    {
        id: 'inventory',
        name: 'Склад',
        emoji: '📦',
        estimatedMinutes: 30,
        requirePhoto: true,
        requireGps: true,
        items: [
            { id: '1', text: 'Товары на местах', canAddToShopping: false },
            { id: '2', text: 'Нет просроченного товара', canAddToShopping: false },
            { id: '3', text: 'Ценники актуальны', canAddToShopping: false },
        ],
    },
];

// Mock assignees (later from Firestore)
interface Assignee {
    id: string;
    name: string;
    avatarUrl?: string;
    isCurrentUser?: boolean;
}

type DeadlineType = 'urgent' | 'end_of_day' | 'tomorrow' | 'custom';

interface AuditTaskInputProps {
    onComplete: (payload: AuditTaskPayload) => void;
    onCancel: () => void;
    clientId: string;
    clientName: string;
    locationId?: string;
}

const AuditTaskInput: React.FC<AuditTaskInputProps> = ({
    onComplete,
    onCancel,
    clientId,
    clientName,
    locationId,
}) => {
    const { currentUser, userProfile } = useAuth();

    // State
    const [selectedTemplate, setSelectedTemplate] = useState<AuditTemplate | null>(null);
    const [deadlineType, setDeadlineType] = useState<DeadlineType | null>(null);
    const [selectedAssignee, setSelectedAssignee] = useState<Assignee | null>(null);
    const [templates] = useState<AuditTemplate[]>(DEFAULT_TEMPLATES);

    // Mock assignees (current user + 2 team members)
    const [assignees] = useState<Assignee[]>([
        {
            id: currentUser?.uid || 'self',
            name: userProfile?.displayName || 'Я',
            isCurrentUser: true
        },
        { id: 'emp1', name: 'Иван П.' },
        { id: 'emp2', name: 'Мария С.' },
    ]);

    // Auto-select current user as default assignee
    useEffect(() => {
        if (assignees.length > 0 && !selectedAssignee) {
            setSelectedAssignee(assignees[0]);
        }
    }, [assignees, selectedAssignee]);

    // Calculate deadline date
    const getDeadlineDate = (type: DeadlineType): Date => {
        const now = new Date();
        switch (type) {
            case 'urgent':
                return new Date(now.getTime() + 60 * 60 * 1000); // +1 hour
            case 'end_of_day':
                const endOfDay = new Date(now);
                endOfDay.setHours(18, 0, 0, 0);
                if (endOfDay < now) endOfDay.setDate(endOfDay.getDate() + 1);
                return endOfDay;
            case 'tomorrow':
                const tomorrow = new Date(now);
                tomorrow.setDate(tomorrow.getDate() + 1);
                tomorrow.setHours(10, 0, 0, 0);
                return tomorrow;
            default:
                return now;
        }
    };

    // Handle submit
    const handleSubmit = () => {
        if (!selectedTemplate || !deadlineType || !selectedAssignee) return;

        const payload: AuditTaskPayload = {
            templateId: selectedTemplate.id,
            templateName: selectedTemplate.name,
            deadline: getDeadlineDate(deadlineType),
            deadlineType,
            assigneeId: selectedAssignee.id,
            assigneeName: selectedAssignee.name,
            requirePhoto: selectedTemplate.requirePhoto,
            requireGps: selectedTemplate.requireGps,
            checklistItems: selectedTemplate.items,
            estimatedMinutes: selectedTemplate.estimatedMinutes,
        };

        // Haptic feedback
        navigator.vibrate?.([50, 30, 50]);

        onComplete(payload);
    };

    const isComplete = selectedTemplate && deadlineType && selectedAssignee;

    return (
        <Box sx={{ p: 2 }}>
            {/* Header */}
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                mb: 3,
            }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="h5" sx={{ color: 'info.main' }}>
                        📋
                    </Typography>
                    <Box>
                        <Typography variant="h6" fontWeight={600} sx={{ color: 'info.main' }}>
                            Аудит
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            {clientName}
                        </Typography>
                    </Box>
                </Box>
                <IconButton onClick={onCancel} size="small">
                    <CloseIcon />
                </IconButton>
            </Box>

            {/* Block A: WHAT to check */}
            <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1.5 }}>
                    ЧТО ПРОВЕРИТЬ?
                </Typography>
                <Box sx={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 1,
                }}>
                    {templates.map((template) => (
                        <Chip
                            key={template.id}
                            label={`${template.emoji} ${template.name}`}
                            variant={selectedTemplate?.id === template.id ? 'filled' : 'outlined'}
                            color={selectedTemplate?.id === template.id ? 'info' : 'default'}
                            onClick={() => {
                                setSelectedTemplate(template);
                                navigator.vibrate?.(20);
                            }}
                            sx={{
                                fontSize: '0.9rem',
                                py: 2,
                            }}
                        />
                    ))}
                </Box>

                {/* Template info */}
                {selectedTemplate && (
                    <Box sx={{
                        mt: 1.5,
                        p: 1.5,
                        bgcolor: 'info.50',
                        borderRadius: 1,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                    }}>
                        <Typography variant="body2" color="info.main">
                            {selectedTemplate.items.length} пунктов • ~{selectedTemplate.estimatedMinutes} мин
                        </Typography>
                        {selectedTemplate.requirePhoto && (
                            <Tooltip title="Требуется фото">
                                <PhotoIcon fontSize="small" color="info" />
                            </Tooltip>
                        )}
                        {selectedTemplate.requireGps && (
                            <Tooltip title="Требуется присутствие на точке">
                                <LocationIcon fontSize="small" color="info" />
                            </Tooltip>
                        )}
                    </Box>
                )}
            </Box>

            <Divider sx={{ my: 2 }} />

            {/* Block B: WHEN */}
            <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1.5 }}>
                    КОГДА?
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Chip
                        icon={<UrgentIcon />}
                        label="Срочно (1 час)"
                        variant={deadlineType === 'urgent' ? 'filled' : 'outlined'}
                        color={deadlineType === 'urgent' ? 'error' : 'default'}
                        onClick={() => {
                            setDeadlineType('urgent');
                            navigator.vibrate?.(20);
                        }}
                        sx={{ py: 2 }}
                    />
                    <Chip
                        icon={<TimeIcon />}
                        label="До конца дня (18:00)"
                        variant={deadlineType === 'end_of_day' ? 'filled' : 'outlined'}
                        color={deadlineType === 'end_of_day' ? 'warning' : 'default'}
                        onClick={() => {
                            setDeadlineType('end_of_day');
                            navigator.vibrate?.(20);
                        }}
                        sx={{ py: 2 }}
                    />
                    <Chip
                        icon={<MorningIcon />}
                        label="Завтра (10:00)"
                        variant={deadlineType === 'tomorrow' ? 'filled' : 'outlined'}
                        color={deadlineType === 'tomorrow' ? 'success' : 'default'}
                        onClick={() => {
                            setDeadlineType('tomorrow');
                            navigator.vibrate?.(20);
                        }}
                        sx={{ py: 2 }}
                    />
                    <IconButton
                        sx={{
                            border: 1,
                            borderColor: 'divider',
                            borderRadius: '16px',
                            px: 1.5,
                        }}
                    >
                        <CalendarIcon />
                    </IconButton>
                </Box>
            </Box>

            <Divider sx={{ my: 2 }} />

            {/* Block C: WHO */}
            <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1.5 }}>
                    КТО?
                </Typography>
                <Box sx={{ display: 'flex', gap: 1.5 }}>
                    {assignees.map((assignee) => (
                        <Box
                            key={assignee.id}
                            onClick={() => {
                                setSelectedAssignee(assignee);
                                navigator.vibrate?.(20);
                            }}
                            sx={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: 0.5,
                                p: 1,
                                borderRadius: 2,
                                cursor: 'pointer',
                                border: 2,
                                borderColor: selectedAssignee?.id === assignee.id ? 'info.main' : 'transparent',
                                bgcolor: selectedAssignee?.id === assignee.id ? 'info.50' : 'grey.50',
                                transition: 'all 0.2s',
                                '&:hover': {
                                    bgcolor: 'info.50',
                                },
                            }}
                        >
                            <Avatar
                                src={assignee.avatarUrl}
                                sx={{
                                    width: 48,
                                    height: 48,
                                    bgcolor: assignee.isCurrentUser ? 'info.main' : 'grey.400',
                                }}
                            >
                                {assignee.name.charAt(0)}
                            </Avatar>
                            <Typography variant="caption" fontWeight={500}>
                                {assignee.isCurrentUser ? 'Я' : assignee.name}
                            </Typography>
                        </Box>
                    ))}
                </Box>
            </Box>

            {/* Submit Button */}
            <Button
                fullWidth
                variant="contained"
                color="info"
                size="large"
                disabled={!isComplete}
                onClick={handleSubmit}
                startIcon={<CheckIcon />}
                sx={{
                    py: 1.5,
                    fontSize: '1rem',
                    fontWeight: 600,
                }}
            >
                Поставить задачу
            </Button>

            {/* Summary */}
            {isComplete && (
                <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', textAlign: 'center', mt: 1 }}
                >
                    {selectedTemplate?.emoji} {selectedTemplate?.name} •
                    {deadlineType === 'urgent' ? ' 🔥 Срочно' :
                        deadlineType === 'end_of_day' ? ' До 18:00' : ' Завтра 10:00'} •
                    {selectedAssignee?.isCurrentUser ? ' Себе' : ` ${selectedAssignee?.name}`}
                </Typography>
            )}
        </Box>
    );
};

export default AuditTaskInput;
