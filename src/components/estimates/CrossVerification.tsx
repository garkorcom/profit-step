import React, { useMemo, useState } from 'react';
import {
    Box, Typography, Table, TableBody, TableCell, TableContainer,
    TableHead, TableRow, Paper, Button, Chip, Tooltip, LinearProgress
} from '@mui/material';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningIcon from '@mui/icons-material/Warning';
import { ITEM_NAMES } from '../../constants/electricalDevices';
import { BlueprintAgentResult } from '../../types/blueprint.types';

export interface PageVerificationEntry {
    fileIndex: number;
    pageIndex: number;
    fileName: string;
    result: BlueprintAgentResult;
}

export interface VerificationRow {
    itemId: string;
    itemName: string;
    pageValues: { fileIndex: number; pageIndex: number; qty: number }[];
    totalQty: number;
    flags: ('duplicate' | 'outlier' | 'zero' | 'ok')[];
    confidence: 'high' | 'medium' | 'low';
}

function detectFlags(pageValues: { qty: number }[]): ('duplicate' | 'outlier' | 'zero' | 'ok')[] {
    const flags: ('duplicate' | 'outlier' | 'zero' | 'ok')[] = [];
    const qtys = pageValues.map(pv => pv.qty);

    // Check for duplicates (exact same qty on multiple pages)
    const nonZero = qtys.filter(q => q > 0);
    const uniqueNonZero = new Set(nonZero);
    if (nonZero.length > 1 && uniqueNonZero.size === 1) {
        flags.push('duplicate');
    }

    // Check for outlier (one value is 3x+ larger than others)
    if (nonZero.length > 1) {
        const avg = nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
        const hasOutlier = nonZero.some(q => q > avg * 2.5);
        if (hasOutlier) flags.push('outlier');
    }

    // Check zero on "expected" pages
    if (qtys.length > 0 && qtys.every(q => q === 0)) {
        flags.push('zero');
    }

    if (flags.length === 0) flags.push('ok');
    return flags;
}

function getConfidence(flags: ('duplicate' | 'outlier' | 'zero' | 'ok')[]): 'high' | 'medium' | 'low' {
    if (flags.includes('duplicate') || flags.includes('outlier')) return 'low';
    if (flags.includes('zero')) return 'medium';
    return 'high';
}

interface CrossVerificationProps {
    pageEntries: PageVerificationEntry[];
    onRefineRequest?: (itemsToRefine: string[], pageIndices: number[]) => void;
    refining?: boolean;
    refinementRound?: number;
}

const CrossVerification: React.FC<CrossVerificationProps> = ({
    pageEntries, onRefineRequest, refining, refinementRound = 0
}) => {
    const [showOnlyFlags, setShowOnlyFlags] = useState(false);

    const rows: VerificationRow[] = useMemo(() => {
        // Collect all unique item IDs
        const allItems = new Set<string>();
        pageEntries.forEach(pe => Object.keys(pe.result).forEach(k => allItems.add(k)));

        return Array.from(allItems).map(itemId => {
            const pageValues = pageEntries.map(pe => ({
                fileIndex: pe.fileIndex,
                pageIndex: pe.pageIndex,
                qty: pe.result[itemId] || 0,
            }));
            const totalQty = pageValues.reduce((sum, pv) => sum + pv.qty, 0);
            const flags = detectFlags(pageValues);
            const confidence = getConfidence(flags);
            return {
                itemId,
                itemName: ITEM_NAMES[itemId] || itemId.replace(/_/g, ' '),
                pageValues,
                totalQty,
                flags,
                confidence,
            };
        }).filter(r => r.totalQty > 0).sort((a, b) => {
            // Flagged items first
            const af = a.flags.includes('ok') ? 1 : 0;
            const bf = b.flags.includes('ok') ? 1 : 0;
            if (af !== bf) return af - bf;
            return b.totalQty - a.totalQty;
        });
    }, [pageEntries]);

    const displayed = showOnlyFlags ? rows.filter(r => !r.flags.includes('ok')) : rows;
    const flaggedCount = rows.filter(r => !r.flags.includes('ok')).length;
    const allOk = flaggedCount === 0;

    const handleRefine = () => {
        const flaggedItems = rows.filter(r => !r.flags.includes('ok')).map(r => r.itemId);
        const flaggedPages = new Set<number>();
        rows.filter(r => !r.flags.includes('ok')).forEach(r => {
            r.pageValues.forEach(pv => {
                if (pv.qty > 0) flaggedPages.add(pv.pageIndex);
            });
        });
        onRefineRequest?.(flaggedItems, Array.from(flaggedPages));
    };

    const flagChip = (flag: string) => {
        switch (flag) {
            case 'duplicate': return <Chip label="🔁 Дубликат?" size="small" color="warning" sx={{ height: 20, fontSize: '0.65rem' }} />;
            case 'outlier': return <Chip label="📈 Выброс" size="small" color="error" sx={{ height: 20, fontSize: '0.65rem' }} />;
            case 'zero': return <Chip label="∅ Пусто" size="small" sx={{ height: 20, fontSize: '0.65rem' }} />;
            default: return <Chip label="✅" size="small" color="success" sx={{ height: 20, fontSize: '0.65rem' }} />;
        }
    };

    return (
        <Box>
            {/* Header */}
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
                <Box display="flex" alignItems="center" gap={1}>
                    <CompareArrowsIcon color="primary" />
                    <Typography variant="subtitle1" fontWeight={700}>
                        Сверка таблиц
                    </Typography>
                    {allOk ? (
                        <Chip icon={<CheckCircleIcon />} label="Всё сошлось" color="success" size="small" />
                    ) : (
                        <Chip icon={<WarningIcon />} label={`${flaggedCount} проблем`} color="warning" size="small" />
                    )}
                    {refinementRound > 0 && (
                        <Chip label={`Раунд ${refinementRound}/3`} size="small" variant="outlined" />
                    )}
                </Box>
                <Box display="flex" gap={1}>
                    <Button
                        size="small"
                        variant={showOnlyFlags ? 'contained' : 'outlined'}
                        color="warning"
                        onClick={() => setShowOnlyFlags(!showOnlyFlags)}
                    >
                        {showOnlyFlags ? 'Показать все' : `Только проблемы (${flaggedCount})`}
                    </Button>
                    {!allOk && onRefineRequest && (
                        <Button
                            variant="contained"
                            startIcon={refining ? undefined : <RefreshIcon />}
                            onClick={handleRefine}
                            disabled={refining || refinementRound >= 3}
                            sx={{ fontWeight: 600 }}
                        >
                            {refining ? 'Пересчёт...' : '🔄 Пересчитать расхождения'}
                        </Button>
                    )}
                </Box>
            </Box>

            {refining && <LinearProgress sx={{ mb: 2, borderRadius: 1 }} />}

            {/* Diff Table */}
            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Позиция</TableCell>
                            {pageEntries.map((pe, i) => (
                                <TableCell key={i} align="center" sx={{ fontSize: '0.7rem', maxWidth: 80 }}>
                                    <Tooltip title={pe.fileName}>
                                        <span>P{pe.pageIndex + 1}</span>
                                    </Tooltip>
                                </TableCell>
                            ))}
                            <TableCell align="center" sx={{ fontWeight: 700 }}>Итого</TableCell>
                            <TableCell align="center">Флаги</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {displayed.map(row => (
                            <TableRow
                                key={row.itemId}
                                sx={{
                                    bgcolor: row.confidence === 'low' ? 'rgba(255,87,34,0.04)'
                                        : row.confidence === 'medium' ? 'rgba(255,152,0,0.04)'
                                            : 'inherit'
                                }}
                            >
                                <TableCell>
                                    <Typography variant="body2">{row.itemName}</Typography>
                                </TableCell>
                                {row.pageValues.map((pv, i) => (
                                    <TableCell key={i} align="center">
                                        <Typography
                                            variant="body2"
                                            fontWeight={pv.qty > 0 ? 600 : 400}
                                            color={pv.qty > 0 ? 'text.primary' : 'text.disabled'}
                                        >
                                            {pv.qty || '—'}
                                        </Typography>
                                    </TableCell>
                                ))}
                                <TableCell align="center">
                                    <Typography variant="body2" fontWeight={700}>{row.totalQty}</Typography>
                                </TableCell>
                                <TableCell align="center">
                                    <Box display="flex" gap={0.3} flexWrap="wrap" justifyContent="center">
                                        {row.flags.map((f, i) => <React.Fragment key={i}>{flagChip(f)}</React.Fragment>)}
                                    </Box>
                                </TableCell>
                            </TableRow>
                        ))}
                        {displayed.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={pageEntries.length + 3} align="center">
                                    <Typography color="text.disabled" p={2}>Нет проблемных позиций 🎉</Typography>
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </TableContainer>
        </Box>
    );
};

export default CrossVerification;
