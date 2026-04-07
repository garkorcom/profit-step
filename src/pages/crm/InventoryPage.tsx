import React, { useEffect, useState, useMemo } from 'react';
import {
    Container, Typography, Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead,
    TableRow, Chip, CircularProgress, Card, CardContent, Button, TextField, IconButton,
    Dialog, DialogTitle, DialogContent, DialogActions, FormControl, InputLabel, Select,
    MenuItem, Grid, Tabs, Tab, Alert, Tooltip, InputAdornment,
    Autocomplete, Checkbox, FormControlLabel, Snackbar,
} from '@mui/material';
import {
    Add as AddIcon,
    Search as SearchIcon,
    Edit as EditIcon,
    Archive as ArchiveIcon,
    Inventory as InventoryIcon,
    LocationOn as LocationIcon,
    Warning as WarningIcon,
    SwapHoriz as TransferIcon,
    PowerSettingsNew as DeactivateIcon,
} from '@mui/icons-material';
import {
    InventoryCatalogItem,
    InventoryTransaction,
    InventoryLocation,
    InventoryCategory,
    InventoryUnit,
    TransactionType,
    INVENTORY_CATEGORY_LABELS,
    INVENTORY_UNITS,
    TRANSACTION_TYPE_LABELS,
    LOCATION_TYPE_LABELS,
    INBOUND_TYPES,
    } from '../../types/inventory.types';
import {
    subscribeCatalogItems,
    subscribeTransactions,
    subscribeLocations,
    createCatalogItem,
    updateCatalogItem,
    archiveCatalogItem,
    createTransaction,
    createLocation,
    updateLocation,
} from '../../features/inventory/inventoryService';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../utils/errorMessage';
import { Timestamp } from 'firebase/firestore';

// ═══════════════════════════════════════
// TAB PANEL
// ═══════════════════════════════════════

function TabPanel({ children, value, index }: { children: React.ReactNode; value: number; index: number }) {
    return value === index ? <Box sx={{ pt: 2 }}>{children}</Box> : null;
}

// ═══════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════

const InventoryPage: React.FC = () => {
    const { currentUser, userProfile } = useAuth();
    const [tab, setTab] = useState(0);
    const [loading, setLoading] = useState(true);

    // Data
    const [catalogItems, setCatalogItems] = useState<InventoryCatalogItem[]>([]);
    const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
    const [locations, setLocations] = useState<InventoryLocation[]>([]);

    // Low stock computed from catalog
    const lowStockItems = useMemo(() =>
        catalogItems.filter(i => i.minStock > 0 && i.totalStock <= i.minStock),
        [catalogItems]
    );

    // Filters
    const [searchQuery, setSearchQuery] = useState('');
    const [categoryFilter, setCategoryFilter] = useState<string>('all');

    // Transaction filters
    const [txSearchQuery, setTxSearchQuery] = useState('');
    const [txTypeFilter, setTxTypeFilter] = useState<string>('all');

    // Dialogs
    const [showAddItem, setShowAddItem] = useState(false);
    const [showTransaction, setShowTransaction] = useState(false);
    const [showAddLocation, setShowAddLocation] = useState(false);
    const [editingItem, setEditingItem] = useState<InventoryCatalogItem | null>(null);
    const [selectedItemForTx, setSelectedItemForTx] = useState<InventoryCatalogItem | null>(null);

    // Archive confirmation dialog
    const [archiveConfirm, setArchiveConfirm] = useState<{ open: boolean; item: InventoryCatalogItem | null }>({ open: false, item: null });

    // Location editing
    const [editingLocation, setEditingLocation] = useState<InventoryLocation | null>(null);

    // Snackbar
    const [snackbar, setSnackbar] = useState<{ open: boolean; msg: string; severity: 'success' | 'error' | 'info' }>({ open: false, msg: '', severity: 'info' });

    // ═══════════════════════════════════════
    // REAL-TIME SUBSCRIPTIONS
    // ═══════════════════════════════════════

    useEffect(() => {
        let catalogLoaded = false, txLoaded = false, locLoaded = false;

        const checkAllLoaded = () => {
            if (catalogLoaded && txLoaded && locLoaded) setLoading(false);
        };

        const unsubCatalog = subscribeCatalogItems((items) => {
            setCatalogItems(items);
            catalogLoaded = true;
            checkAllLoaded();
        });

        const unsubTx = subscribeTransactions((txs) => {
            setTransactions(txs);
            txLoaded = true;
            checkAllLoaded();
        });

        const unsubLoc = subscribeLocations((locs) => {
            setLocations(locs);
            locLoaded = true;
            checkAllLoaded();
        });

        return () => {
            unsubCatalog();
            unsubTx();
            unsubLoc();
        };
    }, []);

    // ═══════════════════════════════════════
    // FILTERING
    // ═══════════════════════════════════════

    const filteredItems = useMemo(() => {
        return catalogItems.filter(item => {
            const matchesSearch = !searchQuery ||
                item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (item.sku && item.sku.toLowerCase().includes(searchQuery.toLowerCase()));
            const matchesCategory = categoryFilter === 'all' || item.category === categoryFilter;
            return matchesSearch && matchesCategory;
        });
    }, [catalogItems, searchQuery, categoryFilter]);

    const filteredTransactions = useMemo(() => {
        return transactions.filter(tx => {
            const matchesSearch = !txSearchQuery ||
                tx.catalogItemName.toLowerCase().includes(txSearchQuery.toLowerCase()) ||
                (tx.performedByName && tx.performedByName.toLowerCase().includes(txSearchQuery.toLowerCase()));
            const matchesType = txTypeFilter === 'all' || tx.type === txTypeFilter;
            return matchesSearch && matchesType;
        });
    }, [transactions, txSearchQuery, txTypeFilter]);

    // ═══════════════════════════════════════
    // STATS
    // ═══════════════════════════════════════

    const stats = useMemo(() => {
        const totalItems = catalogItems.length;
        const totalValue = catalogItems.reduce((sum, i) => sum + (i.totalStock * i.avgPrice), 0);
        const toolsOut = catalogItems.filter(i => i.isTrackable && i.assignedTo).length;
        const lowStock = lowStockItems.length;
        return { totalItems, totalValue, toolsOut, lowStock };
    }, [catalogItems, lowStockItems]);

    // ═══════════════════════════════════════
    // HANDLERS
    // ═══════════════════════════════════════

    const handleArchiveRequest = (item: InventoryCatalogItem) => {
        setArchiveConfirm({ open: true, item });
    };

    const handleArchiveConfirmed = async () => {
        if (!archiveConfirm.item) return;
        try {
            await archiveCatalogItem(archiveConfirm.item.id);
            setSnackbar({ open: true, msg: `✅ "${archiveConfirm.item.name}" архивирован`, severity: 'success' });
        } catch (err: unknown) {
            setSnackbar({ open: true, msg: errorMessage(err) || 'Ошибка архивации', severity: 'error' });
        } finally {
            setArchiveConfirm({ open: false, item: null });
        }
    };

    const handleOpenTransaction = (item?: InventoryCatalogItem) => {
        setSelectedItemForTx(item || null);
        setShowTransaction(true);
    };

    const handleDeactivateLocation = async (loc: InventoryLocation) => {
        try {
            await updateLocation(loc.id, { isActive: !loc.isActive });
            setSnackbar({ open: true, msg: loc.isActive ? `"${loc.name}" деактивирована` : `"${loc.name}" активирована`, severity: 'success' });
        } catch (err: unknown) {
            setSnackbar({ open: true, msg: errorMessage(err) || 'Ошибка', severity: 'error' });
        }
    };

    // ═══════════════════════════════════════
    // RENDER
    // ═══════════════════════════════════════

    if (loading) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Container maxWidth="xl" sx={{ py: 3 }}>
            {/* Header */}
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Box>
                    <Typography variant="h4" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <InventoryIcon sx={{ fontSize: 36, color: 'primary.main' }} />
                        Склад
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        Каталог товаров, остатки и движения
                    </Typography>
                </Box>
                <Box display="flex" gap={1}>
                    <Button variant="outlined" startIcon={<TransferIcon />} onClick={() => handleOpenTransaction()}>
                        + Операция
                    </Button>
                    <Button variant="outlined" startIcon={<LocationIcon />} onClick={() => { setEditingLocation(null); setShowAddLocation(true); }}>
                        + Локация
                    </Button>
                    <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setEditingItem(null); setShowAddItem(true); }}>
                        Добавить товар
                    </Button>
                </Box>
            </Box>

            {/* Low Stock Alert */}
            {lowStockItems.length > 0 && (
                <Alert severity="warning" sx={{ mb: 2 }} icon={<WarningIcon />}>
                    <strong>Мало на складе:</strong> {lowStockItems.map(i => `${i.name} (${i.totalStock} ${i.unit})`).join(', ')}
                </Alert>
            )}

            {/* Stats Cards */}
            <Grid container spacing={2} sx={{ mb: 3 }}>
                <Grid size={{ xs: 6, md: 3 }}>
                    <Card sx={{ borderRadius: 2, background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
                        <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
                            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: 1 }}>
                                Позиций
                            </Typography>
                            <Typography variant="h4" fontWeight={700} color="white">
                                {stats.totalItems}
                            </Typography>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid size={{ xs: 6, md: 3 }}>
                    <Card sx={{ borderRadius: 2, background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' }}>
                        <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
                            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: 1 }}>
                                Стоимость склада
                            </Typography>
                            <Typography variant="h4" fontWeight={700} color="white">
                                ${stats.totalValue.toFixed(0)}
                            </Typography>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid size={{ xs: 6, md: 3 }}>
                    <Card sx={{ borderRadius: 2, background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' }}>
                        <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
                            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: 1 }}>
                                Инструментов выдано
                            </Typography>
                            <Typography variant="h4" fontWeight={700} color="white">
                                {stats.toolsOut}
                            </Typography>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid size={{ xs: 6, md: 3 }}>
                    <Card sx={{ borderRadius: 2, background: stats.lowStock > 0 ? 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)' : 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)' }}>
                        <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
                            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: 1 }}>
                                Мало на складе
                            </Typography>
                            <Typography variant="h4" fontWeight={700} color="white">
                                {stats.lowStock}
                            </Typography>
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>

            {/* Tabs */}
            <Paper sx={{ borderRadius: 2 }}>
                <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}>
                    <Tab label={`📦 Каталог (${catalogItems.length})`} />
                    <Tab label={`📜 Движения (${transactions.length})`} />
                    <Tab label={`📍 Локации (${locations.length})`} />
                </Tabs>

                {/* ═══ TAB: CATALOG ═══ */}
                <TabPanel value={tab} index={0}>
                    {/* Filters */}
                    <Box display="flex" gap={2} px={2} pb={2}>
                        <TextField
                            size="small"
                            placeholder="Поиск по названию или артикулу..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            InputProps={{
                                startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment>,
                            }}
                            sx={{ flexGrow: 1 }}
                        />
                        <FormControl size="small" sx={{ minWidth: 180 }}>
                            <InputLabel>Категория</InputLabel>
                            <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} label="Категория">
                                <MenuItem value="all">Все</MenuItem>
                                {Object.entries(INVENTORY_CATEGORY_LABELS).map(([k, v]) => (
                                    <MenuItem key={k} value={k}>{v}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Box>

                    <TableContainer>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>Название</TableCell>
                                    <TableCell>Категория</TableCell>
                                    <TableCell align="right">Остаток</TableCell>
                                    <TableCell align="right">Цена (средн.)</TableCell>
                                    <TableCell align="right">Стоимость</TableCell>
                                    <TableCell align="right">Наценка</TableCell>
                                    <TableCell>Статус</TableCell>
                                    <TableCell align="center">Действия</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {filteredItems.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                                            <Typography color="text.secondary">
                                                {catalogItems.length === 0 ? 'Каталог пуст. Добавьте первый товар!' : 'Ничего не найдено'}
                                            </Typography>
                                        </TableCell>
                                    </TableRow>
                                )}
                                {filteredItems.map((item) => {
                                    const isLow = item.minStock > 0 && item.totalStock <= item.minStock;
                                    const isToolOut = item.isTrackable && item.assignedTo;
                                    return (
                                        <TableRow key={item.id} hover sx={isLow ? { bgcolor: 'error.50' } : undefined}>
                                            <TableCell>
                                                <Box>
                                                    <Typography variant="body2" fontWeight={600}>{item.name}</Typography>
                                                    {item.sku && <Typography variant="caption" color="text.secondary">#{item.sku}</Typography>}
                                                </Box>
                                            </TableCell>
                                            <TableCell>
                                                <Chip
                                                    label={INVENTORY_CATEGORY_LABELS[item.category]}
                                                    size="small"
                                                    variant="outlined"
                                                    sx={{ fontSize: '0.7rem' }}
                                                />
                                            </TableCell>
                                            <TableCell align="right">
                                                <Typography variant="body2" fontWeight={600} color={isLow ? 'error.main' : 'text.primary'}>
                                                    {item.totalStock} {item.unit}
                                                </Typography>
                                                {item.minStock > 0 && (
                                                    <Typography variant="caption" color="text.secondary">
                                                        мин: {item.minStock}
                                                    </Typography>
                                                )}
                                            </TableCell>
                                            <TableCell align="right">
                                                <Typography variant="body2">${item.avgPrice.toFixed(2)}</Typography>
                                            </TableCell>
                                            <TableCell align="right">
                                                <Typography variant="body2" fontWeight={500}>
                                                    ${(item.totalStock * item.avgPrice).toFixed(2)}
                                                </Typography>
                                            </TableCell>
                                            <TableCell align="right">
                                                <Chip label={`+${item.clientMarkupPercent}%`} size="small" color="success" variant="outlined" />
                                            </TableCell>
                                            <TableCell>
                                                {isLow && <Chip label="⚠️ Мало" size="small" color="error" sx={{ mr: 0.5 }} />}
                                                {isToolOut && (
                                                    <Tooltip title={`Выдан: ${item.assignedToName}`}>
                                                        <Chip label={`🔧 ${item.assignedToName}`} size="small" color="info" />
                                                    </Tooltip>
                                                )}
                                                {!isLow && !isToolOut && item.totalStock > 0 && (
                                                    <Chip label="✅ В наличии" size="small" color="success" variant="outlined" />
                                                )}
                                                {item.totalStock === 0 && !isToolOut && (
                                                    <Chip label="❌ Нет" size="small" color="error" variant="outlined" />
                                                )}
                                            </TableCell>
                                            <TableCell align="center">
                                                <Box display="flex" gap={0.5} justifyContent="center">
                                                    <Tooltip title="Операция (приход/расход)">
                                                        <IconButton size="small" color="primary" onClick={() => handleOpenTransaction(item)}>
                                                            <TransferIcon fontSize="small" />
                                                        </IconButton>
                                                    </Tooltip>
                                                    <Tooltip title="Редактировать">
                                                        <IconButton size="small" onClick={() => { setEditingItem(item); setShowAddItem(true); }}>
                                                            <EditIcon fontSize="small" />
                                                        </IconButton>
                                                    </Tooltip>
                                                    <Tooltip title="Архивировать">
                                                        <IconButton size="small" color="error" onClick={() => handleArchiveRequest(item)}>
                                                            <ArchiveIcon fontSize="small" />
                                                        </IconButton>
                                                    </Tooltip>
                                                </Box>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </TabPanel>

                {/* ═══ TAB: TRANSACTIONS ═══ */}
                <TabPanel value={tab} index={1}>
                    {/* Transaction Filters */}
                    <Box display="flex" gap={2} px={2} pb={2}>
                        <TextField
                            size="small"
                            placeholder="Поиск по товару или исполнителю..."
                            value={txSearchQuery}
                            onChange={(e) => setTxSearchQuery(e.target.value)}
                            InputProps={{
                                startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment>,
                            }}
                            sx={{ flexGrow: 1 }}
                        />
                        <FormControl size="small" sx={{ minWidth: 200 }}>
                            <InputLabel>Тип операции</InputLabel>
                            <Select value={txTypeFilter} onChange={(e) => setTxTypeFilter(e.target.value)} label="Тип операции">
                                <MenuItem value="all">Все типы</MenuItem>
                                {Object.entries(TRANSACTION_TYPE_LABELS).map(([k, v]) => (
                                    <MenuItem key={k} value={k}>{v}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Box>

                    <TableContainer sx={{ px: 2 }}>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>Дата</TableCell>
                                    <TableCell>Тип</TableCell>
                                    <TableCell>Товар</TableCell>
                                    <TableCell align="right">Кол-во</TableCell>
                                    <TableCell align="right">Цена</TableCell>
                                    <TableCell align="right">Сумма</TableCell>
                                    <TableCell>Откуда/Куда</TableCell>
                                    <TableCell>Кто</TableCell>
                                    <TableCell align="right">Остаток</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {filteredTransactions.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={9} align="center" sx={{ py: 4 }}>
                                            <Typography color="text.secondary">
                                                {transactions.length === 0 ? 'Нет движений' : 'Ничего не найдено по фильтрам'}
                                            </Typography>
                                        </TableCell>
                                    </TableRow>
                                )}
                                {filteredTransactions.map((tx) => {
                                    const isInbound = INBOUND_TYPES.includes(tx.type);
                                    const date = tx.timestamp?.toDate ? tx.timestamp.toDate() : new Date();
                                    return (
                                        <TableRow key={tx.id} hover>
                                            <TableCell>
                                                <Typography variant="caption">
                                                    {date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                                                    {' '}
                                                    {date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                                                </Typography>
                                            </TableCell>
                                            <TableCell>
                                                <Chip
                                                    label={TRANSACTION_TYPE_LABELS[tx.type]}
                                                    size="small"
                                                    color={isInbound ? 'success' : 'error'}
                                                    variant="outlined"
                                                    sx={{ fontSize: '0.65rem' }}
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <Typography variant="body2" fontWeight={500}>{tx.catalogItemName}</Typography>
                                            </TableCell>
                                            <TableCell align="right">
                                                <Typography variant="body2" color={isInbound ? 'success.main' : 'error.main'} fontWeight={600}>
                                                    {isInbound ? '+' : '−'}{tx.qty}
                                                </Typography>
                                            </TableCell>
                                            <TableCell align="right">
                                                <Typography variant="body2">${tx.unitPrice.toFixed(2)}</Typography>
                                            </TableCell>
                                            <TableCell align="right">
                                                <Typography variant="body2" fontWeight={500}>${tx.totalAmount.toFixed(2)}</Typography>
                                            </TableCell>
                                            <TableCell>
                                                <Typography variant="caption">
                                                    {tx.fromLocation && `${tx.fromLocation}`}
                                                    {tx.fromLocation && tx.toLocation && ' → '}
                                                    {tx.toLocation && `${tx.toLocation}`}
                                                </Typography>
                                            </TableCell>
                                            <TableCell>
                                                <Typography variant="caption">{tx.performedByName}</Typography>
                                            </TableCell>
                                            <TableCell align="right">
                                                <Typography variant="body2">{tx.stockAfter}</Typography>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </TabPanel>

                {/* ═══ TAB: LOCATIONS ═══ */}
                <TabPanel value={tab} index={2}>
                    <Box px={2} pb={2}>
                        <Grid container spacing={2}>
                            {locations.length === 0 && (
                                <Grid size={{ xs: 12 }}>
                                    <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
                                        Нет локаций. Создайте первую!
                                    </Typography>
                                </Grid>
                            )}
                            {locations.map((loc) => (
                                <Grid size={{ xs: 12, sm: 6, md: 4 }} key={loc.id}>
                                    <Card variant="outlined" sx={{ borderRadius: 2, opacity: loc.isActive ? 1 : 0.6 }}>
                                        <CardContent>
                                            <Box display="flex" justifyContent="space-between" alignItems="center">
                                                <Box display="flex" alignItems="center" gap={1}>
                                                    <Typography variant="h6" fontWeight={600}>{loc.name}</Typography>
                                                    {!loc.isActive && <Chip label="Неактивна" size="small" color="default" />}
                                                </Box>
                                                <Box display="flex" alignItems="center" gap={0.5}>
                                                    <Chip
                                                        label={LOCATION_TYPE_LABELS[loc.type]}
                                                        size="small"
                                                        variant="outlined"
                                                    />
                                                    <Tooltip title="Редактировать">
                                                        <IconButton size="small" onClick={() => { setEditingLocation(loc); setShowAddLocation(true); }}>
                                                            <EditIcon fontSize="small" />
                                                        </IconButton>
                                                    </Tooltip>
                                                    <Tooltip title={loc.isActive ? 'Деактивировать' : 'Активировать'}>
                                                        <IconButton size="small" color={loc.isActive ? 'warning' : 'success'} onClick={() => handleDeactivateLocation(loc)}>
                                                            <DeactivateIcon fontSize="small" />
                                                        </IconButton>
                                                    </Tooltip>
                                                </Box>
                                            </Box>
                                            {loc.address && (
                                                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                                                    📍 {loc.address}
                                                </Typography>
                                            )}
                                            {/* Show items at this location */}
                                            <Box sx={{ mt: 1 }}>
                                                {catalogItems
                                                    .filter(item => (item.stockByLocation?.[loc.id] || 0) > 0)
                                                    .slice(0, 5)
                                                    .map(item => (
                                                        <Chip
                                                            key={item.id}
                                                            label={`${item.name}: ${item.stockByLocation[loc.id]}`}
                                                            size="small"
                                                            sx={{ mr: 0.5, mb: 0.5, fontSize: '0.65rem' }}
                                                        />
                                                    ))
                                                }
                                            </Box>
                                        </CardContent>
                                    </Card>
                                </Grid>
                            ))}
                        </Grid>
                    </Box>
                </TabPanel>
            </Paper>

            {/* ═══════════════ DIALOGS ═══════════════ */}

            {/* Add/Edit Item Dialog */}
            <AddEditItemDialog
                open={showAddItem}
                onClose={() => { setShowAddItem(false); setEditingItem(null); }}
                onSave={() => { setShowAddItem(false); setEditingItem(null); }}
                editItem={editingItem}
                userId={currentUser?.uid || ''}
            />

            {/* Transaction Dialog */}
            <TransactionDialog
                open={showTransaction}
                onClose={() => { setShowTransaction(false); setSelectedItemForTx(null); }}
                onSave={() => { setShowTransaction(false); setSelectedItemForTx(null); }}
                item={selectedItemForTx}
                locations={locations}
                catalogItems={catalogItems}
                userId={currentUser?.uid || ''}
                userName={userProfile?.displayName || ''}
            />

            {/* Add/Edit Location Dialog */}
            <AddLocationDialog
                open={showAddLocation}
                onClose={() => { setShowAddLocation(false); setEditingLocation(null); }}
                onSave={() => { setShowAddLocation(false); setEditingLocation(null); }}
                editLocation={editingLocation}
            />

            {/* Archive Confirmation Dialog */}
            <Dialog
                open={archiveConfirm.open}
                onClose={() => setArchiveConfirm({ open: false, item: null })}
                maxWidth="xs"
                fullWidth
            >
                <DialogTitle>📦 Архивировать товар?</DialogTitle>
                <DialogContent>
                    {archiveConfirm.item && (
                        <Box sx={{ mt: 1 }}>
                            <Typography variant="body1" gutterBottom>
                                <strong>{archiveConfirm.item.name}</strong>
                            </Typography>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                                Остаток: {archiveConfirm.item.totalStock} {archiveConfirm.item.unit}
                            </Typography>
                            {archiveConfirm.item.totalStock > 0 && (
                                <Alert severity="warning" variant="outlined" sx={{ mt: 1 }}>
                                    На складе есть остатки. Архивация скроет товар из каталога.
                                </Alert>
                            )}
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setArchiveConfirm({ open: false, item: null })}>Отмена</Button>
                    <Button onClick={handleArchiveConfirmed} variant="contained" color="error">Архивировать</Button>
                </DialogActions>
            </Dialog>

            {/* Snackbar */}
            <Snackbar
                open={snackbar.open}
                autoHideDuration={4000}
                onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert onClose={() => setSnackbar(prev => ({ ...prev, open: false }))} severity={snackbar.severity} variant="filled">
                    {snackbar.msg}
                </Alert>
            </Snackbar>
        </Container>
    );
};

// ═══════════════════════════════════════
// ADD/EDIT ITEM DIALOG
// ═══════════════════════════════════════

interface AddEditItemDialogProps {
    open: boolean;
    onClose: () => void;
    onSave: () => void;
    editItem: InventoryCatalogItem | null;
    userId: string;
}

const AddEditItemDialog: React.FC<AddEditItemDialogProps> = ({ open, onClose, onSave, editItem, userId }) => {
    const [name, setName] = useState('');
    const [sku, setSku] = useState('');
    const [category, setCategory] = useState<InventoryCategory>('materials');
    const [unit, setUnit] = useState<InventoryUnit>('шт');
    const [minStock, setMinStock] = useState(0);
    const [clientMarkup, setClientMarkup] = useState(20);
    const [isTrackable, setIsTrackable] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (editItem) {
            setName(editItem.name);
            setSku(editItem.sku || '');
            setCategory(editItem.category);
            setUnit(editItem.unit);
            setMinStock(editItem.minStock);
            setClientMarkup(editItem.clientMarkupPercent);
            setIsTrackable(editItem.isTrackable);
        } else {
            setName(''); setSku(''); setCategory('materials'); setUnit('шт');
            setMinStock(0); setClientMarkup(20); setIsTrackable(false);
        }
    }, [editItem, open]);

    const handleSave = async () => {
        if (!name.trim()) return;
        setSaving(true);
        try {
            if (editItem) {
                await updateCatalogItem(editItem.id, {
                    name: name.trim(),
                    sku: sku.trim() || undefined,
                    category,
                    unit,
                    minStock,
                    clientMarkupPercent: clientMarkup,
                    isTrackable,
                });
            } else {
                await createCatalogItem({
                    name: name.trim(),
                    sku: sku.trim() || undefined,
                    category,
                    unit,
                    lastPurchasePrice: 0,
                    avgPrice: 0,
                    clientMarkupPercent: clientMarkup,
                    stockByLocation: {},
                    totalStock: 0,
                    minStock,
                    isTrackable,
                    createdBy: userId,
                    isArchived: false,
                });
            }
            onSave();
        } catch (err) {
            console.error('Error saving item:', err);
            alert('Ошибка при сохранении');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>{editItem ? 'Редактировать товар' : '➕ Новый товар'}</DialogTitle>
            <DialogContent>
                <Box display="flex" flexDirection="column" gap={2} sx={{ mt: 1 }}>
                    <TextField label="Название *" value={name} onChange={(e) => setName(e.target.value)} fullWidth />
                    <TextField label="Артикул (SKU)" value={sku} onChange={(e) => setSku(e.target.value)} fullWidth />
                    <Box display="flex" gap={2}>
                        <FormControl fullWidth>
                            <InputLabel>Категория</InputLabel>
                            <Select value={category} onChange={(e) => setCategory(e.target.value as InventoryCategory)} label="Категория">
                                {Object.entries(INVENTORY_CATEGORY_LABELS).map(([k, v]) => (
                                    <MenuItem key={k} value={k}>{v}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <FormControl fullWidth>
                            <InputLabel>Единица</InputLabel>
                            <Select value={unit} onChange={(e) => setUnit(e.target.value as InventoryUnit)} label="Единица">
                                {INVENTORY_UNITS.map(u => (
                                    <MenuItem key={u} value={u}>{u}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Box>
                    <Box display="flex" gap={2}>
                        <TextField
                            label="Мин. остаток"
                            type="number"
                            value={minStock}
                            onChange={(e) => setMinStock(Number(e.target.value))}
                            fullWidth
                        />
                        <TextField
                            label="Наценка клиенту (%)"
                            type="number"
                            value={clientMarkup}
                            onChange={(e) => setClientMarkup(Number(e.target.value))}
                            fullWidth
                        />
                    </Box>
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={isTrackable}
                                onChange={(e) => setIsTrackable(e.target.checked)}
                            />
                        }
                        label="🔧 Инструмент (штучный учёт, выдача/возврат)"
                    />
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Отмена</Button>
                <Button onClick={handleSave} variant="contained" disabled={saving || !name.trim()}>
                    {saving ? 'Сохранение...' : editItem ? 'Сохранить' : 'Создать'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

// ═══════════════════════════════════════
// TRANSACTION DIALOG
// ═══════════════════════════════════════

interface TransactionDialogProps {
    open: boolean;
    onClose: () => void;
    onSave: () => void;
    item: InventoryCatalogItem | null;
    locations: InventoryLocation[];
    catalogItems: InventoryCatalogItem[];
    userId: string;
    userName: string;
}

const TransactionDialog: React.FC<TransactionDialogProps> = ({
    open, onClose, onSave, item, locations, catalogItems, userId, userName
}) => {
    const [txType, setTxType] = useState<TransactionType>('purchase');
    const [qty, setQty] = useState(1);
    const [unitPrice, setUnitPrice] = useState(0);
    const [fromLocation, setFromLocation] = useState('');
    const [toLocation, setToLocation] = useState('');
    const [note, setNote] = useState('');
    const [selectedItem, setSelectedItem] = useState<InventoryCatalogItem | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (item) {
            setSelectedItem(item);
            setUnitPrice(item.lastPurchasePrice || item.avgPrice || 0);
        }
        setTxType('purchase');
        setQty(1);
        setFromLocation('');
        setToLocation('');
        setNote('');
    }, [item, open]);

    const handleSave = async () => {
        const targetItem = selectedItem || item;
        if (!targetItem) return;
        setSaving(true);
        try {
            await createTransaction({
                catalogItemId: targetItem.id,
                catalogItemName: targetItem.name,
                category: targetItem.category,
                type: txType,
                qty,
                unitPrice,
                totalAmount: qty * unitPrice,
                fromLocation: fromLocation || undefined,
                toLocation: toLocation || undefined,
                performedBy: userId,
                performedByName: userName,
                timestamp: Timestamp.now(),
                note: note.trim() || undefined,
            });
            onSave();
        } catch (err: unknown) {
            console.error('Transaction error:', err);
            alert(errorMessage(err) || 'Ошибка при создании операции');
        } finally {
            setSaving(false);
        }
    };

    const isInbound = INBOUND_TYPES.includes(txType);

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>
                📦 Операция: {selectedItem?.name || item?.name || 'Выберите товар'}
            </DialogTitle>
            <DialogContent>
                <Box display="flex" flexDirection="column" gap={2} sx={{ mt: 1 }}>
                    {!item && (
                        <Autocomplete
                            options={catalogItems}
                            getOptionLabel={(o) => o.name}
                            value={selectedItem}
                            onChange={(_, v) => {
                                setSelectedItem(v);
                                if (v) setUnitPrice(v.lastPurchasePrice || v.avgPrice || 0);
                            }}
                            renderInput={(params) => <TextField {...params} label="Товар *" />}
                        />
                    )}
                    <FormControl fullWidth>
                        <InputLabel>Тип операции</InputLabel>
                        <Select value={txType} onChange={(e) => setTxType(e.target.value as TransactionType)} label="Тип операции">
                            {Object.entries(TRANSACTION_TYPE_LABELS).map(([k, v]) => (
                                <MenuItem key={k} value={k}>{v}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <Box display="flex" gap={2}>
                        <TextField
                            label="Количество"
                            type="number"
                            value={qty}
                            onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
                            fullWidth
                        />
                        <TextField
                            label="Цена за ед."
                            type="number"
                            value={unitPrice}
                            onChange={(e) => setUnitPrice(Number(e.target.value))}
                            fullWidth
                            InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                        />
                    </Box>
                    <Typography variant="body2" color="text.secondary">
                        Сумма: <strong>${(qty * unitPrice).toFixed(2)}</strong>
                    </Typography>

                    {!isInbound && (
                        <FormControl fullWidth>
                            <InputLabel>Откуда</InputLabel>
                            <Select value={fromLocation} onChange={(e) => setFromLocation(e.target.value)} label="Откуда">
                                <MenuItem value="">Склад (default)</MenuItem>
                                {locations.map(l => <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>)}
                            </Select>
                        </FormControl>
                    )}
                    {(isInbound || txType === 'transfer') && (
                        <FormControl fullWidth>
                            <InputLabel>Куда</InputLabel>
                            <Select value={toLocation} onChange={(e) => setToLocation(e.target.value)} label="Куда">
                                <MenuItem value="">Склад (default)</MenuItem>
                                {locations.map(l => <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>)}
                            </Select>
                        </FormControl>
                    )}
                    <TextField
                        label="Примечание"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        fullWidth
                        multiline
                        rows={2}
                    />
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Отмена</Button>
                <Button
                    onClick={handleSave}
                    variant="contained"
                    color={isInbound ? 'success' : 'error'}
                    disabled={saving || !(selectedItem || item)}
                >
                    {saving ? 'Выполняется...' : isInbound ? '📥 Приход' : '📤 Расход'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

// ═══════════════════════════════════════
// ADD LOCATION DIALOG
// ═══════════════════════════════════════

interface AddLocationDialogProps {
    open: boolean;
    onClose: () => void;
    onSave: () => void;
    editLocation: InventoryLocation | null;
}

const AddLocationDialog: React.FC<AddLocationDialogProps> = ({ open, onClose, onSave, editLocation }) => {
    const [name, setName] = useState('');
    const [type, setType] = useState<'warehouse' | 'vehicle' | 'jobsite'>('warehouse');
    const [address, setAddress] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (editLocation) {
            setName(editLocation.name);
            setType(editLocation.type);
            setAddress(editLocation.address || '');
        } else {
            setName(''); setType('warehouse'); setAddress('');
        }
    }, [editLocation, open]);

    const handleSave = async () => {
        if (!name.trim()) return;
        setSaving(true);
        try {
            if (editLocation) {
                await updateLocation(editLocation.id, {
                    name: name.trim(),
                    type,
                    address: address.trim() || undefined,
                });
            } else {
                await createLocation({
                    name: name.trim(),
                    type,
                    address: address.trim() || undefined,
                    isActive: true,
                });
            }
            onSave();
        } catch (err) {
            console.error('Error saving location:', err);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle>{editLocation ? '✏️ Редактировать локацию' : '📍 Новая локация'}</DialogTitle>
            <DialogContent>
                <Box display="flex" flexDirection="column" gap={2} sx={{ mt: 1 }}>
                    <TextField label="Название *" value={name} onChange={(e) => setName(e.target.value)} fullWidth />
                    <FormControl fullWidth>
                        <InputLabel>Тип</InputLabel>
                        <Select value={type} onChange={(e) => setType(e.target.value as 'warehouse' | 'vehicle' | 'jobsite')} label="Тип">
                            {Object.entries(LOCATION_TYPE_LABELS).map(([k, v]) => (
                                <MenuItem key={k} value={k}>{v}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <TextField label="Адрес" value={address} onChange={(e) => setAddress(e.target.value)} fullWidth />
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Отмена</Button>
                <Button onClick={handleSave} variant="contained" disabled={saving || !name.trim()}>
                    {saving ? '...' : editLocation ? 'Сохранить' : 'Создать'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default InventoryPage;
