import React, { useEffect, useState, useRef } from 'react';
import { Box, Typography, Button, LinearProgress, Paper, Table, TableBody, TableCell, TableHead, TableRow, TableContainer, Chip } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { RasterizedImage } from '../../../hooks/usePdfRasterizer';
import { PromptConfig } from './V3PromptStep';
import { BlueprintAgentResult, BlueprintAgentV3Result } from '../../../types/blueprint.types';

import { httpsCallable } from 'firebase/functions';
import { functions } from '../../../firebase/firebase';

interface V3ProcessingStepProps {
    images: RasterizedImage[];
    config: PromptConfig;
    sqft?: number;
    stories?: number;
    projectType?: string;
    onComplete: (results: BlueprintAgentResult, rawV3Data: Record<string, BlueprintAgentV3Result>, anomalies: {itemKey: string, reason: string}[], logs: any[]) => void;
    onBack: () => void;
}

export const V3ProcessingStep: React.FC<V3ProcessingStepProps> = ({ images, config, sqft, stories, projectType, onComplete, onBack }) => {
    const selectedImages = images.filter(img => img.selected);
    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle');
    const [logs, setLogs] = useState<{ time: Date; message: string; type: 'info' | 'success' | 'warning' | 'error' }[]>([]);
    const [results, setResults] = useState<Record<string, BlueprintAgentV3Result>>({});
    const [failedIds, setFailedIds] = useState<Set<string>>(new Set());

    const runRef = useRef(false);

    const addLog = (message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
        setLogs(prev => [...prev, { time: new Date(), message, type }]);
    };

    const finalizeAndComplete = async (aggregated: BlueprintAgentResult, rawData: Record<string, BlueprintAgentV3Result>) => {
        addLog('Running plausibility check on final quantities...', 'info');
        try {
            const checkFn = httpsCallable(functions, 'verifyEstimatePlausibilityCallable');
            const checkRes = await checkFn({
                aggregatedResult: aggregated,
                sqFt: sqft,
                stories: stories,
                projectType: projectType
            });
            const anomalies = (checkRes.data as any).anomalies || [];
            if (anomalies.length > 0) {
                addLog(`Plausibility check flagged ${anomalies.length} potential anomalies!`, 'warning');
            } else {
                addLog('Plausibility rules passed.', 'success');
            }
            setTimeout(() => {
                onComplete(aggregated, rawData, anomalies, logs);
            }, 1000);
        } catch (err: any) {
            addLog(`Plausibility check failed: ${err.message}. Proceeding without it.`, 'error');
            setTimeout(() => {
                onComplete(aggregated, rawData, [], logs);
            }, 1000);
        }
    };

    const runAnalysis = async (imagesToRun: RasterizedImage[], isRetry = false) => {
        if (runRef.current || imagesToRun.length === 0) return;
        runRef.current = true;
        setStatus('running');

        if (!isRetry) {
            setResults({});
            setFailedIds(new Set());
            setLogs([]);
            addLog(`Started V3 Pipeline for ${imagesToRun.length} pages...`, 'info');
        } else {
            addLog(`Retrying V3 Pipeline for ${imagesToRun.length} ${imagesToRun.length === 1 ? 'page' : 'pages'}...`, 'info');
            setProgress(0); // Reset for retry progress
        }

        let completed = 0;
        const dataToSave = { ...results };
        const updatedFailed = new Set(failedIds);

        // Run sequentially to protect API limits
        for (const img of imagesToRun) {
            addLog(`Analyzing ${img.originalFileName} (Page ${img.pageNumber})...`, 'info');
            
            try {
                const analyzeFn = httpsCallable(functions, 'analyzeBlueprintV3Callable');
                // Extract pure base64 if not an external URL. If it's a URL, analyzeFn currently doesn't support it directly without a proxy,
                // but since these images are originally dragged in by user, dataUrl usually holds the base64.
                let b64 = img.dataUrl || img.storageUrl || '';
                if (b64.includes(',')) b64 = b64.split(',')[1];
                
                const res = await analyzeFn({ 
                    imageBase64: b64, 
                    templateId: config.templateId, 
                    customInstructions: config.customInstructions 
                });
                const data = (res.data as any).quantities as BlueprintAgentV3Result;
                
                dataToSave[img.id] = data;
                setResults(prev => ({ ...prev, [img.id]: data }));
                updatedFailed.delete(img.id);
                setFailedIds(new Set(updatedFailed));
                
                addLog(`Success: ${img.originalFileName} (pg ${img.pageNumber})`, 'success');
            } catch (err: any) {
                updatedFailed.add(img.id);
                setFailedIds(new Set(updatedFailed));
                addLog(`Error on ${img.originalFileName}: ${err.message}`, 'error');
            }

            completed++;
            setProgress(Math.round((completed / imagesToRun.length) * 100));
        }

        runRef.current = false;

        // Check overall completion state
        if (updatedFailed.size > 0) {
            setStatus('failed');
            addLog(`Finished with ${updatedFailed.size} errors. Awaiting manual retry.`, 'error');
        } else {
            setStatus('completed');
            addLog('All pages processed successfully. Aggregating results...', 'success');
            
            // Build final aggregated response
            const finalAggregated: BlueprintAgentResult = {};
            for (const data of Object.values(dataToSave)) {
                for (const [key, boxes] of Object.entries(data)) {
                    if (Array.isArray(boxes)) {
                        finalAggregated[key] = (finalAggregated[key] || 0) + boxes.length;
                    }
                }
            }
            
            await finalizeAndComplete(finalAggregated, dataToSave);
        }
    };

    const handleContinueAnyhow = () => {
        // Build aggregated response with ONLY the successfully processed images
        const finalAggregated: BlueprintAgentResult = {};
        for (const data of Object.values(results)) {
            for (const [key, boxes] of Object.entries(data)) {
                if (Array.isArray(boxes)) {
                    finalAggregated[key] = (finalAggregated[key] || 0) + boxes.length;
                }
            }
        }
        finalizeAndComplete(finalAggregated, results);
    };

    // Auto-start
    useEffect(() => {
        if (status === 'idle') {
            runAnalysis(selectedImages, false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status]);

    return (
        <Box p={2}>
            <Box mb={2} display="flex" justifyContent="space-between" alignItems="center">
                <Typography variant="h6">
                    Step 4: AI Analysis
                </Typography>
                <Chip 
                    label={status.toUpperCase()} 
                    color={status === 'running' ? 'primary' : status === 'completed' ? 'success' : 'default'} 
                    variant="outlined"
                />
            </Box>

            <LinearProgress variant="determinate" value={progress} sx={{ height: 10, borderRadius: 5, mb: 4 }} />

            <TableContainer component={Paper} variant="outlined" sx={{ mb: 4, maxHeight: 200 }}>
                <Table size="small" stickyHeader>
                    <TableHead>
                        <TableRow>
                            <TableCell>Page</TableCell>
                            <TableCell align="center">Status</TableCell>
                            <TableCell align="center">Items Found</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {selectedImages.map(img => {
                            const res = results[img.id];
                            const isDone = !!res;
                            const totalItems = Object.values(res || {}).reduce((s, v) => s + (Array.isArray(v) ? v.length : 0), 0);
                            
                            return (
                                <TableRow key={img.id}>
                                    <TableCell>
                                        <Typography variant="body2">{img.originalFileName} (pg {img.pageNumber})</Typography>
                                    </TableCell>
                                    <TableCell align="center">
                                        {isDone ? (
                                            <CheckCircleIcon color="success" fontSize="small" />
                                        ) : failedIds.has(img.id) ? (
                                            <Button 
                                                variant="outlined" 
                                                color="error" 
                                                size="small" 
                                                disabled={status === 'running'}
                                                onClick={() => runAnalysis([img], true)}
                                            >
                                                Retry
                                            </Button>
                                        ) : (
                                            <Typography variant="caption" color="text.secondary">Waiting...</Typography>
                                        )}
                                    </TableCell>
                                    <TableCell align="center">
                                        {isDone ? <Chip label={totalItems} size="small" /> : '-'}
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </TableContainer>

            <Box sx={{
                bgcolor: '#121212', p: 1.5, borderRadius: 1,
                fontFamily: 'monospace', height: 140, overflowY: 'auto', textAlign: 'left',
                boxShadow: 'inset 0 0 10px rgba(0,0,0,0.5)', mb: 2
            }}>
                {logs.map((log, i) => {
                    const colorMap = { info: '#ccc', success: '#00ff00', warning: '#ffaa00', error: '#ff5555' };
                    return (
                        <Box key={i} sx={{ mb: 0.3 }}>
                            <Typography variant="body2" component="span" sx={{ color: '#888', mr: 1, fontFamily: 'monospace', fontSize: '0.7rem' }}>
                                [{log.time.toLocaleTimeString()}]
                            </Typography>
                            <Typography variant="body2" component="span" sx={{ color: colorMap[log.type], fontFamily: 'monospace', fontSize: '0.75rem' }}>
                                {log.message}
                            </Typography>
                        </Box>
                    );
                })}
            </Box>
            
            {status === 'failed' && (
                <Box display="flex" justifyContent="space-between" mt={4}>
                    <Button onClick={onBack} variant="outlined">Back</Button>
                    <Box display="flex" gap={2}>
                        <Button onClick={handleContinueAnyhow} variant="outlined" color="warning">Continue Without Failed Pages</Button>
                        <Button 
                            onClick={() => { 
                                const failedImgs = selectedImages.filter(i => failedIds.has(i.id));
                                runAnalysis(failedImgs, true); 
                            }} 
                            variant="contained" 
                            color="secondary"
                        >
                            Retry All Failed
                        </Button>
                    </Box>
                </Box>
            )}
        </Box>
    );
};
