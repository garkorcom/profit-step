import React, { useState, useEffect } from 'react';
import {
    Box, Typography, Container, Paper, TextField, InputAdornment,
    Button, Chip, Stack, List, ListItem, Avatar, ListItemAvatar, ListItemText,
    CircularProgress, IconButton, Alert, Divider, Snackbar,
    Menu, MenuItem, ListItemIcon, Dialog, DialogTitle, DialogContent, DialogActions, DialogContentText
} from '@mui/material';
import {
    Search as SearchIcon,
    Add as AddIcon,
    MoreVert as MoreVertIcon,
    Phone as PhoneIcon,
    Email as EmailIcon,
    Business as BusinessIcon,
    WhatsApp as WhatsAppIcon,
    Telegram as TelegramIcon,
    Download as DownloadIcon,
    Upload as UploadIcon,
    Edit as EditIcon,
    Delete as DeleteIcon
} from '@mui/icons-material';

import { Contact } from '../../types/contact.types';
import { contactsService } from '../../services/contactsService';
import GlobalContactQuickAdd from '../../components/contacts/GlobalContactQuickAdd';

// Preset roles for quick filtering
const PRESET_ROLES = [
    'Inspector',
    'Building Inspector',
    'Electrical Inspector',
    'Mechanical Inspector',
    'Landlord',
    'Owner',
    'Designer/Architect',
    'Worker',
    'Subcontractor',
    'Supplier',
] as const;

const ContactsPage: React.FC = () => {
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [importSuccessMsg, setImportSuccessMsg] = useState<string | null>(null);

    // Filters
    const [selectedRole, setSelectedRole] = useState<string>('');
    const [allRoles, setAllRoles] = useState<string[]>([]);

    const [modalOpen, setModalOpen] = useState(false);

    // Context Menu & Edit/Delete State
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const [actionContact, setActionContact] = useState<Contact | null>(null);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [editModalOpen, setEditModalOpen] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);

    useEffect(() => {
        const fetchContacts = async () => {
            try {
                setLoading(true);
                const data = await contactsService.getContacts();
                setContacts(data);

                // Extract unique roles for the filter (merge preset + dynamic)
                const roles = new Set<string>(PRESET_ROLES);
                data.forEach(c => c.roles?.forEach(r => roles.add(r)));
                setAllRoles(Array.from(roles).sort());
            } catch (err: any) {
                console.error("Failed to fetch contacts", err);
                setError("Ошибка загрузки справочника контактов.");
            } finally {
                setLoading(false);
            }
        };

        fetchContacts();
    }, []);

    // Filter Logic
    const filteredContacts = contacts.filter(contact => {
        const matchesSearch = contact.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            contact.roles.some(r => r.toLowerCase().includes(searchQuery.toLowerCase())) ||
            (contact.defaultCity || '').toLowerCase().includes(searchQuery.toLowerCase());

        const matchesRole = selectedRole ? contact.roles.includes(selectedRole) : true;

        return matchesSearch && matchesRole;
    });

    const handleExportCSV = () => {
        if (!contacts || contacts.length === 0) return;

        // Define columns
        const headers = ['Имя', 'Роли', 'Телефоны', 'Почта', 'Город', 'Заметки'];

        // Build rows
        const rows = contacts.map(c => [
            `"${c.name.replace(/"/g, '""')}"`,
            `"${c.roles.join(', ').replace(/"/g, '""')}"`,
            `"${(c.phones || []).map(p => `${p.number} ${p.label ? '(' + p.label + ')' : ''}`).join(', ')}"`,
            `"${(c.emails || []).join(', ')}"`,
            `"${(c.defaultCity || '').replace(/"/g, '""')}"`,
            `"${(c.notes || '').replace(/"/g, '""')}"`
        ]);

        // Add BOM for Excel UTF-8 display
        const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\\n');
        const blob = new Blob([`\\ufeff${csvContent}`], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `profit_step_contacts_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleImportCSV = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const text = e.target?.result as string;
                // Basic CSV parser resilient to quotes (handles our own export format)
                const rows = text.split('\\n').filter(row => row.trim() !== '');
                if (rows.length < 2) throw new Error('Файл пуст или содержит только заголовки.');

                // We assume format: ['Имя', 'Роли', 'Телефоны', 'Почта', 'Город', 'Заметки']
                const contactsToImport = rows.slice(1).map(row => {
                    const columns = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(col => col.replace(/^"|"$/g, '').trim());
                    // 0: Name, 1: Roles, 2: Phones, 3: Emails, 4: City, 5: Notes
                    const rawName = columns[0] || '';
                    if (!rawName) return null;

                    const roles = columns[1] ? columns[1].split(',').map(r => r.trim()).filter(Boolean) : [];

                    const phones = columns[2] ? columns[2].split(',').map(p => {
                        const parts = p.match(/(.*?)\\s*\\((.*?)\\)$/);
                        if (parts) {
                            return { number: parts[1].trim(), label: parts[2].trim() };
                        }
                        return { number: p.trim(), label: '' };
                    }).filter(p => !!p.number) : [];

                    const emails = columns[3] ? columns[3].split(',').map(e => e.trim()).filter(Boolean) : [];
                    const city = columns[4] || '';
                    const notes = columns[5] || '';

                    return {
                        name: rawName,
                        roles,
                        phones,
                        emails,
                        messengers: {},
                        defaultCity: city,
                        notes,
                        linkedProjects: [],
                        createdBy: 'csv_import'
                    };
                }).filter(Boolean) as Omit<Contact, 'id' | 'createdAt'>[];

                if (contactsToImport.length === 0) throw new Error('Не найдено валидных контактов для импорта.');

                // Insert into DB
                setLoading(true);
                // Hardcoding current user for simplicity in this utility (since we don't have direct useAuth here yet, we pass 'system' or we can add useAuth)
                let importedCount = 0;
                for (const newContactData of contactsToImport) {
                    await contactsService.createContact(newContactData, 'csv_import', 'CSV Import');
                    importedCount++;
                }

                setImportSuccessMsg(`Успешно импортировано ${importedCount} контактов!`);

                // Refresh list
                const refreshed = await contactsService.getContacts();
                setContacts(refreshed);

                // Update roles (merge preset + dynamic)
                const newRoles = new Set<string>(PRESET_ROLES);
                refreshed.forEach(c => c.roles?.forEach(r => newRoles.add(r)));
                setAllRoles(Array.from(newRoles).sort());

            } catch (err: any) {
                console.error("CSV Import Error", err);
                setError(err.message || 'Ошибка импорта CSV.');
            } finally {
                setLoading(false);
                // Reset file input
                event.target.value = '';
            }
        };
        reader.readAsText(file);
    };

    return (
        <Container maxWidth="md" sx={{ py: 4 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Typography variant="h4" fontWeight={700} color="primary.main">
                    Справочник
                </Typography>
                <Box display="flex" gap={1.5}>
                    <Button
                        variant="outlined"
                        startIcon={<DownloadIcon />}
                        onClick={handleExportCSV}
                        disabled={contacts.length === 0}
                        sx={{ display: { xs: 'none', sm: 'flex' } }}
                    >
                        Экспорт
                    </Button>
                    <Button
                        variant="outlined"
                        startIcon={<UploadIcon />}
                        component="label"
                        sx={{ display: { xs: 'none', sm: 'flex' } }}
                    >
                        Импорт
                        <input
                            type="file"
                            accept=".csv"
                            hidden
                            onChange={handleImportCSV}
                        />
                    </Button>
                    <Button
                        variant="contained"
                        startIcon={<AddIcon />}
                        onClick={() => setModalOpen(true)}
                    >
                        Новый
                    </Button>
                </Box>
            </Box>

            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

            {/* Filters / Search Bar */}
            <Paper sx={{ p: 2, mb: 3 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField
                        fullWidth
                        size="small"
                        placeholder="Поиск по имени, роли, городу..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        InputProps={{
                            startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment>
                        }}
                    />

                    {/* Visual Role Filters */}
                    {allRoles.length > 0 && (
                        <Box sx={{ display: 'flex', gap: 1, overflowX: 'auto', pb: 0.5, flexShrink: 0, alignItems: 'center' }}>
                            <Chip
                                label="Все"
                                onClick={() => setSelectedRole('')}
                                color={selectedRole === '' ? 'primary' : 'default'}
                                variant={selectedRole === '' ? 'filled' : 'outlined'}
                            />
                            {allRoles.map(role => (
                                <Chip
                                    key={role}
                                    label={role}
                                    onClick={() => setSelectedRole(role)}
                                    color={selectedRole === role ? 'primary' : 'default'}
                                    variant={selectedRole === role ? 'filled' : 'outlined'}
                                />
                            ))}
                        </Box>
                    )}
                </Stack>
            </Paper>

            {/* List */}
            {loading ? (
                <Box display="flex" justifyContent="center" py={5}><CircularProgress /></Box>
            ) : filteredContacts.length === 0 ? (
                <Paper sx={{ p: 5, textAlign: 'center' }}>
                    <Typography color="text.secondary">Контакты не найдены</Typography>
                </Paper>
            ) : (
                <Paper>
                    <List sx={{ p: 0 }}>
                        {filteredContacts.map((contact, index) => (
                            <React.Fragment key={contact.id}>
                                <ListItem
                                    alignItems="flex-start"
                                    sx={{ py: 2 }}
                                    secondaryAction={
                                        <IconButton edge="end" onClick={(e) => {
                                            setAnchorEl(e.currentTarget);
                                            setActionContact(contact);
                                        }}>
                                            <MoreVertIcon />
                                        </IconButton>
                                    }
                                >
                                    <ListItemAvatar>
                                        <Avatar sx={{ bgcolor: 'primary.light', color: 'primary.contrastText' }}>
                                            {contact.name.charAt(0).toUpperCase()}
                                        </Avatar>
                                    </ListItemAvatar>

                                    <ListItemText
                                        primary={
                                            <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                                                <Typography variant="subtitle1" fontWeight={600}>
                                                    {contact.name}
                                                </Typography>
                                                {contact.roles.map(r => (
                                                    <Chip key={r} label={r} size="small" />
                                                ))}
                                            </Box>
                                        }
                                        secondary={
                                            <Stack spacing={0.5} mt={1}>
                                                {contact.phones && contact.phones.length > 0 && (
                                                    <Box>
                                                        {contact.phones.map((p, i) => {
                                                            const cleanNumber = p.number.replace(/\\D/g, '');
                                                            return (
                                                                <Box key={i} display="flex" alignItems="center" gap={1} mb={0.5}>
                                                                    <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                                        <PhoneIcon fontSize="small" /> {p.number} {p.label ? `(${p.label})` : ''}
                                                                    </Typography>
                                                                    <IconButton component="a" size="small" href={`https://wa.me/${cleanNumber}`} target="_blank" rel="noopener noreferrer" color="success" sx={{ padding: '2px' }} title="WhatsApp">
                                                                        <WhatsAppIcon fontSize="small" sx={{ fontSize: 16 }} />
                                                                    </IconButton>
                                                                    <IconButton component="a" size="small" href={`https://t.me/+${cleanNumber}`} target="_blank" rel="noopener noreferrer" color="info" sx={{ padding: '2px' }} title="Telegram">
                                                                        <TelegramIcon fontSize="small" sx={{ fontSize: 16 }} />
                                                                    </IconButton>
                                                                </Box>
                                                            );
                                                        })}
                                                    </Box>
                                                )}

                                                {/* Emails */}
                                                {contact.emails && contact.emails.length > 0 && (
                                                    <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                        <EmailIcon fontSize="small" /> {contact.emails.join(', ')}
                                                    </Typography>
                                                )}

                                                {/* Location / City */}
                                                {contact.defaultCity && (
                                                    <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                        <BusinessIcon fontSize="small" /> {contact.defaultCity}
                                                    </Typography>
                                                )}
                                            </Stack>
                                        }
                                    />
                                </ListItem>
                                {index < filteredContacts.length - 1 && <Divider component="li" />}
                            </React.Fragment>
                        ))}
                    </List>
                </Paper>
            )}

            {/* Action Menu */}
            <Menu
                anchorEl={anchorEl}
                open={Boolean(anchorEl)}
                onClose={() => setAnchorEl(null)}
                transformOrigin={{ horizontal: 'right', vertical: 'top' }}
                anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
            >
                <MenuItem onClick={() => {
                    setEditModalOpen(true);
                    setAnchorEl(null);
                }}>
                    <ListItemIcon><EditIcon fontSize="small" /></ListItemIcon>
                    <ListItemText>Редактировать</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => {
                    setDeleteDialogOpen(true);
                    setAnchorEl(null);
                }}>
                    <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon>
                    <ListItemText sx={{ color: 'error.main' }}>Удалить</ListItemText>
                </MenuItem>
            </Menu>

            {/* Delete Confirmation Dialog */}
            <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
                <DialogTitle>Удалить контакт?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        Вы уверены, что хотите удалить <b>{actionContact?.name}</b>? Это действие нельзя отменить.
                    </DialogContentText>
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2 }}>
                    <Button onClick={() => setDeleteDialogOpen(false)} disabled={actionLoading} color="inherit">Отмена</Button>
                    <Button
                        onClick={async () => {
                            if (actionContact?.id) {
                                setActionLoading(true);
                                try {
                                    await contactsService.deleteContact(actionContact.id);
                                    setContacts(prev => prev.filter(c => c.id !== actionContact.id));
                                    setSuccessMsg('Контакт успешно удален!');
                                    setDeleteDialogOpen(false);
                                    setActionContact(null);
                                } catch (err) {
                                    // Error is already logged in service, can just notify
                                    setSuccessMsg('Ошибка при удалении контакта.');
                                } finally {
                                    setActionLoading(false);
                                }
                            }
                        }}
                        color="error"
                        variant="contained"
                        disabled={actionLoading}
                    >
                        {actionLoading ? <CircularProgress size={20} color="inherit" /> : 'Удалить'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Modals */}
            <GlobalContactQuickAdd
                open={modalOpen || editModalOpen}
                onClose={() => {
                    setModalOpen(false);
                    setEditModalOpen(false);
                    setActionContact(null);
                }}
                initialContact={editModalOpen ? actionContact : null}
                onContactAdded={(newContact) => {
                    setContacts(prev => [newContact, ...prev]);
                    // Update roles
                    setAllRoles(prev => {
                        const added = new Set(prev);
                        newContact.roles.forEach(r => added.add(r));
                        return Array.from(added).sort();
                    });
                    setSuccessMsg('Контакт успешно добавлен!');
                }}
                onContactUpdated={(updatedContact) => {
                    setContacts(prev => prev.map(c => c.id === updatedContact.id ? updatedContact : c));
                    setSuccessMsg('Контакт обновлен!');
                }}
            />

            <Snackbar
                open={!!importSuccessMsg || !!successMsg}
                autoHideDuration={6000}
                onClose={() => {
                    setImportSuccessMsg(null);
                    setSuccessMsg(null);
                }}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert severity={successMsg?.includes('Ошибка') ? "error" : "success"} sx={{ width: '100%' }}>
                    {importSuccessMsg || successMsg}
                </Alert>
            </Snackbar>
        </Container>
    );
};

export default ContactsPage;
