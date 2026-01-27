/**
 * @fileoverview Shopping List Client Edit Dialog
 * 
 * Dialog for changing the client of a shopping list.
 */

import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    List,
    ListItem,
    ListItemButton,
    ListItemText,
    TextField,
    CircularProgress,
    Box,
    InputAdornment,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/firebase';

interface Client {
    id: string;
    name: string;
}

interface ShoppingClientDialogProps {
    open: boolean;
    currentClientName: string;
    onSelect: (clientId: string, clientName: string) => void;
    onClose: () => void;
}

const ShoppingClientDialog: React.FC<ShoppingClientDialogProps> = ({
    open,
    currentClientName,
    onSelect,
    onClose,
}) => {
    const [clients, setClients] = useState<Client[]>([]);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState('');

    // Load clients when dialog opens
    useEffect(() => {
        if (!open) return;

        const loadClients = async () => {
            setLoading(true);
            try {
                const q = query(
                    collection(db, 'clients'),
                    where('status', '!=', 'done'),
                    orderBy('status'),
                    orderBy('createdAt', 'desc'),
                    limit(50)
                );
                const snapshot = await getDocs(q);
                const clientList = snapshot.docs.map(doc => ({
                    id: doc.id,
                    name: doc.data().name || 'Unknown',
                }));
                setClients(clientList);
            } catch (error) {
                console.error('Error loading clients:', error);
            } finally {
                setLoading(false);
            }
        };

        loadClients();
    }, [open]);

    const filteredClients = clients.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase())
    );

    const handleSelect = (client: Client) => {
        onSelect(client.id, client.name);
        onClose();
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle>
                Выбрать клиента
            </DialogTitle>
            <DialogContent>
                <TextField
                    fullWidth
                    placeholder="Поиск..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    size="small"
                    sx={{ mb: 2 }}
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start">
                                <SearchIcon />
                            </InputAdornment>
                        ),
                    }}
                />

                {loading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress size={32} />
                    </Box>
                ) : (
                    <List dense sx={{ maxHeight: 300, overflow: 'auto' }}>
                        {filteredClients.map((client) => (
                            <ListItem key={client.id} disablePadding>
                                <ListItemButton
                                    onClick={() => handleSelect(client)}
                                    selected={client.name === currentClientName}
                                >
                                    <ListItemText primary={client.name} />
                                </ListItemButton>
                            </ListItem>
                        ))}
                        {filteredClients.length === 0 && (
                            <ListItem>
                                <ListItemText
                                    primary="Клиенты не найдены"
                                    sx={{ color: 'text.secondary', textAlign: 'center' }}
                                />
                            </ListItem>
                        )}
                    </List>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Отмена</Button>
            </DialogActions>
        </Dialog>
    );
};

export default ShoppingClientDialog;
