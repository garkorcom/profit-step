import React, { useEffect, useState, useMemo } from 'react';
import {
    Container, Typography, Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead,
    TableRow, Chip, CircularProgress, Card, CardContent, TextField,
    FormControl, InputLabel, Select, MenuItem, IconButton, Dialog, DialogContent, DialogTitle
} from '@mui/material';
import { collection, query, orderBy, getDocs, where, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { startOfDay, endOfDay, subDays, format } from 'date-fns';
import PhotoIcon from '@mui/icons-material/Photo';
import CloseIcon from '@mui/icons-material/Close';

// Cost Categories (mirror from bot)
const COST_CATEGORIES = [
    { id: 'materials', label: '🧱 Materials' },
    { id: 'tools', label: '🔧 Tools' },
    { id: 'reimbursement', label: '💵 Reimbursement' },
    { id: 'fuel', label: '⛽ Fuel' },
    { id: 'housing', label: '🏠 Housing' },
    { id: 'food', label: '🍔 Food' },
    { id: 'permit', label: '📋 Permit' },
    { id: 'other', label: '📦 Other' }
];

interface CostEntry {
    id: string;
    userId: string;
    userName: string;
    clientId: string;
    clientName: string;
    category: string;
    categoryLabel: string;
    amount: number;
    originalAmount: number;
    receiptPhotoUrl: string;
    description?: string;
    voiceNoteUrl?: string;
    createdAt: Timestamp;
    status: string;
}

const CostsReportPage: React.FC = () => {
    const [costs, setCosts] = useState<CostEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [startDate, setStartDate] = useState<Date>(subDays(startOfDay(new Date()), 30));
    const [endDate, setEndDate] = useState<Date>(endOfDay(new Date()));

    // Filters
    const [filterCategory, setFilterCategory] = useState('all');
    const [filterEmployee, setFilterEmployee] = useState('all');
    const [filterClient, setFilterClient] = useState('all');

    // Photo Preview
    const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);

    useEffect(() => {
        fetchCosts();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [startDate, endDate]);

    const fetchCosts = async () => {
        setLoading(true);
        try {
            const start = startOfDay(startDate);
            const end = endOfDay(endDate);

            const q = query(
                collection(db, 'costs'),
                where('createdAt', '>=', Timestamp.fromDate(start)),
                where('createdAt', '<=', Timestamp.fromDate(end)),
                orderBy('createdAt', 'desc')
            );

            const snapshot = await getDocs(q);
            setCosts(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as CostEntry)));
        } catch (e) {
            console.error("Error fetching costs:", e);
        } finally {
            setLoading(false);
        }
    };

    // Unique values for filters
    const uniqueEmployees = useMemo(() => {
        const emps = new Map<string, string>();
        costs.forEach(c => {
            if (c.userId && c.userName) {
                emps.set(c.userId, c.userName);
            }
        });
        return Array.from(emps.entries())
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [costs]);

    const uniqueClients = useMemo(() => {
        const clients = new Set(costs.map(c => c.clientName).filter(Boolean));
        return Array.from(clients).sort();
    }, [costs]);

    // Filtered costs
    const filteredCosts = useMemo(() => {
        return costs.filter(cost => {
            const matchesCategory = filterCategory === 'all' || cost.category === filterCategory;
            const matchesEmployee = filterEmployee === 'all' || cost.userId === filterEmployee;
            const matchesClient = filterClient === 'all' || cost.clientName === filterClient;
            return matchesCategory && matchesEmployee && matchesClient;
        });
    }, [costs, filterCategory, filterEmployee, filterClient]);

    // Statistics
    const stats = useMemo(() => {
        let total = 0;
        let reimbursements = 0;

        filteredCosts.forEach(c => {
            if (c.category === 'reimbursement') {
                reimbursements += Math.abs(c.amount);
            }
            total += c.amount; // amount is already negative for reimbursements
        });

        return {
            total: Math.abs(total + reimbursements * 2), // Undo double-counting
            reimbursements,
            net: total,
            count: filteredCosts.length
        };
    }, [filteredCosts]);

    const getCategoryLabel = (categoryId: string) => {
        const cat = COST_CATEGORIES.find(c => c.id === categoryId);
        return cat?.label || categoryId;
    };

    const getCategoryColor = (categoryId: string): "default" | "primary" | "secondary" | "error" | "info" | "success" | "warning" => {
        switch (categoryId) {
            case 'reimbursement': return 'success';
            case 'materials': return 'primary';
            case 'tools': return 'info';
            case 'fuel': return 'warning';
            case 'housing': return 'secondary';
            case 'food': return 'default';
            case 'permit': return 'error';
            default: return 'default';
        }
    };

    return (
        <Container maxWidth="xl" sx={{ py: 4 }}>
            <Typography variant="h4" fontWeight="bold" mb={4}>
                💰 Costs Report
            </Typography>

            {/* Stats Cards */}
            <Box sx={{ display: 'flex', gap: 3, mb: 4, flexWrap: 'wrap' }}>
                <Box sx={{ flex: 1, minWidth: 180 }}>
                    <Card sx={{ bgcolor: '#ff9800', color: 'white', height: '100%' }}>
                        <CardContent>
                            <Typography variant="body2" sx={{ opacity: 0.8 }}>Total Costs</Typography>
                            <Typography variant="h4" fontWeight="bold">${stats.total.toFixed(2)}</Typography>
                        </CardContent>
                    </Card>
                </Box>
                <Box sx={{ flex: 1, minWidth: 180 }}>
                    <Card sx={{ bgcolor: '#4caf50', color: 'white', height: '100%' }}>
                        <CardContent>
                            <Typography variant="body2" sx={{ opacity: 0.8 }}>Reimbursements</Typography>
                            <Typography variant="h4" fontWeight="bold">-${stats.reimbursements.toFixed(2)}</Typography>
                        </CardContent>
                    </Card>
                </Box>
                <Box sx={{ flex: 1, minWidth: 180 }}>
                    <Card sx={{ bgcolor: stats.net >= 0 ? '#f44336' : '#4caf50', color: 'white', height: '100%' }}>
                        <CardContent>
                            <Typography variant="body2" sx={{ opacity: 0.8 }}>Net Total</Typography>
                            <Typography variant="h4" fontWeight="bold">${stats.net.toFixed(2)}</Typography>
                        </CardContent>
                    </Card>
                </Box>
                <Box sx={{ flex: 1, minWidth: 180 }}>
                    <Card sx={{ height: '100%' }}>
                        <CardContent>
                            <Typography color="textSecondary" variant="body2">Entries</Typography>
                            <Typography variant="h4" fontWeight="bold">{stats.count}</Typography>
                        </CardContent>
                    </Card>
                </Box>
            </Box>

            {/* Filters */}
            <Paper sx={{ p: 2, mb: 3 }}>
                <Typography variant="subtitle2" gutterBottom fontWeight="bold">Filters</Typography>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Box sx={{ minWidth: 150 }}>
                        <TextField
                            label="Start Date"
                            type="date"
                            fullWidth
                            size="small"
                            value={format(startDate, 'yyyy-MM-dd')}
                            onChange={(e) => setStartDate(e.target.value ? new Date(e.target.value) : new Date())}
                            InputLabelProps={{ shrink: true }}
                        />
                    </Box>
                    <Box sx={{ minWidth: 150 }}>
                        <TextField
                            label="End Date"
                            type="date"
                            fullWidth
                            size="small"
                            value={format(endDate, 'yyyy-MM-dd')}
                            onChange={(e) => setEndDate(e.target.value ? new Date(e.target.value) : new Date())}
                            InputLabelProps={{ shrink: true }}
                        />
                    </Box>
                    <FormControl size="small" sx={{ minWidth: 150 }}>
                        <InputLabel>Category</InputLabel>
                        <Select
                            value={filterCategory}
                            label="Category"
                            onChange={(e) => setFilterCategory(e.target.value)}
                        >
                            <MenuItem value="all">All Categories</MenuItem>
                            {COST_CATEGORIES.map(cat => (
                                <MenuItem key={cat.id} value={cat.id}>{cat.label}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ minWidth: 150 }}>
                        <InputLabel>Employee</InputLabel>
                        <Select
                            value={filterEmployee}
                            label="Employee"
                            onChange={(e) => setFilterEmployee(e.target.value)}
                        >
                            <MenuItem value="all">All Employees</MenuItem>
                            {uniqueEmployees.map(emp => (
                                <MenuItem key={emp.id} value={emp.id}>{emp.name}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ minWidth: 150 }}>
                        <InputLabel>Client</InputLabel>
                        <Select
                            value={filterClient}
                            label="Client"
                            onChange={(e) => setFilterClient(e.target.value)}
                        >
                            <MenuItem value="all">All Clients</MenuItem>
                            {uniqueClients.map(client => (
                                <MenuItem key={client} value={client}>{client}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </Box>
            </Paper>

            {/* Costs Table */}
            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow sx={{ bgcolor: '#f5f5f5' }}>
                            <TableCell>Date / Time</TableCell>
                            <TableCell>Employee</TableCell>
                            <TableCell>Client</TableCell>
                            <TableCell>Category</TableCell>
                            <TableCell align="right">Amount</TableCell>
                            <TableCell>Photo</TableCell>
                            <TableCell>Note</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={7} align="center"><CircularProgress /></TableCell>
                            </TableRow>
                        ) : filteredCosts.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} align="center">No cost entries found</TableCell>
                            </TableRow>
                        ) : (
                            filteredCosts.map((cost) => {
                                const date = cost.createdAt ? new Date(cost.createdAt.seconds * 1000) : new Date();
                                const isReimbursement = cost.category === 'reimbursement';

                                return (
                                    <TableRow key={cost.id} hover>
                                        <TableCell>
                                            <Typography variant="body2" fontWeight="bold">
                                                {date.toLocaleDateString()}
                                            </Typography>
                                            <Typography variant="caption" color="textSecondary">
                                                {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </Typography>
                                        </TableCell>
                                        <TableCell>{cost.userName}</TableCell>
                                        <TableCell>{cost.clientName}</TableCell>
                                        <TableCell>
                                            <Chip
                                                label={getCategoryLabel(cost.category)}
                                                color={getCategoryColor(cost.category)}
                                                size="small"
                                                variant={isReimbursement ? 'filled' : 'outlined'}
                                            />
                                        </TableCell>
                                        <TableCell
                                            align="right"
                                            sx={{
                                                fontWeight: 'bold',
                                                color: isReimbursement ? 'green' : 'inherit'
                                            }}
                                        >
                                            {isReimbursement ? '-' : ''}${Math.abs(cost.amount).toFixed(2)}
                                        </TableCell>
                                        <TableCell>
                                            {cost.receiptPhotoUrl && (
                                                <IconButton
                                                    size="small"
                                                    color="primary"
                                                    onClick={() => setPreviewPhoto(cost.receiptPhotoUrl)}
                                                >
                                                    <PhotoIcon />
                                                </IconButton>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                                                {cost.description || '-'}
                                            </Typography>
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </TableContainer>

            {/* Photo Preview Dialog */}
            <Dialog
                open={!!previewPhoto}
                onClose={() => setPreviewPhoto(null)}
                maxWidth="md"
            >
                <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    Receipt Photo
                    <IconButton onClick={() => setPreviewPhoto(null)}>
                        <CloseIcon />
                    </IconButton>
                </DialogTitle>
                <DialogContent>
                    {previewPhoto && (
                        <img
                            src={previewPhoto}
                            alt="Receipt"
                            style={{ maxWidth: '100%', maxHeight: '70vh' }}
                        />
                    )}
                </DialogContent>
            </Dialog>
        </Container>
    );
};

export default CostsReportPage;
