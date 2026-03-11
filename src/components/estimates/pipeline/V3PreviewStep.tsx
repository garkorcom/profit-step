import React from 'react';
import { Box, Typography, Button, Grid, Paper, Checkbox, IconButton, Tooltip } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { RasterizedImage } from '../../../hooks/usePdfRasterizer';

interface V3PreviewStepProps {
    images: RasterizedImage[];
    onToggleSelect: (id: string) => void;
    onRemove: (id: string) => void;
    onNext: () => void;
    onBack: () => void;
}

export const V3PreviewStep: React.FC<V3PreviewStepProps> = ({ images, onToggleSelect, onRemove, onNext, onBack }) => {
    const selectedCount = images.filter(img => img.selected).length;

    return (
        <Box p={2}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h6">
                    Step 2: Exclude Irrelevant Pages
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    {selectedCount} of {images.length} pages selected for analysis
                </Typography>
            </Box>

            <Typography variant="body2" color="text.secondary" mb={3}>
                Uncheck pages like covers, legends, or non-electrical plans to save tokens and improve AI accuracy.
            </Typography>

            <Grid container spacing={3} mb={4}>
                {images.map(img => (
                    <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={img.id}>
                        <Paper 
                            variant="outlined" 
                            sx={{ 
                                position: 'relative', 
                                overflow: 'hidden',
                                borderColor: img.selected ? 'primary.main' : 'divider',
                                opacity: img.selected ? 1 : 0.6,
                                transition: 'all 0.2s',
                                cursor: 'pointer'
                            }}
                            onClick={() => onToggleSelect(img.id)}
                        >
                            <Box 
                                sx={{ 
                                    height: 250, 
                                    backgroundImage: `url(${img.dataUrl})`, 
                                    backgroundSize: 'cover', 
                                    backgroundPosition: 'top center' 
                                }} 
                            />
                            <Box p={1} display="flex" justifyContent="space-between" alignItems="center" bgcolor="background.paper" borderTop={1} borderColor="divider">
                                <Box display="flex" alignItems="center">
                                    <Checkbox 
                                        checked={img.selected} 
                                        onChange={() => onToggleSelect(img.id)} 
                                        size="small"
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                    <Typography variant="caption" noWrap sx={{ maxWidth: 120 }}>
                                        {img.originalFileName} (pg {img.pageNumber})
                                    </Typography>
                                </Box>
                                <Tooltip title="Remove permanently">
                                    <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); onRemove(img.id); }}>
                                        <DeleteIcon fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                            </Box>
                        </Paper>
                    </Grid>
                ))}
            </Grid>

            {images.length === 0 && (
                <Typography variant="body2" color="error" textAlign="center">No pages available.</Typography>
            )}

            <Box display="flex" justifyContent="space-between" mt={4}>
                <Button onClick={onBack} variant="outlined">Back</Button>
                <Button 
                    onClick={onNext} 
                    variant="contained" 
                    disabled={selectedCount === 0}
                    color="primary"
                >
                    Continue to Prompt Configuration
                </Button>
            </Box>
        </Box>
    );
};
