import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    Box,
    CircularProgress,
    Typography,
    Alert,
    InputAdornment,
    MenuItem,
    Autocomplete,
    ToggleButtonGroup,
    ToggleButton
} from '@mui/material';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import LanguageIcon from '@mui/icons-material/Language';
import ContactsIcon from '@mui/icons-material/Contacts';
import BusinessIcon from '@mui/icons-material/Business';
import KeyboardIcon from '@mui/icons-material/Keyboard';
import { Client, ClientStatus, ClientType, Company } from '../../types/crm.types';
import { errorMessage } from '../../utils/errorMessage';
import { Contact } from '../../types/contact.types';
import { crmApi, ParseClientWebsiteResponse } from '../../api/crmApi';
import { contactsService } from '../../services/contactsService';
import { getCompanyClientsPaginated } from '../../api/companiesApi';
import { useAuth } from '../../auth/AuthContext';

interface ClientEditDialogProps {
    open: boolean;
    onClose: () => void;
    client: Client;
    onSave: (updatedClient: Client) => void;
}

const statusOptions: { value: ClientStatus, label: string }[] = [
    { value: 'new', label: 'Потенциальный' },
    { value: 'contacted', label: 'Потенциальный (В контакте)' },
    { value: 'qualified', label: 'Потенциальный (Квалифицирован)' },
    { value: 'customer', label: 'В работе' },
    { value: 'done', label: 'Закрыт' },
    { value: 'churned', label: 'Закрыт (Отказ)' },
];

const ClientEditDialog: React.FC<ClientEditDialogProps> = ({ open, onClose, client, onSave }) => {
    const { userProfile } = useAuth();
    const [formData, setFormData] = useState<Partial<Client>>({});
    const [isSaving, setIsSaving] = useState(false);
    const [isParsing, setIsParsing] = useState(false);
    const [parseError, setParseError] = useState<string | null>(null);

    // Source Data
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [companies, setCompanies] = useState<Company[]>([]);
    const [loadingSources, setLoadingSources] = useState(false);

    // Auto-complete selections
    const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
    const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);

    // Initialize form when dialog opens
    useEffect(() => {
        if (open) {
            setFormData({
                name: client.name || '',
                phone: client.phone || '',
                email: client.email || '',
                address: client.address || '',
                website: client.website || '',
                type: client.type || 'person',
                status: client.status || 'new',
                sourceType: client.sourceType || 'manual',
                source: client.source || '', // Legacy/Manual fallback
                sourceId: client.sourceId || '',
                sourceName: client.sourceName || ''
            });
            setParseError(null);
            fetchSources();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, client, userProfile?.companyId]);

    const fetchSources = async () => {
        if (!userProfile?.companyId) return;
        setLoadingSources(true);
        try {
            // Fetch Global Contacts
            const fetchedContacts = await contactsService.getContacts();
            setContacts(fetchedContacts);

            // Fetch Companies (first 50)
            const companiesRes = await getCompanyClientsPaginated({
                ownerCompanyId: userProfile.companyId,
                pageSize: 50,
                orderBy: 'createdAt',
                orderDirection: 'desc',
                statusFilter: 'active'
            });
            setCompanies(companiesRes.companies);

            // Restore selection state based on existing client data
            if (client.sourceType === 'contact' && client.sourceId) {
                const found = fetchedContacts.find(c => c.id === client.sourceId);
                if (found) setSelectedContact(found);
            } else if (client.sourceType === 'company' && client.sourceId) {
                const found = companiesRes.companies.find(c => c.id === client.sourceId);
                if (found) setSelectedCompany(found);
            }

        } catch (err) {
            console.error('Error fetching sources:', err);
        } finally {
            setLoadingSources(false);
        }
    };

    const handleChange = (field: keyof Client) => (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData(prev => ({ ...prev, [field]: e.target.value }));
    };

    const handleSourceTypeChange = (e: React.MouseEvent<HTMLElement>, newSourceType: 'contact' | 'company' | 'manual' | null) => {
        if (newSourceType !== null) {
            setFormData(prev => ({
                ...prev,
                sourceType: newSourceType,
                sourceId: '',
                sourceName: '',
                source: ''
            }));
            setSelectedContact(null);
            setSelectedCompany(null);
        }
    };

    const handleSave = async () => {
        if (!formData.name?.trim()) return;
        setIsSaving(true);
        try {
            // Clean up unwanted fields if we switched source types
            const payloadToSave: Partial<Client> = { ...formData };
            if (payloadToSave.sourceType === 'contact') {
                payloadToSave.source = ''; // Clear manual field
            } else if (payloadToSave.sourceType === 'company') {
                payloadToSave.source = ''; // Clear manual field
            } else if (payloadToSave.sourceType === 'manual') {
                payloadToSave.sourceId = '';
                payloadToSave.sourceName = '';
            }

            await crmApi.updateClient(client.id, payloadToSave);
            onSave({ ...client, ...payloadToSave });
            onClose();
        } catch (error) {
            console.error('Error saving client:', error);
            setParseError('Ошибка при сохранении клиента');
        } finally {
            setIsSaving(false);
        }
    };

    const handleParseWebsite = async () => {
        const url = formData.website?.trim();
        if (!url) {
            setParseError('Сначала введите URL сайта (начинающийся с http/https)');
            return;
        }
        if (!url.startsWith('http')) {
            setParseError('URL должен начинаться с http:// или https://');
            return;
        }

        setIsParsing(true);
        setParseError(null);

        try {
            const aiData: ParseClientWebsiteResponse = await crmApi.parseClientWebsite(url);

            setFormData(prev => ({
                ...prev,
                name: aiData.name || prev.name,
                phone: aiData.phone || prev.phone,
                email: aiData.email || prev.email,
                address: aiData.address || prev.address,
                type: aiData.type === 'company' || aiData.type === 'person' ? (aiData.type as ClientType) : prev.type
            }));
        } catch (error: unknown) {
            console.error('Error parsing website:', error);
            setParseError(errorMessage(error) || 'Не удалось извлечь данные с сайта');
        } finally {
            setIsParsing(false);
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Редактировать клиента</DialogTitle>
            <DialogContent dividers>
                {parseError && (
                    <Alert severity="error" sx={{ mb: 2 }} onClose={() => setParseError(null)}>
                        {parseError}
                    </Alert>
                )}

                {/* --- Smart Parse Box --- */}
                <Box sx={{ mb: 3, p: 2, bgcolor: 'rgba(165,214,167,0.05)', borderRadius: 1, border: '1px solid rgba(165,214,167,0.2)' }}>
                    <Typography variant="subtitle2" sx={{ mb: 1, color: '#a5d6a7', display: 'flex', alignItems: 'center' }}>
                        <AutoFixHighIcon fontSize="small" sx={{ mr: 1 }} />
                        Smart Parse
                    </Typography>
                    <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                        Вставьте ссылку на сайт клиента, и ИИ попытается автоматически найти контакты, имя и адрес.
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <TextField
                            size="small"
                            fullWidth
                            placeholder="https://example.com"
                            value={formData.website || ''}
                            onChange={handleChange('website')}
                            InputProps={{
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <LanguageIcon fontSize="small" />
                                    </InputAdornment>
                                ),
                            }}
                        />
                        <Button
                            variant="contained"
                            disabled={isParsing || !formData.website}
                            onClick={handleParseWebsite}
                            sx={{ minWidth: 120, bgcolor: '#a5d6a7', color: '#121212', '&:hover': { bgcolor: '#81c784' } }}
                        >
                            {isParsing ? <CircularProgress size={20} color="inherit" /> : 'Парсить'}
                        </Button>
                    </Box>
                </Box>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    
                    {/* --- Metadata (Status & Type) --- */}
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <TextField
                            select
                            label="Статус (Роль)"
                            fullWidth
                            value={formData.status || 'new'}
                            onChange={handleChange('status')}
                            disabled={isParsing}
                        >
                            {statusOptions.map(option => (
                                <MenuItem key={option.value} value={option.value}>
                                    {option.label}
                                </MenuItem>
                            ))}
                        </TextField>

                        <TextField
                            select
                            label="Тип лица"
                            fullWidth
                            value={formData.type || 'person'}
                            onChange={handleChange('type')}
                            disabled={isParsing}
                        >
                            <MenuItem value="person">Физическое (B2C)</MenuItem>
                            <MenuItem value="company">Юридическое (B2B)</MenuItem>
                        </TextField>
                    </Box>

                    {/* --- Source Tracking --- */}
                    <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                        <Typography variant="subtitle2" gutterBottom>Источник клиента</Typography>
                        <ToggleButtonGroup
                            value={formData.sourceType || 'manual'}
                            exclusive
                            onChange={handleSourceTypeChange}
                            size="small"
                            fullWidth
                            sx={{ mb: 2 }}
                        >
                            <ToggleButton value="manual"><KeyboardIcon fontSize="small" sx={{ mr: 1 }}/> Текст</ToggleButton>
                            <ToggleButton value="contact"><ContactsIcon fontSize="small" sx={{ mr: 1 }}/> Контакт</ToggleButton>
                            <ToggleButton value="company"><BusinessIcon fontSize="small" sx={{ mr: 1 }}/> Компания</ToggleButton>
                        </ToggleButtonGroup>

                        {formData.sourceType === 'contact' && (
                            <Autocomplete
                                disabled={loadingSources}
                                options={contacts}
                                getOptionLabel={(option) => option.name}
                                value={selectedContact}
                                onChange={(e, newValue) => {
                                    setSelectedContact(newValue);
                                    setFormData(prev => ({
                                        ...prev,
                                        sourceId: newValue?.id || '',
                                        sourceName: newValue?.name || ''
                                    }));
                                }}
                                renderInput={(params) => <TextField {...params} label="Выберите контакт-источник из Справочника" />}
                            />
                        )}

                        {formData.sourceType === 'company' && (
                            <Autocomplete
                                disabled={loadingSources}
                                options={companies}
                                getOptionLabel={(option) => option.name}
                                value={selectedCompany}
                                onChange={(e, newValue) => {
                                    setSelectedCompany(newValue);
                                    setFormData(prev => ({
                                        ...prev,
                                        sourceId: newValue?.id || '',
                                        sourceName: newValue?.name || ''
                                    }));
                                }}
                                renderInput={(params) => <TextField {...params} label="Выберите компанию-источник" />}
                            />
                        )}

                        {formData.sourceType === 'manual' && (
                            <TextField
                                label="Вручную (Напр. Реклама, Google, 2GIS...)"
                                fullWidth
                                value={formData.source || ''}
                                onChange={handleChange('source')}
                            />
                        )}
                    </Box>

                    {/* --- Core Details --- */}
                    <TextField
                        label="Название компании / Имя"
                        fullWidth
                        required
                        value={formData.name || ''}
                        onChange={handleChange('name')}
                        disabled={isParsing}
                    />

                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <TextField
                            label="Телефон"
                            fullWidth
                            value={formData.phone || ''}
                            onChange={handleChange('phone')}
                            disabled={isParsing}
                        />
                        <TextField
                            label="Email"
                            fullWidth
                            type="email"
                            value={formData.email || ''}
                            onChange={handleChange('email')}
                            disabled={isParsing}
                        />
                    </Box>

                    <TextField
                        label="Адрес"
                        fullWidth
                        multiline
                        rows={2}
                        value={formData.address || ''}
                        onChange={handleChange('address')}
                        disabled={isParsing}
                    />
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={isSaving || isParsing}>Отмена</Button>
                <Button
                    onClick={handleSave}
                    variant="contained"
                    color="primary"
                    disabled={isSaving || isParsing || !formData.name?.trim()}
                >
                    {isSaving ? <CircularProgress size={24} /> : 'Сохранить'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default ClientEditDialog;
