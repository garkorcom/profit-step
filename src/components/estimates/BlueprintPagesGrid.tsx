import React, { useState } from 'react';
import {
    Box, Typography, Paper, Checkbox, Button, IconButton, Grid
} from '@mui/material';
import SelectAllIcon from '@mui/icons-material/SelectAll';
import DeselectIcon from '@mui/icons-material/Deselect';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DownloadIcon from '@mui/icons-material/Download';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import { PdfPageImage, downloadPageAsPng, downloadAllPagesAsPng } from '../../services/pdfToImageService';

export interface FilePages {
    fileIndex: number;
    fileName: string;
    pages: PdfPageImage[];
}

interface BlueprintPagesGridProps {
    filePages: FilePages;                // Single file (not an array)
    fileLabel: string;                   // e.g. "Файл 3 из 8: E-1 Electrical..."
    selectedPages: Set<string>;          // "fileIdx-pageIdx" keys
    onSelectionChange: (selected: Set<string>) => void;
    onApprove: () => void;               // Approve file & move to next
    onSkip: () => void;                  // Skip file & move to next
    onBack?: () => void;                 // Go back to previous file
    canGoBack: boolean;
}

const BlueprintPagesGrid: React.FC<BlueprintPagesGridProps> = ({
    filePages, fileLabel, selectedPages, onSelectionChange,
    onApprove, onSkip, onBack, canGoBack,
}) => {
    const [zoomPage, setZoomPage] = useState<string | null>(null);
    const [zoomUrl, setZoomUrl] = useState<string>('');

    const makeKey = (fi: number, pi: number) => `${fi}-${pi}`;
    const totalPages = filePages.pages.length;
    const selectedCount = selectedPages.size;

    const togglePage = (key: string) => {
        const next = new Set(selectedPages);
        if (next.has(key)) next.delete(key); else next.add(key);
        onSelectionChange(next);
    };

    const selectAll = () => {
        const all = new Set<string>();
        filePages.pages.forEach(p => all.add(makeKey(filePages.fileIndex, p.pageIndex)));
        onSelectionChange(all);
    };

    const deselectAll = () => onSelectionChange(new Set());

    const handleZoom = (page: PdfPageImage, key: string) => {
        // Use full-res blob for zoom (not compressed thumbnail)
        const fullResUrl = URL.createObjectURL(page.blob);
        setZoomUrl(fullResUrl);
        setZoomPage(key);
    };

    const closeZoom = () => {
        if (zoomUrl) URL.revokeObjectURL(zoomUrl);
        setZoomPage(null);
        setZoomUrl('');
    };

    return (
        <Box>
            {/* File Header */}
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={1.5}>
                <Box display="flex" alignItems="center" gap={1}>
                    {canGoBack && onBack && (
                        <IconButton size="small" onClick={onBack}>
                            <ArrowBackIcon fontSize="small" />
                        </IconButton>
                    )}
                    <Typography variant="subtitle1" fontWeight={700}>
                        {fileLabel}
                    </Typography>
                </Box>
            </Box>

            {/* Toolbar */}
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
                <Box display="flex" alignItems="center" gap={1}>
                    <Typography variant="body2" color="text.secondary">
                        {selectedCount}/{totalPages} стр. выбрано
                    </Typography>
                </Box>
                <Box display="flex" gap={1} flexWrap="wrap">
                    <Button size="small" startIcon={<SelectAllIcon />} onClick={selectAll} variant="outlined">
                        Все
                    </Button>
                    <Button size="small" startIcon={<DeselectIcon />} onClick={deselectAll} variant="outlined" color="inherit">
                        Снять
                    </Button>
                    <Button
                        size="small"
                        startIcon={<DownloadIcon />}
                        onClick={() => downloadAllPagesAsPng(filePages.pages, filePages.fileName)}
                        variant="outlined"
                        color="inherit"
                    >
                        ⬇ Все PNG
                    </Button>
                </Box>
            </Box>

            {/* Pages Grid */}
            <Grid container spacing={1.5}>
                {filePages.pages.map(page => {
                    const key = makeKey(filePages.fileIndex, page.pageIndex);
                    const isSelected = selectedPages.has(key);
                    return (
                        <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={key}>
                            <Paper
                                elevation={0}
                                sx={{
                                    border: '2px solid',
                                    borderColor: isSelected ? 'primary.main' : 'divider',
                                    borderRadius: 2,
                                    overflow: 'hidden',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease',
                                    opacity: isSelected ? 1 : 0.6,
                                    '&:hover': {
                                        borderColor: 'primary.light',
                                        opacity: 1,
                                        transform: 'translateY(-1px)',
                                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                                    },
                                    position: 'relative',
                                }}
                                onClick={() => togglePage(key)}
                            >
                                {/* Thumbnail */}
                                <Box sx={{ position: 'relative', bgcolor: 'grey.100' }}>
                                    <img
                                        src={page.dataUrl}
                                        alt={`${filePages.fileName} p.${page.pageIndex + 1}`}
                                        style={{
                                            width: '100%',
                                            height: 260,
                                            objectFit: 'contain',
                                            display: 'block',
                                        }}
                                    />
                                    {/* Zoom button */}
                                    <IconButton
                                        size="small"
                                        sx={{
                                            position: 'absolute', top: 4, right: 4,
                                            bgcolor: 'rgba(255,255,255,0.85)',
                                            '&:hover': { bgcolor: 'white' },
                                        }}
                                        onClick={(e) => { e.stopPropagation(); handleZoom(page, key); }}
                                    >
                                        <ZoomInIcon fontSize="small" />
                                    </IconButton>
                                    {/* Download button */}
                                    <IconButton
                                        size="small"
                                        sx={{
                                            position: 'absolute', top: 4, right: 36,
                                            bgcolor: 'rgba(255,255,255,0.85)',
                                            '&:hover': { bgcolor: 'white' },
                                        }}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            downloadPageAsPng(page.blob, filePages.fileName, page.pageIndex);
                                        }}
                                    >
                                        <DownloadIcon fontSize="small" />
                                    </IconButton>
                                    {/* Selection checkbox */}
                                    <Checkbox
                                        checked={isSelected}
                                        size="small"
                                        sx={{
                                            position: 'absolute', top: 2, left: 2,
                                            bgcolor: 'rgba(255,255,255,0.85)',
                                            borderRadius: 1,
                                            p: 0.3,
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                        onChange={() => togglePage(key)}
                                    />
                                </Box>
                                {/* Footer */}
                                <Box px={1} py={0.5} display="flex" justifyContent="space-between" alignItems="center">
                                    <Typography variant="caption" fontWeight={600}>
                                        Стр. {page.pageIndex + 1}
                                    </Typography>
                                </Box>
                            </Paper>
                        </Grid>
                    );
                })}
            </Grid>

            {/* Action Buttons */}
            <Box display="flex" justifyContent="space-between" alignItems="center" mt={2.5} flexWrap="wrap" gap={1}>
                <Button
                    variant="outlined"
                    color="inherit"
                    startIcon={<SkipNextIcon />}
                    onClick={onSkip}
                    size="small"
                >
                    Пропустить файл
                </Button>
                <Button
                    variant="contained"
                    color="primary"
                    startIcon={<CheckCircleIcon />}
                    onClick={onApprove}
                    disabled={selectedCount === 0}
                    sx={{ fontWeight: 600 }}
                >
                    ✅ Согласовать ({selectedCount} стр.)
                </Button>
            </Box>

            {/* Zoom Modal */}
            {zoomPage && (
                <Box
                    sx={{
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                        bgcolor: 'rgba(0,0,0,0.85)', zIndex: 9999,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer',
                    }}
                    onClick={closeZoom}
                >
                    <img
                        src={zoomUrl}
                        alt="Preview"
                        style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain' }}
                    />
                </Box>
            )}
        </Box>
    );
};

export default BlueprintPagesGrid;
