import React, { useState, useMemo } from 'react';
import {
    Box, Typography, Tabs, Tab, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, Paper, Chip, Badge
} from '@mui/material';
import { ITEM_NAMES } from '../../constants/electricalDevices';
import { BlueprintAgentResult } from '../../types/blueprint.types';

interface PageResult {
    fileIndex: number;
    pageIndex: number;
    fileName: string;
    geminiResult?: BlueprintAgentResult;
    claudeResult?: BlueprintAgentResult;
    mergedResult: BlueprintAgentResult;
}

interface PageResultsViewProps {
    pageResults: PageResult[];
    onMergedUpdate?: (merged: BlueprintAgentResult) => void;
}

const PageResultsView: React.FC<PageResultsViewProps> = ({ pageResults, onMergedUpdate }) => {
    const [activeTab, setActiveTab] = useState(0);

    // Combine all page results into one merged table
    const globalMerged = useMemo(() => {
        const merged: BlueprintAgentResult = {};
        pageResults.forEach(pr => {
            for (const [key, qty] of Object.entries(pr.mergedResult)) {
                merged[key] = (merged[key] || 0) + (qty || 0);
            }
        });
        return merged;
    }, [pageResults]);

    const renderTable = (
        result: BlueprintAgentResult,
        gemini?: BlueprintAgentResult,
        claude?: BlueprintAgentResult,
        showAgents: boolean = true
    ) => {
        const items = Object.entries(result).filter(([, qty]) => qty > 0);
        if (items.length === 0) {
            return <Typography color="text.disabled" p={2}>Нет результатов</Typography>;
        }

        return (
            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Позиция</TableCell>
                            <TableCell align="center">Кол-во</TableCell>
                            {showAgents && <TableCell align="center">Gemini</TableCell>}
                            {showAgents && <TableCell align="center">Claude</TableCell>}
                            {showAgents && <TableCell align="center">Статус</TableCell>}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {items.sort((a, b) => b[1] - a[1]).map(([key, qty]) => {
                            const gQty = gemini?.[key] ?? null;
                            const cQty = claude?.[key] ?? null;
                            const match = gQty !== null && cQty !== null && gQty === cQty;
                            const hasDiscrepancy = gQty !== null && cQty !== null && gQty !== cQty;

                            return (
                                <TableRow
                                    key={key}
                                    sx={hasDiscrepancy ? { bgcolor: 'rgba(255,152,0,0.06)' } : {}}
                                >
                                    <TableCell>
                                        <Typography variant="body2">
                                            {ITEM_NAMES[key] || key.replace(/_/g, ' ')}
                                        </Typography>
                                    </TableCell>
                                    <TableCell align="center">
                                        <Typography fontWeight={700}>{qty}</Typography>
                                    </TableCell>
                                    {showAgents && (
                                        <TableCell align="center">
                                            <Typography variant="body2" color={gQty !== null ? 'text.primary' : 'text.disabled'}>
                                                {gQty ?? '—'}
                                            </Typography>
                                        </TableCell>
                                    )}
                                    {showAgents && (
                                        <TableCell align="center">
                                            <Typography variant="body2" color={cQty !== null ? 'text.primary' : 'text.disabled'}>
                                                {cQty ?? '—'}
                                            </Typography>
                                        </TableCell>
                                    )}
                                    {showAgents && (
                                        <TableCell align="center">
                                            {match && <Chip label="✅" size="small" color="success" sx={{ height: 20 }} />}
                                            {hasDiscrepancy && <Chip label="⚠️" size="small" color="warning" sx={{ height: 20 }} />}
                                        </TableCell>
                                    )}
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </TableContainer>
        );
    };

    return (
        <Box>
            <Tabs
                value={activeTab}
                onChange={(_, v) => setActiveTab(v)}
                variant="scrollable"
                scrollButtons="auto"
                sx={{ mb: 2, borderBottom: '1px solid', borderColor: 'divider' }}
            >
                {pageResults.map((pr, i) => {
                    const discrepancyCount = Object.keys(pr.mergedResult).filter(key => {
                        const g = pr.geminiResult?.[key] ?? null;
                        const c = pr.claudeResult?.[key] ?? null;
                        return g !== null && c !== null && g !== c;
                    }).length;

                    return (
                        <Tab
                            key={i}
                            label={
                                <Badge badgeContent={discrepancyCount > 0 ? discrepancyCount : 0} color="warning" max={99}>
                                    <Typography variant="body2">
                                        {pr.fileName.substring(0, 12)}… p.{pr.pageIndex + 1}
                                    </Typography>
                                </Badge>
                            }
                        />
                    );
                })}
                <Tab label={<Typography variant="body2" fontWeight={700}>📊 Сводная</Typography>} />
            </Tabs>

            {/* Content */}
            {activeTab < pageResults.length ? (
                <Box>
                    <Typography variant="caption" color="text.secondary" mb={1} display="block">
                        {pageResults[activeTab].fileName} — Страница {pageResults[activeTab].pageIndex + 1}
                    </Typography>
                    {renderTable(
                        pageResults[activeTab].mergedResult,
                        pageResults[activeTab].geminiResult,
                        pageResults[activeTab].claudeResult,
                        true
                    )}
                </Box>
            ) : (
                <Box>
                    <Typography variant="caption" color="text.secondary" mb={1} display="block">
                        Суммарный результат по всем {pageResults.length} страницам
                    </Typography>
                    {renderTable(globalMerged, undefined, undefined, false)}
                </Box>
            )}
        </Box>
    );
};

export default PageResultsView;
