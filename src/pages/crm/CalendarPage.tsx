import React, { useState, useEffect, useMemo } from 'react';
import { Box, Container, Typography, Paper, Grid, IconButton, Button, Tooltip, Chip, CircularProgress } from '@mui/material';
import { collection, query, where, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, format, isSameMonth, isSameDay, addMonths, subMonths, parseISO } from 'date-fns';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TodayIcon from '@mui/icons-material/Today';
import RefreshIcon from '@mui/icons-material/Refresh';
import LeadDetailsDialog from '../../components/crm/LeadDetailsDialog';

// Interface matching the one in DealsPage
interface Lead {
    id: string;
    name: string;
    phone: string;
    service: string;
    status: 'new' | 'contacted' | 'quote_sent' | 'won' | 'lost';
    createdAt: Timestamp;
    preferred_date?: string; // YYYY-MM-DD
    preferred_time?: string; // HH:MM
    notes?: { text: string; date: Timestamp }[];
    email?: string;
    value?: number;
    source?: string;
    briefing?: string;
    aiAnalysis?: any;
}

const CalendarPage: React.FC = () => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [leads, setLeads] = useState<Lead[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
    const [isDialogOpen, setIsDialogOpen] = useState(false);

    // Fetch leads with preferred_date
    useEffect(() => {
        const q = query(collection(db, 'leads'), where('preferred_date', '!=', null));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const leadsData = snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
            })) as Lead[];
            setLeads(leadsData);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching calendar leads:", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    // Generate calendar days
    const calendarDays = useMemo(() => {
        const monthStart = startOfMonth(currentDate);
        const monthEnd = endOfMonth(monthStart);
        const startDate = startOfWeek(monthStart);
        const endDate = endOfWeek(monthEnd);

        return eachDayOfInterval({
            start: startDate,
            end: endDate,
        });
    }, [currentDate]);

    const handlePrevMonth = () => setCurrentDate(subMonths(currentDate, 1));
    const handleNextMonth = () => setCurrentDate(addMonths(currentDate, 1));
    const handleToday = () => setCurrentDate(new Date());

    const handleLeadClick = (lead: Lead) => {
        setSelectedLead(lead);
        setIsDialogOpen(true);
    };

    const getLeadsForDay = (day: Date) => {
        const dateStr = format(day, 'yyyy-MM-dd');
        return leads.filter(lead => lead.preferred_date === dateStr);
    };

    return (
        <Container maxWidth="xl" sx={{ py: 4, height: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Box display="flex" alignItems="center" gap={2}>
                    <Typography variant="h4" fontWeight="bold">
                        Call Calendar
                    </Typography>
                    <Chip label={`${leads.length} Scheduled`} color="primary" size="small" />
                </Box>

                <Box display="flex" alignItems="center" gap={1}>
                    <Button variant="outlined" startIcon={<TodayIcon />} onClick={handleToday}>
                        Today
                    </Button>
                    <Box display="flex" alignItems="center" bgcolor="white" borderRadius={1} border="1px solid #e5e7eb">
                        <IconButton onClick={handlePrevMonth}>
                            <ChevronLeftIcon />
                        </IconButton>
                        <Typography variant="h6" sx={{ px: 2, minWidth: 150, textAlign: 'center' }}>
                            {format(currentDate, 'MMMM yyyy')}
                        </Typography>
                        <IconButton onClick={handleNextMonth}>
                            <ChevronRightIcon />
                        </IconButton>
                    </Box>
                    <IconButton onClick={() => setLoading(true)} disabled={loading}>
                        <RefreshIcon />
                    </IconButton>
                </Box>
            </Box>

            {/* Calendar Grid */}
            <Paper elevation={0} sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', border: '1px solid #e5e7eb', borderRadius: 2, overflow: 'hidden' }}>
                {/* Weekday Headers */}
                <Box display="grid" gridTemplateColumns="repeat(7, 1fr)" bgcolor="#f9fafb" borderBottom="1px solid #e5e7eb">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                        <Box key={day} p={2} textAlign="center">
                            <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">
                                {day}
                            </Typography>
                        </Box>
                    ))}
                </Box>

                {/* Days */}
                <Box display="grid" gridTemplateColumns="repeat(7, 1fr)" flexGrow={1} sx={{ overflowY: 'auto' }}>
                    {calendarDays.map((day, index) => {
                        const dayLeads = getLeadsForDay(day);
                        const isCurrentMonth = isSameMonth(day, currentDate);
                        const isToday = isSameDay(day, new Date());

                        return (
                            <Box
                                key={day.toISOString()}
                                sx={{
                                    borderRight: (index + 1) % 7 === 0 ? 'none' : '1px solid #e5e7eb',
                                    borderBottom: '1px solid #e5e7eb',
                                    bgcolor: isCurrentMonth ? 'white' : '#f9fafb',
                                    minHeight: 120,
                                    p: 1,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 0.5
                                }}
                            >
                                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                                    <Typography
                                        variant="body2"
                                        sx={{
                                            fontWeight: isToday ? 'bold' : 'normal',
                                            color: isToday ? 'white' : (isCurrentMonth ? 'text.primary' : 'text.disabled'),
                                            bgcolor: isToday ? 'primary.main' : 'transparent',
                                            width: 24,
                                            height: 24,
                                            borderRadius: '50%',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center'
                                        }}
                                    >
                                        {format(day, 'd')}
                                    </Typography>
                                </Box>

                                {dayLeads.map(lead => (
                                    <Tooltip key={lead.id} title={`${lead.name} - ${lead.service}`}>
                                        <Box
                                            onClick={() => handleLeadClick(lead)}
                                            sx={{
                                                p: 0.5,
                                                px: 1,
                                                borderRadius: 1,
                                                bgcolor: lead.status === 'new' ? '#eff6ff' : '#f3f4f6',
                                                border: '1px solid',
                                                borderColor: lead.status === 'new' ? '#bfdbfe' : '#e5e7eb',
                                                cursor: 'pointer',
                                                '&:hover': { bgcolor: '#dbeafe' },
                                                fontSize: '0.75rem',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 0.5
                                            }}
                                        >
                                            <Box
                                                sx={{
                                                    width: 6,
                                                    height: 6,
                                                    borderRadius: '50%',
                                                    bgcolor: lead.preferred_time ? '#10b981' : '#9ca3af'
                                                }}
                                            />
                                            <Typography variant="caption" noWrap fontWeight="medium">
                                                {lead.preferred_time || 'Anytime'} - {lead.name}
                                            </Typography>
                                        </Box>
                                    </Tooltip>
                                ))}
                            </Box>
                        );
                    })}
                </Box>
            </Paper>

            <LeadDetailsDialog
                open={isDialogOpen}
                onClose={() => setIsDialogOpen(false)}
                lead={selectedLead}
            />
        </Container>
    );
};

export default CalendarPage;
