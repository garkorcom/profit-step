import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, Paper, Grid, Chip, Card, CardContent, IconButton, Container, TextField, MenuItem, InputAdornment, Button, Tooltip, Avatar } from '@mui/material';
import { collection, query, orderBy, onSnapshot, Timestamp, doc, updateDoc, deleteDoc, addDoc, where, getDocs, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import RefreshIcon from '@mui/icons-material/Refresh';
import PhoneIcon from '@mui/icons-material/Phone';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import SearchIcon from '@mui/icons-material/Search';
import FilterListIcon from '@mui/icons-material/FilterList';
import SortIcon from '@mui/icons-material/Sort';
import CallIcon from '@mui/icons-material/Call';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import DeleteIcon from '@mui/icons-material/Delete';
import InboxIcon from '@mui/icons-material/Inbox';
import { DndContext, DragEndEvent, useDraggable, useDroppable, DragOverlay, closestCorners, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import LeadDetailsDialog from '../../components/crm/LeadDetailsDialog';

// Define Lead interface based on landing page form data
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
    tags?: string[];
    priority?: 'low' | 'medium' | 'high';
}

const COLUMNS = [
    { id: 'new', label: 'New Lead', color: '#3b82f6' }, // Blue
    { id: 'contacted', label: 'Contacted', color: '#f59e0b' }, // Amber
    { id: 'quote_sent', label: 'Quote Sent', color: '#8b5cf6' }, // Purple
    { id: 'won', label: 'Won', color: '#10b981' }, // Green
    { id: 'lost', label: 'Lost', color: '#ef4444' }, // Red
];

// --- Draggable Lead Card Component ---
const DraggableLeadCard = ({ lead, columnColor, onClick, onDelete }: { lead: Lead, columnColor: string, onClick: (lead: Lead) => void, onDelete: (id: string) => void }) => {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: lead.id,
        data: { lead } // Pass lead data for DragOverlay
    });

    const style = {
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.5 : 1,
        cursor: 'grab',
        touchAction: 'none', // Required for PointerSensor
    };

    return (
        <div ref={setNodeRef} style={style} {...listeners} {...attributes} onClick={() => onClick(lead)}>
            <LeadCardContent lead={lead} columnColor={columnColor} onDelete={onDelete} />
        </div>
    );
};

// --- Lead Card Content (Reusable for DragOverlay) ---
const LeadCardContent = ({ lead, columnColor, onDelete }: { lead: Lead, columnColor: string, onDelete?: (id: string) => void }) => {
    const formatDate = (timestamp: Timestamp) => {
        if (!timestamp) return '';
        return new Date(timestamp.seconds * 1000).toLocaleDateString();
    };

    const handleAction = (e: React.MouseEvent, action: () => void) => {
        e.stopPropagation(); // Prevent card click
        action();
    };

    // Urgency Logic: If status is 'new' and created > 24 hours ago
    const isUrgent = lead.status === 'new' && lead.createdAt && (Date.now() - lead.createdAt.seconds * 1000) > 24 * 60 * 60 * 1000;
    const isHighPriority = lead.priority === 'high';

    // Initials
    const initials = lead.name
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);

    return (
        <Card sx={{
            mb: 2,
            boxShadow: 1,
            '&:hover': { boxShadow: 3 },
            transition: '0.2s',
            bgcolor: 'white',
            position: 'relative',
            borderLeft: isUrgent || isHighPriority ? '4px solid #ef4444' : 'none'
        }}>
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Box display="flex" justifyContent="space-between" alignItems="start" mb={1}>
                    <Box display="flex" alignItems="center" gap={1}>
                        <Avatar sx={{ width: 24, height: 24, fontSize: '0.75rem', bgcolor: columnColor }}>{initials}</Avatar>
                        <Typography variant="subtitle2" fontWeight="bold">
                            {lead.name}
                        </Typography>
                    </Box>
                    {lead.value && lead.value > 0 && (
                        <Typography variant="caption" sx={{ color: 'success.main', fontWeight: 'bold' }}>
                            ${lead.value.toLocaleString()}
                        </Typography>
                    )}
                </Box>

                <Box display="flex" gap={0.5} flexWrap="wrap" mb={1.5}>
                    {lead.priority && (
                        <Chip
                            label={lead.priority.toUpperCase()}
                            size="small"
                            sx={{
                                bgcolor: lead.priority === 'high' ? '#fee2e2' : lead.priority === 'medium' ? '#fef3c7' : '#e0f2fe',
                                color: lead.priority === 'high' ? '#991b1b' : lead.priority === 'medium' ? '#92400e' : '#075985',
                                fontWeight: 'bold',
                                fontSize: '0.65rem',
                                height: 20
                            }}
                        />
                    )}
                    <Chip
                        label={lead.service}
                        size="small"
                        sx={{
                            bgcolor: columnColor + '20',
                            color: columnColor,
                            fontWeight: 500,
                            fontSize: '0.75rem'
                        }}
                    />
                    {lead.source && (
                        <Chip
                            label={lead.source.replace('landing_page_', '').replace('_', ' ')}
                            size="small"
                            variant="outlined"
                            sx={{
                                borderColor: '#e5e7eb',
                                color: 'text.secondary',
                                fontSize: '0.70rem',
                                height: 24
                            }}
                        />
                    )}
                    {lead.tags && lead.tags.map(tag => (
                        <Chip
                            key={tag}
                            label={tag}
                            size="small"
                            sx={{
                                bgcolor: '#f3f4f6',
                                color: '#4b5563',
                                fontSize: '0.70rem',
                                height: 24
                            }}
                        />
                    ))}
                </Box>

                <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                    <PhoneIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                    <Typography variant="caption" color="text.secondary">
                        {lead.phone}
                    </Typography>
                </Box>

                <Box display="flex" alignItems="center" gap={1} mb={1.5}>
                    <AccessTimeIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                    <Typography variant="caption" color="text.secondary">
                        {formatDate(lead.createdAt)}
                        {isUrgent && <span style={{ color: '#ef4444', fontWeight: 'bold', marginLeft: 4 }}>(Urgent)</span>}
                    </Typography>
                </Box>

                <Box display="flex" gap={1} mt={1} pt={1} borderTop="1px solid #f3f4f6">
                    <Tooltip title="Call">
                        <IconButton
                            size="small"
                            color="primary"
                            onClick={(e) => handleAction(e, () => window.open(`tel:${lead.phone} `, '_self'))}
                        >
                            <CallIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="WhatsApp">
                        <IconButton
                            size="small"
                            color="success"
                            onClick={(e) => handleAction(e, () => window.open(`https://wa.me/${lead.phone.replace(/\D/g, '')}`, '_blank'))}
                        >
                            <WhatsAppIcon fontSize="small" />
                        </IconButton >
                    </Tooltip >
                    <Box flexGrow={1} />
                    {
                        onDelete && (
                            <Tooltip title="Delete">
                                <IconButton
                                    size="small"
                                    color="error"
                                    onClick={(e) => handleAction(e, () => {
                                        if (window.confirm('Are you sure you want to delete this lead?')) {
                                            onDelete(lead.id);
                                        }
                                    })}
                                >
                                    <DeleteIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        )
                    }
                </Box >
            </CardContent >
        </Card >
    );
};

// --- Droppable Column Component ---
const DroppableColumn = ({ column, leads, children }: { column: typeof COLUMNS[0], leads: Lead[], children: React.ReactNode }) => {
    const { setNodeRef, isOver } = useDroppable({
        id: column.id,
    });

    return (
        <Grid size={{ xs: 12, sm: 6, md: 2.4 }} sx={{ minWidth: 300, height: '100%' }}>
            <Paper
                ref={setNodeRef}
                elevation={0}
                sx={{
                    height: '100%',
                    bgcolor: isOver ? '#e5e7eb' : '#f3f4f6', // Highlight on drag over
                    p: 2,
                    display: 'flex',
                    flexDirection: 'column',
                    borderRadius: 2,
                    transition: 'background-color 0.2s'
                }}
            >
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                    <Typography variant="subtitle1" fontWeight="bold" sx={{ color: '#374151' }}>
                        {column.label}
                    </Typography>
                    <Chip
                        label={leads.length}
                        size="small"
                        sx={{ bgcolor: 'white', fontWeight: 'bold' }}
                    />
                </Box>

                <Box sx={{ flexGrow: 1, overflowY: 'auto', pr: 1, minHeight: 100 }}>
                    {children}
                    {leads.length === 0 && (
                        <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" height="100%" mt={4} color="text.secondary" sx={{ opacity: 0.5 }}>
                            <InboxIcon sx={{ fontSize: 40, mb: 1 }} />
                            <Typography variant="body2" fontStyle="italic">
                                No leads
                            </Typography>
                        </Box>
                    )}
                </Box>
            </Paper>
        </Grid>
    );
};

const DealsPage: React.FC = () => {
    const [leads, setLeads] = useState<Lead[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeDragLead, setActiveDragLead] = useState<Lead | null>(null);
    const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
    const [isDialogOpen, setIsDialogOpen] = useState(false);

    // Filter & Sort State
    const [searchQuery, setSearchQuery] = useState('');
    const [serviceFilter, setServiceFilter] = useState('all');
    const [sourceFilter, setSourceFilter] = useState('all');
    const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

    // Sensors for drag detection (Pointer works for mouse and touch)
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 5, // Drag starts after moving 5px
            },
        })
    );

    useEffect(() => {
        const q = query(collection(db, 'leads'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const leadsData = snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
            })) as Lead[];
            setLeads(leadsData);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching leads:", error);
            setLoading(false);
            // You might want to add a state for error to display it
            alert("Error fetching leads: " + error.message);
        });

        return () => unsubscribe();
    }, []);

    // Derived state for filtered leads
    const filteredLeads = useMemo(() => {
        let result = leads;

        // Search
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            result = result.filter(lead =>
                lead.name.toLowerCase().includes(query) ||
                lead.phone.includes(query)
            );
        }

        // Filter by Service
        if (serviceFilter !== 'all') {
            result = result.filter(lead => lead.service === serviceFilter);
        }

        // Filter by Source
        if (sourceFilter !== 'all') {
            if (sourceFilter === 'manual') {
                result = result.filter(lead => !lead.source || (!lead.source.startsWith('landing_page')));
            } else {
                result = result.filter(lead => lead.source === sourceFilter);
            }
        }

        // Sort
        result = [...result].sort((a, b) => {
            const dateA = a.createdAt?.seconds || 0;
            const dateB = b.createdAt?.seconds || 0;
            return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
        });

        return result;
    }, [leads, searchQuery, serviceFilter, sourceFilter, sortOrder]);

    // Get unique services for filter dropdown
    const services = useMemo(() => {
        const unique = new Set(leads.map(l => l.service));
        return Array.from(unique);
    }, [leads]);

    const handleDragStart = (event: any) => {
        const { active } = event;
        const lead = leads.find(l => l.id === active.id);
        if (lead) setActiveDragLead(lead);
    };

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;
        setActiveDragLead(null);

        if (!over) return;

        const leadId = active.id as string;
        const newStatus = over.id as string;
        const lead = leads.find(l => l.id === leadId);

        if (lead && lead.status !== newStatus) {
            // Optimistic Update
            const oldStatus = lead.status;
            setLeads(prev => prev.map(l =>
                l.id === leadId ? { ...l, status: newStatus as any } : l
            ));


            try {
                await updateDoc(doc(db, 'leads', leadId), {
                    status: newStatus
                });

                // AUTOMATION: Create Project if Won
                if (newStatus === 'won' && oldStatus !== 'won') {
                    const projectsRef = collection(db, 'projects');
                    // Check availability to avoid duplicates
                    const q = query(projectsRef, where('leadId', '==', leadId));
                    const snapshot = await getDocs(q);

                    if (snapshot.empty) {
                        await addDoc(projectsRef, {
                            name: lead.name + ' Project',
                            clientName: lead.name,
                            clientId: lead.id,
                            leadId: lead.id,
                            status: 'active',
                            createdAt: serverTimestamp(),
                            budget: lead.value || 0,
                            description: `Generated from lead: ${lead.service}`
                        });
                        alert(`🚀 Project created for ${lead.name}!`);
                    }
                }

            } catch (error) {
                console.error("Error updating status:", error);
                // Revert on error
                setLeads(prev => prev.map(l =>
                    l.id === leadId ? { ...l, status: oldStatus } : l
                ));
                alert("Failed to update lead status.");
            }
        }
    };

    const navigate = useNavigate(); // Add hook

    const handleLeadClick = (lead: Lead) => {
        navigate(`/crm/leads/${lead.id}`);
    };

    const handleDialogClose = () => {
        setIsDialogOpen(false);
        setSelectedLead(null);
    };

    const handleDeleteLead = async (leadId: string) => {
        try {
            await deleteDoc(doc(db, 'leads', leadId));
        } catch (error) {
            console.error("Error deleting lead:", error);
            alert("Failed to delete lead.");
        }
    };

    return (
        <Container maxWidth="xl" sx={{ py: 4, height: 'calc(100vh - 64px)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h4" component="h1" fontWeight="bold">
                    Sales Funnel
                </Typography>
                <Box>
                    <IconButton onClick={async () => {
                        try {
                            await import('firebase/firestore').then(({ addDoc, collection, serverTimestamp }) => {
                                addDoc(collection(db, 'leads'), {
                                    name: "Test Lead " + new Date().toLocaleTimeString(),
                                    phone: "555-0000",
                                    service: "Test Service",
                                    status: 'new',
                                    createdAt: serverTimestamp(),
                                    source: 'manual_test'
                                });
                            });
                        } catch (e) {
                            alert("Error creating lead: " + e);
                        }
                    }} sx={{ mr: 1 }}>
                        <Typography variant="caption" sx={{ mr: 1 }}>Test Lead</Typography>
                        <AccessTimeIcon />
                    </IconButton>
                    <IconButton onClick={() => setLoading(true)} disabled={loading}>
                        <RefreshIcon />
                    </IconButton>
                </Box>
            </Box>

            {/* Toolbar */}
            <Paper elevation={0} sx={{ p: 2, mb: 2, bgcolor: 'white', borderRadius: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                <TextField
                    placeholder="Search leads..."
                    size="small"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start">
                                <SearchIcon color="action" />
                            </InputAdornment>
                        ),
                    }}
                    sx={{ width: 300 }}
                />

                <TextField
                    select
                    size="small"
                    value={serviceFilter}
                    onChange={(e) => setServiceFilter(e.target.value)}
                    sx={{ width: 200 }}
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start">
                                <FilterListIcon color="action" />
                            </InputAdornment>
                        ),
                    }}
                >
                    <MenuItem value="all">All Services</MenuItem>
                    {services.map(service => (
                        <MenuItem key={service} value={service}>{service}</MenuItem>
                    ))}
                </TextField>

                <TextField
                    select
                    size="small"
                    value={sourceFilter}
                    onChange={(e) => setSourceFilter(e.target.value)}
                    sx={{ width: 220 }}
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start">
                                <FilterListIcon color="action" />
                            </InputAdornment>
                        ),
                    }}
                >
                    <MenuItem value="all">All Sources</MenuItem>
                    <MenuItem value="landing_page">Standard Promo</MenuItem>
                    <MenuItem value="landing_page_high_end">High-End Promo</MenuItem>
                    <MenuItem value="landing_page_creative">Creative Promo</MenuItem>
                    <MenuItem value="landing_page_garkor">Garkor Promo</MenuItem>
                    <MenuItem value="manual">Manual/Other</MenuItem>
                </TextField>

                <Button
                    variant="outlined"
                    startIcon={<SortIcon />}
                    onClick={() => setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
                    size="small"
                    sx={{ height: 40, textTransform: 'none' }}
                >
                    {sortOrder === 'desc' ? 'Newest First' : 'Oldest First'}
                </Button>
            </Paper>

            <DndContext
                sensors={sensors}
                collisionDetection={closestCorners}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
            >
                <Grid container spacing={2} sx={{ flexGrow: 1, overflowX: 'auto', flexWrap: 'nowrap', pb: 2 }}>
                    {COLUMNS.map((column) => {
                        const columnLeads = filteredLeads.filter((lead) => (lead.status || 'new') === column.id);
                        return (
                            <DroppableColumn key={column.id} column={column} leads={columnLeads}>
                                {columnLeads.map((lead) => (
                                    <DraggableLeadCard
                                        key={lead.id}
                                        lead={lead}
                                        columnColor={column.color}
                                        onClick={handleLeadClick}
                                        onDelete={handleDeleteLead}
                                    />
                                ))}
                            </DroppableColumn>
                        );
                    })}
                </Grid>

                <DragOverlay>
                    {activeDragLead ? (
                        <div style={{ transform: 'rotate(3deg)' }}>
                            <LeadCardContent
                                lead={activeDragLead}
                                columnColor={COLUMNS.find(c => c.id === activeDragLead.status)?.color || '#000'}
                            />
                        </div>
                    ) : null}
                </DragOverlay>
            </DndContext>

            <LeadDetailsDialog
                open={isDialogOpen}
                onClose={handleDialogClose}
                lead={selectedLead}
            />
        </Container>
    );
};

export default DealsPage;
