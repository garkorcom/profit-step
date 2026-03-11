import React, { useState, useCallback, useRef } from 'react';
import { Box, Typography, CircularProgress, LinearProgress } from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { usePdfRasterizer, RasterizedImage } from '../../../hooks/usePdfRasterizer';

interface V3UploadStepProps {
    onComplete: (images: RasterizedImage[]) => void;
}

export const V3UploadStep: React.FC<V3UploadStepProps> = ({ onComplete }) => {
    const { isRasterizing, progress, statusText, rasterizeFiles } = usePdfRasterizer();
    const [isDragging, setIsDragging] = useState(false);
    const dragCounter = useRef(0);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFiles = useCallback(async (files: File[]) => {
        if (!files || files.length === 0) return;
        const result = await rasterizeFiles(files, 200); // 200 DPI
        if (result && result.length > 0) {
            onComplete(result);
        }
    }, [rasterizeFiles, onComplete]);

    const handleDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault(); e.stopPropagation();
        dragCounter.current++;
        setIsDragging(true);
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault(); e.stopPropagation();
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault(); e.stopPropagation();
        dragCounter.current--;
        if (dragCounter.current === 0) setIsDragging(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault(); e.stopPropagation();
        setIsDragging(false);
        dragCounter.current = 0;
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            handleFiles(Array.from(files));
        }
    }, [handleFiles]);

    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            handleFiles(Array.from(e.target.files));
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    if (isRasterizing) {
        return (
            <Box p={4} textAlign="center" minHeight={300} display="flex" flexDirection="column" justifyContent="center">
                <CircularProgress size={60} sx={{ mx: 'auto', mb: 3 }} />
                <Typography variant="h6" gutterBottom>{statusText}</Typography>
                <Box width="80%" mx="auto">
                    <LinearProgress variant="determinate" value={progress} sx={{ height: 10, borderRadius: 5 }} />
                </Box>
                <Typography variant="caption" color="text.secondary" mt={1}>{progress}%</Typography>
            </Box>
        );
    }

    return (
        <Box p={2}>
            <Box
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                sx={{
                    border: '2px dashed',
                    borderColor: isDragging ? 'primary.main' : 'divider',
                    borderRadius: 2,
                    p: 6,
                    textAlign: 'center',
                    cursor: 'pointer',
                    bgcolor: isDragging ? 'primary.50' : 'background.paper',
                    transition: 'all 0.2s',
                    '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' }
                }}
            >
                <CloudUploadIcon sx={{ fontSize: 60, color: isDragging ? 'primary.main' : 'text.secondary', mb: 2 }} />
                <Typography variant="h5" gutterBottom color={isDragging ? 'primary.main' : 'text.primary'}>
                    {isDragging ? 'Drop PDFs here' : 'Click or drag PDFs to upload'}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    All pages will be locally converted to PNGs for maximum AI accuracy.
                </Typography>
                <input
                    type="file"
                    multiple
                    accept="application/pdf,image/png,image/jpeg"
                    hidden
                    ref={fileInputRef}
                    onChange={handleFileInputChange}
                />
            </Box>
        </Box>
    );
};
