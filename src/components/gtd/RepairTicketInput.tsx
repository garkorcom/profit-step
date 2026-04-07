/**
 * @fileoverview Repair Ticket Input Component (Service Desk)
 * 
 * Camera-first repair ticket creation:
 * 1. Photo capture (immediately opens camera)
 * 2. Annotation support (draw on photo)
 * 3. Category routing (Электрика, Сантехника, IT...)
 * 4. Severity selection (Планово/Авария)
 * 
 * Goal: Create repair ticket in 5-7 seconds without typing
 */

import React, { useState, useRef } from 'react';
import {
    Box,
    Typography,
    Chip,
    Button,
    IconButton,
    TextField,
    Paper,
    Divider,
} from '@mui/material';
import {
    Close as CloseIcon,
    PhotoCamera as CameraIcon,
    Mic as MicIcon,
    Send as SendIcon,
    Warning as WarningIcon,
    CheckCircle as CheckIcon,
    Lightbulb as ElectricIcon,
    Plumbing as PlumbingIcon,
    Chair as FurnitureIcon,
    Computer as ITIcon,
    Build as GeneralIcon,
    Delete as DeleteIcon,
} from '@mui/icons-material';

// Categories for routing
export interface RepairCategory {
    id: string;
    name: string;
    emoji: string;
    icon: React.ReactNode;
    color: string;
}

const REPAIR_CATEGORIES: RepairCategory[] = [
    { id: 'electric', name: 'Электрика', emoji: '💡', icon: <ElectricIcon />, color: '#FFC107' },
    { id: 'plumbing', name: 'Сантехника', emoji: '🚰', icon: <PlumbingIcon />, color: '#2196F3' },
    { id: 'furniture', name: 'Мебель', emoji: '🪑', icon: <FurnitureIcon />, color: '#795548' },
    { id: 'it', name: 'IT/Касса', emoji: '💻', icon: <ITIcon />, color: '#9C27B0' },
    { id: 'general', name: 'Общее', emoji: '🔧', icon: <GeneralIcon />, color: '#607D8B' },
];

type Severity = 'normal' | 'critical';

export interface RepairTicketPayload {
    categoryId: string;
    categoryName: string;
    severity: Severity;
    photoUrl?: string;          // Base64 or URL
    voiceText?: string;         // Transcribed voice note
    description?: string;       // Manual description
    hasAnnotation: boolean;
}

interface RepairTicketInputProps {
    onComplete: (payload: RepairTicketPayload) => void;
    onCancel: () => void;
    clientId: string;
    clientName: string;
    locationId?: string;
}

const RepairTicketInput: React.FC<RepairTicketInputProps> = ({
    onComplete,
    onCancel,
    clientId: _clientId,
    clientName,
    locationId: _locationId,
}) => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    // State
    const [photoPreview, setPhotoPreview] = useState<string | null>(null);
    const [selectedCategory, setSelectedCategory] = useState<RepairCategory | null>(null);
    const [severity, setSeverity] = useState<Severity | null>(null);
    const [description, setDescription] = useState('');
    const [isRecording, setIsRecording] = useState(false);
    const [hasAnnotation] = useState(false); // Will be used when annotation feature is implemented
    const [photoStep, setPhotoStep] = useState(true); // Start with photo step

    // Handle photo capture
    const handlePhotoCapture = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setPhotoPreview(reader.result as string);
                setPhotoStep(false); // Move to category selection
                navigator.vibrate?.([30, 20, 30]);
            };
            reader.readAsDataURL(file);
        }
    };

    // Trigger camera
    const triggerCamera = () => {
        fileInputRef.current?.click();
    };

    // Handle voice recording (placeholder - would integrate with Web Speech API)
    const handleVoiceToggle = () => {
        setIsRecording(!isRecording);
        if (isRecording) {
            // Stop recording, transcribe
            setDescription(prev => prev + ' [Голосовое сообщение]');
        }
        navigator.vibrate?.(20);
    };

    // Remove photo
    const handleRemovePhoto = () => {
        setPhotoPreview(null);
        setPhotoStep(true);
    };

    // Submit
    const handleSubmit = () => {
        if (!selectedCategory || !severity) return;

        const payload: RepairTicketPayload = {
            categoryId: selectedCategory.id,
            categoryName: selectedCategory.name,
            severity,
            photoUrl: photoPreview || undefined,
            description: description || undefined,
            hasAnnotation,
        };

        navigator.vibrate?.([50, 30, 50]);
        onComplete(payload);
    };

    const isComplete = selectedCategory && severity;

    return (
        <Box sx={{ p: 2 }}>
            {/* Hidden file input for camera */}
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoCapture}
                style={{ display: 'none' }}
            />

            {/* Header */}
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                mb: 3,
            }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="h5" sx={{ color: 'warning.main' }}>
                        🔧
                    </Typography>
                    <Box>
                        <Typography variant="h6" fontWeight={600} sx={{ color: 'warning.main' }}>
                            Ремонт
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

            {/* Photo Step - Camera First */}
            {photoStep && !photoPreview && (
                <Paper
                    sx={{
                        p: 4,
                        textAlign: 'center',
                        bgcolor: 'grey.50',
                        border: '2px dashed',
                        borderColor: 'grey.300',
                        borderRadius: 2,
                        cursor: 'pointer',
                        mb: 3,
                        '&:hover': {
                            borderColor: 'warning.main',
                            bgcolor: 'warning.50',
                        }
                    }}
                    onClick={triggerCamera}
                >
                    <CameraIcon sx={{ fontSize: 64, color: 'warning.main', mb: 2 }} />
                    <Typography variant="h6" gutterBottom>
                        Сфотографируйте поломку
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        Нажмите, чтобы открыть камеру
                    </Typography>
                </Paper>
            )}

            {/* Photo Preview */}
            {photoPreview && (
                <Box sx={{ mb: 3, position: 'relative' }}>
                    <Box
                        component="img"
                        src={photoPreview}
                        alt="Фото поломки"
                        sx={{
                            width: '100%',
                            maxHeight: 200,
                            objectFit: 'cover',
                            borderRadius: 2,
                            border: 2,
                            borderColor: 'warning.main',
                        }}
                    />
                    <IconButton
                        size="small"
                        onClick={handleRemovePhoto}
                        sx={{
                            position: 'absolute',
                            top: 8,
                            right: 8,
                            bgcolor: 'error.main',
                            color: 'white',
                            '&:hover': { bgcolor: 'error.dark' },
                        }}
                    >
                        <DeleteIcon fontSize="small" />
                    </IconButton>

                    {/* Annotation hint */}
                    <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block', textAlign: 'center', mt: 1 }}
                    >
                        Фото прикреплено ✓
                    </Typography>
                </Box>
            )}

            {/* Category Selection */}
            {(!photoStep || photoPreview) && (
                <>
                    <Box sx={{ mb: 3 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1.5 }}>
                            ТИП ПОЛОМКИ
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                            {REPAIR_CATEGORIES.map((cat) => (
                                <Chip
                                    key={cat.id}
                                    label={`${cat.emoji} ${cat.name}`}
                                    variant={selectedCategory?.id === cat.id ? 'filled' : 'outlined'}
                                    onClick={() => {
                                        setSelectedCategory(cat);
                                        navigator.vibrate?.(20);
                                    }}
                                    sx={{
                                        py: 2,
                                        fontSize: '0.9rem',
                                        bgcolor: selectedCategory?.id === cat.id ? cat.color : 'transparent',
                                        color: selectedCategory?.id === cat.id ? 'white' : 'text.primary',
                                        borderColor: cat.color,
                                        '&:hover': {
                                            bgcolor: cat.color,
                                            color: 'white',
                                        },
                                    }}
                                />
                            ))}
                        </Box>
                    </Box>

                    <Divider sx={{ my: 2 }} />

                    {/* Severity Selection */}
                    <Box sx={{ mb: 3 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1.5 }}>
                            КРИТИЧНОСТЬ
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                            <Chip
                                icon={<CheckIcon />}
                                label="🟢 Планово"
                                variant={severity === 'normal' ? 'filled' : 'outlined'}
                                color={severity === 'normal' ? 'success' : 'default'}
                                onClick={() => {
                                    setSeverity('normal');
                                    navigator.vibrate?.(20);
                                }}
                                sx={{ py: 2.5, px: 1, fontSize: '1rem', flex: 1 }}
                            />
                            <Chip
                                icon={<WarningIcon />}
                                label="🔴 АВАРИЯ"
                                variant={severity === 'critical' ? 'filled' : 'outlined'}
                                color={severity === 'critical' ? 'error' : 'default'}
                                onClick={() => {
                                    setSeverity('critical');
                                    navigator.vibrate?.([20, 10, 20]);
                                }}
                                sx={{ py: 2.5, px: 1, fontSize: '1rem', flex: 1 }}
                            />
                        </Box>
                    </Box>

                    <Divider sx={{ my: 2 }} />

                    {/* Description (optional) */}
                    <Box sx={{ mb: 3 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1.5 }}>
                            ОПИСАНИЕ (опционально)
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                            <TextField
                                fullWidth
                                multiline
                                rows={2}
                                placeholder="Что сломалось? (можно не писать)"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                size="small"
                            />
                            <IconButton
                                color={isRecording ? 'error' : 'primary'}
                                onClick={handleVoiceToggle}
                                sx={{
                                    bgcolor: isRecording ? 'error.50' : 'primary.50',
                                    '&:hover': {
                                        bgcolor: isRecording ? 'error.100' : 'primary.100',
                                    },
                                }}
                            >
                                <MicIcon />
                            </IconButton>
                        </Box>
                        {isRecording && (
                            <Typography variant="caption" color="error" sx={{ mt: 0.5, display: 'block' }}>
                                🎤 Запись... (нажмите еще раз для остановки)
                            </Typography>
                        )}
                    </Box>

                    {/* Submit Button */}
                    <Button
                        fullWidth
                        variant="contained"
                        color="warning"
                        size="large"
                        disabled={!isComplete}
                        onClick={handleSubmit}
                        startIcon={<SendIcon />}
                        sx={{
                            py: 1.5,
                            fontSize: '1rem',
                            fontWeight: 600,
                        }}
                    >
                        Отправить заявку
                    </Button>

                    {/* Summary */}
                    {isComplete && (
                        <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: 'block', textAlign: 'center', mt: 1 }}
                        >
                            {selectedCategory?.emoji} {selectedCategory?.name} •
                            {severity === 'critical' ? ' 🔴 АВАРИЯ' : ' 🟢 Планово'}
                            {photoPreview ? ' • 📷 Фото' : ''}
                        </Typography>
                    )}
                </>
            )}
        </Box>
    );
};

export default RepairTicketInput;
