import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    Container, Box, Typography, Paper, Button, IconButton, TextField,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    CircularProgress, Chip, Divider, Snackbar, Alert
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import DownloadIcon from '@mui/icons-material/Download';
import EditIcon from '@mui/icons-material/Edit';
import CheckIcon from '@mui/icons-material/Check';
import PlaceIcon from '@mui/icons-material/Place';
import SquareFootIcon from '@mui/icons-material/SquareFoot';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { savedEstimateApi } from '../../api/savedEstimateApi';
import { SavedEstimate } from '../../types/savedEstimate.types';
import { DEVICES, GEAR, POOL, GENERATOR, LANDSCAPE, WIRE } from './ElectricalEstimatorPage';

// Lookup for device data
const ALL_ITEMS: Record<string, { name: string; matRate?: number; laborRate?: number; wireLen?: number; wireType?: string }> = {};
Object.values(DEVICES).flat().forEach((d: any) => { ALL_ITEMS[d.id] = d; });
[GEAR, POOL, GENERATOR, LANDSCAPE, WIRE].forEach((arr: any[]) => arr.forEach(d => { ALL_ITEMS[d.id] = d; }));

const CATEGORY_NAMES: Record<string, string> = {
    lighting: '💡 Освещение',
    receptacles: '🔌 Розетки',
    switches: '🔲 Выключатели',
    appliances: '🍳 Электроприборы',
    hvac: '❄️ HVAC',
    lowvoltage: '📡 Слаботочка',
    gear: '⚙️ Оборудование',
    pool: '🏊 Бассейн',
    generator: '🔋 Генератор',
    landscape: '🌿 Ландшафт',
    wire: '🔌 Провод/Кабель',
    other: '❓ Прочее',
};

function getCategory(itemId: string): string {
    for (const [cat, items] of Object.entries(DEVICES)) {
        if ((items as any[]).some(d => d.id === itemId)) return cat;
    }
    if (GEAR.some((d: any) => d.id === itemId)) return 'gear';
    if (POOL.some((d: any) => d.id === itemId)) return 'pool';
    if (GENERATOR.some((d: any) => d.id === itemId)) return 'generator';
    if (LANDSCAPE.some((d: any) => d.id === itemId)) return 'landscape';
    if (WIRE.some((d: any) => d.id === itemId)) return 'wire';
    return 'other';
}

function calcTotals(quantities: Record<string, number>, laborRate: number, wirePrice: number) {
    let totalMat = 0, totalLab = 0, totalWire = 0;
    for (const [id, qty] of Object.entries(quantities)) {
        const item = ALL_ITEMS[id];
        if (!item || qty <= 0) continue;
        totalMat += (item.matRate || 0) * qty;
        totalLab += (item.laborRate || 0) * qty * laborRate;
        if (item.wireLen) totalWire += item.wireLen * qty * wirePrice;
    }
    return { totalMaterials: Math.round(totalMat), totalLabor: Math.round(totalLab), totalWire: Math.round(totalWire), grandTotal: Math.round(totalMat + totalLab + totalWire) };
}

const EstimateDetailPage: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [estimate, setEstimate] = useState<SavedEstimate | null>(null);
    const [loading, setLoading] = useState(true);
    const [quantities, setQuantities] = useState<Record<string, number>>({});
    const [laborRate, setLaborRate] = useState(65);
    const [wirePrice, setWirePrice] = useState(0.45);
    const [editingName, setEditingName] = useState(false);
    const [projectName, setProjectName] = useState('');
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const [snackbar, setSnackbar] = useState('');
    const [hasChanges, setHasChanges] = useState(false);

    useEffect(() => {
        if (!id) return;
        (async () => {
            setLoading(true);
            const data = await savedEstimateApi.getById(id);
            if (data) {
                setEstimate(data);
                setQuantities({ ...data.quantities });
                setLaborRate(data.laborRate || 65);
                setWirePrice(data.wirePrice || 0.45);
                setProjectName(data.projectName);
                setNotes(data.notes || '');
            }
            setLoading(false);
        })();
    }, [id]);

    const totals = useMemo(() => calcTotals(quantities, laborRate, wirePrice), [quantities, laborRate, wirePrice]);

    const updateQty = useCallback((itemId: string, value: number) => {
        setQuantities(prev => ({ ...prev, [itemId]: Math.max(0, value) }));
        setHasChanges(true);
    }, []);

    // Group items by category
    const grouped = useMemo(() => {
        const groups: Record<string, { id: string; name: string; qty: number; original: number; mat: number; lab: number; wire: number }[]> = {};
        for (const [itemId, qty] of Object.entries(quantities)) {
            if (qty <= 0) continue;
            const cat = getCategory(itemId);
            const item = ALL_ITEMS[itemId];
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push({
                id: itemId,
                name: item?.name || itemId.replace(/_/g, ' '),
                qty,
                original: estimate?.originalQuantities?.[itemId] || 0,
                mat: (item?.matRate || 0) * qty,
                lab: (item?.laborRate || 0) * qty * laborRate,
                wire: (item?.wireLen || 0) * qty * wirePrice,
            });
        }
        return groups;
    }, [quantities, laborRate, wirePrice, estimate]);

    const handleSave = async () => {
        if (!id) return;
        setSaving(true);
        try {
            await savedEstimateApi.update(id, {
                quantities,
                projectName,
                notes,
                laborRate,
                wirePrice,
                ...totals,
            });
            setHasChanges(false);
            setSnackbar('Сохранено ✅');
        } catch (err) { console.error('Save failed', err); setSnackbar('Ошибка сохранения'); }
        setSaving(false);
    };

    const handleStatusToggle = async () => {
        if (!id || !estimate) return;
        const newStatus = estimate.status === 'draft' ? 'final' : 'draft';
        await savedEstimateApi.update(id, { status: newStatus } as any);
        setEstimate(prev => prev ? { ...prev, status: newStatus } : prev);
        setSnackbar(newStatus === 'final' ? 'Проект финализирован ✅' : 'Возвращён в черновик');
    };

    const exportPDF = () => {
        if (!estimate) return;
        const pdf = new jsPDF();
        pdf.setFontSize(18);
        pdf.text(projectName || 'AI Estimate Report', 14, 22);
        pdf.setFontSize(10);
        pdf.setTextColor(100);
        const meta = [
            estimate.address && `Address: ${estimate.address}`,
            estimate.areaSqft && `Area: ${estimate.areaSqft} sqft`,
            `Files: ${estimate.filesCount}`,
            `Date: ${new Date().toLocaleDateString()}`
        ].filter(Boolean).join(' | ');
        pdf.text(meta, 14, 30);

        let startY = 38;
        for (const [cat, items] of Object.entries(grouped)) {
            pdf.setFontSize(11);
            pdf.setTextColor(30);
            pdf.text(CATEGORY_NAMES[cat] || cat, 14, startY);
            startY += 4;

            autoTable(pdf, {
                startY,
                head: [['Item', 'Qty', 'Materials $', 'Labor $', 'Wire $', 'Total $']],
                body: items.map(i => [
                    i.name,
                    i.qty.toString(),
                    `$${Math.round(i.mat)}`,
                    `$${Math.round(i.lab)}`,
                    `$${Math.round(i.wire)}`,
                    `$${Math.round(i.mat + i.lab + i.wire)}`,
                ]),
                theme: 'grid',
                headStyles: { fillColor: [25, 118, 210], fontSize: 8 },
                bodyStyles: { fontSize: 8 },
                margin: { left: 14 },
            });
            startY = (pdf as any).lastAutoTable.finalY + 8;
        }

        // Totals
        pdf.setFontSize(12);
        pdf.setTextColor(0);
        pdf.text(`Materials: $${totals.totalMaterials.toLocaleString()}`, 14, startY + 4);
        pdf.text(`Labor: $${totals.totalLabor.toLocaleString()}`, 14, startY + 10);
        pdf.text(`Wire: $${totals.totalWire.toLocaleString()}`, 14, startY + 16);
        pdf.setFontSize(14);
        pdf.text(`GRAND TOTAL: $${totals.grandTotal.toLocaleString()}`, 14, startY + 26);

        if (notes) {
            pdf.setFontSize(10);
            pdf.setTextColor(80);
            pdf.text(`Notes: ${notes}`, 14, startY + 36);
        }

        pdf.save(`${projectName || 'estimate'}.pdf`);
        setSnackbar('PDF скачан 📥');
    };

    if (loading) return <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px"><CircularProgress /></Box>;
    if (!estimate) return <Box p={4}><Typography>Проект не найден</Typography></Box>;

    const formatDate = (ts: any) => {
        if (!ts) return '—';
        const d = ts.toDate ? ts.toDate() : new Date(ts);
        return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    return (
        <Container maxWidth="xl" sx={{ mt: 3, mb: 4 }}>
            {/* Header */}
            <Box display="flex" alignItems="center" gap={1} mb={2}>
                <IconButton onClick={() => navigate('/estimates/projects')}>
                    <ArrowBackIcon />
                </IconButton>
                {editingName ? (
                    <Box display="flex" alignItems="center" gap={1}>
                        <TextField
                            value={projectName}
                            onChange={e => { setProjectName(e.target.value); setHasChanges(true); }}
                            size="small"
                            autoFocus
                            sx={{ minWidth: 300 }}
                        />
                        <IconButton onClick={() => setEditingName(false)} size="small" color="primary">
                            <CheckIcon />
                        </IconButton>
                    </Box>
                ) : (
                    <Box display="flex" alignItems="center" gap={1}>
                        <Typography variant="h5" fontWeight={700}>{projectName}</Typography>
                        <IconButton size="small" onClick={() => setEditingName(true)}>
                            <EditIcon fontSize="small" />
                        </IconButton>
                    </Box>
                )}
                <Box flex={1} />
                <Chip
                    label={estimate.status === 'final' ? '✅ Финал' : '📝 Черновик'}
                    color={estimate.status === 'final' ? 'success' : 'default'}
                    onClick={handleStatusToggle}
                    sx={{ cursor: 'pointer' }}
                />
            </Box>

            {/* Meta row */}
            <Box display="flex" gap={3} mb={3} flexWrap="wrap" alignItems="center">
                {estimate.address && (
                    <Box display="flex" alignItems="center" gap={0.5}>
                        <PlaceIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                        <Typography variant="body2" color="text.secondary">{estimate.address}</Typography>
                    </Box>
                )}
                {estimate.areaSqft && (
                    <Box display="flex" alignItems="center" gap={0.5}>
                        <SquareFootIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                        <Typography variant="body2" color="text.secondary">{estimate.areaSqft.toLocaleString()} sqft</Typography>
                    </Box>
                )}
                <Box display="flex" alignItems="center" gap={0.5}>
                    <InsertDriveFileIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                    <Typography variant="body2" color="text.secondary">{estimate.filesCount} файлов · {estimate.electricalCount} электрических</Typography>
                </Box>
                <Typography variant="caption" color="text.disabled">{formatDate(estimate.createdAt)}</Typography>
            </Box>

            {/* Rates */}
            <Box display="flex" gap={2} mb={3} alignItems="center">
                <TextField
                    label="Labor $/hr"
                    type="number"
                    size="small"
                    value={laborRate}
                    onChange={e => { setLaborRate(Number(e.target.value)); setHasChanges(true); }}
                    sx={{ width: 120 }}
                />
                <TextField
                    label="Wire $/ft"
                    type="number"
                    size="small"
                    value={wirePrice}
                    onChange={e => { setWirePrice(Number(e.target.value)); setHasChanges(true); }}
                    sx={{ width: 120 }}
                    inputProps={{ step: 0.05 }}
                />
                <Box flex={1} />
                <Button variant="outlined" startIcon={<DownloadIcon />} onClick={exportPDF} sx={{ textTransform: 'none' }}>
                    PDF
                </Button>
                <Button
                    variant="contained" startIcon={<SaveIcon />} onClick={handleSave} disabled={!hasChanges || saving}
                    sx={{ textTransform: 'none', fontWeight: 600 }}
                >
                    {saving ? 'Сохранение...' : 'Сохранить'}
                </Button>
            </Box>

            {/* Tables by category */}
            {Object.entries(grouped).map(([cat, items]) => (
                <Paper key={cat} variant="outlined" sx={{ mb: 2, borderRadius: 2, overflow: 'hidden' }}>
                    <Box sx={{ bgcolor: 'grey.50', px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                        <Typography variant="subtitle2" fontWeight={700}>{CATEGORY_NAMES[cat] || cat}</Typography>
                    </Box>
                    <TableContainer>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>Позиция</TableCell>
                                    <TableCell align="center" sx={{ width: 80 }}>Кол-во</TableCell>
                                    <TableCell align="right">Материал</TableCell>
                                    <TableCell align="right">Работа</TableCell>
                                    <TableCell align="right">Провод</TableCell>
                                    <TableCell align="right">Итого</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {items.map(item => {
                                    const isChanged = item.qty !== item.original;
                                    const rowTotal = Math.round(item.mat + item.lab + item.wire);
                                    return (
                                        <TableRow key={item.id} sx={isChanged ? { bgcolor: 'rgba(25,118,210,0.04)' } : {}}>
                                            <TableCell>
                                                <Typography variant="body2">{item.name}</Typography>
                                                {isChanged && (
                                                    <Typography variant="caption" color="text.disabled">
                                                        AI: {item.original}
                                                    </Typography>
                                                )}
                                            </TableCell>
                                            <TableCell align="center">
                                                <TextField
                                                    type="number"
                                                    value={item.qty}
                                                    onChange={e => updateQty(item.id, parseInt(e.target.value) || 0)}
                                                    size="small"
                                                    inputProps={{ min: 0, style: { textAlign: 'center', width: 50, padding: '4px 8px' } }}
                                                    sx={isChanged ? { '& .MuiOutlinedInput-root': { borderColor: 'primary.main' } } : {}}
                                                />
                                            </TableCell>
                                            <TableCell align="right">${Math.round(item.mat).toLocaleString()}</TableCell>
                                            <TableCell align="right">${Math.round(item.lab).toLocaleString()}</TableCell>
                                            <TableCell align="right">${Math.round(item.wire).toLocaleString()}</TableCell>
                                            <TableCell align="right">
                                                <Typography fontWeight={600}>${rowTotal.toLocaleString()}</Typography>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Paper>
            ))}

            {/* Totals summary */}
            <Paper variant="outlined" sx={{ p: 3, borderRadius: 2, mt: 2 }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
                    <Box>
                        <Typography variant="body2" color="text.secondary">Материалы</Typography>
                        <Typography variant="h6" fontWeight={600}>${totals.totalMaterials.toLocaleString()}</Typography>
                    </Box>
                    <Box>
                        <Typography variant="body2" color="text.secondary">Работа</Typography>
                        <Typography variant="h6" fontWeight={600}>${totals.totalLabor.toLocaleString()}</Typography>
                    </Box>
                    <Box>
                        <Typography variant="body2" color="text.secondary">Провод</Typography>
                        <Typography variant="h6" fontWeight={600}>${totals.totalWire.toLocaleString()}</Typography>
                    </Box>
                    <Divider orientation="vertical" flexItem />
                    <Box>
                        <Typography variant="body2" color="text.secondary">Итого</Typography>
                        <Typography variant="h4" fontWeight={800} color="primary.main">
                            ${totals.grandTotal.toLocaleString()}
                        </Typography>
                    </Box>
                </Box>
            </Paper>

            {/* Notes */}
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mt: 2 }}>
                <TextField
                    label="Заметки"
                    multiline
                    rows={3}
                    fullWidth
                    value={notes}
                    onChange={e => { setNotes(e.target.value); setHasChanges(true); }}
                    variant="outlined"
                    size="small"
                />
            </Paper>

            <Snackbar open={!!snackbar} autoHideDuration={3000} onClose={() => setSnackbar('')} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
                <Alert severity="success" onClose={() => setSnackbar('')}>{snackbar}</Alert>
            </Snackbar>
        </Container>
    );
};

export default EstimateDetailPage;
