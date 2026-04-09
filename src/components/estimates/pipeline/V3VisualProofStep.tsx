import React, { useState } from 'react';
import { Box, Typography, Button, Paper, Tabs, Tab, Chip, Stack } from '@mui/material';
import { RasterizedImage } from '../../../hooks/usePdfRasterizer';
import { BlueprintAgentV3Result, BlueprintAgentResult } from '../../../types/blueprint.types';

interface V3VisualProofStepProps {
    images: RasterizedImage[];
    results: Record<string, BlueprintAgentV3Result>;
    aggregatedResult: BlueprintAgentResult;
    onComplete: () => void;
    onBack: () => void;
}

// Function to generate distinct colors for different item types
const stringToColor = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    return '#' + '00000'.substring(0, 6 - c.length) + c;
};

export const V3VisualProofStep: React.FC<V3VisualProofStepProps> = ({ images, results, aggregatedResult, onComplete, onBack }) => {
    const selectedImages = images.filter(img => img.selected && results[img.id]);
    const [activeTab, setActiveTab] = useState(0);

    if (selectedImages.length === 0) {
        return <Typography>No images analyzed.</Typography>;
    }

    const activeImage = selectedImages[activeTab];
    const activeResult = results[activeImage.id];

    return (
        <Box p={2}>
            <Box mb={2} display="flex" justifyContent="space-between" alignItems="center">
                <Typography variant="h6">
                    Step 5: Visual Proof Verification
                </Typography>
                <Chip label={`${Object.keys(aggregatedResult).length} item categories found total`} color="success" />
            </Box>

            <Typography variant="body2" color="text.secondary" mb={3}>
                Review the AI's physical detections. Bounding boxes are drawn exactly where the AI identified the electrical device.
            </Typography>

            <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
                <Tabs value={activeTab} onChange={(e, v) => setActiveTab(v)} variant="scrollable" scrollButtons="auto">
                    {selectedImages.map((img, idx) => (
                        <Tab key={img.id} label={`Page ${img.pageNumber}`} value={idx} />
                    ))}
                </Tabs>
            </Box>

            <Box display="flex" gap={3} height="60vh">
                {/* Image & Bounding Boxes Container */}
                <Paper 
                    variant="outlined" 
                    sx={{ 
                        flex: 1, 
                        position: 'relative', 
                        overflow: 'auto', 
                        bgcolor: '#e0e0e0',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'flex-start'
                    }}
                >
                    <Box sx={{ position: 'relative', display: 'inline-block' }}>
                        <img 
                            src={activeImage.dataUrl} 
                            alt={`Page ${activeImage.pageNumber}`} 
                            style={{ 
                                display: 'block', 
                                maxWidth: '100%', 
                                height: 'auto',
                                border: '1px solid #ccc'
                            }} 
                        />
                        
                        {/* Overlay Bounding Boxes */}
                        {activeResult && Object.entries(activeResult).map(([itemType, boxes]) => {
                            const color = stringToColor(itemType);
                            return boxes.map((box, boxIdx) => {
                                // item is [ymin, xmin, ymax, xmax] or {box: [...], confidence}
                                const boxArr = Array.isArray(box)
                                    ? box
                                    : (box as { box?: number[] } | null | undefined)?.box;
                                if (!boxArr) return null;
                                const [ymin, xmin, ymax, xmax] = boxArr;
                                const top = `${ymin / 10}%`;
                                const left = `${xmin / 10}%`;
                                const height = `${(ymax - ymin) / 10}%`;
                                const width = `${(xmax - xmin) / 10}%`;

                                return (
                                    <Box
                                        key={`${itemType}-${boxIdx}`}
                                        sx={{
                                            position: 'absolute',
                                            top, left, height, width,
                                            border: `2px solid ${color}`,
                                            backgroundColor: `${color}33`, // 33 is 20% opacity hex
                                            pointerEvents: 'none',
                                            '&:hover': {
                                                backgroundColor: `${color}80`, // hover effect if we enable pointerEvents
                                                zIndex: 10
                                            }
                                        }}
                                        title={itemType}
                                    />
                                );
                            });
                        })}
                    </Box>
                </Paper>

                {/* Legend & Summary Sidebar */}
                <Paper variant="outlined" sx={{ width: 250, p: 2, overflowY: 'auto' }}>
                    <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 'bold' }}>
                        Detected on this page
                    </Typography>
                    
                    <Stack spacing={1}>
                        {activeResult && Object.entries(activeResult).map(([itemType, boxes]) => (
                            <Box key={itemType} display="flex" justifyContent="space-between" alignItems="center">
                                <Box display="flex" alignItems="center" gap={1}>
                                    <Box sx={{ width: 12, height: 12, bgcolor: stringToColor(itemType), borderRadius: '2px' }} />
                                    <Typography variant="body2">{itemType}</Typography>
                                </Box>
                                <Typography variant="body2" fontWeight="bold">{boxes.length}</Typography>
                            </Box>
                        ))}
                        {(!activeResult || Object.keys(activeResult).length === 0) && (
                            <Typography variant="body2" color="text.secondary">No items detected.</Typography>
                        )}
                    </Stack>
                </Paper>
            </Box>

            <Box display="flex" justifyContent="space-between" mt={4}>
                <Button onClick={onBack} variant="outlined">Back</Button>
                <Button onClick={onComplete} variant="contained" color="primary" size="large">
                    Apply to Estimate
                </Button>
            </Box>
        </Box>
    );
};
