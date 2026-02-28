import React, { useState, useMemo } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, Box, Typography, Table, TableBody, TableCell,
    TableHead, TableRow, TableContainer, Paper, Chip, Select, MenuItem,
    Alert
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import SettingsIcon from '@mui/icons-material/Settings';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

export interface AiMappingDialogProps {
    open: boolean;
    onClose: () => void;
    aiResults: Record<string, number>;
    onApply: (finalMappedResults: Record<string, number>, unmappedItems: Record<string, number>) => void;
    DEVICES: any;
    GEAR: any;
    POOL: any;
    GENERATOR: any;
    LANDSCAPE: any;
}

export const AiMappingDialog = ({ open, onClose, aiResults, onApply, DEVICES, GEAR, POOL, GENERATOR, LANDSCAPE }: AiMappingDialogProps) => {

    const VALID_DEVICES = useMemo(() => {
        const map = new Map<string, string>();
        if (DEVICES) Object.values(DEVICES).flat().forEach((i: any) => map.set(i.id, i.name));
        if (GEAR) GEAR.forEach((i: any) => map.set(i.id, i.name));
        if (POOL) POOL.forEach((i: any) => map.set(i.id, i.name));
        if (GENERATOR) GENERATOR.forEach((i: any) => map.set(i.id, i.name));
        if (LANDSCAPE) LANDSCAPE.forEach((i: any) => map.set(i.id, i.name));
        return map;
    }, [DEVICES, GEAR, POOL, GENERATOR, LANDSCAPE]);

    const initialMapping = useMemo(() => {
        const mapped: Record<string, number> = {};
        const unmapped: Record<string, number> = {};

        Object.entries(aiResults).forEach(([aiKey, qty]) => {
            const cleanKey = aiKey.toLowerCase().replace(/\s+/g, '_');
            if (VALID_DEVICES.has(cleanKey)) {
                if (!mapped[cleanKey]) mapped[cleanKey] = 0;
                mapped[cleanKey] += qty;
            } else if (VALID_DEVICES.has(aiKey)) {
                if (!mapped[aiKey]) mapped[aiKey] = 0;
                mapped[aiKey] += qty;
            } else {
                unmapped[aiKey] = qty;
            }
        });

        return { mapped, unmapped };
    }, [aiResults, VALID_DEVICES]);

    const [manualMap, setManualMap] = useState<Record<string, string>>({});

    const handleAcceptAll = () => {
        const finalMapped = { ...initialMapping.mapped };
        const finalUnmapped: Record<string, number> = {};

        Object.entries(initialMapping.unmapped).forEach(([aiKey, qty]) => {
            const chosenId = manualMap[aiKey];
            if (chosenId && chosenId !== 'ignore') {
                if (!finalMapped[chosenId]) finalMapped[chosenId] = 0;
                finalMapped[chosenId] += qty;
            } else if (chosenId !== 'ignore') {
                finalUnmapped[aiKey] = qty;
            }
        });

        onApply(finalMapped, finalUnmapped);
    };

    const isAllMapped = Object.keys(initialMapping.unmapped).length === 0;

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <AutoAwesomeIcon color="primary" />
                AI Analysis Mapping
            </DialogTitle>

            <DialogContent dividers>
                {isAllMapped ? (
                    <Box textAlign="center" py={4}>
                        <CheckCircleIcon color="success" sx={{ fontSize: 64, mb: 2 }} />
                        <Typography variant="h5" gutterBottom>Perfect Match!</Typography>
                        <Typography color="text.secondary">
                            All {Object.keys(aiResults).length} items found by the AI perfectly match your price list.
                        </Typography>
                    </Box>
                ) : (
                    <Box>
                        <Alert severity="warning" sx={{ mb: 3 }}>
                            Some items identified by the AI don't exactly match your price list.
                            You can map them manually below, or leave them as Unmapped (they will appear in a special section).
                        </Alert>

                        <TableContainer component={Paper} variant="outlined">
                            <Table size="small">
                                <TableHead>
                                    <TableRow sx={{ bgcolor: 'grey.100' }}>
                                        <TableCell>AI Recognized Item</TableCell>
                                        <TableCell align="center">Qty</TableCell>
                                        <TableCell>Mapped To</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {/* Unmapped Items */}
                                    {Object.entries(initialMapping.unmapped).map(([aiKey, qty]) => (
                                        <TableRow key={aiKey} sx={{ bgcolor: 'warning.50' }}>
                                            <TableCell>
                                                <Typography variant="body2" fontWeight="medium">
                                                    {aiKey}
                                                </Typography>
                                            </TableCell>
                                            <TableCell align="center">
                                                <Chip label={qty} size="small" />
                                            </TableCell>
                                            <TableCell>
                                                <Select
                                                    size="small"
                                                    value={manualMap[aiKey] || ''}
                                                    onChange={(e) => setManualMap(prev => ({ ...prev, [aiKey]: e.target.value as string }))}
                                                    displayEmpty
                                                    sx={{ minWidth: 200, bgcolor: 'background.paper', fontSize: 13 }}
                                                >
                                                    <MenuItem value="">
                                                        <em>-- Leave Unmapped --</em>
                                                    </MenuItem>
                                                    <MenuItem value="ignore" sx={{ color: 'error.main' }}>
                                                        <em>Ignore / Delete</em>
                                                    </MenuItem>
                                                    {Array.from(VALID_DEVICES.entries()).map(([id, name]) => (
                                                        <MenuItem key={id} value={id}>{name}</MenuItem>
                                                    ))}
                                                </Select>
                                            </TableCell>
                                        </TableRow>
                                    ))}

                                    {/* Mapped Items */}
                                    {Object.entries(initialMapping.mapped).map(([id, qty]) => (
                                        <TableRow key={id}>
                                            <TableCell>
                                                <Typography variant="body2" color="text.secondary">
                                                    {VALID_DEVICES.get(id) || id}
                                                </Typography>
                                            </TableCell>
                                            <TableCell align="center">
                                                <Chip label={qty} size="small" variant="outlined" />
                                            </TableCell>
                                            <TableCell>
                                                <Box display="flex" alignItems="center" gap={1} color="success.main">
                                                    <CheckCircleIcon fontSize="small" />
                                                    <Typography variant="caption" fontWeight="bold">Auto-Mapped</Typography>
                                                </Box>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    </Box>
                )}
            </DialogContent>

            <DialogActions sx={{ py: 2, px: 3, justifyContent: 'space-between' }}>
                <Button
                    startIcon={<SettingsIcon />}
                    color="inherit"
                    onClick={() => { window.open('/settings/calculator', '_blank'); }}
                >
                    Configure Mapping Rules
                </Button>

                <Box display="flex" gap={1}>
                    <Button onClick={onClose} color="inherit">Cancel</Button>
                    <Button
                        onClick={handleAcceptAll}
                        variant="contained"
                        color="primary"
                        startIcon={<CheckCircleIcon />}
                    >
                        Accept All & Apply
                    </Button>
                </Box>
            </DialogActions>
        </Dialog>
    );
};
