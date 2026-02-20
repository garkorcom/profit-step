import React, { useState, useEffect } from 'react';
import {
    Box, Typography, Container, Paper, TextField, InputAdornment,
    Button, Chip, Stack, List, ListItem, Avatar, ListItemAvatar, ListItemText,
    CircularProgress, IconButton, Alert, Divider
} from '@mui/material';
import {
    Search as SearchIcon,
    Add as AddIcon,
    MoreVert as MoreVertIcon,
    Phone as PhoneIcon,
    Email as EmailIcon,
    Business as BusinessIcon
} from '@mui/icons-material';

import { Contact } from '../../types/contact.types';
import { contactsService } from '../../services/contactsService';
import GlobalContactQuickAdd from '../../components/contacts/GlobalContactQuickAdd';

const ContactsPage: React.FC = () => {
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [error, setError] = useState<string | null>(null);

    // Filters
    const [selectedRole, setSelectedRole] = useState<string>('');
    const [allRoles, setAllRoles] = useState<string[]>([]);

    const [modalOpen, setModalOpen] = useState(false);

    useEffect(() => {
        const fetchContacts = async () => {
            try {
                setLoading(true);
                const data = await contactsService.getContacts();
                setContacts(data);

                // Extract unique roles for the filter
                const roles = new Set<string>();
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

    const handleContactAdded = (newContact: Contact) => {
        setContacts(prev => [newContact, ...prev]);
        setAllRoles(prev => {
            const added = new Set(prev);
            newContact.roles.forEach(r => added.add(r));
            return Array.from(added).sort();
        });
    };

    return (
        <Container maxWidth="md" sx={{ py: 4 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Typography variant="h4" fontWeight={700} color="primary.main">
                    Справочник
                </Typography>
                <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={() => setModalOpen(true)}
                >
                    Добавить контакт
                </Button>
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
                                        <IconButton edge="end">
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
                                                {/* Phones */}
                                                {contact.phones && contact.phones.length > 0 && (
                                                    <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                        <PhoneIcon fontSize="small" /> {contact.phones.map(p => p.number).join(', ')}
                                                    </Typography>
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

            {/* Quick Add Modal */}
            <GlobalContactQuickAdd
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                onContactAdded={handleContactAdded}
            />
        </Container>
    );
};

export default ContactsPage;
