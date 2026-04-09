/**
 * @fileoverview TaskMaterialsTab — Materials management tab for UnifiedCockpitPage
 * 
 * Allows adding/editing materials linked to a GTD task.
 * Integrates with inventory catalog for auto-complete and stock checking.
 */

import React, { useState, useEffect } from 'react';
import {
    Box, Typography, Button, IconButton, TextField, Chip, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, Dialog, DialogTitle, DialogContent, DialogActions,
    FormControl, InputLabel, Select, MenuItem, Alert, Tooltip, Autocomplete, InputAdornment,
    Snackbar,
} from '@mui/material';
import {
    Add as AddIcon,
    Delete as DeleteIcon,
    ShoppingCart as ShoppingCartIcon,
    Inventory as InventoryIcon,
    CheckCircle as CheckIcon,
    Edit as EditIcon,
} from '@mui/icons-material';
import {
    TaskMaterial,
    TaskMaterialStatus,
    TASK_MATERIAL_STATUS_LABELS,
    TASK_MATERIAL_STATUS_COLORS,
    InventoryCatalogItem,
    INVENTORY_UNITS,
} from '../../types/inventory.types';
import { getCatalogItems, createTransaction, getAvailableStock, calculateMaterialsCost } from '../../features/inventory/inventoryService';
import { Timestamp } from 'firebase/firestore';
import { errorMessage } from '../../utils/errorMessage';

interface TaskMaterialsTabProps {
    taskId: string;
    materials: TaskMaterial[];
    clientId?: string;
    clientName?: string;
    userId: string;
    userName: string;
    onMaterialsChange: (materials: TaskMaterial[]) => void;
}

const TaskMaterialsTab: React.FC<TaskMaterialsTabProps> = ({
    taskId, materials, clientId, clientName, userId, userName, onMaterialsChange,
}) => {
    const [showAddDialog, setShowAddDialog] = useState(false);
    const [catalogItems, setCatalogItems] = useState<InventoryCatalogItem[]>([]);
    const [editingIdx, setEditingIdx] = useState<number | null>(null);

    // Snackbar feedback
    const [snackbar, setSnackbar] = useState<{ open: boolean; msg: string; severity: 'success' | 'error' | 'info' }>({
        open: false, msg: '', severity: 'info',
    });

    // Confirmation dialog for writeoff
    const [writeOffConfirm, setWriteOffConfirm] = useState<{ open: boolean; idx: number; loading: boolean }>({
        open: false, idx: -1, loading: false,
    });

    useEffect(() => {
        getCatalogItems().then(setCatalogItems).catch(console.error);
    }, []);

    // ═══════════════════════════════════════
    // STATS (using shared utility)
    // ═══════════════════════════════════════

    const { planned: plannedTotal, actual: actualTotal } = calculateMaterialsCost(materials);
    const clientTotal = materials.reduce((sum, m) => {
        const basePrice = m.actualPrice || m.plannedPrice;
        const catalogItem = catalogItems.find(c => c.id === m.catalogItemId);
        const markup = catalogItem?.clientMarkupPercent || 20;
        return sum + (m.clientPrice || basePrice * (1 + markup / 100)) * m.qty;
    }, 0);

    // ═══════════════════════════════════════
    // HANDLERS
    // ═══════════════════════════════════════

    const handleRemove = (idx: number) => {
        const updated = materials.filter((_, i) => i !== idx);
        onMaterialsChange(updated);
    };

    const handleStatusChange = (idx: number, newStatus: TaskMaterialStatus) => {
        const updated = [...materials];
        updated[idx] = { ...updated[idx], status: newStatus };
        onMaterialsChange(updated);
    };

    const handleWriteOffRequest = async (idx: number) => {
        const mat = materials[idx];
        if (!mat.catalogItemId) {
            setSnackbar({ open: true, msg: 'Материал не привязан к каталогу. Сначала свяжите его.', severity: 'error' });
            return;
        }

        try {
            const available = await getAvailableStock(mat.catalogItemId);
            if (available < mat.qty) {
                setSnackbar({ open: true, msg: `Недостаточно на складе: есть ${available}, нужно ${mat.qty}`, severity: 'error' });
                return;
            }
            // Show confirmation dialog
            setWriteOffConfirm({ open: true, idx, loading: false });
        } catch (err: unknown) {
            setSnackbar({ open: true, msg: errorMessage(err) || 'Ошибка проверки остатков', severity: 'error' });
        }
    };

    const handleWriteOffConfirmed = async () => {
        const idx = writeOffConfirm.idx;
        const mat = materials[idx];
        if (!mat.catalogItemId) return;

        setWriteOffConfirm(prev => ({ ...prev, loading: true }));

        try {
            const txId = await createTransaction({
                catalogItemId: mat.catalogItemId,
                catalogItemName: mat.name,
                category: 'materials',
                type: 'write_off',
                qty: mat.qty,
                unitPrice: mat.actualPrice || mat.plannedPrice,
                totalAmount: mat.qty * (mat.actualPrice || mat.plannedPrice),
                relatedTaskId: taskId,
                relatedClientId: clientId,
                relatedClientName: clientName,
                performedBy: userId,
                performedByName: userName,
                timestamp: Timestamp.now(),
                note: `Списание для задачи`,
            });

            const updated = [...materials];
            updated[idx] = { ...updated[idx], status: 'issued', transactionId: txId };
            onMaterialsChange(updated);
            setSnackbar({ open: true, msg: `✅ ${mat.name} — списано ${mat.qty} ${mat.unit}`, severity: 'success' });
        } catch (err: unknown) {
            setSnackbar({ open: true, msg: errorMessage(err) || 'Ошибка при списании', severity: 'error' });
        } finally {
            setWriteOffConfirm({ open: false, idx: -1, loading: false });
        }
    };

    const handleSaved = (material: TaskMaterial) => {
        if (editingIdx !== null) {
            const updated = [...materials];
            updated[editingIdx] = material;
            onMaterialsChange(updated);
        } else {
            onMaterialsChange([...materials, material]);
        }
        setShowAddDialog(false);
        setEditingIdx(null);
    };

    // ═══════════════════════════════════════
    // RENDER
    // ═══════════════════════════════════════

    return (
        <Box sx={{ py: 2 }}>
            {/* Summary */}
            <Box display="flex" gap={3} mb={2} flexWrap="wrap">
                <Box>
                    <Typography variant="caption" color="text.secondary">План</Typography>
                    <Typography variant="h6" fontWeight={600}>${plannedTotal.toFixed(2)}</Typography>
                </Box>
                <Box>
                    <Typography variant="caption" color="text.secondary">Факт</Typography>
                    <Typography variant="h6" fontWeight={600} color={actualTotal > plannedTotal ? 'error.main' : 'success.main'}>
                        ${actualTotal.toFixed(2)}
                    </Typography>
                </Box>
                <Box>
                    <Typography variant="caption" color="text.secondary">Клиенту</Typography>
                    <Typography variant="h6" fontWeight={600} color="primary.main">
                        ${clientTotal.toFixed(2)}
                    </Typography>
                </Box>
                <Box sx={{ ml: 'auto' }}>
                    <Button
                        variant="contained"
                        size="small"
                        startIcon={<AddIcon />}
                        onClick={() => { setEditingIdx(null); setShowAddDialog(true); }}
                    >
                        Добавить
                    </Button>
                </Box>
            </Box>

            {/* Table */}
            {materials.length === 0 ? (
                <Alert severity="info" variant="outlined">
                    Материалы не добавлены. Нажмите "Добавить" или используйте AI-генерацию при создании задачи.
                </Alert>
            ) : (
                <TableContainer>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Название</TableCell>
                                <TableCell align="right">Кол-во</TableCell>
                                <TableCell align="right">План $/ед</TableCell>
                                <TableCell align="right">Факт $/ед</TableCell>
                                <TableCell align="right">Итого</TableCell>
                                <TableCell>Статус</TableCell>
                                <TableCell align="center">Действия</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {materials.map((mat, idx) => (
                                <TableRow key={mat.id} hover>
                                    <TableCell>
                                        <Box>
                                            <Typography variant="body2" fontWeight={500}>
                                                {mat.catalogItemId && <InventoryIcon sx={{ fontSize: 14, mr: 0.5, verticalAlign: 'middle', color: 'primary.main' }} />}
                                                {mat.name}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {mat.source === 'ai' ? '🤖 AI' : mat.source === 'estimate' ? '📐 Смета' : '✏️ Ручной'}
                                            </Typography>
                                        </Box>
                                    </TableCell>
                                    <TableCell align="right">
                                        <Typography variant="body2">{mat.qty} {mat.unit}</Typography>
                                    </TableCell>
                                    <TableCell align="right">
                                        <Typography variant="body2">${mat.plannedPrice.toFixed(2)}</Typography>
                                    </TableCell>
                                    <TableCell align="right">
                                        <Typography variant="body2" fontWeight={mat.actualPrice ? 600 : 400}>
                                            {mat.actualPrice ? `$${mat.actualPrice.toFixed(2)}` : '—'}
                                        </Typography>
                                    </TableCell>
                                    <TableCell align="right">
                                        <Typography variant="body2" fontWeight={600}>
                                            ${((mat.actualPrice || mat.plannedPrice) * mat.qty).toFixed(2)}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>
                                        <Chip
                                            label={TASK_MATERIAL_STATUS_LABELS[mat.status]}
                                            size="small"
                                            sx={{
                                                bgcolor: TASK_MATERIAL_STATUS_COLORS[mat.status] + '20',
                                                color: TASK_MATERIAL_STATUS_COLORS[mat.status],
                                                fontWeight: 600,
                                                fontSize: '0.65rem',
                                            }}
                                        />
                                    </TableCell>
                                    <TableCell align="center">
                                        <Box display="flex" gap={0.5} justifyContent="center">
                                            {/* Edit button */}
                                            <Tooltip title="Редактировать">
                                                <IconButton size="small" onClick={() => { setEditingIdx(idx); setShowAddDialog(true); }}>
                                                    <EditIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                            {/* Write off from inventory */}
                                            {mat.status === 'planned' && mat.catalogItemId && (
                                                <Tooltip title="Списать со склада">
                                                    <IconButton size="small" color="success" onClick={() => handleWriteOffRequest(idx)}>
                                                        <CheckIcon fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                            )}
                                            {/* Mark as need purchase */}
                                            {mat.status === 'planned' && !mat.catalogItemId && (
                                                <Tooltip title="Нужна закупка">
                                                    <IconButton size="small" color="warning" onClick={() => handleStatusChange(idx, 'need_purchase')}>
                                                        <ShoppingCartIcon fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                            )}
                                            {/* Delete */}
                                            <Tooltip title="Удалить">
                                                <IconButton size="small" color="error" onClick={() => handleRemove(idx)}>
                                                    <DeleteIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        </Box>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}

            {/* Add/Edit Dialog */}
            <AddMaterialDialog
                open={showAddDialog}
                onClose={() => { setShowAddDialog(false); setEditingIdx(null); }}
                onSave={handleSaved}
                catalogItems={catalogItems}
                editMaterial={editingIdx !== null ? materials[editingIdx] : undefined}
            />

            {/* Write-off Confirmation Dialog */}
            <Dialog
                open={writeOffConfirm.open}
                onClose={() => !writeOffConfirm.loading && setWriteOffConfirm({ open: false, idx: -1, loading: false })}
                maxWidth="xs"
                fullWidth
            >
                <DialogTitle>📦 Подтверждение списания</DialogTitle>
                <DialogContent>
                    {writeOffConfirm.idx >= 0 && writeOffConfirm.idx < materials.length && (
                        <Box sx={{ mt: 1 }}>
                            <Typography variant="body1" gutterBottom>
                                Списать со склада:
                            </Typography>
                            <Box sx={{ bgcolor: 'action.hover', borderRadius: 1, p: 1.5, mb: 1 }}>
                                <Typography variant="body2" fontWeight={600}>
                                    {materials[writeOffConfirm.idx].name}
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                    Кол-во: {materials[writeOffConfirm.idx].qty} {materials[writeOffConfirm.idx].unit}
                                    {' · '}
                                    Сумма: ${((materials[writeOffConfirm.idx].actualPrice || materials[writeOffConfirm.idx].plannedPrice) * materials[writeOffConfirm.idx].qty).toFixed(2)}
                                </Typography>
                            </Box>
                            <Alert severity="warning" variant="outlined" sx={{ fontSize: '0.8rem' }}>
                                Операция создаст транзакцию списания. Остатки на складе уменьшатся.
                            </Alert>
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={() => setWriteOffConfirm({ open: false, idx: -1, loading: false })}
                        disabled={writeOffConfirm.loading}
                    >
                        Отмена
                    </Button>
                    <Button
                        onClick={handleWriteOffConfirmed}
                        variant="contained"
                        color="success"
                        disabled={writeOffConfirm.loading}
                    >
                        {writeOffConfirm.loading ? 'Списание...' : 'Списать'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Snackbar feedback */}
            <Snackbar
                open={snackbar.open}
                autoHideDuration={4000}
                onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert
                    onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
                    severity={snackbar.severity}
                    variant="filled"
                    sx={{ width: '100%' }}
                >
                    {snackbar.msg}
                </Alert>
            </Snackbar>
        </Box>
    );
};

// ═══════════════════════════════════════
// ADD MATERIAL DIALOG
// ═══════════════════════════════════════

interface AddMaterialDialogProps {
    open: boolean;
    onClose: () => void;
    onSave: (material: TaskMaterial) => void;
    catalogItems: InventoryCatalogItem[];
    editMaterial?: TaskMaterial;
}

const AddMaterialDialog: React.FC<AddMaterialDialogProps> = ({ open, onClose, onSave, catalogItems, editMaterial }) => {
    const [catalogItem, setCatalogItem] = useState<InventoryCatalogItem | null>(null);
    const [name, setName] = useState('');
    const [qty, setQty] = useState(1);
    const [unit, setUnit] = useState('шт');
    const [plannedPrice, setPlannedPrice] = useState(0);

    useEffect(() => {
        if (editMaterial) {
            setName(editMaterial.name);
            setQty(editMaterial.qty);
            setUnit(editMaterial.unit);
            setPlannedPrice(editMaterial.plannedPrice);
            if (editMaterial.catalogItemId) {
                const found = catalogItems.find(c => c.id === editMaterial.catalogItemId);
                setCatalogItem(found || null);
            }
        } else {
            setCatalogItem(null); setName(''); setQty(1); setUnit('шт'); setPlannedPrice(0);
        }
    }, [editMaterial, open, catalogItems]);

    const handleCatalogSelect = (item: InventoryCatalogItem | null) => {
        setCatalogItem(item);
        if (item) {
            setName(item.name);
            setUnit(item.unit);
            setPlannedPrice(item.lastPurchasePrice || item.avgPrice || 0);
        }
    };

    const handleSave = () => {
        if (!name.trim()) return;
        onSave({
            id: editMaterial?.id || `mat_${Date.now()}`,
            catalogItemId: catalogItem?.id,
            name: name.trim(),
            qty,
            unit,
            plannedPrice,
            actualPrice: editMaterial?.actualPrice,
            clientPrice: editMaterial?.clientPrice,
            status: editMaterial?.status || 'planned',
            source: editMaterial?.source || 'manual',
            transactionId: editMaterial?.transactionId,
            reservationId: editMaterial?.reservationId,
            shoppingListId: editMaterial?.shoppingListId,
        });
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>{editMaterial ? '✏️ Редактировать материал' : '➕ Добавить материал'}</DialogTitle>
            <DialogContent>
                <Box display="flex" flexDirection="column" gap={2} sx={{ mt: 1 }}>
                    <Autocomplete
                        options={catalogItems}
                        getOptionLabel={(o) => `${o.name} (${o.totalStock} ${o.unit})`}
                        value={catalogItem}
                        onChange={(_, v) => handleCatalogSelect(v)}
                        renderInput={(params) => <TextField {...params} label="Из каталога (опционально)" />}
                        clearOnEscape
                    />
                    <TextField
                        label="Название *"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        fullWidth
                    />
                    <Box display="flex" gap={2}>
                        <TextField
                            label="Количество"
                            type="number"
                            value={qty}
                            onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
                            fullWidth
                        />
                        <FormControl fullWidth>
                            <InputLabel>Единица</InputLabel>
                            <Select value={unit} onChange={(e) => setUnit(e.target.value)} label="Единица">
                                {INVENTORY_UNITS.map(u => <MenuItem key={u} value={u}>{u}</MenuItem>)}
                            </Select>
                        </FormControl>
                    </Box>
                    <TextField
                        label="Цена за единицу (план)"
                        type="number"
                        value={plannedPrice}
                        onChange={(e) => setPlannedPrice(Number(e.target.value))}
                        fullWidth
                        InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                    />
                    {catalogItem && (
                        <Alert severity="info" variant="outlined">
                            На складе: <strong>{catalogItem.totalStock} {catalogItem.unit}</strong>
                            {catalogItem.totalStock < qty && (
                                <Typography variant="caption" color="error.main" display="block">
                                    ⚠️ Недостаточно! Нужна закупка {qty - catalogItem.totalStock} {catalogItem.unit}
                                </Typography>
                            )}
                        </Alert>
                    )}
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Отмена</Button>
                <Button onClick={handleSave} variant="contained" disabled={!name.trim()}>
                    {editMaterial ? 'Сохранить' : 'Добавить'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default TaskMaterialsTab;
