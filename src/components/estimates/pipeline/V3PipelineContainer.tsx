import React, { useState, useEffect } from 'react';
import { Box, Stepper, Step, StepLabel, Paper, Button, Typography } from '@mui/material';
import { V3UploadStep } from './V3UploadStep';
import { V3PreviewStep } from './V3PreviewStep';
import { V3PromptStep, PromptConfig } from './V3PromptStep';
import { V3ProcessingStep } from './V3ProcessingStep';
import { V3VisualProofStep } from './V3VisualProofStep';
import { RasterizedImage } from '../../../hooks/usePdfRasterizer';
import { BlueprintAgentResult, BlueprintAgentV3Result, BlueprintV3Session } from '../../../types/blueprint.types';
import { blueprintApi } from '../../../api/blueprintApi';
import { v4 as uuidv4 } from 'uuid';

const steps = ['Upload PDFs', 'Review Pages', 'AI Setup', 'Processing', 'Visual Proof'];

interface V3PipelineContainerProps {
    companyId: string;
    userId: string;
    initialSessionId?: string;
    sqft?: number;
    stories?: number;
    projectType?: string;
    onAnalysisComplete: (results: BlueprintAgentResult, v3Results: Record<string, BlueprintAgentV3Result>, anomalies: {itemKey: string, reason: string}[], images: any[]) => void;
    onCancel: () => void;
}

export const V3PipelineContainer: React.FC<V3PipelineContainerProps> = ({ companyId, userId, initialSessionId, sqft, stories, projectType, onAnalysisComplete, onCancel }) => {
    const [sessionId] = useState(() => initialSessionId || uuidv4());
    const [activeStep, setActiveStep] = useState(0);
    const [images, setImages] = useState<RasterizedImage[]>([]);
    const [promptConfig, setPromptConfig] = useState<PromptConfig>({
        templateId: 'standard_residential',
        customInstructions: ''
    });
    const [v3Results, setV3Results] = useState<Record<string, BlueprintAgentV3Result>>({});
    const [aggregatedResult, setAggregatedResult] = useState<BlueprintAgentResult | null>(null);
    const [anomalies, setAnomalies] = useState<{itemKey: string, reason: string}[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [isLoadingSession, setIsLoadingSession] = useState(!!initialSessionId);

    useEffect(() => {
        if (!initialSessionId) return;
        
        const loadSession = async () => {
            try {
                const session = await blueprintApi.getV3Session(initialSessionId);
                if (session) {
                    setActiveStep(session.currentStep);
                    setImages(session.images.map(img => ({
                        id: img.id,
                        originalFileName: img.originalFileName,
                        pageNumber: img.pageNumber,
                        dataUrl: img.storageUrl, // Render using the remote URL
                        storageUrl: img.storageUrl,
                        selected: img.selected,
                        width: img.dimensions?.width,
                        height: img.dimensions?.height
                    })));
                    if (session.promptConfig) {
                        setPromptConfig(session.promptConfig);
                    }
                    if (session.v3Results) {
                        setV3Results(session.v3Results);
                    }
                    if (session.aggregatedResult) {
                        setAggregatedResult(session.aggregatedResult);
                    }
                    if (session.anomalies) {
                        setAnomalies(session.anomalies);
                    }
                }
            } catch (err) {
                console.error("Failed to load V3 session", err);
            } finally {
                setIsLoadingSession(false);
            }
        };
        
        loadSession();
    }, [initialSessionId]);

    const handleNext = () => setActiveStep((prev) => prev + 1);
    const handleBack = () => setActiveStep((prev) => prev - 1);

    const handleUploadComplete = (newImages: RasterizedImage[]) => {
        setImages(newImages);
        handleNext();
    };

    const handleToggleSelect = (id: string) => {
        setImages(prev => prev.map(img => 
            img.id === id ? { ...img, selected: !img.selected } : img
        ));
    };

    const handleRemoveImage = (id: string) => {
        setImages(prev => prev.filter(img => img.id !== id));
    };

    const handleProcessingComplete = (aggregatedData: BlueprintAgentResult, rawV3Data: Record<string, BlueprintAgentV3Result>, anomaliesArray: {itemKey: string, reason: string}[], _logs: any[]) => {
        setAggregatedResult(aggregatedData);
        setV3Results(rawV3Data);
        setAnomalies(anomaliesArray);
        handleNext(); // Move to Step 5: Visual Proof
    };

    const handleVisualProofComplete = () => {
        if (aggregatedResult) {
            onAnalysisComplete(aggregatedResult, v3Results, anomalies, images);
        }
    };

    const handleSaveAndClose = async () => {
        if (!companyId || images.length === 0) {
            onCancel();
            return;
        }
        setIsSaving(true);
        try {
            // Upload selected images to Storage to drop Base64 memory overhead
            const uploadedImages = await blueprintApi.uploadV3Images(companyId, sessionId, images);
            
            const sessionData: BlueprintV3Session = {
                id: sessionId,
                companyId,
                createdBy: userId,
                status: activeStep >= 4 ? 'completed' : 'configuring',
                currentStep: activeStep,
                images: uploadedImages.map(img => ({
                    id: img.id,
                    originalFileName: img.originalFileName,
                    pageNumber: img.pageNumber,
                    storageUrl: img.storageUrl || '',
                    selected: img.selected,
                    dimensions: { width: img.width, height: img.height }
                })),
                promptConfig,
                v3Results,
                aggregatedResult: aggregatedResult || undefined,
                anomalies: anomalies.length > 0 ? anomalies : undefined,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            
            await blueprintApi.saveV3Session(sessionData);
        } catch (error) {
            console.error('Failed to save session for resume:', error);
        } finally {
            setIsSaving(false);
            onCancel();
        }
    };

    return (
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 4 }, mb: 4, bgcolor: '#fafafa' }}>
            <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: 4 }}>
                {steps.map((label) => (
                    <Step key={label}>
                        <StepLabel>{label}</StepLabel>
                    </Step>
                ))}
            </Stepper>

            {isLoadingSession ? (
                <Box display="flex" justifyContent="center" alignItems="center" minHeight={400}>
                    <Typography>Loading saved session...</Typography>
                </Box>
            ) : (
                <Box sx={{ mt: 2, minHeight: 400, bgcolor: 'background.paper', borderRadius: 2, p: 2, border: '1px solid', borderColor: 'divider' }}>
                    {activeStep === 0 && (
                        <V3UploadStep onComplete={handleUploadComplete} />
                    )}
                
                {activeStep === 1 && (
                    <V3PreviewStep 
                        images={images} 
                        onToggleSelect={handleToggleSelect} 
                        onRemove={handleRemoveImage}
                        onNext={handleNext}
                        onBack={handleBack}
                    />
                )}

                {activeStep === 2 && (
                    <V3PromptStep 
                        config={promptConfig}
                        onChange={setPromptConfig}
                        onNext={handleNext}
                        onBack={handleBack}
                    />
                )}

                {activeStep === 3 && (
                    <V3ProcessingStep 
                        images={images}
                        config={promptConfig}
                        sqft={sqft}
                        stories={stories}
                        projectType={projectType}
                        onComplete={handleProcessingComplete}
                        onBack={handleBack}
                    />
                )}

                {activeStep === 4 && aggregatedResult && (
                    <V3VisualProofStep
                        images={images}
                        results={v3Results}
                        aggregatedResult={aggregatedResult}
                        onComplete={handleVisualProofComplete}
                        onBack={handleBack}
                    />
                )}
            </Box>
            )}
            
            {!isLoadingSession && activeStep > 0 && activeStep < 3 && (
                 <Box display="flex" justifyContent="space-between" mt={3}>
                    <Button onClick={onCancel} color="inherit" size="small" disabled={isSaving}>
                        Delete Session
                    </Button>
                    <Button 
                        onClick={handleSaveAndClose} 
                        color="primary" 
                        variant="outlined" 
                        size="small"
                        disabled={isSaving}
                    >
                        {isSaving ? 'Saving...' : 'Save & Resume Later'}
                    </Button>
                </Box>
            )}
        </Paper>
    );
};
