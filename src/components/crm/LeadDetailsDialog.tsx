import React, { useState, useEffect } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, TextField, Box, Typography, IconButton, Grid,
    MenuItem, Divider, List, ListItem, ListItemText
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { doc, updateDoc, arrayUnion, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase/firebase';

interface Lead {
    id: string;
    name: string;
    phone: string;
    service: string;
    status: 'new' | 'contacted' | 'quote_sent' | 'won' | 'lost';
    createdAt: Timestamp;
    notes?: { text: string; date: Timestamp }[];
    email?: string;
    value?: number;
    source?: string;
    briefing?: string;
    aiAnalysis?: {
        type: string;
        category: string;
        priority: string;
        recommendations: string;
    };
    tags?: string[];
    priority?: 'low' | 'medium' | 'high';
}

interface LeadDetailsDialogProps {
    open: boolean;
    onClose: () => void;
    lead: Lead | null;
}

const STATUS_OPTIONS = [
    { value: 'new', label: 'New Lead' },
    { value: 'contacted', label: 'Contacted' },
    { value: 'quote_sent', label: 'Quote Sent' },
    { value: 'won', label: 'Won' },
    { value: 'lost', label: 'Lost' },
];

const LeadDetailsDialog: React.FC<LeadDetailsDialogProps> = ({ open, onClose, lead }) => {
    const [formData, setFormData] = useState<Partial<Lead>>({});
    const [newNote, setNewNote] = useState('');
    const [saving, setSaving] = useState(false);
    const [tagsInput, setTagsInput] = useState('');

    useEffect(() => {
        if (lead) {
            setFormData({
                name: lead.name,
                phone: lead.phone,
                email: lead.email || '',
                service: lead.service,
                status: lead.status,
                value: lead.value || 0,
                priority: lead.priority || 'medium',
                tags: lead.tags || []
            });
            setNewNote('');
            setTagsInput((lead.tags || []).join(', '));
        }
    }, [lead]);

    const handleChange = (field: keyof Lead, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleSave = async () => {
        if (!lead) return;
        setSaving(true);
        try {
            await updateDoc(doc(db, 'leads', lead.id), formData);
            onClose();
        } catch (error) {
            console.error("Error updating lead:", error);
            alert("Failed to save changes.");
        } finally {
            setSaving(false);
        }
    };

    const handleAddNote = async () => {
        if (!lead || !newNote.trim()) return;
        try {
            const note = {
                text: newNote,
                date: Timestamp.now()
            };
            await updateDoc(doc(db, 'leads', lead.id), {
                notes: arrayUnion(note)
            });
            setNewNote('');
            // Note: The parent component's real-time listener will update the UI, 
            // but for immediate feedback in this dialog we might need local state if we displayed notes here.
            // For now, we rely on the parent or re-opening.
        } catch (error) {
            console.error("Error adding note:", error);
        }
    };

    if (!lead) return null;

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ m: 0, p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6" component="div" fontWeight="bold">
                    Lead Details
                </Typography>
                <IconButton
                    aria-label="close"
                    onClick={onClose}
                    sx={{ color: (theme) => theme.palette.grey[500] }}
                >
                    <CloseIcon />
                </IconButton>
            </DialogTitle>
            <DialogContent dividers>
                {lead.briefing && (
                    <Box sx={{ mb: 3, p: 2, bgcolor: '#f0f9ff', borderRadius: 2, border: '1px solid #bae6fd' }}>
                        <Typography variant="subtitle2" color="primary" fontWeight="bold" gutterBottom display="flex" alignItems="center" gap={1}>
                            🤖 AI Agent Briefing
                        </Typography>
                        <Typography variant="body2" component="pre" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', m: 0 }}>
                            {lead.briefing}
                        </Typography>
                    </Box>
                )}
                <Box component="form" noValidate autoComplete="off" sx={{ mt: 1 }}>
                    <Grid container spacing={2}>
                        <Grid size={{ xs: 12 }}>
                            <TextField
                                label="Name"
                                fullWidth
                                value={formData.name || ''}
                                onChange={(e) => handleChange('name', e.target.value)}
                            />
                        </Grid>
                        <Grid size={{ xs: 6 }}>
                            <TextField
                                label="Phone"
                                fullWidth
                                value={formData.phone || ''}
                                onChange={(e) => handleChange('phone', e.target.value)}
                            />
                        </Grid>
                        <Grid size={{ xs: 6 }}>
                            <TextField
                                label="Email"
                                fullWidth
                                value={formData.email || ''}
                                onChange={(e) => handleChange('email', e.target.value)}
                            />
                        </Grid>
                        <Grid size={{ xs: 6 }}>
                            <TextField
                                label="Service"
                                fullWidth
                                value={formData.service || ''}
                                onChange={(e) => handleChange('service', e.target.value)}
                            />
                        </Grid>
                        <Grid size={{ xs: 6 }}>
                            <TextField
                                select
                                label="Status"
                                fullWidth
                                value={formData.status || 'new'}
                                onChange={(e) => handleChange('status', e.target.value)}
                            >
                                {STATUS_OPTIONS.map((option) => (
                                    <MenuItem key={option.value} value={option.value}>
                                        {option.label}
                                    </MenuItem>
                                ))}
                            </TextField>
                        </Grid>
                        <Grid size={{ xs: 6 }}>
                            <TextField
                                select
                                label="Priority"
                                fullWidth
                                value={formData.priority || 'medium'}
                                onChange={(e) => handleChange('priority', e.target.value)}
                            >
                                <MenuItem value="low">Low</MenuItem>
                                <MenuItem value="medium">Medium</MenuItem>
                                <MenuItem value="high">High</MenuItem>
                            </TextField>
                        </Grid>
                        <Grid size={{ xs: 6 }}>
                            <TextField
                                label="Tags (comma separated)"
                                fullWidth
                                value={tagsInput}
                                onChange={(e) => {
                                    setTagsInput(e.target.value);
                                    handleChange('tags', e.target.value.split(',').map(t => t.trim()).filter(Boolean));
                                }}
                            />
                        </Grid>
                        <Grid size={{ xs: 12 }}>
                            <TextField
                                label="Estimated Value ($)"
                                type="number"
                                fullWidth
                                value={formData.value || ''}
                                onChange={(e) => handleChange('value', Number(e.target.value))}
                                InputProps={{ startAdornment: <Typography sx={{ mr: 1 }}>$</Typography> }}
                            />
                        </Grid>
                        <Grid size={{ xs: 12 }}>
                            <TextField
                                label="Source"
                                fullWidth
                                value={lead.source || 'Unknown'}
                                InputProps={{
                                    readOnly: true,
                                }}
                                helperText="Origin of the lead (e.g., Landing Page)"
                            />
                        </Grid>
                    </Grid>

                    <Divider sx={{ my: 3 }} />

                    <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                        Notes
                    </Typography>

                    <Box display="flex" gap={1} mb={2}>
                        <TextField
                            label="Add a note..."
                            fullWidth
                            size="small"
                            value={newNote}
                            onChange={(e) => setNewNote(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddNote())}
                        />
                        <Button variant="contained" onClick={handleAddNote} disabled={!newNote.trim()}>
                            Add
                        </Button>
                    </Box>

                    <List sx={{ maxHeight: 200, overflow: 'auto', bgcolor: '#f9fafb', borderRadius: 1 }}>
                        {lead.notes && lead.notes.length > 0 ? (
                            [...lead.notes].toReversed().map((note, index) => (
                                <ListItem key={index} alignItems="flex-start" sx={{ py: 1 }}>
                                    <ListItemText
                                        primary={note.text}
                                        secondary={new Date(note.date.seconds * 1000).toLocaleString()}
                                        primaryTypographyProps={{ variant: 'body2' }}
                                        secondaryTypographyProps={{ variant: 'caption' }}
                                    />
                                </ListItem>
                            ))
                        ) : (
                            <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
                                No notes yet.
                            </Typography>
                        )}
                    </List>
                </Box>
            </DialogContent>
            <DialogActions sx={{ p: 2 }}>
                <Button onClick={onClose}>Cancel</Button>
                <Button onClick={handleSave} variant="contained" disabled={saving}>
                    {saving ? 'Saving...' : 'Save Changes'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

// Helper for Grid item since we are not in the main file where Grid is imported


export default LeadDetailsDialog;
