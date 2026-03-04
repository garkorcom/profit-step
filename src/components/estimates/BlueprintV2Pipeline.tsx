/**
 * BlueprintV2Pipeline — Orchestrates the per-file V2 pipeline:
 * 1. file-convert: Convert current PDF → PNG pages (one file at a time)
 * 2. file-review: Preview + select pages for the current file
 * 3. summary: Review all approved files before analysis
 * 4. analyzing: Per-page AI analysis (Gemini + Claude) via callable
 * 5. results: Tabbed per-page results view
 * 6. verifying: Cross-verify + iterative refinement
 */
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
    Box, Typography, LinearProgress, Button, Stepper, Step, StepLabel,
    Alert, CircularProgress
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import { ref, uploadBytes } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { storage, functions } from '../../firebase/firebase';
import { convertPdfToImages, readFileAsDataUrl } from '../../services/pdfToImageService';
import BlueprintPagesGrid, { FilePages } from './BlueprintPagesGrid';
import BlueprintFileSummary from './BlueprintFileSummary';
import PageResultsView from './PageResultsView';
import CrossVerification, { PageVerificationEntry } from './CrossVerification';
import { BlueprintAgentResult } from '../../types/blueprint.types';
import { exportBlueprintPdf } from '../../utils/exportBlueprintPdf';
import { useAuth } from '../../auth/AuthContext';

interface PageAnalysisResult {
    fileIndex: number;
    pageIndex: number;
    fileName: string;
    storagePath: string;
    geminiResult: BlueprintAgentResult;
    claudeResult: BlueprintAgentResult;
    mergedResult: BlueprintAgentResult;
}

type PipelinePhase =
    | 'file-convert'   // Converting current PDF → PNG
    | 'file-review'    // Preview + select pages for current file
    | 'summary'        // Summary of all files before AI analysis
    | 'analyzing'      // AI analysis in progress
    | 'results'        // Per-page results
    | 'verifying';     // Cross-verification

const PHASE_LABELS = ['Файлы', 'Сводка', 'Анализ AI', 'Результаты', 'Сверка'];

function getStepIndex(phase: PipelinePhase): number {
    switch (phase) {
        case 'file-convert':
        case 'file-review':
            return 0;
        case 'summary':
            return 1;
        case 'analyzing':
            return 2;
        case 'results':
            return 3;
        case 'verifying':
            return 4;
    }
}

interface BlueprintV2PipelineProps {
    files: File[];
    onComplete: (finalResult: BlueprintAgentResult, aiResults: { gemini: Record<string, number>, claude: Record<string, number>, openai: Record<string, number> }) => void;
    onCancel: () => void;
}

const BlueprintV2Pipeline: React.FC<BlueprintV2PipelineProps> = ({ files, onComplete, onCancel }) => {
    const { userProfile } = useAuth();
    const [phase, setPhase] = useState<PipelinePhase>('file-convert');
    const [progress, setProgress] = useState('');
    const [error, setError] = useState('');

    // Per-file navigation
    const [currentFileIndex, setCurrentFileIndex] = useState(0);
    const [currentFilePages, setCurrentFilePages] = useState<FilePages | null>(null);
    const [currentFileSelected, setCurrentFileSelected] = useState<Set<string>>(new Set());

    // Approved files map: fileIndex → { filePages, selectedPages }
    const [approvedFiles, setApprovedFiles] = useState<Map<number, { filePages: FilePages; selectedPages: Set<string> }>>(new Map());

    // Analysis results
    const [pageResults, setPageResults] = useState<PageAnalysisResult[]>([]);
    const [analysisProgress, setAnalysisProgress] = useState({ done: 0, total: 0 });

    // Selected AI Agents
    const [selectedAgents, setSelectedAgents] = useState<string[]>(['gemini', 'claude']);

    // Prompt Configuration
    const [projectType, setProjectType] = useState<string>('residential');
    const [squareFootage, setSquareFootage] = useState<string>('2500');
    const [customPrompt, setCustomPrompt] = useState<string>(
        'Sanity check: Для жилого дома на 2500 кв. футов физически не может быть больше 1-2 главных щитов (panel_200). Обратите внимание на масштаб (розеток не может быть 200+ для одного дома). Сверь свой ответ с логикой.'
    );

    const handleProjectTypeChange = (type: string) => {
        setProjectType(type);
        const sq = squareFootage || 'X';
        if (type === 'residential') setCustomPrompt(`Sanity check: Для жилого дома на ${sq} кв. футов физически не может быть больше 1-2 главных щитов (panel_200). Обратите внимание на масштаб (розеток не может быть 200+ для одного дома). Сверь свой ответ с логикой.`);
        else if (type === 'commercial') setCustomPrompt(`Sanity check: Это коммерческое помещение на ${sq} кв. футов. Ожидается большое количество освещения и розеток (например, 100+).`);
        else if (type === 'multifamily') setCustomPrompt(`Sanity check: Это многоквартирный дом на ${sq} кв. футов. Ожидается множество subpanel_100 (по одной на квартиру).`);
    };

    // Editable result (user can modify quantities after analysis)
    const [editedResult, setEditedResult] = useState<BlueprintAgentResult>({});

    // Refinement
    const [refining, setRefining] = useState(false);
    const [refinementRound, setRefinementRound] = useState(0);

    // Timer
    const [startTime, setStartTime] = useState<number | null>(null);
    const [elapsed, setElapsed] = useState(0);
    const cancelledRef = useRef(false);
    const convertingRef = useRef(false);

    const stepIndex = getStepIndex(phase);

    // Timer effect
    useEffect(() => {
        if (!startTime) return;
        const interval = setInterval(() => {
            setElapsed(Math.floor((Date.now() - startTime) / 1000));
        }, 1000);
        return () => clearInterval(interval);
    }, [startTime]);

    const formatTime = (s: number) => {
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return m > 0 ? `${m}м ${sec}с` : `${sec}с`;
    };

    // ===== Convert current file =====
    const convertCurrentFile = useCallback(async (fileIdx: number) => {
        if (convertingRef.current) return;
        convertingRef.current = true;
        setPhase('file-convert');
        setError('');
        setStartTime(Date.now());
        cancelledRef.current = false;
        setCurrentFilePages(null);

        const file = files[fileIdx];
        setProgress(`📄 Конвертация: ${file.name} (файл ${fileIdx + 1} из ${files.length})...`);

        try {
            if (file.type === 'application/pdf') {
                const pages = await convertPdfToImages(file, 2.0, (current, total) => {
                    setProgress(`📄 ${file.name}: стр. ${current}/${total}`);
                });
                if (cancelledRef.current) { convertingRef.current = false; return; }
                const fp: FilePages = { fileIndex: fileIdx, fileName: file.name, pages };
                setCurrentFilePages(fp);
                // Auto-select all pages
                const keys = new Set(pages.map(p => `${fileIdx}-${p.pageIndex}`));
                setCurrentFileSelected(keys);
            } else {
                // Image file — single page
                const dataUrl = await readFileAsDataUrl(file);
                if (cancelledRef.current) { convertingRef.current = false; return; }
                const fp: FilePages = {
                    fileIndex: fileIdx,
                    fileName: file.name,
                    pages: [{ pageIndex: 0, blob: file, width: 0, height: 0, dataUrl }],
                };
                setCurrentFilePages(fp);
                setCurrentFileSelected(new Set([`${fileIdx}-0`]));
            }
        } catch (err: any) {
            console.error(`Failed to convert ${file.name}:`, err);
            setError(`Ошибка: ${file.name}: ${err.message}`);
        }

        setStartTime(null);
        setPhase('file-review');
        setProgress('');
        convertingRef.current = false;
    }, [files]);

    // Auto-start conversion when currentFileIndex changes
    useEffect(() => {
        if (phase === 'file-convert' && currentFileIndex < files.length) {
            convertCurrentFile(currentFileIndex);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentFileIndex]);

    // Initial auto-start
    useEffect(() => {
        if (files.length > 0) {
            convertCurrentFile(0);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ===== Approve / Skip / Back =====
    const handleApproveFile = useCallback(() => {
        if (!currentFilePages) return;
        // Memory optimization: only keep blobs for selected pages
        const selectedSet = new Set(currentFileSelected);
        const leanPages: FilePages = {
            ...currentFilePages,
            pages: currentFilePages.pages.filter(p =>
                selectedSet.has(`${currentFilePages.fileIndex}-${p.pageIndex}`)
            ),
        };
        setApprovedFiles(prev => {
            const next = new Map(prev);
            next.set(currentFileIndex, {
                filePages: leanPages,
                selectedPages: selectedSet,
            });
            return next;
        });
        moveToNextFile();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentFilePages, currentFileSelected, currentFileIndex, files.length]);

    const handleSkipFile = useCallback(() => {
        // Remove from approved if previously approved
        setApprovedFiles(prev => {
            const next = new Map(prev);
            next.delete(currentFileIndex);
            return next;
        });
        moveToNextFile();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentFileIndex, files.length]);

    const moveToNextFile = () => {
        if (currentFileIndex < files.length - 1) {
            const nextIdx = currentFileIndex + 1;
            setCurrentFileIndex(nextIdx);
            setPhase('file-convert');
        } else {
            setPhase('summary');
        }
    };

    const handleGoBackToFile = useCallback((fileIdx: number) => {
        // Check if we already have this file approved — restore its state
        const approved = approvedFiles.get(fileIdx);
        if (approved) {
            setCurrentFilePages(approved.filePages);
            setCurrentFileSelected(new Set(approved.selectedPages));
            setCurrentFileIndex(fileIdx);
            setPhase('file-review');
        } else {
            setCurrentFileIndex(fileIdx);
            setPhase('file-convert');
        }
    }, [approvedFiles]);

    // ===== Analysis (using all approved pages) =====
    const startAnalysis = useCallback(async () => {
        if (!userProfile?.id) return;
        setPhase('analyzing');

        setError('');
        setStartTime(Date.now());
        cancelledRef.current = false;

        // Collect all selected pages from approved files
        const pagesToAnalyze: { fileIndex: number; pageIndex: number; fileName: string; blob: Blob }[] = [];
        approvedFiles.forEach((af) => {
            af.filePages.pages.forEach(p => {
                const key = `${af.filePages.fileIndex}-${p.pageIndex}`;
                if (af.selectedPages.has(key)) {
                    pagesToAnalyze.push({
                        fileIndex: af.filePages.fileIndex,
                        pageIndex: p.pageIndex,
                        fileName: af.filePages.fileName,
                        blob: p.blob,
                    });
                }
            });
        });

        setAnalysisProgress({ done: 0, total: pagesToAnalyze.length });
        const results: PageAnalysisResult[] = [];
        const analyzePageFn = httpsCallable(functions, 'analyzePageCallable');
        let failedCount = 0;

        for (let i = 0; i < pagesToAnalyze.length; i++) {
            if (cancelledRef.current) break;
            const page = pagesToAnalyze[i];
            setProgress(`🔍 Анализ ${i + 1}/${pagesToAnalyze.length}: ${page.fileName} стр.${page.pageIndex + 1}...`);

            try {
                const storagePath = `blueprints/${userProfile.id}/v2_pages/${Date.now()}_${page.fileIndex}_p${page.pageIndex}.png`;
                const storageRef = ref(storage, storagePath);
                await uploadBytes(storageRef, page.blob);

                const response = await analyzePageFn({
                    storagePath,
                    fileName: page.fileName,
                    pageIndex: page.pageIndex,
                    agents: selectedAgents,
                    customPrompt: customPrompt.trim() !== '' ? customPrompt : undefined,
                });

                const data = response.data as any;
                results.push({
                    fileIndex: page.fileIndex,
                    pageIndex: page.pageIndex,
                    fileName: page.fileName,
                    storagePath,
                    geminiResult: data.geminiResult || {},
                    claudeResult: data.claudeResult || {},
                    mergedResult: data.mergedResult || {},
                });
            } catch (err: any) {
                console.error(`Analysis failed for ${page.fileName} p${page.pageIndex}:`, err);
                failedCount++;
                results.push({
                    fileIndex: page.fileIndex,
                    pageIndex: page.pageIndex,
                    fileName: page.fileName,
                    storagePath: '',
                    geminiResult: {},
                    claudeResult: {},
                    mergedResult: {},
                });
                setError(prev => prev
                    ? `${prev}\n❌ ${page.fileName} стр.${page.pageIndex + 1}: ${err.message}`
                    : `❌ ${page.fileName} стр.${page.pageIndex + 1}: ${err.message}`
                );
            }

            setAnalysisProgress({ done: i + 1, total: pagesToAnalyze.length });
        }

        if (cancelledRef.current) return;

        setPageResults(results);
        const successCount = results.length - failedCount;
        setProgress(`✅ Анализ: ${successCount}/${pagesToAnalyze.length} страниц за ${formatTime(Math.floor((Date.now() - (startTime || Date.now())) / 1000))}`);
        setStartTime(null);
        setPhase('results');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [approvedFiles, userProfile]);

    // ===== Cross-verification entries =====
    const verificationEntries: PageVerificationEntry[] = useMemo(() => {
        return pageResults
            .filter(pr => Object.keys(pr.mergedResult).length > 0)
            .map(pr => ({
                fileIndex: pr.fileIndex,
                pageIndex: pr.pageIndex,
                fileName: pr.fileName,
                result: pr.mergedResult,
            }));
    }, [pageResults]);

    // Global merged result
    const globalMerged = useMemo(() => {
        const merged: BlueprintAgentResult = {};
        pageResults.forEach(pr => {
            for (const [key, qty] of Object.entries(pr.mergedResult)) {
                if (qty && qty > 0) {
                    merged[key] = (merged[key] || 0) + qty;
                }
            }
        });
        return merged;
    }, [pageResults]);

    const totalItems = Object.keys(editedResult).length;
    const totalQty = Object.values(editedResult).reduce((sum, q) => sum + (q || 0), 0);

    // Compute and dispatch global results
    const handleComplete = () => {
        const gemini: Record<string, number> = {};
        const claude: Record<string, number> = {};
        const openai: Record<string, number> = {};

        pageResults.forEach(pr => {
            if (pr.geminiResult) {
                Object.entries(pr.geminiResult).forEach(([k, val]) => {
                    const v = val as number;
                    if (v > 0) gemini[k] = (gemini[k] || 0) + v;
                });
            }
            if (pr.claudeResult) {
                Object.entries(pr.claudeResult).forEach(([k, val]) => {
                    const v = val as number;
                    if (v > 0) claude[k] = (claude[k] || 0) + v;
                });
            }
            // For future openai
            if ((pr as any).openaiResult) {
                Object.entries((pr as any).openaiResult).forEach(([k, val]) => {
                    const v = val as number;
                    if (v > 0) openai[k] = (openai[k] || 0) + v;
                });
            }
        });

        onComplete(editedResult, { gemini, claude, openai });
    };

    const handleExportPdf = () => {
        // Compute globalMerged
        const globalMerged: BlueprintAgentResult = {};
        pageResults.forEach(pr => {
            for (const [key, qty] of Object.entries(pr.mergedResult)) {
                globalMerged[key] = (globalMerged[key] || 0) + (qty || 0);
            }
        });

        let safeProjectName = 'Project';
        // You might consider passing down actual project name if available in Context, but for now we fallback.

        exportBlueprintPdf(
            safeProjectName,
            pageResults,
            globalMerged,
            selectedAgents
        );
    };

    // Sync editedResult when globalMerged changes (after analysis / refinement)
    useEffect(() => {
        if (Object.keys(globalMerged).length > 0) {
            setEditedResult(prev => {
                // Merge: keep user edits, add new keys from globalMerged
                const updated = { ...globalMerged };
                for (const [key, val] of Object.entries(prev)) {
                    if (key in updated) updated[key] = val; // preserve user edit
                }
                return updated;
            });
        }
    }, [globalMerged]);

    // ===== Refinement =====
    const handleRefine = useCallback(async (itemsToRefine: string[], pageIndices: number[]) => {
        setRefining(true);
        setRefinementRound(prev => prev + 1);
        setStartTime(Date.now());
        const refineFn = httpsCallable(functions, 'refineAnalysisCallable');

        const updatedResults = [...pageResults];

        for (let idx = 0; idx < updatedResults.length; idx++) {
            const pr = updatedResults[idx];
            if (!pageIndices.includes(pr.pageIndex) || !pr.storagePath) continue;

            setProgress(`🔄 Пересчёт: ${pr.fileName} стр.${pr.pageIndex + 1}...`);

            try {
                const response = await refineFn({
                    storagePath: pr.storagePath,
                    fileName: pr.fileName,
                    discrepancyItems: itemsToRefine,
                });

                const data = response.data as any;
                if (data.refinedResult) {
                    const updated = { ...pr.mergedResult };
                    for (const [key, qty] of Object.entries(data.refinedResult as Record<string, number>)) {
                        if (itemsToRefine.includes(key)) {
                            updated[key] = qty;
                        }
                    }
                    updatedResults[idx] = { ...pr, mergedResult: updated };
                }
            } catch (err: any) {
                console.error('Refinement failed:', err);
                setError(`Ошибка пересчёта ${pr.fileName}: ${err.message}`);
            }
        }

        setPageResults(updatedResults);
        setRefining(false);
        setStartTime(null);
        setProgress(`✅ Пересчёт завершён`);
    }, [pageResults]);

    // Cancel handler
    const handleCancel = () => {
        cancelledRef.current = true;
        setStartTime(null);
        onCancel();
    };

    // ===== Render =====
    return (
        <Box>
            {/* Stepper */}
            <Stepper activeStep={stepIndex} alternativeLabel sx={{ mb: 2 }}>
                {PHASE_LABELS.map(label => (
                    <Step key={label}>
                        <StepLabel>{label}</StepLabel>
                    </Step>
                ))}
            </Stepper>

            {/* Progress + Timer */}
            {(progress || startTime) && (
                <Box mb={2}>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={0.5}>
                        <Typography variant="body2" color="text.secondary">{progress}</Typography>
                        {startTime && (
                            <Typography variant="caption" color="text.disabled">
                                ⏱ {formatTime(elapsed)}
                            </Typography>
                        )}
                    </Box>
                    {(phase === 'file-convert') && <LinearProgress sx={{ borderRadius: 1 }} />}
                    {phase === 'analyzing' && analysisProgress.total > 0 && (
                        <LinearProgress
                            variant="determinate"
                            value={(analysisProgress.done / analysisProgress.total) * 100}
                            sx={{ borderRadius: 1 }}
                        />
                    )}
                </Box>
            )}

            {error && (
                <Alert severity="warning" sx={{ mb: 2, whiteSpace: 'pre-line' }} onClose={() => setError('')}>
                    {error}
                </Alert>
            )}

            {/* Phase: file-convert */}
            {phase === 'file-convert' && (
                <Box textAlign="center" py={4}>
                    <CircularProgress size={48} sx={{ mb: 2 }} />
                    <Typography variant="h6" mb={1}>
                        Конвертация файла {currentFileIndex + 1} из {files.length}...
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        {files[currentFileIndex]?.name}
                    </Typography>
                    <Button variant="text" color="inherit" onClick={handleCancel} sx={{ mt: 2 }}>
                        Отменить
                    </Button>
                </Box>
            )}

            {/* Phase: file-review */}
            {phase === 'file-review' && currentFilePages && (
                <Box>
                    <BlueprintPagesGrid
                        filePages={currentFilePages}
                        fileLabel={`Файл ${currentFileIndex + 1} из ${files.length}: ${currentFilePages.fileName}`}
                        selectedPages={currentFileSelected}
                        onSelectionChange={setCurrentFileSelected}
                        onApprove={handleApproveFile}
                        onSkip={handleSkipFile}
                        onBack={currentFileIndex > 0 ? () => handleGoBackToFile(currentFileIndex - 1) : undefined}
                        canGoBack={currentFileIndex > 0}
                    />
                    <Box mt={1}>
                        <Button
                            startIcon={<ArrowBackIcon />}
                            size="small"
                            color="inherit"
                            onClick={handleCancel}
                        >
                            ← Назад к выбору файлов
                        </Button>
                    </Box>
                </Box>
            )}

            {/* Phase: summary */}
            {phase === 'summary' && (
                <BlueprintFileSummary
                    approvedFiles={approvedFiles}
                    allFileNames={files.map(f => f.name)}
                    selectedAgents={selectedAgents}
                    onToggleAgent={(agent) => {
                        setSelectedAgents(prev =>
                            prev.includes(agent) ? prev.filter(a => a !== agent) : [...prev, agent]
                        );
                    }}
                    projectType={projectType}
                    setProjectType={handleProjectTypeChange}
                    squareFootage={squareFootage}
                    setSquareFootage={setSquareFootage}
                    customPrompt={customPrompt}
                    setCustomPrompt={setCustomPrompt}
                    onStartAnalysis={startAnalysis}
                    onGoBackToFile={handleGoBackToFile}
                />
            )}

            {/* Phase: analyzing */}
            {phase === 'analyzing' && (
                <Box textAlign="center" py={4}>
                    <CircularProgress size={48} sx={{ mb: 2 }} />
                    <Typography variant="h6" mb={1}>🔍 Анализ страниц...</Typography>
                    <Typography variant="body2" color="text.secondary" mb={1}>
                        {analysisProgress.done}/{analysisProgress.total} страниц • Gemini + Claude
                    </Typography>
                    <Button variant="text" color="error" onClick={handleCancel} size="small">
                        Остановить
                    </Button>
                </Box>
            )}

            {/* Phase: results */}
            {phase === 'results' && pageResults.length > 0 && (
                <Box>
                    <Box display="flex" gap={2} mb={2} flexWrap="wrap">
                        <Typography variant="body2" color="text.secondary">
                            📊 {pageResults.length} страниц • {totalItems} позиций • {totalQty} шт. суммарно
                        </Typography>
                    </Box>

                    <PageResultsView
                        pageResults={pageResults.map(pr => ({
                            fileIndex: pr.fileIndex,
                            pageIndex: pr.pageIndex,
                            fileName: pr.fileName,
                            geminiResult: pr.geminiResult,
                            claudeResult: pr.claudeResult,
                            mergedResult: pr.mergedResult,
                        }))}
                    />
                    <Box display="flex" justifyContent="space-between" mt={2}>
                        <Box display="flex" gap={1}>
                            <Button
                                startIcon={<ArrowBackIcon />}
                                size="small"
                                color="inherit"
                                onClick={() => setPhase('summary')}
                            >
                                ← К сводке
                            </Button>
                            <Button
                                startIcon={<PictureAsPdfIcon />}
                                size="small"
                                color="secondary"
                                variant="outlined"
                                onClick={handleExportPdf}
                            >
                                Скачать PDF
                            </Button>
                        </Box>
                        <Box display="flex" gap={1}>
                            <Button
                                variant="outlined"
                                onClick={() => setPhase('verifying')}
                            >
                                🔍 Сверить таблицы
                            </Button>
                            <Button
                                variant="contained"
                                onClick={handleComplete}
                            >
                                ✅ Применить ({totalItems} поз.)
                            </Button>
                        </Box>
                    </Box>
                </Box>
            )}

            {/* Phase: verifying */}
            {phase === 'verifying' && (
                <Box>
                    <CrossVerification
                        pageEntries={verificationEntries}
                        onRefineRequest={handleRefine}
                        refining={refining}
                        refinementRound={refinementRound}
                    />
                    <Box display="flex" justifyContent="space-between" mt={2}>
                        <Button
                            startIcon={<ArrowBackIcon />}
                            variant="outlined"
                            size="small"
                            onClick={() => setPhase('results')}
                        >
                            ← Результаты
                        </Button>
                        <Button
                            variant="contained"
                            onClick={handleComplete}
                        >
                            ✅ Применить финальный результат ({totalItems} поз.)
                        </Button>
                    </Box>
                </Box>
            )}
        </Box>
    );
};

export default BlueprintV2Pipeline;
