/**
 * @fileoverview Select Client Dialog
 * 
 * Dialog for selecting a client for shopping list.
 */

import React, { useState } from 'react';
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
import { useClients } from '../hooks/useClients';

interface SelectClientDialogProps {
    open: boolean;
    currentClientName: string;
    onSelect: (clientId: string, clientName: string) => void;
    onClose: () => void;
}

const SelectClientDialog: React.FC<SelectClientDialogProps> = ({
    open,
    currentClientName,
    onSelect,
    onClose,
}) => {
    const { clients, loading } = useClients();
    const [search, setSearch] = useState('');

    const filteredClients = clients.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase())
    );

    const handleSelect = (clientId: string, clientName: string) => {
        onSelect(clientId, clientName);
        onClose();
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle>Выбрать клиента</DialogTitle>
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
                                    onClick={() => handleSelect(client.id, client.name)}
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

export default SelectClientDialog;
