import React, { useState, useEffect } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, TextField, Box, Typography, IconButton,
    Chip, CircularProgress, Alert, Stack
} from '@mui/material';
import {
    Close as CloseIcon,
    Add as AddIcon,
    Delete as DeleteIcon,
    LocationOn as LocationIcon
} from '@mui/icons-material';
import { Contact, ContactPhone } from '../../types/contact.types';
import { contactsService } from '../../services/contactsService';
import { useAuth } from '../../auth/AuthContext';

interface GlobalContactQuickAddProps {
    open: boolean;
    onClose: () => void;
    onContactAdded?: (newContact: Contact) => void;
    onContactUpdated?: (updatedContact: Contact) => void;
    initialContact?: Contact | null;
    // Context capture
    currentProjectId?: string;
}

const GlobalContactQuickAdd: React.FC<GlobalContactQuickAddProps> = ({
    open,
    onClose,
    onContactAdded,
    onContactUpdated,
    initialContact,
    currentProjectId
}) => {
    const { currentUser, userProfile } = useAuth();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Form State
    const [name, setName] = useState('');
    const [roles, setRoles] = useState<string[]>([]);
    const [newRole, setNewRole] = useState('');

    // Arrays
    const [phones, setPhones] = useState<ContactPhone[]>([{ number: '', label: 'Мобильный' }]);
    const [emails, setEmails] = useState<string[]>([]);

    // Other
    const [defaultCity, setDefaultCity] = useState('');
    const [whatsapp, setWhatsapp] = useState('');
    const [telegram, setTelegram] = useState('');
    const [notes, setNotes] = useState('');

    // Auto-captured data
    const [locationCaptured, setLocationCaptured] = useState<{ lat: number, lng: number } | null>(null);

    // Reset form when opened
    useEffect(() => {
        if (open) {
            if (initialContact) {
                // Edit Mode
                setName(initialContact.name);
                setRoles(initialContact.roles || []);
                setNewRole('');
                setPhones(initialContact.phones?.length ? initialContact.phones : [{ number: '', label: 'Мобильный' }]);
                setEmails(initialContact.emails || []);
                setDefaultCity(initialContact.defaultCity || '');
                setWhatsapp(initialContact.messengers?.whatsapp || '');
                setTelegram(initialContact.messengers?.telegram || '');
                setNotes(initialContact.notes || '');
                setError(null);
                setLocationCaptured(null);
            } else {
                // Create Mode
                setName('');
                setRoles([]);
                setNewRole('');
                setPhones([{ number: '', label: 'Мобильный' }]);
                setEmails([]);
                setDefaultCity('');
                setWhatsapp('');
                setTelegram('');
                setNotes('');
                setError(null);

                // Try capturing geolocation
                if ('geolocation' in navigator) {
                    navigator.geolocation.getCurrentPosition(
                        (position) => {
                            setLocationCaptured({
                                lat: position.coords.latitude,
                                lng: position.coords.longitude
                            });
                        },
                        (err) => {
                            console.warn("Geolocation denied or unavailable", err);
                            setLocationCaptured(null);
                        }
                    );
                }
            }
        }
    }, [open, initialContact]);

    // Handle Phone Changes
    const handlePhoneChange = (index: number, field: keyof ContactPhone, value: string) => {
        const updatedPhones = [...phones];
        updatedPhones[index] = { ...updatedPhones[index], [field]: value };
        setPhones(updatedPhones);
    };

    const addPhoneRow = () => {
        setPhones([...phones, { number: '', label: 'Доп. номер' }]);
    };

    const removePhoneRow = (index: number) => {
        setPhones(phones.filter((_, i) => i !== index));
    };

    // Arrays handlers
    const handleAddRole = () => {
        if (newRole.trim() && !roles.includes(newRole.trim())) {
            setRoles([...roles, newRole.trim()]);
            setNewRole('');
        }
    };

    // Submit
    const handleSubmit = async () => {
        if (!name.trim()) {
            setError("Имя контакта обязательно");
            return;
        }

        if (!currentUser) {
            setError("Необходимо войти в систему");
            return;
        }

        try {
            setLoading(true);
            setError(null);

            // Clean up empty phones
            const cleanPhones = phones.filter(p => p.number.trim() !== '');

            // Context capturing
            const linkedProjects = currentProjectId ? [currentProjectId] : [];
            const createdLocation = locationCaptured || currentProjectId || undefined;

            const newContactData: Omit<Contact, 'id' | 'createdAt'> = {
                name: name.trim(),
                roles: roles,
                phones: cleanPhones,
                emails: emails,
                messengers: {
                    ...(whatsapp.trim() ? { whatsapp: whatsapp.trim() } : {}),
                    ...(telegram.trim() ? { telegram: telegram.trim() } : {})
                },
                defaultCity: defaultCity.trim() || undefined,
                linkedProjects,
                notes: notes.trim() || undefined,
                createdBy: initialContact ? initialContact.createdBy : currentUser.uid,
                createdLocation: initialContact ? initialContact.createdLocation : createdLocation
            };

            if (initialContact) {
                await contactsService.updateContact(initialContact.id!, newContactData);
                if (onContactUpdated) {
                    onContactUpdated({ id: initialContact.id, ...newContactData, createdAt: initialContact.createdAt });
                }
            } else {
                const authorName = userProfile?.displayName || currentUser.email || 'Пользователь';
                const newId = await contactsService.createContact(newContactData, currentUser.uid, authorName);
                if (onContactAdded) {
                    onContactAdded({ id: newId, ...newContactData, createdAt: null as any });
                }
            }

            onClose();
        } catch (err: any) {
            console.error("Failed to add contact", err);
            setError("Не удалось сохранить контакт. Пожалуйста, попробуйте снова.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth scroll="paper">
            <DialogTitle sx={{ m: 0, p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6" fontWeight="bold">
                    {initialContact ? 'Редактировать контакт' : 'Внести контакт'}
                </Typography>
                <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
            </DialogTitle>

            <DialogContent dividers>
                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

                <Box component="form" noValidate sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>

                    {/* Basic Info */}
                    <Box>
                        <TextField
                            fullWidth
                            label="Имя / Организация *"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            size="small"
                        />
                    </Box>

                    {/* Roles Array */}
                    <Box>
                        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                            Роли / Специализация
                        </Typography>
                        <Box display="flex" gap={1} mb={1}>
                            <TextField
                                fullWidth
                                size="small"
                                placeholder="Например: Инспектор, Электрик..."
                                value={newRole}
                                onChange={(e) => setNewRole(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddRole())}
                            />
                            <Button variant="outlined" onClick={handleAddRole} disabled={!newRole.trim()}>Добавить</Button>
                        </Box>
                        <Box display="flex" flexWrap="wrap" gap={0.5}>
                            {roles.map(r => (
                                <Chip
                                    key={r}
                                    label={r}
                                    onDelete={() => setRoles(roles.filter(role => role !== r))}
                                    size="small"
                                />
                            ))}
                        </Box>
                    </Box>

                    {/* Phones Array */}
                    <Box>
                        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                            Телефоны
                        </Typography>
                        <Stack spacing={1}>
                            {phones.map((phone, index) => (
                                <Stack direction="row" spacing={1} key={index} alignItems="center">
                                    <Box flex={5}>
                                        <TextField
                                            fullWidth
                                            size="small"
                                            placeholder="+1 (555) 000-0000"
                                            value={phone.number}
                                            onChange={(e) => handlePhoneChange(index, 'number', e.target.value)}
                                        />
                                    </Box>
                                    <Box flex={5}>
                                        <TextField
                                            fullWidth
                                            size="small"
                                            placeholder="Метка (Моб, Раб)"
                                            value={phone.label}
                                            onChange={(e) => handlePhoneChange(index, 'label', e.target.value)}
                                        />
                                    </Box>
                                    <Box flex={2} display="flex" justifyContent="center">
                                        {phones.length > 1 && (
                                            <IconButton color="error" onClick={() => removePhoneRow(index)} size="small">
                                                <DeleteIcon fontSize="small" />
                                            </IconButton>
                                        )}
                                    </Box>
                                </Stack>
                            ))}
                            <Button
                                startIcon={<AddIcon />}
                                onClick={addPhoneRow}
                                size="small"
                                sx={{ alignSelf: 'flex-start' }}
                            >
                                Добавить номер
                            </Button>
                        </Stack>
                    </Box>

                    {/* Geography & Others */}
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        <Box flex={1}>
                            <TextField
                                fullWidth
                                label="Город"
                                value={defaultCity}
                                onChange={(e) => setDefaultCity(e.target.value)}
                                size="small"
                            />
                        </Box>
                        <Box flex={1}>
                            <Box display="flex" alignItems="center" gap={1} height="100%">
                                <LocationIcon color={locationCaptured ? "success" : "disabled"} />
                                <Typography variant="caption" color="text.secondary">
                                    {locationCaptured ? "Геопозиция захвачена" : "Гео не получено"}
                                </Typography>
                            </Box>
                        </Box>
                    </Stack>

                    {/* Messengers */}
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        <Box flex={1}>
                            <TextField
                                fullWidth
                                label="WhatsApp"
                                placeholder="+1..."
                                value={whatsapp}
                                onChange={(e) => setWhatsapp(e.target.value)}
                                size="small"
                            />
                        </Box>
                        <Box flex={1}>
                            <TextField
                                fullWidth
                                label="Telegram"
                                placeholder="@username"
                                value={telegram}
                                onChange={(e) => setTelegram(e.target.value)}
                                size="small"
                            />
                        </Box>
                    </Stack>

                    {/* Notes */}
                    <Box>
                        <TextField
                            fullWidth
                            label="Заметки"
                            multiline
                            rows={3}
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            size="small"
                        />
                    </Box>

                </Box>
            </DialogContent>

            <DialogActions sx={{ p: 2, display: 'flex', justifyContent: 'space-between', bgcolor: 'background.default' }}>
                <Typography variant="caption" color="text.secondary">
                    {currentProjectId ? `Будет привязан к проекту: ${currentProjectId}` : 'Без привязки к проекту'}
                </Typography>
                <Box>
                    <Button onClick={onClose} disabled={loading} color="inherit" sx={{ mr: 1 }}>
                        Отмена
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        variant="contained"
                        disabled={loading || !name.trim()}
                        sx={{ px: 4 }}
                    >
                        {loading ? <CircularProgress size={24} /> : (initialContact ? 'Сохранить' : 'Добавить')}
                    </Button>
                </Box>
            </DialogActions>
        </Dialog>
    );
};

export default GlobalContactQuickAdd;
