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
    InputAdornment
} from '@mui/material';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import LanguageIcon from '@mui/icons-material/Language';
import { Client } from '../../types/crm.types';
import { crmApi, ParseClientWebsiteResponse } from '../../api/crmApi';

interface ClientEditDialogProps {
    open: boolean;
    onClose: () => void;
    client: Client;
    onSave: (updatedClient: Client) => void;
}

const ClientEditDialog: React.FC<ClientEditDialogProps> = ({ open, onClose, client, onSave }) => {
    const [formData, setFormData] = useState<Partial<Client>>({});
    const [isSaving, setIsSaving] = useState(false);
    const [isParsing, setIsParsing] = useState(false);
    const [parseError, setParseError] = useState<string | null>(null);

    // Initialize form when dialog opens
    useEffect(() => {
        if (open) {
            setFormData({
                name: client.name || '',
                phone: client.phone || '',
                email: client.email || '',
                address: client.address || '',
                website: client.website || '',
                type: client.type || 'B2B'
            });
            setParseError(null);
        }
    }, [open, client]);

    const handleChange = (field: keyof Client) => (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData(prev => ({ ...prev, [field]: e.target.value }));
    };

    const handleSave = async () => {
        if (!formData.name?.trim()) return;
        setIsSaving(true);
        try {
            await crmApi.updateClient(client.id, formData);
            onSave({ ...client, ...formData });
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

            // Merge AI data, prioritizing it if found, but keeping existing if AI returned nothing.
            setFormData(prev => ({
                ...prev,
                name: aiData.name || prev.name,
                phone: aiData.phone || prev.phone,
                email: aiData.email || prev.email,
                address: aiData.address || prev.address,
                type: aiData.type === 'B2B' || aiData.type === 'B2C' || aiData.type === 'Both' ? aiData.type as any : prev.type
            }));
        } catch (error: any) {
            console.error('Error parsing website:', error);
            setParseError(error.message || 'Не удалось извлечь данные с сайта');
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
                            label="Тип (B2B / B2C)"
                            fullWidth
                            value={formData.type || ''}
                            onChange={handleChange('type')}
                            disabled={isParsing}
                        />
                        <TextField
                            label="Телефон"
                            fullWidth
                            value={formData.phone || ''}
                            onChange={handleChange('phone')}
                            disabled={isParsing}
                        />
                    </Box>

                    <TextField
                        label="Email"
                        fullWidth
                        type="email"
                        value={formData.email || ''}
                        onChange={handleChange('email')}
                        disabled={isParsing}
                    />

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
