import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
    Container, Typography, Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead,
    TableRow, Chip, CircularProgress, Card, CardContent, Button, TextField, IconButton,
    Dialog, DialogTitle, DialogContent, DialogActions, FormControl, InputLabel, Select,
    MenuItem, Grid, Alert, InputAdornment, Snackbar,
} from '@mui/material';
import {
    Add as AddIcon,
    Search as SearchIcon,
    Warehouse as WarehouseIcon,
    ArrowBack as ArrowBackIcon,
    RemoveCircleOutline as WriteOffIcon,
    AddCircleOutline as PurchaseIcon,
} from '@mui/icons-material';
import {
    InventoryCatalogItem,
    InventoryLocation,
    TransactionType,
    InventoryCategory,
    InventoryUnit,
    INVENTORY_CATEGORY_LABELS,
    INVENTORY_UNITS,
    INVENTORY_UNIT_LABELS,
} from '../../types/inventory.types';
import {
    subscribeCatalogItems,
    subscribeLocations,
    createTransaction,
    createCatalogItem,
} from '../../features/inventory/inventoryService';
import { useAuth } from '../../auth/AuthContext';
import { Timestamp } from 'firebase/firestore';
import { errorMessage } from '../../utils/errorMessage';

// =======================================
// MAIN PAGE
// =======================================

const InventoryPage: React.FC = () => {
    const { currentUser, userProfile } = useAuth();

    // Data
    const [catalogItems, setCatalogItems] = useState<InventoryCatalogItem[]>([]);
    const [locations, setLocations] = useState<InventoryLocation[]>([]);
    const [loading, setLoading] = useState(true);

    // UI state
    const [selectedWarehouse, setSelectedWarehouse] = useState<InventoryLocation | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
        open: false, message: '', severity: 'success',
    });

    // Dialogs
    const [transactionDialogOpen, setTransactionDialogOpen] = useState(false);
    const [transactionType, setTransactionType] = useState<'purchase' | 'write_off'>('purchase');
    const [addItemDialogOpen, setAddItemDialogOpen] = useState(false);

    // Transaction form
    const [txCatalogItemId, setTxCatalogItemId] = useState('');
    const [txQty, setTxQty] = useState('');
    const [txUnitPrice, setTxUnitPrice] = useState('');
    const [txNote, setTxNote] = useState('');
    const [txSubmitting, setTxSubmitting] = useState(false);

    // Add item form
    const [newItemName, setNewItemName] = useState('');
    const [newItemSku, setNewItemSku] = useState('');
    const [newItemCategory, setNewItemCategory] = useState<InventoryCategory>('materials');
    const [newItemUnit, setNewItemUnit] = useState<InventoryUnit>('шт');
    const [newItemMinStock, setNewItemMinStock] = useState('0');
    const [addItemSubmitting, setAddItemSubmitting] = useState(false);

    // =======================================
    // SUBSCRIPTIONS
    // =======================================

    useEffect(() => {
        const unsubs: (() => void)[] = [];

        unsubs.push(subscribeCatalogItems((items) => {
            setCatalogItems(items);
            setLoading(false);
        }));

        unsubs.push(subscribeLocations((locs) => {
            setLocations(locs);
        }));

        return () => unsubs.forEach(u => u());
    }, []);

    // =======================================
    // COMPUTED
    // =======================================

    const warehouses = useMemo(() =>
        locations.filter(l => l.type === 'warehouse' || l.isActive),
        [locations]
    );

    const warehouseItems = useMemo(() => {
        if (!selectedWarehouse) return [];
        return catalogItems.filter(item => {
            const stock = item.stockByLocation?.[selectedWarehouse.id];
            return stock !== undefined && stock > 0;
        });
    }, [catalogItems, selectedWarehouse]);

    const filteredItems = useMemo(() => {
        if (!searchQuery.trim()) return warehouseItems;
        const q = searchQuery.toLowerCase();
        return warehouseItems.filter(item =>
            item.name.toLowerCase().includes(q) ||
            (item.sku && item.sku.toLowerCase().includes(q))
        );
    }, [warehouseItems, searchQuery]);

    // =======================================
    // HANDLERS
    // =======================================

    const openTransactionDialog = useCallback((type: 'purchase' | 'write_off') => {
        setTransactionType(type);
        setTxCatalogItemId('');
        setTxQty('');
        setTxUnitPrice('');
        setTxNote('');
        setTransactionDialogOpen(true);
    }, []);

    const handleSubmitTransaction = async () => {
        if (!txCatalogItemId || !txQty || !selectedWarehouse || !currentUser) return;

        const qty = parseFloat(txQty);
        const unitPrice = parseFloat(txUnitPrice) || 0;
        if (qty <= 0) return;

        const catalogItem = catalogItems.find(i => i.id === txCatalogItemId);
        if (!catalogItem) return;

        setTxSubmitting(true);
        try {
            await createTransaction({
                catalogItemId: txCatalogItemId,
                catalogItemName: catalogItem.name,
                category: catalogItem.category,
                type: transactionType as TransactionType,
                qty,
                unitPrice,
                totalAmount: qty * unitPrice,
                ...(transactionType === 'purchase'
                    ? { toLocation: selectedWarehouse.id }
                    : { fromLocation: selectedWarehouse.id }
                ),
                performedBy: currentUser.uid,
                performedByName: userProfile?.displayName || currentUser.email || 'Unknown',
                timestamp: Timestamp.now(),
                note: txNote || undefined,
            });

            setTransactionDialogOpen(false);
            setSnackbar({
                open: true,
                message: transactionType === 'purchase'
                    ? 'Приход записан'
                    : 'Списание записано',
                severity: 'success',
            });
        } catch (err: unknown) {
            setSnackbar({
                open: true,
                message: errorMessage(err) || 'Ошибка при создании транзакции',
                severity: 'error',
            });
        } finally {
            setTxSubmitting(false);
        }
    };

    const handleAddItem = async () => {
        if (!newItemName.trim() || !currentUser) return;

        setAddItemSubmitting(true);
        try {
            await createCatalogItem({
                name: newItemName.trim(),
                sku: newItemSku.trim() || undefined,
                category: newItemCategory,
                unit: newItemUnit,
                lastPurchasePrice: 0,
                avgPrice: 0,
                clientMarkupPercent: 20,
                stockByLocation: {},
                totalStock: 0,
                minStock: parseInt(newItemMinStock) || 0,
                isTrackable: false,
                createdBy: currentUser.uid,
                isArchived: false,
            });

            setAddItemDialogOpen(false);
            setNewItemName('');
            setNewItemSku('');
            setNewItemCategory('materials');
            setNewItemUnit('шт');
            setNewItemMinStock('0');
            setSnackbar({ open: true, message: 'Товар добавлен в каталог', severity: 'success' });
        } catch (err: unknown) {
            setSnackbar({ open: true, message: errorMessage(err) || 'Ошибка при добавлении', severity: 'error' });
        } finally {
            setAddItemSubmitting(false);
        }
    };

    // =======================================
    // RENDER: LOADING
    // =======================================

    if (loading) {
        return (
            <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
                <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                    <CircularProgress />
                </Box>
            </Container>
        );
    }

    // =======================================
    // RENDER: WAREHOUSE LIST
    // =======================================

    if (!selectedWarehouse) {
        return (
            <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                    <Typography variant="h4">Склады</Typography>
                    <Button
                        variant="contained"
                        startIcon={<AddIcon />}
                        onClick={() => setAddItemDialogOpen(true)}
                    >
                        Добавить товар
                    </Button>
                </Box>

                {warehouses.length === 0 ? (
                    <Alert severity="info" sx={{ mt: 2 }}>
                        Нет активных складов. Создайте склад в разделе CRM Inventory.
                    </Alert>
                ) : (
                    <Grid container spacing={2}>
                        {warehouses.map((wh) => {
                            const itemCount = catalogItems.filter(
                                item => (item.stockByLocation?.[wh.id] || 0) > 0
                            ).length;
                            const totalItems = catalogItems.reduce(
                                (sum, item) => sum + (item.stockByLocation?.[wh.id] || 0), 0
                            );

                            return (
                                <Grid size={{ xs: 12, sm: 6, md: 4 }} key={wh.id}>
                                    <Card
                                        sx={{
                                            cursor: 'pointer',
                                            transition: 'box-shadow 0.2s',
                                            '&:hover': { boxShadow: 6 },
                                        }}
                                        onClick={() => setSelectedWarehouse(wh)}
                                    >
                                        <CardContent>
                                            <Box display="flex" alignItems="center" gap={1} mb={1}>
                                                <WarehouseIcon color="primary" />
                                                <Typography variant="h6">{wh.name}</Typography>
                                            </Box>
                                            {wh.address && (
                                                <Typography variant="body2" color="text.secondary" mb={1}>
                                                    {wh.address}
                                                </Typography>
                                            )}
                                            <Box display="flex" gap={2}>
                                                <Chip
                                                    label={`${itemCount} позиций`}
                                                    size="small"
                                                    color="primary"
                                                    variant="outlined"
                                                />
                                                <Chip
                                                    label={`${totalItems} единиц`}
                                                    size="small"
                                                    variant="outlined"
                                                />
                                            </Box>
                                            <Chip
                                                label={wh.isActive ? 'Активен' : 'Неактивен'}
                                                size="small"
                                                color={wh.isActive ? 'success' : 'default'}
                                                sx={{ mt: 1 }}
                                            />
                                        </CardContent>
                                    </Card>
                                </Grid>
                            );
                        })}
                    </Grid>
                )}

                {/* Add Item Dialog */}
                {renderAddItemDialog()}

                <Snackbar
                    open={snackbar.open}
                    autoHideDuration={4000}
                    onClose={() => setSnackbar(s => ({ ...s, open: false }))}
                >
                    <Alert severity={snackbar.severity} onClose={() => setSnackbar(s => ({ ...s, open: false }))}>
                        {snackbar.message}
                    </Alert>
                </Snackbar>
            </Container>
        );
    }

    // =======================================
    // RENDER: WAREHOUSE ITEMS
    // =======================================

    function renderAddItemDialog() {
        return (
            <Dialog
                open={addItemDialogOpen}
                onClose={() => setAddItemDialogOpen(false)}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle>Добавить товар в каталог</DialogTitle>
                <DialogContent>
                    <Box display="flex" flexDirection="column" gap={2} mt={1}>
                        <TextField
                            label="Название"
                            value={newItemName}
                            onChange={(e) => setNewItemName(e.target.value)}
                            fullWidth
                            required
                        />
                        <TextField
                            label="Артикул (SKU)"
                            value={newItemSku}
                            onChange={(e) => setNewItemSku(e.target.value)}
                            fullWidth
                        />
                        <FormControl fullWidth>
                            <InputLabel>Категория</InputLabel>
                            <Select
                                value={newItemCategory}
                                label="Категория"
                                onChange={(e) => setNewItemCategory(e.target.value as InventoryCategory)}
                            >
                                {(Object.entries(INVENTORY_CATEGORY_LABELS) as [InventoryCategory, string][]).map(([key, label]) => (
                                    <MenuItem key={key} value={key}>{label}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <FormControl fullWidth>
                            <InputLabel>Единица измерения</InputLabel>
                            <Select
                                value={newItemUnit}
                                label="Единица измерения"
                                onChange={(e) => setNewItemUnit(e.target.value as InventoryUnit)}
                            >
                                {INVENTORY_UNITS.map(u => (
                                    <MenuItem key={u} value={u}>{INVENTORY_UNIT_LABELS[u]} ({u})</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <TextField
                            label="Мин. остаток"
                            type="number"
                            value={newItemMinStock}
                            onChange={(e) => setNewItemMinStock(e.target.value)}
                            fullWidth
                        />
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setAddItemDialogOpen(false)}>Отмена</Button>
                    <Button
                        variant="contained"
                        onClick={handleAddItem}
                        disabled={!newItemName.trim() || addItemSubmitting}
                    >
                        {addItemSubmitting ? <CircularProgress size={20} /> : 'Добавить'}
                    </Button>
                </DialogActions>
            </Dialog>
        );
    }

    function renderTransactionDialog() {
        const isPurchase = transactionType === 'purchase';
        return (
            <Dialog
                open={transactionDialogOpen}
                onClose={() => setTransactionDialogOpen(false)}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle>
                    {isPurchase ? 'Приход (закупка)' : 'Списание'}
                </DialogTitle>
                <DialogContent>
                    <Box display="flex" flexDirection="column" gap={2} mt={1}>
                        <FormControl fullWidth required>
                            <InputLabel>Товар</InputLabel>
                            <Select
                                value={txCatalogItemId}
                                label="Товар"
                                onChange={(e) => setTxCatalogItemId(e.target.value)}
                            >
                                {(isPurchase ? catalogItems : warehouseItems).map(item => (
                                    <MenuItem key={item.id} value={item.id}>
                                        {item.name}
                                        {!isPurchase && ` (${item.stockByLocation?.[selectedWarehouse!.id] || 0} ${item.unit})`}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <TextField
                            label="Количество"
                            type="number"
                            value={txQty}
                            onChange={(e) => setTxQty(e.target.value)}
                            fullWidth
                            required
                            inputProps={{ min: 0.01, step: 0.01 }}
                        />
                        <TextField
                            label="Цена за единицу"
                            type="number"
                            value={txUnitPrice}
                            onChange={(e) => setTxUnitPrice(e.target.value)}
                            fullWidth
                            InputProps={{
                                startAdornment: <InputAdornment position="start">$</InputAdornment>,
                            }}
                            inputProps={{ min: 0, step: 0.01 }}
                        />
                        <TextField
                            label="Примечание"
                            value={txNote}
                            onChange={(e) => setTxNote(e.target.value)}
                            fullWidth
                            multiline
                            rows={2}
                        />
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setTransactionDialogOpen(false)}>Отмена</Button>
                    <Button
                        variant="contained"
                        color={isPurchase ? 'primary' : 'warning'}
                        onClick={handleSubmitTransaction}
                        disabled={!txCatalogItemId || !txQty || txSubmitting}
                    >
                        {txSubmitting ? <CircularProgress size={20} /> : (isPurchase ? 'Записать приход' : 'Списать')}
                    </Button>
                </DialogActions>
            </Dialog>
        );
    }

    return (
        <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
            {/* Header */}
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Box display="flex" alignItems="center" gap={1}>
                    <IconButton onClick={() => { setSelectedWarehouse(null); setSearchQuery(''); }}>
                        <ArrowBackIcon />
                    </IconButton>
                    <WarehouseIcon color="primary" sx={{ fontSize: 32 }} />
                    <Typography variant="h4">{selectedWarehouse.name}</Typography>
                </Box>
                <Box display="flex" gap={1}>
                    <Button
                        variant="contained"
                        startIcon={<AddIcon />}
                        onClick={() => setAddItemDialogOpen(true)}
                    >
                        Добавить товар
                    </Button>
                    <Button
                        variant="contained"
                        color="primary"
                        startIcon={<PurchaseIcon />}
                        onClick={() => openTransactionDialog('purchase')}
                    >
                        Приход
                    </Button>
                    <Button
                        variant="contained"
                        color="warning"
                        startIcon={<WriteOffIcon />}
                        onClick={() => openTransactionDialog('write_off')}
                    >
                        Списание
                    </Button>
                </Box>
            </Box>

            {/* Search */}
            <Box mb={2}>
                <TextField
                    placeholder="Поиск по названию или артикулу..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    fullWidth
                    size="small"
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start">
                                <SearchIcon />
                            </InputAdornment>
                        ),
                    }}
                />
            </Box>

            {/* Items Table */}
            {filteredItems.length === 0 ? (
                <Alert severity="info">
                    {searchQuery ? 'Ничего не найдено' : 'На этом складе пока нет товаров. Используйте "Приход" для добавления.'}
                </Alert>
            ) : (
                <TableContainer component={Paper}>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell>Название</TableCell>
                                <TableCell>Артикул</TableCell>
                                <TableCell>Категория</TableCell>
                                <TableCell align="right">Остаток</TableCell>
                                <TableCell>Ед.</TableCell>
                                <TableCell align="right">Средн. цена</TableCell>
                                <TableCell>Статус</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {filteredItems.map((item) => {
                                const stock = item.stockByLocation?.[selectedWarehouse.id] || 0;
                                const isLow = item.minStock > 0 && stock <= item.minStock;
                                return (
                                    <TableRow key={item.id} hover>
                                        <TableCell>
                                            <Typography fontWeight={500}>{item.name}</Typography>
                                        </TableCell>
                                        <TableCell>
                                            <Typography variant="body2" color="text.secondary">
                                                {item.sku || '---'}
                                            </Typography>
                                        </TableCell>
                                        <TableCell>
                                            <Chip
                                                label={INVENTORY_CATEGORY_LABELS[item.category]}
                                                size="small"
                                                variant="outlined"
                                            />
                                        </TableCell>
                                        <TableCell align="right">
                                            <Typography fontWeight={600} color={isLow ? 'error.main' : 'text.primary'}>
                                                {stock}
                                            </Typography>
                                        </TableCell>
                                        <TableCell>{item.unit}</TableCell>
                                        <TableCell align="right">
                                            {item.avgPrice > 0 ? `$${item.avgPrice.toFixed(2)}` : '---'}
                                        </TableCell>
                                        <TableCell>
                                            {isLow ? (
                                                <Chip label="Мало" color="error" size="small" />
                                            ) : (
                                                <Chip label="OK" color="success" size="small" />
                                            )}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}

            {/* Dialogs */}
            {renderAddItemDialog()}
            {renderTransactionDialog()}

            <Snackbar
                open={snackbar.open}
                autoHideDuration={4000}
                onClose={() => setSnackbar(s => ({ ...s, open: false }))}
            >
                <Alert severity={snackbar.severity} onClose={() => setSnackbar(s => ({ ...s, open: false }))}>
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Container>
    );
};

export default InventoryPage;
