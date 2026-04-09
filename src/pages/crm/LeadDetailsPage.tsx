import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    Box, Container, Grid, Paper, Typography, TextField, Button,
    MenuItem, Chip, Divider, List, ListItem, ListItemText,
    IconButton, Tabs, Tab, Checkbox, FormControlLabel, FormGroup,
    CircularProgress
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SendIcon from '@mui/icons-material/Send';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import TelegramIcon from '@mui/icons-material/Telegram';
import EmailIcon from '@mui/icons-material/Email';
import PhoneIcon from '@mui/icons-material/Phone';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { doc, getDoc, updateDoc, Timestamp, collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../firebase/firebase';
import { errorMessage } from '../../utils/errorMessage';

interface Lead {
    id: string;
    name: string;
    phone: string;
    email?: string;
    service: string;
    status: string;
    source?: string;
    value?: number;
    notes?: { text: string; date: Timestamp }[];
    createdAt: Timestamp;
    aiAnalysis?: {
        type?: string;
        category?: string;
        priority?: string;
        recommendations?: string;
    };
    telegramChatId?: string;
}

interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Timestamp;
    channel: 'whatsapp' | 'telegram' | 'email';
}

const LeadDetailsPage: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [lead, setLead] = useState<Lead | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Communication State
    const [activeTab, setActiveTab] = useState(0); // 0: All, 1: WA, 2: TG, 3: Email
    const [messages, setMessages] = useState<Message[]>([]);
    const [newMessage, setNewMessage] = useState('');
    const [sendChannels, setSendChannels] = useState({
        whatsapp: true,
        telegram: false,
        email: false
    });

    // Form State (Lead Info)
    const [formData, setFormData] = useState<Partial<Lead>>({});

    useEffect(() => {
        const fetchLead = async () => {
            if (!id) return;
            try {
                const docRef = doc(db, 'leads', id);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    const data = { id: docSnap.id, ...docSnap.data() } as Lead;
                    setLead(data);
                    setFormData(data);
                } else {
                    alert('Lead not found');
                    navigate('/crm/deals');
                }
            } catch (error) {
                console.error("Error fetching lead:", error);
            } finally {
                setLoading(false);
            }
        };
        fetchLead();
    }, [id, navigate]);

    // Real-time Chat Listener
    useEffect(() => {
        if (!lead) return;

        // Determine Chat ID based on active tab
        // Tab 0 (All) is tricky, so let's focus on specific channels first or aggregate
        // For simplicity: If Tab 1 (WA), listen to wa_{phone}
        // If Tab 2 (TG), listen to tg_{chatId} (if we had it)
        // If Tab 3 (Email), listen to email_{email}

        // Strategy: Listen to ALL relevant collections and merge? 
        // Or just listen to the one active tab? Let's do active tab for efficiency.

        let _collectionRef = null;
        let chatId = '';

        if (activeTab === 1 && lead.phone) {
            chatId = `wa_${lead.phone.replace(/\D/g, '')}`;
        } else if (activeTab === 2 && lead.telegramChatId) {
            chatId = `tg_${lead.telegramChatId}`;
        } else if (activeTab === 3 && lead.email) {
            chatId = `email_${lead.email}`;
        }

        if (chatId) {
            const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('timestamp', 'asc'));
            const unsubscribe = onSnapshot(q, (snapshot) => {
                const msgs = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                })) as Message[];
                setMessages(msgs);
            }, (err) => {
                console.log("No chat history found or error:", err);
                setMessages([]); // Clear if no chat exists yet
            });
            return () => unsubscribe();
        } else {
            setMessages([]);
        }

    }, [lead, activeTab]);

    const handleSaveInfo = async () => {
        if (!id) return;
        setSaving(true);
        try {
            await updateDoc(doc(db, 'leads', id), formData);
            setLead({ ...lead, ...formData } as Lead); // Update local state immediately
            alert('Saved successfully');
        } catch (error) {
            console.error("Error updating lead:", error);
            alert("Failed to save");
        } finally {
            setSaving(false);
        }
    };

    const handleSendMessage = async () => {
        if (!newMessage.trim() || !lead) return;

        // Optimistic UI update is hard with real streams, so we rely on the stream
        // But we can show a loading state

        try {
            const sendMessageFn = httpsCallable(functions, 'sendMessage');
            await sendMessageFn({
                leadId: lead.id,
                message: newMessage,
                channels: sendChannels
            });
            setNewMessage('');
        } catch (error: unknown) {
            console.error("Error sending message:", error);
            alert(`Failed to send message: ${errorMessage(error) || 'Unknown error'}`);
        }
    };

    const handleGenerateSummary = async () => {
        if (!lead) return;
        try {
            const generateSummaryFn = httpsCallable(functions, 'generateLeadSummary');
            await generateSummaryFn({ leadId: lead.id });
            // The document update will trigger a re-render via fetchLead if we were listening
            // But we are not listening to the lead doc in real-time, only fetching once.
            // Let's re-fetch or just alert for now. Ideally, listen to lead doc too.
            alert("AI Analysis Requested. Refreshing...");
            window.location.reload();
        } catch (error) {
            console.error("Error generating summary:", error);
            alert("Failed to generate summary");
        }
    };

    if (loading) return <Box display="flex" justifyContent="center" mt={4}><CircularProgress /></Box>;
    if (!lead) return null;

    return (
        <Container maxWidth="xl" sx={{ py: 4, height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
            {/* Header */}
            <Box display="flex" alignItems="center" mb={3}>
                <IconButton onClick={() => navigate('/crm/deals')} sx={{ mr: 2 }}>
                    <ArrowBackIcon />
                </IconButton>
                <Typography variant="h4" fontWeight="bold">
                    {lead.name}
                </Typography>
                <Chip
                    label={lead.status}
                    color={lead.status === 'new' ? 'primary' : 'default'}
                    sx={{ ml: 2, textTransform: 'uppercase', fontWeight: 'bold' }}
                />
            </Box>

            <Grid container spacing={3} sx={{ height: '100%' }}>
                {/* Left Column: Lead Info */}
                <Grid size={{ xs: 12, md: 4 }} sx={{ height: '100%', overflowY: 'auto' }}>
                    <Paper elevation={0} sx={{ p: 3, borderRadius: 2, border: '1px solid #e5e7eb' }}>
                        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                            <Typography variant="h6" fontWeight="bold">Lead Information</Typography>
                            <Chip label={lead.status} color={lead.status === 'new' ? 'primary' : 'default'} sx={{ textTransform: 'uppercase', fontWeight: 'bold' }} />
                        </Box>

                        {/* AI Analysis Card */}
                        {lead.aiAnalysis && (
                            <Paper variant="outlined" sx={{ p: 2, mb: 3, bgcolor: '#f0f7ff', borderColor: '#cce5ff' }}>
                                <Box display="flex" alignItems="center" gap={1} mb={1}>
                                    <AutoAwesomeIcon color="primary" fontSize="small" />
                                    <Typography variant="subtitle2" color="primary" fontWeight="bold">AI Insight</Typography>
                                </Box>
                                <Typography variant="body2" paragraph>
                                    <strong>Priority:</strong> {lead.aiAnalysis.priority || 'N/A'}
                                </Typography>
                                <Typography variant="body2">
                                    {lead.aiAnalysis.recommendations}
                                </Typography>
                            </Paper>
                        )}

                        <Box component="form" display="flex" flexDirection="column" gap={2} mt={2}>
                            <TextField
                                label="Name"
                                value={formData.name || ''}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                fullWidth
                                size="small"
                            />
                            <TextField
                                label="Phone"
                                value={formData.phone || ''}
                                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                fullWidth
                                size="small"
                                InputProps={{
                                    endAdornment: <IconButton size="small" href={`tel:${formData.phone}`}><PhoneIcon /></IconButton>
                                }}
                            />
                            <TextField
                                label="Email"
                                value={formData.email || ''}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                fullWidth
                                size="small"
                                InputProps={{
                                    endAdornment: <IconButton size="small" href={`mailto:${formData.email}`}><EmailIcon /></IconButton>
                                }}
                            />
                            <TextField
                                label="Service"
                                value={formData.service || ''}
                                onChange={(e) => setFormData({ ...formData, service: e.target.value })}
                                fullWidth
                                size="small"
                            />
                            <TextField
                                select
                                label="Status"
                                value={formData.status || 'new'}
                                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                                fullWidth
                            >
                                <MenuItem value="new">New Lead</MenuItem>
                                <MenuItem value="contacted">Contacted</MenuItem>
                                <MenuItem value="quote_sent">Quote Sent</MenuItem>
                                <MenuItem value="won">Won</MenuItem>
                                <MenuItem value="lost">Lost</MenuItem>
                            </TextField>
                            <TextField
                                label="Source"
                                value={formData.source || 'Unknown'}
                                fullWidth
                                InputProps={{ readOnly: true }}
                                disabled
                                size="small"
                            />
                            <TextField
                                label="Value ($)"
                                type="number"
                                value={formData.value || 0}
                                onChange={(e) => setFormData({ ...formData, value: Number(e.target.value) })}
                                fullWidth
                                size="small"
                            />
                            <TextField
                                label="Telegram Chat ID"
                                value={formData.telegramChatId || ''}
                                onChange={(e) => setFormData({ ...formData, telegramChatId: e.target.value })}
                                fullWidth
                                size="small"
                                helperText="Required for Telegram messaging. Ask user to message bot."
                            />

                            <Button
                                variant="contained"
                                onClick={handleSaveInfo}
                                disabled={saving}
                                sx={{ mt: 2 }}
                            >
                                {saving ? 'Saving...' : 'Save Changes'}
                            </Button>
                        </Box>

                        <Divider sx={{ my: 3 }} />

                        <Typography variant="h6" gutterBottom fontWeight="bold">Notes</Typography>
                        <List sx={{ bgcolor: '#f9fafb', borderRadius: 1, maxHeight: 300, overflow: 'auto' }}>
                            {lead.notes?.map((note, idx) => (
                                <ListItem key={idx} alignItems="flex-start">
                                    <ListItemText
                                        primary={note.text}
                                        secondary={new Date(note.date.seconds * 1000).toLocaleString()}
                                    />
                                </ListItem>
                            ))}
                            {!lead.notes?.length && <Typography p={2} color="text.secondary">No notes yet.</Typography>}
                        </List>
                    </Paper>
                </Grid>

                {/* Right Column: Communication Hub */}
                <Grid size={{ xs: 12, md: 8 }} sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <Paper elevation={0} sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', borderRadius: 2, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                        {/* Tabs */}
                        <Box borderBottom={1} borderColor="divider">
                            <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} textColor="primary" indicatorColor="primary">
                                <Tab label="All History" />
                                <Tab icon={<WhatsAppIcon />} iconPosition="start" label="WhatsApp" />
                                <Tab icon={<TelegramIcon />} iconPosition="start" label="Telegram" />
                                <Tab icon={<EmailIcon />} iconPosition="start" label="Email" />
                            </Tabs>
                            {activeTab === 2 && (
                                <Box sx={{ ml: 'auto', mr: 2, my: 'auto', display: 'flex', gap: 1 }}>
                                    <Button
                                        size="small"
                                        variant="outlined"
                                        onClick={() => {
                                            const link = `https://t.me/Garkor_bot?start=${lead.id}`;
                                            navigator.clipboard.writeText(link);
                                            alert('Invite link copied!');
                                        }}
                                    >
                                        Copy Invite Link
                                    </Button>
                                    {lead.phone && (
                                        <Button
                                            size="small"
                                            href={`tg://resolve?phone=${lead.phone.replace(/\D/g, '')}`}
                                            target="_blank"
                                        >
                                            Open App
                                        </Button>
                                    )}
                                </Box>
                            )}
                        </Box>

                        {/* Messages Area */}
                        <Box sx={{ flexGrow: 1, p: 3, overflowY: 'auto', bgcolor: '#f8fafc' }}>
                            {messages.map((msg) => (
                                <Box
                                    key={msg.id}
                                    display="flex"
                                    justifyContent={msg.role === 'user' ? 'flex-start' : 'flex-end'}
                                    mb={2}
                                >
                                    <Box
                                        sx={{
                                            maxWidth: '70%',
                                            p: 2,
                                            borderRadius: 2,
                                            bgcolor: msg.role === 'user' ? 'white' : '#eff6ff',
                                            border: '1px solid',
                                            borderColor: msg.role === 'user' ? '#e5e7eb' : '#bfdbfe',
                                            boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                        }}
                                    >
                                        <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                                            {msg.channel === 'whatsapp' && <WhatsAppIcon fontSize="small" color="success" />}
                                            {msg.channel === 'telegram' && <TelegramIcon fontSize="small" color="primary" />}
                                            {msg.channel === 'email' && <EmailIcon fontSize="small" color="action" />}
                                            <Typography variant="caption" color="text.secondary" fontWeight="bold">
                                                {msg.role === 'user' ? lead.name : 'You'}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {new Date(msg.timestamp.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </Typography>
                                        </Box>
                                        <Typography variant="body1">{msg.content}</Typography>
                                    </Box>
                                </Box>
                            ))}
                            {messages.length === 0 && (
                                <Box textAlign="center" mt={4} color="text.secondary">
                                    <Typography variant="body2">No messages yet.</Typography>
                                    <Typography variant="caption" display="block" mt={1}>
                                        Listening to: {activeTab === 1 ? `wa_${lead.phone?.replace(/\D/g, '')}` :
                                            activeTab === 2 ? `tg_${lead.telegramChatId || 'missing_id'}` :
                                                activeTab === 3 ? `email_${lead.email}` : 'all'}
                                    </Typography>
                                </Box>
                            )}
                        </Box>

                        {/* Compose Area */}
                        <Box p={2} bgcolor="white" borderTop="1px solid #e5e7eb">
                            <FormGroup row sx={{ mb: 1, ml: 1 }}>
                                <Typography variant="caption" sx={{ mr: 2, alignSelf: 'center', fontWeight: 'bold', color: 'text.secondary' }}>SEND VIA:</Typography>
                                <FormControlLabel
                                    control={<Checkbox checked={sendChannels.whatsapp} onChange={(e) => setSendChannels({ ...sendChannels, whatsapp: e.target.checked })} size="small" color="success" />}
                                    label="WhatsApp"
                                />
                                <FormControlLabel
                                    control={<Checkbox checked={sendChannels.telegram} onChange={(e) => setSendChannels({ ...sendChannels, telegram: e.target.checked })} size="small" color="primary" />}
                                    label="Telegram"
                                />
                                <FormControlLabel
                                    control={<Checkbox checked={sendChannels.email} onChange={(e) => setSendChannels({ ...sendChannels, email: e.target.checked })} size="small" color="default" />}
                                    label="Email"
                                />
                            </FormGroup>

                            <Box display="flex" gap={2}>
                                <TextField
                                    fullWidth
                                    multiline
                                    maxRows={4}
                                    placeholder="Type your message..."
                                    value={newMessage}
                                    onChange={(e) => setNewMessage(e.target.value)}
                                    size="small"
                                />
                                <Button
                                    variant="contained"
                                    endIcon={<SendIcon />}
                                    onClick={handleSendMessage}
                                    disabled={!newMessage.trim() || (!sendChannels.whatsapp && !sendChannels.telegram && !sendChannels.email)}
                                >
                                    Send
                                </Button>
                            </Box>
                            <Box p={2} display="flex" justifyContent="flex-end">
                                <Button
                                    startIcon={<AutoAwesomeIcon />}
                                    size="small"
                                    onClick={handleGenerateSummary}
                                >
                                    Generate AI Summary
                                </Button>
                            </Box>
                        </Box>
                    </Paper>
                </Grid>
            </Grid>
        </Container>
    );
};

export default LeadDetailsPage;
