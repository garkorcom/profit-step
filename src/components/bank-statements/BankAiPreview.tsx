/**
 * @fileoverview AI categorization preview dialog with confidence-colored
 * suggestion table and bulk apply/reject actions.
 * @module components/bank-statements/BankAiPreview
 */

import React from 'react';
import {
    Box,
    Typography,
    Button,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Chip,
    CircularProgress,
    Checkbox,
    LinearProgress,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
} from '@mui/material';
import {
    AISuggestion,
    CATEGORY_COLORS,
    CATEGORY_LABELS,
    getConfidenceColor,
} from './bankStatements.types';

interface BankAiPreviewProps {
    open: boolean;
    onClose: () => void;
    aiSuggestions: AISuggestion[];
    selectedSuggestions: Set<string>;
    aiApplying: boolean;
    toggleSuggestion: (txId: string) => void;
    toggleAllSuggestions: () => void;
    applyAiSuggestions: () => void;
}

export const BankAiPreview: React.FC<BankAiPreviewProps> = ({
    open,
    onClose,
    aiSuggestions,
    selectedSuggestions,
    aiApplying,
    toggleSuggestion,
    toggleAllSuggestions,
    applyAiSuggestions,
}) => (
    <Dialog
        open={open}
        onClose={() => !aiApplying && onClose()}
        maxWidth="lg"
        fullWidth
        PaperProps={{ sx: { maxHeight: '90vh' } }}
    >
        <DialogTitle sx={{ pb: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    🤖 AI Категоризация — Предпросмотр
                </Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <Chip
                        label={`🟢 ${aiSuggestions.filter(s => s.confidence >= 0.9).length}`}
                        color="success"
                        size="small"
                        variant="outlined"
                    />
                    <Chip
                        label={`🟡 ${aiSuggestions.filter(s => s.confidence >= 0.7 && s.confidence < 0.9).length}`}
                        color="warning"
                        size="small"
                        variant="outlined"
                    />
                    <Chip
                        label={`🔴 ${aiSuggestions.filter(s => s.confidence < 0.7).length}`}
                        color="error"
                        size="small"
                        variant="outlined"
                    />
                </Box>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Выбрано {selectedSuggestions.size} из {aiSuggestions.length} предложений.
                Зелёные (High) предвыбраны автоматически.
            </Typography>
            {aiApplying && <LinearProgress color="secondary" sx={{ mt: 1 }} />}
        </DialogTitle>
        <DialogContent dividers>
            <TableContainer>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell padding="checkbox">
                                <Checkbox
                                    checked={selectedSuggestions.size === aiSuggestions.length}
                                    indeterminate={selectedSuggestions.size > 0 && selectedSuggestions.size < aiSuggestions.length}
                                    onChange={toggleAllSuggestions}
                                />
                            </TableCell>
                            <TableCell>Vendor</TableCell>
                            <TableCell>Description</TableCell>
                            <TableCell align="right">Amount</TableCell>
                            <TableCell>→ AI Suggestion</TableCell>
                            <TableCell>Confidence</TableCell>
                            <TableCell>Reasoning</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {[...aiSuggestions]
                            .sort((a, b) => b.confidence - a.confidence)
                            .map((suggestion) => (
                                <TableRow
                                    key={suggestion.txId}
                                    hover
                                    sx={{
                                        bgcolor: selectedSuggestions.has(suggestion.txId)
                                            ? suggestion.confidence >= 0.9 ? '#E8F5E9'
                                                : suggestion.confidence >= 0.7 ? '#FFF8E1'
                                                    : '#FFEBEE'
                                            : undefined,
                                        opacity: selectedSuggestions.has(suggestion.txId) ? 1 : 0.6,
                                    }}
                                >
                                    <TableCell padding="checkbox">
                                        <Checkbox
                                            checked={selectedSuggestions.has(suggestion.txId)}
                                            onChange={() => toggleSuggestion(suggestion.txId)}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant="body2" fontWeight={500}>
                                            {suggestion.vendor}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant="caption" color="text.secondary" sx={{
                                            maxWidth: 200,
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                            display: 'block'
                                        }}>
                                            {suggestion.description}
                                        </Typography>
                                    </TableCell>
                                    <TableCell align="right">
                                        <Typography variant="body2" sx={{
                                            color: suggestion.amount < 0 ? 'error.main' : 'success.main',
                                            fontWeight: 500
                                        }}>
                                            ${Math.abs(suggestion.amount).toFixed(2)}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>
                                        <Chip
                                            label={CATEGORY_LABELS[suggestion.suggestedCategory] || suggestion.suggestedCategory}
                                            size="small"
                                            sx={{
                                                bgcolor: CATEGORY_COLORS[suggestion.suggestedCategory],
                                                color: 'white',
                                                fontWeight: 500,
                                                maxWidth: 200,
                                            }}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <Chip
                                            label={`${(suggestion.confidence * 100).toFixed(0)}%`}
                                            size="small"
                                            color={getConfidenceColor(suggestion.confidence)}
                                            variant="outlined"
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant="caption" color="text.secondary" sx={{
                                            maxWidth: 180,
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                            display: 'block'
                                        }}>
                                            {suggestion.reasoning}
                                        </Typography>
                                    </TableCell>
                                </TableRow>
                            ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, justifyContent: 'space-between' }}>
            <Button
                onClick={onClose}
                disabled={aiApplying}
            >
                Отмена
            </Button>
            <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                    variant="outlined"
                    color="primary"
                    onClick={toggleAllSuggestions}
                >
                    {selectedSuggestions.size === aiSuggestions.length ? 'Снять все' : '✅ Выбрать все'}
                </Button>
                <Button
                    variant="contained"
                    color="success"
                    onClick={applyAiSuggestions}
                    disabled={selectedSuggestions.size === 0 || aiApplying}
                    startIcon={aiApplying ? <CircularProgress size={18} color="inherit" /> : <span>✅</span>}
                >
                    {aiApplying
                        ? 'Применяю...'
                        : `Принять выбранные (${selectedSuggestions.size})`}
                </Button>
            </Box>
        </DialogActions>
    </Dialog>
);

export default BankAiPreview;
