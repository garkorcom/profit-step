import React, { useState, useMemo, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
    Container, Grid, Paper, Typography, Box, TextField, Select, MenuItem,
    FormControl, InputLabel, Tabs, Tab, Button, Card, CardContent, Divider,
    Stack, IconButton, Tooltip, AppBar, Toolbar, useTheme, useMediaQuery,
    InputAdornment, Chip, Menu, Snackbar, Alert, CircularProgress, Dialog, Popover
} from '@mui/material';
import {
    Lightbulb as LightIcon, Power as PowerIcon, ToggleOn as SwitchIcon,
    Kitchen as ApplianceIcon, AcUnit as HvacIcon, Router as LowVoltageIcon,
    SettingsInputComponent as GearIcon, Pool as PoolIcon, Bolt as GeneratorIcon,
    Landscape as LandscapeIcon, Construction as EquipmentIcon, Assessment as SummaryIcon,
    Print as PrintIcon, ContentCopy as CopyIcon, Delete as ClearIcon,
    SaveAlt as ExportIcon, FlashOn as FlashOnIcon,
    AutoAwesome as AutoAwesomeIcon,
    Cable as CableIcon, PictureAsPdf as PdfIcon,
    Save as SaveIcon, FolderOpen as ProjectsIcon, TableChart as ExcelIcon,
} from '@mui/icons-material';

import { generateProjectOverview, type ProjectOverview } from '../../utils/estimateValidation';
import { AiMappingDialog } from '../../components/estimates/AiMappingDialog';
import { V3PipelineContainer } from '../../components/estimates/pipeline/V3PipelineContainer';
import { V3VisualProofStep } from '../../components/estimates/pipeline/V3VisualProofStep';
import { EstimatorLangGraphUI } from '../../components/estimates/EstimatorLangGraphUI';
import { useAuth } from '../../auth/AuthContext';
import { savedEstimateApi } from '../../api/savedEstimateApi';
import { projectsApi } from '../../api/projectsApi';
import { blueprintApi } from '../../api/blueprintApi';
import { BlueprintV3Session, BlueprintAgentV3Result } from '../../types/blueprint.types';

// ─── Modular Estimator Components ─────────────────────────
import { DEVICES, GEAR, POOL, GENERATOR, LANDSCAPE, WIRE } from '../../constants/electricalDevices';
export { DEVICES, GEAR, POOL, GENERATOR, LANDSCAPE, WIRE };

import {
    QuantityMap, ElectricalItem,
    EQUIPMENT_SBO, TEMPLATES, WIRE_RATES,
    fmt, fmtHr,
} from '../../components/estimator/estimator.types';
import { Section } from '../../components/estimator/ItemRow';
import { useEstimatorCalc } from '../../components/estimator/useEstimatorCalc';
import {
    generateEstimatePDF as generatePDF,
    generateExcelExport as generateExcel,
    generatePrintContent as getPrintText,
} from '../../components/estimator/estimatorExport';

// ─── Estimate Data Type ───────────────────────────────────
interface EstimateData {
    projectName?: string;
    areaSqft?: number;
    quantities?: QuantityMap;
    filesCount?: number;
    electricalCount?: number;
    aiResults?: {
        gemini?: QuantityMap;
        claude?: QuantityMap;
        openai?: QuantityMap;
    };
}

export default function ElectricalEstimatorPage() {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const { userProfile } = useAuth();
    const location = useLocation();

    const projectIdMatch = new URLSearchParams(location.search).get('projectId');

    // ─── UI State ─────────────────────────────────────────
    const [savingProject, setSavingProject] = useState(false);
    const [saveSnackbar, setSaveSnackbar] = useState('');
    const [projectName, setProjectName] = useState('New Project');
    const [projectType, setProjectType] = useState('residential');
    const [sqft, setSqft] = useState(0);
    const [stories, setStories] = useState(1);
    const [typeMult, setTypeMult] = useState(1);

    // ─── Data State ───────────────────────────────────────
    const [devicesData, setDevicesData] = useState(DEVICES);
    const [gearData, setGearData] = useState(GEAR);
    const [poolData, setPoolData] = useState(POOL);
    const [genData, setGenData] = useState(GENERATOR);
    const [landData, setLandData] = useState(LANDSCAPE);
    const [wireRatesData] = useState(WIRE_RATES);

    // ─── Quantity State ───────────────────────────────────
    const [quantities, setQuantities] = useState<QuantityMap>({});
    const [gearQty, setGearQty] = useState<QuantityMap>({});
    const [poolQty, setPoolQty] = useState<QuantityMap>({});
    const [genQty, setGenQty] = useState<QuantityMap>({});
    const [landQty, setLandQty] = useState<QuantityMap>({});
    const [wireQty, setWireQty] = useState<QuantityMap>({});
    const [equipmentPrices, setEquipmentPrices] = useState<QuantityMap>({});

    // ─── Config State ─────────────────────────────────────
    const [laborRate] = useState(35);
    const [overheadPct, setOverheadPct] = useState(25);
    const [profitPct, setProfitPct] = useState(10);
    const [activeTab, setActiveTab] = useState<number>(0);
    const [notes, setNotes] = useState('');
    const [isEditingRates, setIsEditingRates] = useState(false);

    // ─── AI / Dialog State ────────────────────────────────
    const [showAiDialog, setShowAiDialog] = useState(false);
    const [showVisualProof, setShowVisualProof] = useState(false);
    const [activeV3Sessions, setActiveV3Sessions] = useState<BlueprintV3Session[]>([]);
    const [resumeSessionId, setResumeSessionId] = useState<string | undefined>(undefined);
    const [exportAnchorEl, setExportAnchorEl] = useState<null | HTMLElement>(null);
    const [unmappedItems, setUnmappedItems] = useState<Record<string, number>>({});
    const [pendingMappingData, setPendingMappingData] = useState<Record<string, number> | null>(null);
    const [v3Results, setV3Results] = useState<Record<string, BlueprintAgentV3Result>>({});
    const [v3Images, setV3Images] = useState<Array<{ id: string; originalFileName?: string; pageNumber?: number; storageUrl?: string; selected?: boolean; dimensions?: { width: number; height: number } }>>([]);
    const [anomalies, setAnomalies] = useState<{itemKey: string, reason: string}[]>([]);
    const [lineageAnchorEl, setLineageAnchorEl] = useState<HTMLElement | null>(null);
    const [lineageItem, setLineageItem] = useState<string | null>(null);

    // ─── Estimate Persistence ─────────────────────────────
    const [currentEstimateId, setCurrentEstimateId] = useState<string | null>(null);
    const [currentEstimateData, setCurrentEstimateData] = useState<EstimateData | null>(null);
    const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
    const [autosaveStatus, setAutosaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

    // ─── Effects ──────────────────────────────────────────
    useEffect(() => {
        if (!userProfile?.companyId || !userProfile?.id) return;
        blueprintApi.listActiveV3Sessions(userProfile.companyId, userProfile.id)
            .then(setActiveV3Sessions)
            .catch(console.error);
    }, [userProfile?.companyId, userProfile?.id, showAiDialog]);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const estId = params.get('id') || params.get('estimateId');

        if (userProfile) {
            if (projectIdMatch) {
                projectsApi.getById(projectIdMatch).then((projectData) => {
                    if (projectData) {
                        setProjectName(projectData.name);
                        if (projectData.areaSqft) setSqft(projectData.areaSqft);
                        if (estId) {
                            savedEstimateApi.getById(estId).then((rawData) => {
                                const estData = rawData as unknown as EstimateData | null;
                                if (estData) {
                                    setCurrentEstimateId(estId);
                                    setCurrentEstimateData(estData);
                                    if (estData.quantities) {
                                        setQuantities(estData.quantities); setGearQty(estData.quantities);
                                        setPoolQty(estData.quantities); setGenQty(estData.quantities);
                                        setLandQty(estData.quantities); setWireQty(estData.quantities);
                                    }
                                }
                            }).catch(console.error);
                        }
                    }
                }).catch(console.error);
            } else if (estId) {
                savedEstimateApi.getById(estId).then((rawData) => {
                    const data = rawData as unknown as EstimateData | null;
                    if (data) {
                        setCurrentEstimateId(estId);
                        setCurrentEstimateData(data);
                        setProjectName(data.projectName || 'Loaded Project');
                        if (data.areaSqft) setSqft(data.areaSqft);
                        if (data.quantities) {
                            setQuantities(data.quantities); setGearQty(data.quantities);
                            setPoolQty(data.quantities); setGenQty(data.quantities);
                            setLandQty(data.quantities); setWireQty(data.quantities);
                        }
                    }
                }).catch(console.error);
            }
        }
    }, [userProfile, projectIdMatch]);

    // ─── Handlers ─────────────────────────────────────────
    const updateQty = (setter: React.Dispatch<React.SetStateAction<QuantityMap>>) => (id: string, value: string) => {
        setter((prev: QuantityMap) => ({ ...prev, [id]: Math.max(0, parseInt(value) || 0) }));
    };

    const updateEquipment = (id: string, value: string) => {
        setEquipmentPrices((prev: QuantityMap) => ({ ...prev, [id]: Math.max(0, parseFloat(value) || 0) }));
    };

    const updateRate = (category: string, id: string, field: 'matRate' | 'laborRate', value: string) => {
        const numValue = parseFloat(value) || 0;
        if (category === 'devices') {
            setDevicesData(prev => {
                const newData = { ...prev };
                Object.keys(newData).forEach(key => {
                    newData[key as keyof typeof DEVICES] = newData[key as keyof typeof DEVICES].map((item) =>
                        item.id === id ? { ...item, [field]: numValue } : item
                    );
                });
                return newData;
            });
        } else if (category === 'gear') {
            setGearData(prev => prev.map(item => item.id === id ? { ...item, [field]: numValue } : item));
        } else if (category === 'pool') {
            setPoolData(prev => prev.map(item => item.id === id ? { ...item, [field]: numValue } : item));
        } else if (category === 'generator') {
            setGenData(prev => prev.map(item => item.id === id ? { ...item, [field]: numValue } : item));
        } else if (category === 'landscape') {
            setLandData(prev => prev.map(item => item.id === id ? { ...item, [field]: numValue } : item));
        }
    };

    const applyTemplate = (templateKey: string) => {
        const t = TEMPLATES[templateKey];
        if (!t) return;
        setProjectName(t.name);
        setSqft(t.sqft);
        setStories(t.stories);
        setProjectType(t.type);
        setTypeMult(t.type === 'commercial' ? 1.3 : 1);
        setQuantities(t.devices || {});
        setGearQty(t.gear || {});
        setPoolQty(t.pool || {});
        setGenQty(t.generator || {});
        setLandQty(t.landscape || {});
        setEquipmentPrices(t.equipment || {});
    };

    const handleAiApply = (detected: Record<string, number>, newSqft?: number) => {
        setPendingMappingData(detected);
        if (newSqft) setSqft(newSqft);
        setShowAiDialog(false);
    };

    const getConfidence = (itemKey: string) => {
        let totalConf = 0;
        let count = 0;
        Object.values(v3Results).forEach(pageData => {
            const boxes = pageData[itemKey];
            if (boxes && Array.isArray(boxes)) {
                boxes.forEach((b: { confidence?: number } | number[]) => {
                    const conf = Array.isArray(b) ? 0 : b.confidence;
                    if (conf) { totalConf += conf; count++; }
                });
            }
        });
        return count > 0 ? Math.round(totalConf / count) : 0;
    };

    const getAnomaly = (itemKey: string) => {
        const found = anomalies.find(a => a.itemKey === itemKey);
        return found ? found.reason : null;
    };

    const handleShowLineage = (e: React.MouseEvent<HTMLElement>, itemId: string) => {
        setLineageAnchorEl(e.currentTarget);
        setLineageItem(itemId);
    };

    const handleFinalMapping = (mapped: Record<string, number>, unmapped: Record<string, number>) => {
        const devKeys = new Set(Object.values(DEVICES).flat().map((i) => i.id));
        const gearKeys = new Set(GEAR.map(i => i.id));
        const poolKeys = new Set(POOL.map(i => i.id));
        const genKeys = new Set(GENERATOR.map(i => i.id));
        const landKeys = new Set(LANDSCAPE.map(i => i.id));
        const wireKeys = new Set(WIRE.map(i => i.id));

        const applyMapped = (setter: React.Dispatch<React.SetStateAction<QuantityMap>>, keys: Set<string>) => {
            setter((prev: QuantityMap) => {
                const next = { ...prev };
                Object.entries(mapped).forEach(([k, v]) => {
                    if (keys.has(k)) next[k] = (next[k] || 0) + v;
                });
                return next;
            });
        };

        applyMapped(setQuantities, devKeys);
        applyMapped(setGearQty, gearKeys);
        applyMapped(setPoolQty, poolKeys);
        applyMapped(setGenQty, genKeys);
        applyMapped(setLandQty, landKeys);
        applyMapped(setWireQty, wireKeys);

        setUnmappedItems(prev => {
            const next = { ...prev };
            Object.entries(unmapped).forEach(([k, v]) => { next[k] = (next[k] || 0) + v; });
            return next;
        });

        const areaKeys = new Set(['sqft', 'sq_ft', 'area', 'square_feet', 'area_sqft']);
        for (const [key, val] of Object.entries(unmapped)) {
            if (areaKeys.has(key.toLowerCase()) && typeof val === 'number' && val > 0) {
                setSqft(val);
                break;
            }
        }
        setPendingMappingData(null);
    };

    const clearAll = () => {
        setQuantities({}); setGearQty({}); setPoolQty({}); setGenQty({}); setLandQty({}); setWireQty({}); setEquipmentPrices({});
        setProjectName('New Project'); setSqft(0); setStories(1); setTypeMult(1);
    };

    // ─── Calculation ──────────────────────────────────────
    const storyMult = stories === 1 ? 1.0 : stories === 2 ? 1.15 : 1.30;

    const calc = useEstimatorCalc({
        devicesData, gearData: gearData as ElectricalItem[], poolData: poolData as ElectricalItem[],
        genData: genData as ElectricalItem[], landData: landData as ElectricalItem[],
        quantities, gearQty, poolQty, genQty, landQty, wireQty, equipmentPrices,
        laborRate, overheadPct, profitPct, storyMult, typeMult, wireRatesData,
    });

    // ─── Overview ─────────────────────────────────────────
    const overview: ProjectOverview = useMemo(() => {
        const allQty: Record<string, number> = {};
        [quantities, gearQty, poolQty, genQty, landQty, wireQty].forEach(map => {
            Object.entries(map).forEach(([k, v]) => { if (v > 0) allQty[k] = (allQty[k] || 0) + v; });
        });
        const roomCount = currentEstimateData?.electricalCount ||
            (currentEstimateData?.filesCount || Object.keys(allQty).length > 0 ? 1 : 0);
        return generateProjectOverview({
            areaSqft: sqft, roomCount, quantities: allQty, totalBomCost: calc.materialsBase,
        });
    }, [sqft, quantities, gearQty, poolQty, genQty, landQty, wireQty, calc.materialsBase, currentEstimateData]);

    // ─── Export Handlers ──────────────────────────────────
    const commonExportParams = {
        projectName, projectType, sqft, stories, overheadPct, profitPct,
        overview, calc, notes, quantities, wireQty,
        gearData: gearData as ElectricalItem[], poolData: poolData as ElectricalItem[],
        genData: genData as ElectricalItem[], landData: landData as ElectricalItem[],
        gearQty, poolQty, genQty, landQty, equipmentPrices,
    };

    const handleGeneratePDF = async (label?: string, aiQtyMap?: QuantityMap) => {
        setIsGeneratingPDF(true);
        await new Promise(r => setTimeout(r, 100));
        try {
            await generatePDF({ ...commonExportParams, activeV3Sessions, label, aiQtyMap });
            setSaveSnackbar('PDF готов, скачивание началось');
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Сбой';
            console.error('PDF generation error', err);
            setSaveSnackbar(`Ошибка генерации PDF: ${message}`);
        } finally {
            setIsGeneratingPDF(false);
        }
    };

    const handleExcelExport = () => {
        generateExcel({ ...commonExportParams, laborRate });
    };

    const handlePrintContent = () => getPrintText({ projectName, projectType, sqft, stories, overheadPct, profitPct, overview, calc, notes });

    const copyToClipboard = () => {
        navigator.clipboard.writeText(handlePrintContent());
        alert('Copied to clipboard!');
    };

    const downloadTxt = () => {
        const element = document.createElement("a");
        const file = new Blob([handlePrintContent()], { type: 'text/plain' });
        element.href = URL.createObjectURL(file);
        element.download = `${projectName.replace(/\s+/g, '_')}_Estimate.txt`;
        document.body.appendChild(element);
        element.click();
    };

    // ─── Save ─────────────────────────────────────────────
    const mergeAllQuantities = (): Record<string, number> => {
        const allQuantities: Record<string, number> = {};
        [quantities, gearQty, poolQty, genQty, landQty, wireQty].forEach(map => {
            Object.entries(map).forEach(([k, v]) => { if (v > 0) allQuantities[k] = v; });
        });
        return allQuantities;
    };

    const handleSaveProject = async () => {
        if (!userProfile?.companyId || !userProfile?.id) {
            setSaveSnackbar('Войдите в систему для сохранения'); return;
        }
        if (!projectIdMatch) {
            setSaveSnackbar('Ошибка: Отсутствует привязка к Проекту. Начните расчет из Библиотеки Проектов.'); return;
        }
        setSavingProject(true);
        try {
            const allQuantities = mergeAllQuantities();
            const dataToSave = {
                companyId: userProfile.companyId, createdBy: userProfile.id,
                projectId: projectIdMatch, projectName, areaSqft: sqft,
                batchId: `manual_${Date.now()}`, quantities: allQuantities,
                originalQuantities: allQuantities, laborRate, wirePrice: 0.45,
                totalMaterials: calc.materialsFinal, totalLabor: calc.laborCost,
                totalWire: calc.sectionsData.wire_auto.mat + calc.sectionsData.wire_manual.mat,
                grandTotal: calc.totalPrice, filesCount: 0,
                electricalCount: Object.keys(allQuantities).length,
                status: 'draft' as const,
                ...(notes ? { notes } : {}),
            };
            if (currentEstimateId) {
                await savedEstimateApi.update(currentEstimateId, dataToSave);
            } else {
                const newId = await savedEstimateApi.save(dataToSave);
                setCurrentEstimateId(newId);
            }
            if (sqft > 0 && projectIdMatch) {
                await projectsApi.update(projectIdMatch, { areaSqft: sqft });
            }
            setSaveSnackbar('Проект сохранён ✅');
            setAutosaveStatus('saved');
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Сбой сети';
            console.error('Save failed:', err);
            setSaveSnackbar(`Ошибка сохранения: ${message}`);
            setAutosaveStatus('idle');
        }
        setSavingProject(false);
    };

    // ─── Autosave ─────────────────────────────────────────
    useEffect(() => {
        if (!currentEstimateId || savingProject || !userProfile?.companyId || !projectIdMatch) return;
        const timer = setTimeout(() => {
            setAutosaveStatus('saving');
            const allQuantities = mergeAllQuantities();
            savedEstimateApi.update(currentEstimateId, {
                projectName, quantities: allQuantities, laborRate, wirePrice: 0.45,
                totalMaterials: calc.materialsFinal, totalLabor: calc.laborCost,
                totalWire: calc.sectionsData.wire_auto.mat + calc.sectionsData.wire_manual.mat,
                grandTotal: calc.totalPrice, status: 'draft',
                ...(notes ? { notes } : {}),
            }).then(() => setAutosaveStatus('saved'))
              .catch(err => { console.error('Autosave failed:', err); setAutosaveStatus('idle'); });
        }, 30000);
        return () => clearTimeout(timer);
    }, [quantities, gearQty, poolQty, genQty, landQty, wireQty, projectName, laborRate, calc, notes, currentEstimateId, savingProject, userProfile, projectIdMatch]);

    // ─── Tabs Config ──────────────────────────────────────
    const tabs = [
        { id: 'devices', icon: <LightIcon />, label: 'Devices' },
        { id: 'wire', icon: <CableIcon />, label: 'Wire' },
        { id: 'gear', icon: <GearIcon />, label: 'Gear' },
        { id: 'pool', icon: <PoolIcon />, label: 'Pool' },
        { id: 'generator', icon: <GeneratorIcon />, label: 'Generator' },
        { id: 'landscape', icon: <LandscapeIcon />, label: 'Landscape' },
        { id: 'equipment', icon: <EquipmentIcon />, label: 'Equipment' },
        { id: 'summary', icon: <SummaryIcon />, label: 'Summary' },
    ];

    // ═══════════════════════════════════════════════════════
    //  RENDER
    // ═══════════════════════════════════════════════════════
    return (
        <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', pb: 8 }}>
            <AppBar position="static" color="default" elevation={1} sx={{ bgcolor: 'background.paper' }}>
                <Toolbar>
                    <Typography variant="h6" color="primary" sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                        <FlashOnIcon /> Electrical Estimator Pro
                    </Typography>
                    <Button color="inherit" sx={{ mr: 1 }} startIcon={<ProjectsIcon />} onClick={() => window.location.href = '/estimates/projects'}>
                        Проекты
                    </Button>
                </Toolbar>
            </AppBar>

            <Container maxWidth="xl" sx={{ mt: 3 }}>
                <EstimatorLangGraphUI />

                <Grid container spacing={3}>
                    {/* Project Info & Quick Fill */}
                    <Grid size={{ xs: 12 }}>
                        <Card variant="outlined">
                            <CardContent>
                                <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
                                    <Box display="flex" alignItems="center">
                                        <Typography variant="h6">Project Details</Typography>
                                        {currentEstimateId && (
                                            <Typography variant="caption" color="text.secondary" sx={{ ml: 2, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                {autosaveStatus === 'saving' && <><CircularProgress size={10} color="inherit" /> Сохранение...</>}
                                                {autosaveStatus === 'saved' && <><SaveIcon sx={{ fontSize: 12 }} /> Сохранено</>}
                                            </Typography>
                                        )}
                                    </Box>
                                    <Box>
                                        <Button size="small" onClick={() => setIsEditingRates(!isEditingRates)} color={isEditingRates ? "success" : "primary"} variant={isEditingRates ? "contained" : "text"} sx={{ mr: 1 }}>
                                            {isEditingRates ? "Done Editing" : "Edit Rates"}
                                        </Button>
                                    </Box>
                                </Stack>
                                <Grid container spacing={2} alignItems="center">
                                    <Grid size={{ xs: 12, sm: 4 }}>
                                        <TextField fullWidth label="Project Name" value={projectName} onChange={(e) => setProjectName(e.target.value)} onFocus={(e) => e.target.select()} size="small" />
                                    </Grid>
                                    <Grid size={{ xs: 6, sm: 2 }}>
                                        <TextField fullWidth label="Sq. Ft." type="number" value={sqft} onChange={(e) => setSqft(Number(e.target.value))} onFocus={(e) => e.target.select()} size="small" />
                                    </Grid>
                                    <Grid size={{ xs: 6, sm: 2 }}>
                                        <TextField fullWidth label="Stories" type="number" value={stories} onChange={(e) => setStories(Number(e.target.value))} onFocus={(e) => e.target.select()} size="small" />
                                    </Grid>
                                    <Grid size={{ xs: 12, sm: 4 }}>
                                        <FormControl fullWidth size="small">
                                            <InputLabel>Type</InputLabel>
                                            <Select value={typeMult} label="Type" onChange={(e) => setTypeMult(Number(e.target.value))}>
                                                <MenuItem value={1}>Residential (Standard)</MenuItem>
                                                <MenuItem value={1.2}>Custom Home (+20%)</MenuItem>
                                                <MenuItem value={1.3}>Commercial (+30%)</MenuItem>
                                                <MenuItem value={1.4}>Commercial (+40%)</MenuItem>
                                            </Select>
                                        </FormControl>
                                    </Grid>
                                </Grid>

                                <Divider sx={{ my: 2 }} />

                                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                                    <Typography variant="caption" color="text.secondary">Quick Fill:</Typography>
                                    {Object.entries(TEMPLATES).map(([key, t]) => (
                                        <Tooltip key={key} title={t.descriptionRu || t.name} arrow>
                                            <Chip label={t.name.split(' ')[0]} onClick={() => applyTemplate(key)} size="small" color="primary" variant="outlined" clickable />
                                        </Tooltip>
                                    ))}
                                    <Tooltip title="Clear All">
                                        <IconButton size="small" color="error" onClick={clearAll}><ClearIcon /></IconButton>
                                    </Tooltip>
                                    <Button size="small" startIcon={<AutoAwesomeIcon />} onClick={() => { setResumeSessionId(undefined); setShowAiDialog(true); }} sx={{ ml: 'auto', background: 'linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)', color: 'white' }}>
                                        AI Analysis
                                    </Button>
                                    <Tooltip title="Export">
                                        <Button size="small" color="success" variant="outlined" startIcon={isGeneratingPDF ? <CircularProgress size={16} color="inherit" /> : <ExportIcon />} onClick={(e) => setExportAnchorEl(e.currentTarget)} disabled={isGeneratingPDF}>
                                            {isGeneratingPDF ? 'Generating...' : 'Export ▾'}
                                        </Button>
                                    </Tooltip>
                                    <Menu anchorEl={exportAnchorEl} open={Boolean(exportAnchorEl)} onClose={() => setExportAnchorEl(null)}>
                                        <MenuItem onClick={() => { handleGeneratePDF(); setExportAnchorEl(null); }}>
                                            <PdfIcon sx={{ mr: 1 }} fontSize="small" /> Смета (PDF)
                                        </MenuItem>
                                        {currentEstimateData?.aiResults?.gemini && (
                                            <MenuItem onClick={() => { handleGeneratePDF('Gemini AI Output', currentEstimateData.aiResults!.gemini); setExportAnchorEl(null); }}>
                                                <PdfIcon sx={{ mr: 1, color: 'info.main' }} fontSize="small" /> Gemini AI Смета
                                            </MenuItem>
                                        )}
                                        {currentEstimateData?.aiResults?.claude && (
                                            <MenuItem onClick={() => { handleGeneratePDF('Claude AI Output', currentEstimateData.aiResults!.claude); setExportAnchorEl(null); }}>
                                                <PdfIcon sx={{ mr: 1, color: 'warning.main' }} fontSize="small" /> Claude AI Смета
                                            </MenuItem>
                                        )}
                                        {currentEstimateData?.aiResults?.openai && (
                                            <MenuItem onClick={() => { handleGeneratePDF('OpenAI Output', currentEstimateData.aiResults!.openai); setExportAnchorEl(null); }}>
                                                <PdfIcon sx={{ mr: 1, color: 'success.main' }} fontSize="small" /> OpenAI Смета
                                            </MenuItem>
                                        )}
                                        <Divider />
                                        <MenuItem onClick={() => { handleExcelExport(); setExportAnchorEl(null); }}>
                                            <ExcelIcon sx={{ mr: 1 }} fontSize="small" /> Excel (.xlsx)
                                        </MenuItem>
                                        <MenuItem onClick={() => { downloadTxt(); setExportAnchorEl(null); }}>
                                            <ExportIcon sx={{ mr: 1 }} fontSize="small" /> Download .txt
                                        </MenuItem>
                                        <MenuItem onClick={() => { copyToClipboard(); setExportAnchorEl(null); }}>
                                            <CopyIcon sx={{ mr: 1 }} fontSize="small" /> Copy to Clipboard
                                        </MenuItem>
                                        <MenuItem onClick={() => { window.print(); setExportAnchorEl(null); }}>
                                            <PrintIcon sx={{ mr: 1 }} fontSize="small" /> Print
                                        </MenuItem>
                                    </Menu>
                                    <Button size="small" variant="contained" color="primary" startIcon={<SaveIcon />} onClick={handleSaveProject} disabled={savingProject}>
                                        {savingProject ? 'Сохранение...' : 'Сохранить'}
                                    </Button>
                                </Stack>
                            </CardContent>
                        </Card>
                    </Grid>

                    {/* Main Content */}
                    <Grid size={{ xs: 12, lg: 9 }}>
                        <Paper sx={{ minHeight: 500 }}>
                            {activeV3Sessions.length > 0 && (
                                <Paper sx={{ p: 2, mb: 3, bgcolor: 'primary.light', color: 'primary.contrastText', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 2 }}>
                                    <Box>
                                        <Typography variant="subtitle1" fontWeight="bold" display="flex" alignItems="center" gap={1}>
                                            <AutoAwesomeIcon /> Paused AI Takeoff Found
                                        </Typography>
                                        <Typography variant="body2" sx={{ opacity: 0.9 }}>
                                            You have an unfinished AI analysis session. Resume to complete the takeoff.
                                        </Typography>
                                    </Box>
                                    <Button variant="contained" color="secondary" onClick={() => { setResumeSessionId(activeV3Sessions[0].id); setShowAiDialog(true); }} sx={{ whiteSpace: 'nowrap' }}>
                                        Resume Session
                                    </Button>
                                </Paper>
                            )}

                            <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} variant="scrollable" scrollButtons="auto" sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'grey.50' }}>
                                {tabs.map((tab) => (
                                    <Tab key={tab.id} label={tab.label} icon={tab.icon} iconPosition="start" />
                                ))}
                            </Tabs>

                            <Box p={3}>
                                {activeTab === 0 && (
                                    <>
                                        {Object.keys(unmappedItems).length > 0 && (
                                            <Box mb={4}>
                                                <Alert severity="warning" sx={{ mb: 2 }}>
                                                    The following items were found by the AI but could not be mapped to the price list.
                                                </Alert>
                                                <Typography variant="h6" color="warning.main" mb={2}>⚠️ Unmapped AI Items</Typography>
                                                <Grid container spacing={1}>
                                                    {Object.entries(unmappedItems).map(([itemName, qty]) => (
                                                        <Grid size={{ xs: 12, md: 6 }} key={itemName}>
                                                            <Paper variant="outlined" sx={{ p: 1, display: 'flex', alignItems: 'center', bgcolor: 'warning.50', borderColor: 'warning.light' }}>
                                                                <Box flex={1}>
                                                                    <Typography variant="body2" fontWeight="bold" textTransform="capitalize">{itemName.replace(/_/g, ' ')}</Typography>
                                                                </Box>
                                                                <Chip label={qty} color="warning" size="small" />
                                                            </Paper>
                                                        </Grid>
                                                    ))}
                                                </Grid>
                                            </Box>
                                        )}
                                        <Grid container spacing={4}>
                                            <Grid size={{ xs: 12, md: 6 }}>
                                                <Section items={devicesData.lighting as ElectricalItem[]} qtyMap={quantities} onChange={updateQty(setQuantities)} title="Lighting" icon={<LightIcon />} category="devices" isMobile={isMobile} isEditingRates={isEditingRates} onRateChange={updateRate} getConfidence={getConfidence} getAnomaly={getAnomaly} onShowLineage={handleShowLineage} />
                                                <Section items={devicesData.receptacles as ElectricalItem[]} qtyMap={quantities} onChange={updateQty(setQuantities)} title="Receptacles" icon={<PowerIcon />} category="devices" isMobile={isMobile} isEditingRates={isEditingRates} onRateChange={updateRate} getConfidence={getConfidence} getAnomaly={getAnomaly} onShowLineage={handleShowLineage} />
                                                <Section items={devicesData.switches as ElectricalItem[]} qtyMap={quantities} onChange={updateQty(setQuantities)} title="Switches" icon={<SwitchIcon />} category="devices" isMobile={isMobile} isEditingRates={isEditingRates} onRateChange={updateRate} getConfidence={getConfidence} getAnomaly={getAnomaly} onShowLineage={handleShowLineage} />
                                            </Grid>
                                            <Grid size={{ xs: 12, md: 6 }}>
                                                <Section items={devicesData.appliances as ElectricalItem[]} qtyMap={quantities} onChange={updateQty(setQuantities)} title="Appliances" icon={<ApplianceIcon />} category="devices" isMobile={isMobile} isEditingRates={isEditingRates} onRateChange={updateRate} getConfidence={getConfidence} getAnomaly={getAnomaly} onShowLineage={handleShowLineage} />
                                                <Section items={devicesData.hvac as ElectricalItem[]} qtyMap={quantities} onChange={updateQty(setQuantities)} title="HVAC" icon={<HvacIcon />} category="devices" isMobile={isMobile} isEditingRates={isEditingRates} onRateChange={updateRate} getConfidence={getConfidence} getAnomaly={getAnomaly} onShowLineage={handleShowLineage} />
                                                <Section items={devicesData.lowvoltage as ElectricalItem[]} qtyMap={quantities} onChange={updateQty(setQuantities)} title="Low Voltage" icon={<LowVoltageIcon />} category="devices" isMobile={isMobile} isEditingRates={isEditingRates} onRateChange={updateRate} getConfidence={getConfidence} getAnomaly={getAnomaly} onShowLineage={handleShowLineage} />
                                            </Grid>
                                        </Grid>
                                    </>
                                )}

                                {activeTab === 1 && (
                                    <Section items={WIRE as ElectricalItem[]} qtyMap={wireQty} onChange={updateQty(setWireQty)} title="Wiring & Rough-In" icon={<CableIcon />} category="wire" isMobile={isMobile} isEditingRates={isEditingRates} onRateChange={updateRate} />
                                )}
                                {activeTab === 2 && (
                                    <Section items={gearData as ElectricalItem[]} qtyMap={gearQty} onChange={updateQty(setGearQty)} title="Panels & Service" icon={<GearIcon />} category="gear" isMobile={isMobile} isEditingRates={isEditingRates} onRateChange={updateRate} />
                                )}
                                {activeTab === 3 && (
                                    <Section items={poolData as ElectricalItem[]} qtyMap={poolQty} onChange={updateQty(setPoolQty)} title="Pool & Spa" icon={<PoolIcon />} category="pool" isMobile={isMobile} isEditingRates={isEditingRates} onRateChange={updateRate} />
                                )}
                                {activeTab === 4 && (
                                    <Section items={genData as ElectricalItem[]} qtyMap={genQty} onChange={updateQty(setGenQty)} title="Generator & Backup" icon={<GeneratorIcon />} category="generator" isMobile={isMobile} isEditingRates={isEditingRates} onRateChange={updateRate} />
                                )}
                                {activeTab === 5 && (
                                    <Section items={landData as ElectricalItem[]} qtyMap={landQty} onChange={updateQty(setLandQty)} title="Landscape Lighting" icon={<LandscapeIcon />} category="landscape" isMobile={isMobile} isEditingRates={isEditingRates} onRateChange={updateRate} />
                                )}

                                {activeTab === 6 && (
                                    <Box>
                                        <Box display="flex" alignItems="center" gap={1} mb={2}>
                                            <EquipmentIcon color="primary" />
                                            <Typography variant="h6">Equipment (Supplied By Others)</Typography>
                                        </Box>
                                        <Typography variant="body2" color="text.secondary" mb={3}>
                                            Enter the NET price of equipment. Tax (7%) and markup (25%) will be added automatically.
                                        </Typography>
                                        <Grid container spacing={2}>
                                            {EQUIPMENT_SBO.map(eq => (
                                                <Grid size={{ xs: 12, sm: 6 }} key={eq.id}>
                                                    <Paper variant="outlined" sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                        <Typography variant="body2">{eq.name}</Typography>
                                                        <TextField size="small" type="number" value={equipmentPrices[eq.id] || ''} onChange={(e) => updateEquipment(eq.id, e.target.value)} placeholder={eq.defaultPrice.toString()}
                                                            InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }} sx={{ width: 120 }} />
                                                    </Paper>
                                                </Grid>
                                            ))}
                                        </Grid>
                                        <Paper sx={{ mt: 3, p: 2, bgcolor: 'warning.light', color: 'warning.contrastText' }}>
                                            <Grid container spacing={2}>
                                                <Grid size={{ xs: 6, md: 3 }}>
                                                    <Typography variant="caption" display="block">Net</Typography>
                                                    <Typography variant="h6">{fmt(calc.eqNet)}</Typography>
                                                </Grid>
                                                <Grid size={{ xs: 6, md: 3 }}>
                                                    <Typography variant="caption" display="block">Tax (7%)</Typography>
                                                    <Typography variant="h6">{fmt(calc.eqTax)}</Typography>
                                                </Grid>
                                                <Grid size={{ xs: 6, md: 3 }}>
                                                    <Typography variant="caption" display="block">Markup (25%)</Typography>
                                                    <Typography variant="h6">{fmt(calc.eqMarkup)}</Typography>
                                                </Grid>
                                                <Grid size={{ xs: 6, md: 3 }}>
                                                    <Typography variant="caption" display="block" fontWeight="bold">Total</Typography>
                                                    <Typography variant="h6" fontWeight="bold">{fmt(calc.eqTotal)}</Typography>
                                                </Grid>
                                            </Grid>
                                        </Paper>
                                    </Box>
                                )}

                                {activeTab === 7 && (
                                    <Grid container spacing={3}>
                                        <Grid size={{ xs: 12, md: 6 }}>
                                            <Card variant="outlined">
                                                <CardContent>
                                                    <Typography variant="subtitle2" gutterBottom>📦 By Section</Typography>
                                                    <Divider sx={{ mb: 1 }} />
                                                    {Object.entries(calc.sectionsData).map(([key, val]) => (
                                                        <Box key={key} display="flex" justifyContent="space-between" mb={1}>
                                                            <Typography variant="body2" sx={{ textTransform: 'capitalize' }}>{key}</Typography>
                                                            <Typography variant="body2" fontWeight="medium">{fmt(val.mat)} / {fmtHr(val.labor)}</Typography>
                                                        </Box>
                                                    ))}
                                                </CardContent>
                                            </Card>
                                        </Grid>
                                        <Grid size={{ xs: 12, md: 6 }}>
                                            <Card variant="outlined">
                                                <CardContent>
                                                    <Typography variant="subtitle2" gutterBottom>🔌 Wire Summary</Typography>
                                                    <Divider sx={{ mb: 1 }} />
                                                    <Box sx={{ maxHeight: 200, overflow: 'auto' }}>
                                                        {Object.entries(calc.wireByType).map(([type, len]) => (
                                                            <Box key={type} display="flex" justifyContent="space-between" mb={1}>
                                                                <Typography variant="body2">{WIRE_RATES[type]?.name || type}</Typography>
                                                                <Typography variant="body2" fontWeight="medium">{Math.round(len * 1.1)} ft</Typography>
                                                            </Box>
                                                        ))}
                                                    </Box>
                                                </CardContent>
                                            </Card>
                                        </Grid>
                                        <Grid size={{ xs: 12 }}>
                                            <TextField fullWidth multiline rows={4} label="Project Notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add any additional notes here..." />
                                        </Grid>
                                    </Grid>
                                )}
                            </Box>
                        </Paper>
                    </Grid>

                    {/* Sidebar Summary */}
                    <Grid size={{ xs: 12, lg: 3 }}>
                        {/* PROJECT OVERVIEW — QA Validation Card */}
                        <Paper sx={{ p: 2, mb: 2, bgcolor: overview.hasWarnings ? 'warning.50' : 'success.50', border: 1, borderColor: overview.hasWarnings ? 'warning.main' : 'success.main' }}>
                            <Typography variant="subtitle2" fontWeight="bold" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                📋 PROJECT OVERVIEW
                            </Typography>
                            <Box sx={{ fontSize: '0.85rem' }}>
                                <Box display="flex" justifyContent="space-between" mb={0.5}>
                                    <Typography variant="body2" color="text.secondary">Area</Typography>
                                    <Typography variant="body2" fontWeight="medium">{overview.areaSqft > 0 ? `${overview.areaSqft.toLocaleString()} sq ft` : '—'}</Typography>
                                </Box>
                                <Box display="flex" justifyContent="space-between" mb={0.5}>
                                    <Typography variant="body2" color="text.secondary">Devices</Typography>
                                    <Typography variant="body2" fontWeight="medium">{overview.totalDevices.toLocaleString()}</Typography>
                                </Box>
                                <Box display="flex" justifyContent="space-between" mb={0.5}>
                                    <Typography variant="body2" color="text.secondary">BOM Cost</Typography>
                                    <Typography variant="body2" fontWeight="medium">{fmt(overview.totalBomCost)}</Typography>
                                </Box>
                                <Divider sx={{ my: 1 }} />
                                <Box mb={0.5}>
                                    <Chip size="small" label={overview.costValidation.status === 'ok' ? `$${overview.costValidation.costPerSqft.toFixed(2)}/sq.ft ✅` : `$${overview.costValidation.costPerSqft.toFixed(2)}/sq.ft ⚠️`}
                                        color={overview.costValidation.status === 'ok' ? 'success' : 'warning'} sx={{ fontSize: '0.75rem', mb: 0.5 }} />
                                    {overview.costValidation.status !== 'ok' && (
                                        <Typography variant="caption" display="block" color="warning.dark">{overview.costValidation.message}</Typography>
                                    )}
                                </Box>
                                <Box>
                                    <Chip size="small" label={overview.roomValidation.status === 'ok' ? `${overview.roomCount} files ✅` : `${overview.roomCount} files ⚠️`}
                                        color={overview.roomValidation.status === 'ok' ? 'success' : 'warning'} sx={{ fontSize: '0.75rem', mb: 0.5 }} />
                                    {overview.roomValidation.status !== 'ok' && (
                                        <Typography variant="caption" display="block" color="warning.dark">{overview.roomValidation.message}</Typography>
                                    )}
                                </Box>
                            </Box>
                        </Paper>

                        <Paper sx={{ p: 2, position: 'sticky', top: 20 }}>
                            <Typography variant="h6" gutterBottom>Estimate Summary</Typography>
                            <Divider sx={{ mb: 2 }} />
                            <Box mb={3}>
                                <Typography variant="subtitle2" color="primary" gutterBottom>Materials</Typography>
                                <Box display="flex" justifyContent="space-between"><Typography variant="body2" color="text.secondary">Base</Typography><Typography variant="body2">{fmt(calc.materialsBase)}</Typography></Box>
                                <Box display="flex" justifyContent="space-between"><Typography variant="body2" color="text.secondary">Markup (18%)</Typography><Typography variant="body2">{fmt(calc.miscMarkup)}</Typography></Box>
                                <Box display="flex" justifyContent="space-between" mt={1}><Typography variant="body2" fontWeight="bold">Total Materials</Typography><Typography variant="body2" fontWeight="bold">{fmt(calc.materialsFinal)}</Typography></Box>
                            </Box>
                            <Box mb={3}>
                                <Typography variant="subtitle2" color="primary" gutterBottom>Labor</Typography>
                                <Box display="flex" justifyContent="space-between"><Typography variant="body2" color="text.secondary">Hours</Typography><Typography variant="body2">{fmtHr(calc.totalHrs)}</Typography></Box>
                                <Box display="flex" justifyContent="space-between"><Typography variant="body2" color="text.secondary">Rate</Typography><Typography variant="body2">${laborRate}/hr</Typography></Box>
                                <Box display="flex" justifyContent="space-between" mt={1}><Typography variant="body2" fontWeight="bold">Total Labor</Typography><Typography variant="body2" fontWeight="bold">{fmt(calc.laborCost)}</Typography></Box>
                            </Box>
                            <Divider sx={{ my: 2 }} />
                            <Box mb={2}>
                                <Grid container spacing={1} alignItems="center">
                                    <Grid size={{ xs: 6 }}><Typography variant="body2">Overhead %</Typography></Grid>
                                    <Grid size={{ xs: 6 }}>
                                        <TextField size="small" type="number" value={overheadPct} onChange={(e) => setOverheadPct(parseInt(e.target.value) || 0)} InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }} />
                                    </Grid>
                                    <Grid size={{ xs: 6 }}><Typography variant="body2">Profit %</Typography></Grid>
                                    <Grid size={{ xs: 6 }}>
                                        <TextField size="small" type="number" value={profitPct} onChange={(e) => setProfitPct(parseInt(e.target.value) || 0)} InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }} />
                                    </Grid>
                                </Grid>
                            </Box>
                            <Box bgcolor="grey.100" p={2} borderRadius={1}>
                                <Box display="flex" justifyContent="space-between" mb={1}><Typography variant="body2">Base Price</Typography><Typography variant="body2">{fmt(calc.basePrice)}</Typography></Box>
                                <Box display="flex" justifyContent="space-between" mb={1}><Typography variant="body2">Equipment</Typography><Typography variant="body2">{fmt(calc.eqTotal)}</Typography></Box>
                                <Divider sx={{ my: 1 }} />
                                <Box display="flex" justifyContent="space-between">
                                    <Typography variant="h6" color="primary.main">TOTAL</Typography>
                                    <Typography variant="h6" color="primary.main">{fmt(calc.totalPrice)}</Typography>
                                </Box>
                                <Typography variant="caption" display="block" textAlign="center" mt={1} color="text.secondary">
                                    {fmt(calc.totalPrice / sqft)} / sq ft
                                </Typography>
                            </Box>
                        </Paper>
                    </Grid>
                </Grid>
            </Container>

            {/* AI Dialogs */}
            <Dialog open={showAiDialog} onClose={() => setShowAiDialog(false)} maxWidth="lg" fullWidth>
                <V3PipelineContainer
                    companyId={userProfile?.companyId || ''}
                    userId={userProfile?.id || ''}
                    initialSessionId={resumeSessionId}
                    sqft={sqft}
                    stories={stories}
                    projectType={projectType}
                    onAnalysisComplete={(results: Record<string, number>, v3R?: Record<string, BlueprintAgentV3Result>, anom?: {itemKey: string, reason: string}[], imgs?: typeof v3Images) => {
                        handleAiApply(results);
                        if (v3R) setV3Results(v3R);
                        if (anom) setAnomalies(anom);
                        if (imgs) setV3Images(imgs);
                    }}
                    onCancel={() => setShowAiDialog(false)}
                />
            </Dialog>

            {pendingMappingData && (
                <AiMappingDialog
                    open={!!pendingMappingData}
                    onClose={() => setPendingMappingData(null)}
                    aiResults={pendingMappingData!}
                    onApply={handleFinalMapping}
                    DEVICES={DEVICES}
                    GEAR={GEAR}
                    POOL={POOL}
                    GENERATOR={GENERATOR}
                    LANDSCAPE={LANDSCAPE}
                />
            )}

            {/* Lineage Popover */}
            <Popover
                open={Boolean(lineageAnchorEl) && !!lineageItem}
                anchorEl={lineageAnchorEl}
                onClose={() => setLineageAnchorEl(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            >
                <Box p={2} sx={{ minWidth: 250, maxWidth: 350 }}>
                    <Typography variant="subtitle2" fontWeight="bold" mb={1} textTransform="capitalize" color="primary">
                        {lineageItem?.replace(/_/g, ' ')} — AI Data Lineage
                    </Typography>
                    <Divider sx={{ mb: 1 }} />
                    {v3Images.map(img => {
                        const boxes = v3Results[img.id]?.[lineageItem || ''];
                        if (!boxes || boxes.length === 0) return null;
                        const avgConf = Math.round(boxes.reduce((s, b: { confidence?: number } | number[]) => s + (Array.isArray(b) ? 0 : (b.confidence || 0)), 0) / boxes.length);
                        return (
                            <Box key={img.id} display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                                <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 160 }}>
                                    {img.originalFileName} (pg {img.pageNumber})
                                </Typography>
                                <Box display="flex" alignItems="center" gap={1}>
                                    <Chip label={boxes.length} size="small" />
                                    <Typography variant="caption" sx={{ color: avgConf > 80 ? 'success.main' : 'warning.main', fontWeight: 'bold' }}>
                                        {avgConf}%
                                    </Typography>
                                </Box>
                            </Box>
                        );
                    })}
                    {anomalies.find(a => a.itemKey === lineageItem) && (
                        <Alert severity="error" sx={{ mt: 2, p: 0.5, '& .MuiAlert-message': { p: 1 } }}>
                            <Typography variant="caption" fontWeight="bold">Anomaly Detected:</Typography><br/>
                            <Typography variant="caption">{anomalies.find(a => a.itemKey === lineageItem)?.reason}</Typography>
                        </Alert>
                    )}
                    {v3Images.length > 0 && Object.keys(v3Results).length > 0 && (
                        <>
                            <Divider sx={{ my: 2 }} />
                            <Button size="small" variant="outlined" fullWidth onClick={() => { setLineageAnchorEl(null); setShowVisualProof(true); }}>
                                View Visual Proof
                            </Button>
                        </>
                    )}
                </Box>
            </Popover>

            {/* Visual Proof Dialog */}
            <Dialog open={showVisualProof} onClose={() => setShowVisualProof(false)} maxWidth="xl" fullWidth>
                <Box sx={{ bgcolor: 'background.paper', height: '85vh', display: 'flex', flexDirection: 'column' }}>
                    {v3Images.length > 0 && Object.keys(v3Results).length > 0 ? (
                        <V3VisualProofStep
                            images={v3Images as unknown as import('../../hooks/usePdfRasterizer').RasterizedImage[]}
                            results={v3Results}
                            aggregatedResult={currentEstimateData?.quantities || quantities || {}}
                            onComplete={() => setShowVisualProof(false)}
                            onBack={() => setShowVisualProof(false)}
                        />
                    ) : (
                        <Typography p={4} textAlign="center">No visual data available.</Typography>
                    )}
                </Box>
            </Dialog>

            {/* Sticky Footer for Mobile */}
            {isMobile && (
                <Paper elevation={3} sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, p: 2, bgcolor: 'primary.main', color: 'primary.contrastText', zIndex: 1000 }}>
                    <Box display="flex" justifyContent="space-between" alignItems="center">
                        <Box>
                            <Typography variant="caption">Total Estimate</Typography>
                            <Typography variant="h6" fontWeight="bold">{fmt(calc.totalPrice)}</Typography>
                        </Box>
                        <Button variant="contained" color="secondary" onClick={() => setActiveTab(7)}>View Summary</Button>
                    </Box>
                </Paper>
            )}

            {/* Save Snackbar */}
            <Snackbar open={!!saveSnackbar} autoHideDuration={3000} onClose={() => setSaveSnackbar('')} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
                <Alert onClose={() => setSaveSnackbar('')} severity={saveSnackbar.includes('✅') ? 'success' : 'error'} variant="filled">
                    {saveSnackbar}
                </Alert>
            </Snackbar>
        </Box>
    );
}
