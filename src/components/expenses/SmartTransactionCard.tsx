/**
 * @fileoverview SmartTransactionCard — Pinterest-style transaction card
 * 
 * Dynamic-height card with colored left border (green=income, red=expense, gray=transfer).
 * Features: select mode checkbox, description truncation ("More..."),
 * inline category select, hover action icons, taxYearLocked warning.
 */

import React, { useState } from 'react';
import {
    Box,
    Typography,
    Select,
    MenuItem,
    IconButton,
    Tooltip,
    Chip,
    Checkbox,
    Snackbar,
    Alert,
    type SelectChangeEvent,
} from '@mui/material';
import {
    CallSplit as SplitIcon,
    Rule as RuleIcon,
    AttachFile as AttachIcon,
    DeleteOutline as ExcludeIcon,
    Warning as AmbiguousIcon,
    Lock as LockIcon,
} from '@mui/icons-material';
import {
    type SmartTransaction,
    type TaxCategory,
    DROPDOWN_CATEGORIES,
    CATEGORY_LABELS,
    TYPE_BORDER_COLORS,
} from '../../types/expensesBoard.types';

interface SmartTransactionCardProps {
    transaction: SmartTransaction;
    onCategoryChange: (txId: string, category: TaxCategory) => Promise<{ blocked: boolean; reason?: string }>;
    onSplit?: (tx: SmartTransaction) => void;
    onCreateRule?: (tx: SmartTransaction) => void;
    onAttachReceipt?: (tx: SmartTransaction) => void;
    onExclude?: (tx: SmartTransaction) => void;
    // Select mode
    selectMode?: boolean;
    isSelected?: boolean;
    onToggleSelect?: (txId: string) => void;
}

const SF_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';
const DESCRIPTION_MAX_LENGTH = 80;

const SmartTransactionCard: React.FC<SmartTransactionCardProps> = ({
    transaction: tx,
    onCategoryChange,
    onSplit,
    onCreateRule,
    onAttachReceipt,
    onExclude,
    selectMode = false,
    isSelected = false,
    onToggleSelect,
}) => {
    const [isHovered, setIsHovered] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [lockWarning, setLockWarning] = useState('');
    const borderColor = TYPE_BORDER_COLORS[tx.type];
    const isUncategorized = tx.category === 'uncategorized';
    const isLocked = tx.taxYearLocked === true;
    const needsTruncation = tx.rawDescription && tx.rawDescription.length > DESCRIPTION_MAX_LENGTH;

    const handleCategoryChange = async (e: SelectChangeEvent<string>) => {
        const result = await onCategoryChange(tx.id, e.target.value as TaxCategory);
        if (result.blocked) {
            setLockWarning(result.reason || 'Tax year is locked');
        }
    };

    return (
        <>
            <Box
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                onClick={selectMode ? () => onToggleSelect?.(tx.id) : undefined}
                sx={{
                    breakInside: 'avoid',
                    mb: 2,
                    backgroundColor: isSelected ? '#E3F2FD' : '#fff',
                    borderRadius: '16px',
                    boxShadow: isHovered
                        ? '0 8px 30px rgba(0,0,0,0.12)'
                        : isSelected
                            ? '0 2px 12px rgba(25,118,210,0.15)'
                            : '0 2px 12px rgba(0,0,0,0.06)',
                    borderLeft: `4px solid ${borderColor}`,
                    transition: 'all 0.2s ease',
                    overflow: 'hidden',
                    transform: isHovered ? 'translateY(-2px)' : 'none',
                    fontFamily: SF_FONT,
                    position: 'relative',
                    cursor: selectMode ? 'pointer' : 'default',
                    outline: isSelected ? '2px solid #1976d2' : 'none',
                }}
            >
                {/* ── Select Checkbox ── */}
                {selectMode && (
                    <Box sx={{ position: 'absolute', top: 4, left: 8, zIndex: 2 }}>
                        <Checkbox
                            checked={isSelected}
                            onChange={() => onToggleSelect?.(tx.id)}
                            size="small"
                            sx={{ p: 0.5 }}
                        />
                    </Box>
                )}

                {/* ── Locked Badge ── */}
                {isLocked && (
                    <Tooltip title={`Tax year ${tx.year} is locked`}>
                        <LockIcon sx={{
                            position: 'absolute',
                            top: 8,
                            right: 8,
                            fontSize: 14,
                            color: '#FF9800',
                        }} />
                    </Tooltip>
                )}

                {/* ── Header: Vendor + Amount ── */}
                <Box sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    px: 2,
                    pt: selectMode ? 2 : 1.5,
                    pb: 0.5,
                    pl: selectMode ? 4.5 : 2,
                }}>
                    <Box sx={{ flex: 1, minWidth: 0, mr: 1 }}>
                        <Typography sx={{
                            fontSize: '14px',
                            fontWeight: 700,
                            fontFamily: SF_FONT,
                            color: '#1d1d1f',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}>
                            {tx.vendor || 'Unknown Vendor'}
                        </Typography>
                    </Box>

                    <Typography sx={{
                        fontSize: '18px',
                        fontWeight: 700,
                        fontFamily: SF_FONT,
                        color: tx.type === 'income' ? '#2E7D32' : tx.type === 'transfer' ? '#1565C0' : '#C62828',
                        flexShrink: 0,
                        letterSpacing: '-0.02em',
                    }}>
                        {tx.type === 'income' ? '+' : tx.type === 'transfer' ? '' : '-'}
                        {tx.formattedAmount}
                    </Typography>
                </Box>

                {/* ── Date + Schedule C ── */}
                <Box sx={{ px: 2, pb: 0.5 }}>
                    <Typography sx={{
                        fontSize: '11px',
                        color: '#86868b',
                        fontFamily: SF_FONT,
                    }}>
                        {tx.formattedDate}
                        {tx.scheduleCLine && (
                            <span style={{ marginLeft: 8, color: '#0e7490' }}>
                                📋 {tx.scheduleCLine}
                            </span>
                        )}
                    </Typography>
                </Box>

                {/* ── Description (P2: truncation with "More...") ── */}
                {tx.rawDescription && tx.rawDescription !== tx.vendor && (
                    <Box sx={{ px: 2, pb: 1 }}>
                        <Typography sx={{
                            fontSize: '12px',
                            color: '#6e6e73',
                            fontFamily: SF_FONT,
                            lineHeight: 1.4,
                            wordBreak: 'break-word',
                            maxHeight: isExpanded ? 'none' : '38px',
                            overflow: 'hidden',
                        }}>
                            {tx.rawDescription}
                        </Typography>
                        {needsTruncation && (
                            <Typography
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsExpanded(!isExpanded);
                                }}
                                sx={{
                                    fontSize: '11px',
                                    color: '#007AFF',
                                    cursor: 'pointer',
                                    fontFamily: SF_FONT,
                                    fontWeight: 600,
                                    mt: 0.25,
                                    '&:hover': { textDecoration: 'underline' },
                                }}
                            >
                                {isExpanded ? '▲ Less' : '▼ More...'}
                            </Typography>
                        )}
                    </Box>
                )}

                {/* ── Category + Tags ── */}
                <Box sx={{
                    px: 2,
                    pb: 1,
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 0.5,
                    alignItems: 'center',
                }}>
                    {isUncategorized ? (
                        <Tooltip title={isLocked ? `🔒 Tax year ${tx.year} is locked — category cannot be changed` : ''} arrow>
                            <span>
                                <Select
                                    size="small"
                                    value={tx.category}
                                    onChange={handleCategoryChange}
                                    displayEmpty
                                    disabled={isLocked}
                                    onClick={(e) => e.stopPropagation()}
                                    sx={{
                                        minWidth: 160,
                                        height: 28,
                                        fontSize: '11px',
                                        fontFamily: SF_FONT,
                                        borderRadius: '8px',
                                        bgcolor: isLocked ? '#F5F5F5' : '#FFF3E0',
                                        border: `1px solid ${isLocked ? '#BDBDBD' : '#FF9800'}`,
                                        opacity: isLocked ? 0.6 : 1,
                                        '& .MuiSelect-select': {
                                            py: 0.5,
                                            px: 1,
                                        },
                                    }}
                                >
                                    <MenuItem value="uncategorized" sx={{ fontSize: '12px' }}>
                                        ❓ Select Category...
                                    </MenuItem>
                                    {DROPDOWN_CATEGORIES.map(cat => (
                                        <MenuItem key={cat} value={cat} sx={{ fontSize: '12px' }}>
                                            {CATEGORY_LABELS[cat]}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </span>
                        </Tooltip>
                    ) : (
                        <Chip
                            label={tx.categoryLabel}
                            size="small"
                            sx={{
                                bgcolor: `${tx.categoryColor}18`,
                                color: tx.categoryColor,
                                fontWeight: 600,
                                fontSize: '10px',
                                height: 24,
                                fontFamily: SF_FONT,
                                border: `1px solid ${tx.categoryColor}40`,
                            }}
                        />
                    )}

                    {/* Deductibility badge */}
                    {tx.deductibilityPercent > 0 && tx.deductibilityPercent < 100 && (
                        <Chip label={`${tx.deductibilityPercent}%`} size="small"
                            sx={{ bgcolor: '#FFF8E1', color: '#F57F17', fontSize: '9px', height: 20, fontWeight: 600, fontFamily: SF_FONT }} />
                    )}

                    {/* Refund badge */}
                    {tx.isRefund && (
                        <Chip label="↩ Refund" size="small"
                            sx={{ bgcolor: '#E8F5E9', color: '#2E7D32', fontSize: '9px', height: 20, fontWeight: 600, fontFamily: SF_FONT }} />
                    )}

                    {/* Currency badge */}
                    {tx.originalCurrency && tx.originalCurrency !== 'USD' && (
                        <Chip label={`${tx.originalCurrency} → USD`} size="small"
                            sx={{ bgcolor: '#F3E5F5', color: '#7B1FA2', fontSize: '9px', height: 20, fontWeight: 600, fontFamily: SF_FONT }} />
                    )}

                    {/* Ambiguous vendor */}
                    {tx.isAmbiguous && (
                        <Tooltip title="Ambiguous vendor — needs manual review">
                            <AmbiguousIcon sx={{ fontSize: 16, color: '#FF9800' }} />
                        </Tooltip>
                    )}
                </Box>

                {/* ── Footer Actions (hover) ── */}
                {!selectMode && (
                    <Box sx={{
                        display: 'flex',
                        justifyContent: 'flex-end',
                        gap: 0.25,
                        px: 1.5,
                        pb: 1,
                        opacity: isHovered ? 1 : 0,
                        transition: 'opacity 0.2s ease',
                        height: isHovered ? 'auto' : 0,
                        overflow: 'hidden',
                    }}>
                        <Tooltip title="Split Transaction">
                            <IconButton size="small" onClick={() => onSplit?.(tx)} sx={{ color: '#6e6e73' }}>
                                <SplitIcon sx={{ fontSize: 16 }} />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title="Create Auto-Rule">
                            <IconButton size="small" onClick={() => onCreateRule?.(tx)} sx={{ color: '#6e6e73' }}>
                                <RuleIcon sx={{ fontSize: 16 }} />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title="Attach Receipt">
                            <IconButton size="small" onClick={() => onAttachReceipt?.(tx)} sx={{ color: '#6e6e73' }}>
                                <AttachIcon sx={{ fontSize: 16 }} />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title="Exclude">
                            <IconButton size="small" onClick={() => onExclude?.(tx)} sx={{ color: '#e57373' }}>
                                <ExcludeIcon sx={{ fontSize: 16 }} />
                            </IconButton>
                        </Tooltip>
                    </Box>
                )}
            </Box>

            {/* TaxYearLocked Snackbar */}
            <Snackbar
                open={!!lockWarning}
                autoHideDuration={4000}
                onClose={() => setLockWarning('')}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert severity="warning" onClose={() => setLockWarning('')} sx={{ fontFamily: SF_FONT }}>
                    🔒 {lockWarning}
                </Alert>
            </Snackbar>
        </>
    );
};

export default SmartTransactionCard;
