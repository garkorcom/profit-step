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
    SaveAlt as ExportIcon, FlashOn as FlashOnIcon, Add as AddIcon,
    Remove as RemoveIcon, AutoAwesome as AutoAwesomeIcon,
    Cable as CableIcon, PictureAsPdf as PdfIcon,
    Save as SaveIcon, FolderOpen as ProjectsIcon, TableChart as ExcelIcon, Warning as WarningIcon
} from '@mui/icons-material';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

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

// ============== DATA ==============
import { DEVICES, GEAR, POOL, GENERATOR, LANDSCAPE, WIRE } from '../../constants/electricalDevices';
export { DEVICES, GEAR, POOL, GENERATOR, LANDSCAPE, WIRE };

const EQUIPMENT_SBO = [
    { id: 'eq_fixtures', name: 'Light Fixtures Package', defaultPrice: 5000 },
    { id: 'eq_fans', name: 'Ceiling Fans Package', defaultPrice: 1500 },
    { id: 'eq_landscape', name: 'Landscape Fixtures', defaultPrice: 2500 },
    { id: 'eq_generator', name: 'Generator Unit', defaultPrice: 12000 },
    { id: 'eq_smart', name: 'Smart Home Devices', defaultPrice: 3000 },
    { id: 'eq_audio', name: 'Audio/Speakers', defaultPrice: 2000 },
    { id: 'eq_security', name: 'Security System', defaultPrice: 1500 },
    { id: 'eq_ev_charger', name: 'EV Charger Unit', defaultPrice: 800 },
];

const TEMPLATES: any = {
    condo_2br: {
        name: '2BR Condo (~1,200 sf)',
        descriptionRu: '2 спальни, 1 этаж, базовый набор',
        sqft: 1200, stories: 1, type: 'residential',
        devices: { recessed_ic: 12, surface: 4, bath_exhaust: 2, duplex: 18, gfi: 6, single_pole: 12, '3way': 4, dimmer: 2, dishwasher: 1, disposal: 1, microwave: 1, refrigerator: 1, washer: 1, ac_30a: 1, ac_disc: 1, air_handler: 1, thermostat: 1, smoke_co: 3, doorbell: 1, cat6: 4 },
        gear: { panel_200: 1, meter_200: 1, grounding: 1 },
        pool: {}, generator: {}, landscape: {}, equipment: {}
    },
    house_3br: {
        name: '3BR House (~2,000 sf)',
        descriptionRu: '3 спальни, ~2000 кв.ф., стандартное наполнение',
        sqft: 2000, stories: 1, type: 'residential',
        devices: { recessed_ic: 24, surface: 6, pendant: 2, ceiling_fan: 3, bath_exhaust: 2, duplex: 28, gfi: 8, dedicated_20a: 2, outlet_240_30: 1, outlet_240_50: 1, exterior: 4, single_pole: 18, '3way': 6, dimmer: 4, range: 1, dishwasher: 1, disposal: 1, microwave: 1, refrigerator: 1, washer: 1, dryer: 1, water_heater: 1, ac_30a: 1, ac_disc: 1, air_handler: 1, thermostat: 1, smoke_co: 5, doorbell: 1, cat6: 6, coax: 4 },
        gear: { panel_200: 1, meter_200: 1, grounding: 1, surge: 1 },
        pool: {}, generator: {}, landscape: { land_trans_300: 1, land_path: 6, land_spot: 4 }, equipment: {}
    },
    house_4br: {
        name: '4BR House (~3,000 sf)',
        descriptionRu: '4 спальни, 2 этажа, расширенный набор',
        sqft: 3000, stories: 2, type: 'residential',
        devices: { recessed_ic: 42, surface: 8, pendant: 4, chandelier: 1, ceiling_fan: 4, under_cabinet: 8, bath_exhaust: 3, duplex: 42, gfi: 12, dedicated_20a: 4, outlet_240_30: 1, outlet_240_50: 1, floor_outlet: 2, exterior: 6, single_pole: 28, '3way': 10, '4way': 2, dimmer: 8, range: 1, cooktop: 0, wall_oven: 1, dishwasher: 1, disposal: 1, microwave: 1, refrigerator: 1, washer: 1, dryer: 1, water_heater: 1, ev_charger: 1, ac_40a: 1, ac_disc: 1, mini_split: 1, air_handler: 1, thermostat: 2, smoke_co: 7, doorbell_cam: 1, cat6: 12, coax: 6, speaker_wire: 4 },
        gear: { panel_200: 1, subpanel_100: 1, meter_200: 1, grounding: 1, surge: 1 },
        pool: {}, generator: { interlock: 1, inlet_box: 1 }, landscape: { land_trans_600: 1, land_path: 10, land_spot: 8, land_well: 4 }, equipment: { eq_fixtures: 8000 }
    },
    custom_5br: {
        name: '5BR Custom (~5,500 sf)',
        descriptionRu: '5 спален, премиум класс, полное оснащение',
        sqft: 5500, stories: 2, type: 'residential',
        devices: { recessed_ic: 85, surface: 12, pendant: 8, chandelier: 3, ceiling_fan: 5, under_cabinet: 16, bath_exhaust: 5, duplex: 65, gfi: 18, dedicated_20a: 8, outlet_240_30: 1, outlet_240_50: 2, floor_outlet: 4, exterior: 12, single_pole: 45, '3way': 18, '4way': 4, dimmer: 16, smart_switch: 10, occupancy: 6, range: 0, cooktop: 1, double_oven: 1, dishwasher: 2, disposal: 1, microwave: 1, refrigerator: 2, freezer: 1, washer: 1, dryer: 1, tankless_wh: 1, ev_charger_60: 2, ac_40a: 2, ac_disc: 2, mini_split: 2, air_handler: 2, thermostat: 4, smoke_co: 12, doorbell_cam: 2, cat6: 24, coax: 8, speaker_wire: 12, central_vac: 6 },
        gear: { panel_400: 1, ct_400: 1, subpanel_200: 2, meter_400: 1, grounding: 1, surge: 1 },
        pool: { pool_bond: 1, pool_light_jbox: 2, pool_transformer: 1, pool_pump: 1, pool_heater: 1, spa_pump: 1, pool_gfi: 2, pool_disc: 2, pool_automation: 1 },
        generator: { gen_pad: 1, ats_200: 1, gen_whip: 1, gen_disc: 1, gen_wire: 1, gen_coord: 1 },
        landscape: { land_trans_900: 1, land_path: 20, land_spot: 16, land_well: 8, land_flood: 4 },
        equipment: { eq_fixtures: 18000, eq_fans: 2500, eq_landscape: 6000, eq_generator: 15000, eq_smart: 8000, eq_audio: 5000 }
    },
};

const WIRE_RATES: any = {
    '14-2': { name: '14-2 NM-B', rate: 0.45, laborPer100: 0.80 },
    '14-3': { name: '14-3 NM-B', rate: 0.65, laborPer100: 0.85 },
    '12-2': { name: '12-2 NM-B', rate: 0.55, laborPer100: 0.85 },
    '12-3': { name: '12-3 NM-B', rate: 0.75, laborPer100: 0.90 },
    '10-2': { name: '10-2 NM-B', rate: 0.85, laborPer100: 1.00 },
    '10-3': { name: '10-3 NM-B', rate: 1.10, laborPer100: 1.10 },
    '8-2': { name: '8-2 NM-B', rate: 1.50, laborPer100: 1.20 },
    '8-3': { name: '8-3 NM-B', rate: 1.80, laborPer100: 1.30 },
    '6-2': { name: '6-2 NM-B', rate: 2.40, laborPer100: 1.40 },
    '6-3': { name: '6-3 NM-B', rate: 3.20, laborPer100: 1.60 },
    '4-3': { name: '4-3 NM-B', rate: 3.80, laborPer100: 1.80 },
    '2-2-2-4': { name: '2-2-2-4 SER', rate: 4.50, laborPer100: 2.00 },
    '18-2': { name: '18-2 LV', rate: 0.18, laborPer100: 0.30 },
    '18-5': { name: '18-5 Stat', rate: 0.28, laborPer100: 0.35 },
    '16-2': { name: '16-2 Speaker', rate: 0.22, laborPer100: 0.30 },
    '12-2lv': { name: '12-2 LV Landscape', rate: 0.35, laborPer100: 0.40 },
    'cat6': { name: 'Cat6', rate: 0.75, laborPer100: 0.60 },
    'rg6': { name: 'RG6 Coax', rate: 0.35, laborPer100: 0.50 },
};

const ItemRow = React.memo(({ item, qty, onChange, category, isMobile, isEditingRates, onRateChange, confidence, anomaly, onShowLineage }: any) => {
    const hasQty = qty > 0;
    const bg = hasQty ? 'primary.50' : 'background.paper';

    const handleIncrement = () => onChange(item.id, (parseInt(qty || '0') + 1).toString());
    const handleDecrement = () => onChange(item.id, Math.max(0, (parseInt(qty || '0') - 1)).toString());

    if (isMobile) {
        return (
            <Paper variant="outlined" sx={{ p: 1, mb: 1, bgcolor: bg, borderColor: hasQty ? 'primary.main' : undefined }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                    <Box display="flex" alignItems="center" gap={1}>
                        {anomaly && (
                            <Tooltip title={anomaly}>
                                <IconButton color="error" size="small" sx={{ p: 0 }} onClick={onShowLineage}>
                                    <WarningIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        )}
                        <Typography variant="body2" fontWeight="medium">{item.name}</Typography>
                        {!!confidence && confidence > 0 && hasQty && (
                            <Chip size="small" label={`${confidence}%`} color={confidence > 85 ? 'success' : confidence > 60 ? 'warning' : 'error'} sx={{ height: 16, fontSize: '0.65rem' }} onClick={onShowLineage} />
                        )}
                    </Box>
                    {hasQty && <Chip label={qty} size="small" color="primary" />}
                </Box>

                {isEditingRates ? (
                    <Box display="flex" gap={1} mb={1}>
                        <TextField
                            label="Mat $"
                            type="number"
                            size="small"
                            value={item.matRate}
                            onChange={(e) => onRateChange(category, item.id, 'matRate', e.target.value)}
                            sx={{ width: 80 }}
                            InputProps={{ style: { fontSize: '0.75rem' } }}
                        />
                        <TextField
                            label="Labor Hr"
                            type="number"
                            size="small"
                            value={item.laborRate}
                            onChange={(e) => onRateChange(category, item.id, 'laborRate', e.target.value)}
                            sx={{ width: 80 }}
                            InputProps={{ style: { fontSize: '0.75rem' } }}
                        />
                    </Box>
                ) : (
                    <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                        Mat: ${item.matRate} | Labor: {item.laborRate}h
                    </Typography>
                )}

                <Box display="flex" alignItems="center" justifyContent="flex-end" gap={1}>
                    <IconButton size="small" onClick={handleDecrement} disabled={!qty}><RemoveIcon fontSize="small" /></IconButton>
                    <TextField
                        type="number"
                        size="small"
                        value={qty || ''}
                        onChange={(e) => onChange(item.id, e.target.value)}
                        placeholder="0"
                        sx={{ width: 60 }}
                        inputProps={{ min: 0, style: { textAlign: 'center' } }}
                    />
                    <IconButton size="small" onClick={handleIncrement} color="primary"><AddIcon fontSize="small" /></IconButton>
                </Box>
            </Paper>
        );
    }

    return (
        <Paper
            variant="outlined"
            sx={{
                p: 1,
                mb: 1,
                display: 'flex',
                alignItems: 'center',
                bgcolor: bg,
                borderColor: hasQty ? 'primary.main' : 'divider',
                transition: 'all 0.2s',
                '&:hover': { bgcolor: hasQty ? 'primary.100' : 'action.hover' }
            }}
        >
            <Box flex={1} mr={2} display="flex" alignItems="center" gap={1}>
                {anomaly && (
                    <Tooltip title={anomaly}>
                        <IconButton color="error" size="small" sx={{ p: 0 }} onClick={onShowLineage}>
                            <WarningIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                )}
                <Typography variant="body2" fontWeight={hasQty ? "bold" : "medium"}>{item.name}</Typography>
                {!!confidence && confidence > 0 && hasQty && (
                    <Chip size="small" label={`${confidence}%`} color={confidence > 85 ? 'success' : confidence > 60 ? 'warning' : 'error'} sx={{ height: 16, fontSize: '0.65rem', cursor: 'pointer' }} onClick={onShowLineage} />
                )}
            </Box>

            {isEditingRates ? (
                <>
                    <TextField
                        type="number"
                        size="small"
                        value={item.matRate}
                        onChange={(e) => onRateChange(category, item.id, 'matRate', e.target.value)}
                        sx={{ width: 90, mr: 1 }}
                        InputProps={{
                            startAdornment: <InputAdornment position="start">$</InputAdornment>,
                            style: { fontSize: '0.875rem' }
                        }}
                    />
                    <TextField
                        type="number"
                        size="small"
                        value={item.laborRate}
                        onChange={(e) => onRateChange(category, item.id, 'laborRate', e.target.value)}
                        sx={{ width: 90, mr: 1 }}
                        InputProps={{
                            endAdornment: <InputAdornment position="end">h</InputAdornment>,
                            style: { fontSize: '0.875rem' }
                        }}
                    />
                </>
            ) : (
                <>
                    <Typography variant="body2" color="text.secondary" sx={{ width: 90, mr: 1, textAlign: 'right' }}>
                        ${item.matRate}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ width: 90, mr: 1, textAlign: 'right' }}>
                        {item.laborRate}h
                    </Typography>
                </>
            )}

            <Box display="flex" alignItems="center" sx={{ width: 140, justifyContent: 'center' }}>
                <IconButton size="small" onClick={handleDecrement} disabled={!qty} sx={{ p: 0.5 }}><RemoveIcon fontSize="small" /></IconButton>
                <TextField
                    type="number"
                    size="small"
                    value={qty || ''}
                    onChange={(e) => onChange(item.id, e.target.value)}
                    placeholder="0"
                    sx={{ width: 60, mx: 0.5 }}
                    inputProps={{ min: 0, style: { textAlign: 'center', fontWeight: hasQty ? 'bold' : 'normal' } }}
                />
                <IconButton size="small" onClick={handleIncrement} color="primary" sx={{ p: 0.5 }}><AddIcon fontSize="small" /></IconButton>
            </Box>
        </Paper>
    );
});

const Section = React.memo(({ items, qtyMap, onChange, title, icon, category, isMobile, isEditingRates, onRateChange, getConfidence, getAnomaly, onShowLineage }: any) => (
    <Box mb={4}>
        <Box display="flex" alignItems="center" gap={1} mb={2}>
            {icon}
            <Typography variant="h6" color="primary">{title}</Typography>
        </Box>
        {!isMobile && (
            <Box display="flex" px={2} mb={1}>
                <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>Item</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ width: 90, mr: 1, textAlign: 'right' }}>Material</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ width: 90, mr: 1, textAlign: 'right' }}>Labor</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ width: 140, textAlign: 'center' }}>Quantity</Typography>
            </Box>
        )}
        <Grid container spacing={1}>
            {items.map((item: any) => (
                <Grid size={{ xs: 12 }} key={item.id}>
                    <ItemRow
                        item={item}
                        qty={qtyMap[item.id]}
                        onChange={onChange}
                        category={category}
                        isMobile={isMobile}
                        isEditingRates={isEditingRates}
                        onRateChange={onRateChange}
                        confidence={getConfidence ? getConfidence(item.id) : 0}
                        anomaly={getAnomaly ? getAnomaly(item.id) : null}
                        onShowLineage={(e: any) => onShowLineage && onShowLineage(e, item.id)}
                    />
                </Grid>
            ))}
        </Grid>
    </Box>
));

// ============== COMPONENT ==============
export default function ElectricalEstimatorPage() {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const { userProfile } = useAuth();
    const location = useLocation();

    /**
     * PROJECT VERSIONING CONTEXT:
     * If navigating from a Project Workspace to "re-run" an analysis, the `projectId` is passed in the URL.
     * We capture this and pass it down to `BlueprintUploadDialog` so the resulting estimate
     * is saved as a new version (e.g., v2) under the same project instead of creating a duplicate project.
     */
    const projectIdMatch = new URLSearchParams(location.search).get('projectId');

    const [savingProject, setSavingProject] = useState(false);
    const [saveSnackbar, setSaveSnackbar] = useState('');

    const [projectName, setProjectName] = useState('New Project');
    const [projectType, setProjectType] = useState('residential');
    const [sqft, setSqft] = useState(0);
    const [stories, setStories] = useState(1);
    const [typeMult, setTypeMult] = useState(1);

    // Data State
    const [devicesData, setDevicesData] = useState(DEVICES);
    const [gearData, setGearData] = useState(GEAR);
    const [poolData, setPoolData] = useState(POOL);
    const [genData, setGenData] = useState(GENERATOR);
    const [landData, setLandData] = useState(LANDSCAPE);
    const [wireRatesData] = useState(WIRE_RATES);

    const [quantities, setQuantities] = useState<any>({});
    const [gearQty, setGearQty] = useState<any>({});
    const [poolQty, setPoolQty] = useState<any>({});
    const [genQty, setGenQty] = useState<any>({});
    const [landQty, setLandQty] = useState<any>({});
    const [wireQty, setWireQty] = useState<any>({});
    const [equipmentPrices, setEquipmentPrices] = useState<any>({});
    const [laborRate] = useState(35);
    const [overheadPct, setOverheadPct] = useState(25);
    const [profitPct, setProfitPct] = useState(10);
    const [activeTab, setActiveTab] = useState<number>(0);
    const [notes, setNotes] = useState('');
    const [isEditingRates, setIsEditingRates] = useState(false);
    const [showAiDialog, setShowAiDialog] = useState(false);
    const [showVisualProof, setShowVisualProof] = useState(false);
    const [activeV3Sessions, setActiveV3Sessions] = useState<BlueprintV3Session[]>([]);
    const [resumeSessionId, setResumeSessionId] = useState<string | undefined>(undefined);
    const [exportAnchorEl, setExportAnchorEl] = useState<null | HTMLElement>(null);

    const [unmappedItems, setUnmappedItems] = useState<Record<string, number>>({});
    const [pendingMappingData, setPendingMappingData] = useState<Record<string, number> | null>(null);

    const [v3Results, setV3Results] = useState<Record<string, BlueprintAgentV3Result>>({});
    const [v3Images, setV3Images] = useState<any[]>([]);
    const [anomalies, setAnomalies] = useState<{itemKey: string, reason: string}[]>([]);
    
    const [lineageAnchorEl, setLineageAnchorEl] = useState<HTMLElement | null>(null);
    const [lineageItem, setLineageItem] = useState<string | null>(null);

    const [currentEstimateId, setCurrentEstimateId] = useState<string | null>(null);
    const [currentEstimateData, setCurrentEstimateData] = useState<any>(null);
    const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
    const [autosaveStatus, setAutosaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

    // Fetch active V3 sessions on component load
    useEffect(() => {
        if (!userProfile?.companyId || !userProfile?.id) return;
        
        blueprintApi.listActiveV3Sessions(userProfile.companyId, userProfile.id)
            .then(setActiveV3Sessions)
            .catch(console.error);
    }, [userProfile?.companyId, userProfile?.id, showAiDialog]);

    // Load project on mount if ID is in URL
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const estId = params.get('id') || params.get('estimateId');

        if (userProfile) {
            if (projectIdMatch) {
                // Load root project metadata
                projectsApi.getById(projectIdMatch).then((projectData) => {
                    if (projectData) {
                        setProjectName(projectData.name);
                        if (projectData.areaSqft) setSqft(projectData.areaSqft);

                        // Try to load the estimate quantities if ID was passed
                        if (estId) {
                            savedEstimateApi.getById(estId).then((estData: any) => {
                                if (estData) {
                                    setCurrentEstimateId(estId);
                                    setCurrentEstimateData(estData);
                                    if (estData.quantities) {
                                        setQuantities(estData.quantities);
                                        setGearQty(estData.quantities);
                                        setPoolQty(estData.quantities);
                                        setGenQty(estData.quantities);
                                        setLandQty(estData.quantities);
                                        setWireQty(estData.quantities);
                                    }
                                }
                            }).catch(console.error);
                        }
                    }
                }).catch(console.error);
            } else if (estId) {
                // Legacy: load standalone estimate
                savedEstimateApi.getById(estId).then((data: any) => {
                    if (data) {
                        setCurrentEstimateId(estId);
                        setCurrentEstimateData(data);
                        setProjectName(data.projectName || 'Loaded Project');
                        if (data.areaSqft) setSqft(data.areaSqft);
                        // Load quantities
                        if (data.quantities) {
                            setQuantities(data.quantities);
                            setGearQty(data.quantities);
                            setPoolQty(data.quantities);
                            setGenQty(data.quantities);
                            setLandQty(data.quantities);
                            setWireQty(data.quantities);
                        }
                    }
                }).catch(console.error);
            }
        }
    }, [userProfile, projectIdMatch]);

    const updateQty = (setter: any) => (id: string, value: string) => {
        setter((prev: any) => ({ ...prev, [id]: Math.max(0, parseInt(value) || 0) }));
    };

    const updateEquipment = (id: string, value: string) => {
        setEquipmentPrices((prev: any) => ({ ...prev, [id]: Math.max(0, parseFloat(value) || 0) }));
    };

    const updateRate = (category: string, id: string, field: 'matRate' | 'laborRate', value: string) => {
        const numValue = parseFloat(value) || 0;
        if (category === 'devices') {
            setDevicesData(prev => {
                const newData = { ...prev };
                Object.keys(newData).forEach(key => {
                    newData[key as keyof typeof DEVICES] = newData[key as keyof typeof DEVICES].map((item: any) =>
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

    const handleAiApply = (detected: any, newSqft?: number) => {
        setPendingMappingData(detected);
        if (newSqft) {
            setSqft(newSqft);
        }
        setShowAiDialog(false);
    };

    const getConfidence = (itemKey: string) => {
        let totalConf = 0;
        let count = 0;
        Object.values(v3Results).forEach(pageData => {
            const boxes = pageData[itemKey];
            if (boxes && Array.isArray(boxes)) {
                boxes.forEach((b: any) => {
                    if (b.confidence) {
                        totalConf += b.confidence;
                        count++;
                    }
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
        const devKeys = new Set(Object.values(DEVICES).flat().map((i: any) => i.id));
        const gearKeys = new Set(GEAR.map(i => i.id));
        const poolKeys = new Set(POOL.map(i => i.id));
        const genKeys = new Set(GENERATOR.map(i => i.id));
        const landKeys = new Set(LANDSCAPE.map(i => i.id));
        const wireKeys = new Set(WIRE.map(i => i.id));

        setQuantities((prev: any) => {
            const next = { ...prev };
            Object.entries(mapped).forEach(([k, v]) => {
                if (devKeys.has(k)) next[k] = (next[k] || 0) + v;
            });
            return next;
        });
        setGearQty((prev: any) => {
            const next = { ...prev };
            Object.entries(mapped).forEach(([k, v]) => {
                if (gearKeys.has(k)) next[k] = (next[k] || 0) + v;
            });
            return next;
        });
        setPoolQty((prev: any) => {
            const next = { ...prev };
            Object.entries(mapped).forEach(([k, v]) => {
                if (poolKeys.has(k)) next[k] = (next[k] || 0) + v;
            });
            return next;
        });
        setGenQty((prev: any) => {
            const next = { ...prev };
            Object.entries(mapped).forEach(([k, v]) => {
                if (genKeys.has(k)) next[k] = (next[k] || 0) + v;
            });
            return next;
        });
        setLandQty((prev: any) => {
            const next = { ...prev };
            Object.entries(mapped).forEach(([k, v]) => {
                if (landKeys.has(k)) next[k] = (next[k] || 0) + v;
            });
            return next;
        });
        setWireQty((prev: any) => {
            const next = { ...prev };
            Object.entries(mapped).forEach(([k, v]) => {
                if (wireKeys.has(k)) next[k] = (next[k] || 0) + v;
            });
            return next;
        });

        setUnmappedItems(prev => {
            const next = { ...prev };
            Object.entries(unmapped).forEach(([k, v]) => {
                next[k] = (next[k] || 0) + v;
            });
            return next;
        });

        // Extract potential sqft area fields natively
        const areaKeys = ['sqft', 'sq_ft', 'area', 'square_feet', 'area_sqft'];
        for (const [key, val] of Object.entries(unmapped)) {
            if (areaKeys.includes(key.toLowerCase()) && typeof val === 'number' && val > 0) {
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

    const storyMult = stories === 1 ? 1.0 : stories === 2 ? 1.15 : 1.30;

    const calc = useMemo(() => {
        let devicesMat = 0, devicesLabor = 0, wireByType: any = {};

        const processItems = (items: any[], qtyMap: any, addWire = true) => {
            let mat = 0, labor = 0;
            items.forEach(item => {
                const qty = qtyMap[item.id] || 0;
                if (qty > 0) {
                    mat += qty * (item.matRate || 0);
                    labor += qty * (item.laborRate || 0);
                    if (addWire && item.wireType && item.wireLen > 0) {
                        const adjLen = item.wireLen * storyMult;
                        wireByType[item.wireType] = (wireByType[item.wireType] || 0) + qty * adjLen;
                    }
                }
            });
            return { mat, labor };
        };

        const devRes = processItems(Object.values(devicesData).flat(), quantities);
        devicesMat = devRes.mat; devicesLabor = devRes.labor;

        const gearRes = processItems(gearData, gearQty, false);
        const poolRes = processItems(poolData, poolQty);
        const genRes = processItems(genData, genQty);
        const landRes = processItems(landData, landQty);
        const wireRes = processItems(WIRE, wireQty, false);

        let wireMat = 0, wireLabor = 0;
        Object.entries(wireByType).forEach(([type, len]: [string, any]) => {
            const w = wireRatesData[type];
            if (w) {
                const withAdd = len * 1.10;
                wireMat += withAdd * w.rate;
                wireLabor += (withAdd / 100) * w.laborPer100;
            }
        });

        const sectionsData = {
            devices: { mat: devicesMat, labor: devicesLabor },
            wire_auto: { mat: wireMat, labor: wireLabor },
            wire_manual: { mat: wireRes.mat, labor: wireRes.labor },
            gear: { mat: gearRes.mat, labor: gearRes.labor },
            pool: { mat: poolRes.mat, labor: poolRes.labor },
            generator: { mat: genRes.mat, labor: genRes.labor },
            landscape: { mat: landRes.mat, labor: landRes.labor },
        };

        const materialsBase = Object.values(sectionsData).reduce((s, x) => s + x.mat, 0);
        const productiveHrs = Object.values(sectionsData).reduce((s, x) => s + x.labor, 0) * typeMult;
        const nonProdHrs = productiveHrs * 0.18;
        const totalHrs = productiveHrs + nonProdHrs;

        const miscMarkup = materialsBase * 0.18;
        const materialsFinal = materialsBase + miscMarkup;
        const salesTaxMat = materialsBase * 0.07;
        const laborCost = totalHrs * laborRate;
        const matLaborCost = materialsFinal + laborCost;
        const overhead = matLaborCost * (overheadPct / 100);
        const profit = matLaborCost * (profitPct / 100);

        let eqNet = 0;
        Object.entries(equipmentPrices).forEach(([id, price]: [string, any]) => { eqNet += price || 0; });
        const eqTax = eqNet * 0.07;
        const eqMarkup = eqNet * 0.25;
        const eqTotal = eqNet + eqTax + eqMarkup;

        const basePrice = matLaborCost + overhead + profit + salesTaxMat;
        const totalPrice = basePrice + eqTotal;

        return {
            sectionsData, wireByType, materialsBase, miscMarkup, materialsFinal, salesTaxMat,
            productiveHrs, nonProdHrs, totalHrs, laborCost, matLaborCost, overhead, profit,
            eqNet, eqTax, eqMarkup, eqTotal, basePrice, totalPrice
        };
    }, [quantities, gearQty, poolQty, genQty, landQty, wireQty, equipmentPrices, laborRate, overheadPct, profitPct, storyMult, typeMult, devicesData, gearData, poolData, genData, landData, wireRatesData]);

    // ===== PROJECT OVERVIEW with QA Validation =====
    const overview: ProjectOverview = useMemo(() => {
        // Merge all quantity maps for total device count
        const allQty: Record<string, number> = {};
        [quantities, gearQty, poolQty, genQty, landQty, wireQty].forEach(map => {
            Object.entries(map).forEach(([k, v]: [string, any]) => { if (v > 0) allQty[k] = (allQty[k] || 0) + v; });
        });

        // Room/file count: use electricalCount from current estimate if available, else count active sections
        const roomCount = currentEstimateData?.electricalCount || 
            (currentEstimateData?.filesCount || Object.keys(allQty).length > 0 ? 1 : 0);

        return generateProjectOverview({
            areaSqft: sqft,
            roomCount,
            quantities: allQty,
            totalBomCost: calc.materialsBase,
        });
    }, [sqft, quantities, gearQty, poolQty, genQty, landQty, wireQty, calc.materialsBase, currentEstimateData]);

    const fmt = (v: number) => '$' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const fmtHr = (v: number) => v.toFixed(1) + ' hr';

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

    // ===== PDF Export =====
    const stringToColor = (str: string) => {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
        return '#' + '00000'.substring(0, 6 - c.length) + c;
    };

    const hexToRgb = (hex: string) => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return [r, g, b] as [number, number, number];
    };

    const generateEstimatePDF = async (label?: string, aiQtyMap?: Record<string, number>) => {
        setIsGeneratingPDF(true);
        // Small delay to allow react to render the spinner
        await new Promise(r => setTimeout(r, 100));
        
        try {
                const pdf = new jsPDF();
                // Header
                pdf.setFontSize(18);
                const title = label ? `ELECTRICAL ESTIMATE - ${label}` : 'ELECTRICAL ESTIMATE';
                pdf.text(title, 14, 20);
                pdf.setFontSize(10);
                pdf.setTextColor(100);
                pdf.text(`Project: ${projectName} | ${projectType} | ${sqft} sq ft | ${stories} story`, 14, 28);
                pdf.text(`Date: ${new Date().toLocaleDateString()} | Overhead: ${overheadPct}% | Profit: ${profitPct}%`, 14, 34);

                // PROJECT OVERVIEW in PDF
                const ovBgColor: [number, number, number] = overview.hasWarnings ? [255, 243, 224] : [232, 245, 233];
                pdf.setFillColor(...ovBgColor);
                pdf.roundedRect(14, 38, 182, 28, 2, 2, 'F');
                pdf.setFontSize(9);
                pdf.setTextColor(33, 33, 33);
                pdf.text('📋 PROJECT OVERVIEW', 18, 44);
                pdf.setFontSize(8);
                pdf.setTextColor(80);
                pdf.text(`Area: ${overview.areaSqft > 0 ? overview.areaSqft.toLocaleString() + ' sq ft' : '—'}   |   Devices: ${overview.totalDevices.toLocaleString()}   |   BOM Cost: ${fmt(overview.totalBomCost)}`, 18, 50);
                const costStatus = overview.costValidation.status === 'ok' ? '✓' : '⚠';
                const roomStatus = overview.roomValidation.status === 'ok' ? '✓' : '⚠';
                pdf.text(`Cost/sq.ft: $${overview.costValidation.costPerSqft.toFixed(2)} ${costStatus}   |   Files: ${overview.roomCount} ${roomStatus}`, 18, 56);
                if (overview.hasWarnings) {
                    pdf.setTextColor(211, 84, 0);
                    pdf.setFontSize(7);
                    let warnY = 62;
                    if (overview.costValidation.status !== 'ok') {
                        pdf.text(overview.costValidation.message, 18, warnY);
                        warnY += 4;
                    }
                    if (overview.roomValidation.status !== 'ok') {
                        pdf.text(overview.roomValidation.message, 18, warnY);
                    }
                }

                // Use either custom AI map or the state maps
                const getCustomQty = aiQtyMap ? (id: string) => aiQtyMap[id] || 0 : null;

                let startY = overview.hasWarnings ? 72 : 68;

                // Gather all items with qty > 0
                const sections: { name: string; items: any[]; qtyMap: any }[] = [
                    ...Object.entries(DEVICES).map(([key, items]) => ({ name: key.charAt(0).toUpperCase() + key.slice(1), items, qtyMap: getCustomQty ? aiQtyMap : quantities })),
                    { name: 'Wire & Conduit', items: WIRE, qtyMap: getCustomQty ? aiQtyMap : wireQty },
                    { name: 'Panels & Gear', items: gearData, qtyMap: getCustomQty ? aiQtyMap : gearQty },
                    { name: 'Pool & Spa', items: poolData, qtyMap: getCustomQty ? aiQtyMap : poolQty },
                    { name: 'Generator', items: genData, qtyMap: getCustomQty ? aiQtyMap : genQty },
                    { name: 'Landscape', items: landData, qtyMap: getCustomQty ? aiQtyMap : landQty },
                ];

                sections.forEach(sec => {
                    const rows = sec.items.filter(item => (getCustomQty ? getCustomQty(item.id) : (sec.qtyMap[item.id] || 0)) > 0)
                        .map(item => {
                            const qty = getCustomQty ? getCustomQty(item.id) : (sec.qtyMap[item.id] || 0);
                            return [
                                item.name,
                                `$${item.matRate}`,
                                `${item.laborRate}h`,
                                qty.toString(),
                                `$${(qty * item.matRate).toFixed(2)}`,
                            ];
                        });
                    if (rows.length === 0) return;

                    pdf.setFontSize(11);
                    pdf.setTextColor(33, 33, 33);
                    pdf.text(sec.name.toUpperCase(), 14, startY);
                    startY += 2;
                    autoTable(pdf, {
                        startY,
                        head: [['Item', 'Mat $', 'Labor Hr', 'Qty', 'Mat Total']],
                        body: rows,
                        styles: { fontSize: 7.5 },
                        headStyles: { fillColor: [25, 118, 210] },
                        margin: { left: 14, right: 14 },
                        theme: 'grid',
                    });
                    startY = (pdf as any).lastAutoTable.finalY + 8;
                    if (startY > 260) { pdf.addPage(); startY = 20; }
                });

                // Equipment S.B.O.
                const eqRows = EQUIPMENT_SBO.filter(eq => (equipmentPrices[eq.id] || 0) > 0)
                    .map(eq => {
                        const price = equipmentPrices[eq.id] || 0;
                        return [eq.name, '', '', '1', `$${price.toFixed(2)}`];
                    });
                if (eqRows.length > 0) {
                    if (startY > 250) { pdf.addPage(); startY = 20; }
                    pdf.setFontSize(11);
                    pdf.setTextColor(33, 33, 33);
                    pdf.text('EQUIPMENT (S.B.O.)', 14, startY);
                    startY += 2;
                    autoTable(pdf, {
                        startY,
                        head: [['Item', '', '', '', 'Price']],
                        body: eqRows,
                        styles: { fontSize: 7.5 },
                        headStyles: { fillColor: [76, 175, 80] },
                        margin: { left: 14, right: 14 },
                        theme: 'grid',
                    });
                    startY = (pdf as any).lastAutoTable.finalY + 8;
                }

                // Summary
                if (startY > 220) { pdf.addPage(); startY = 20; }
                pdf.setFontSize(12);
                pdf.setTextColor(33, 33, 33);
                pdf.text('SUMMARY', 14, startY);
                startY += 4;
                autoTable(pdf, {
                    startY,
                    body: [
                        ['Materials (Base)', fmt(calc.materialsBase)],
                        ['Materials (+18%)', fmt(calc.materialsFinal)],
                        [`Labor (${fmtHr(calc.totalHrs)})`, fmt(calc.laborCost)],
                        ['Mat + Labor', fmt(calc.matLaborCost)],
                        [`Overhead (${overheadPct}%)`, fmt(calc.overhead)],
                        [`Profit (${profitPct}%)`, fmt(calc.profit)],
                        ['Sales Tax', fmt(calc.salesTaxMat)],
                        ['BASE PRICE', fmt(calc.basePrice)],
                        ['', ''],
                        ['Equipment (Net)', fmt(calc.eqNet)],
                        ['Equipment (Tax+Markup)', fmt(calc.eqTax + calc.eqMarkup)],
                        ['Equipment Total', fmt(calc.eqTotal)],
                        ['', ''],
                        ['TOTAL PRICE', fmt(calc.totalPrice)],
                        ['Cost per sq ft', fmt(calc.totalPrice / sqft)],
                    ],
                    styles: { fontSize: 9 },
                    columnStyles: { 0: { fontStyle: 'bold' } },
                    theme: 'plain',
                    margin: { left: 14 },
                });

                if (notes) {
                    const notesY = (pdf as any).lastAutoTable.finalY + 8;
                    pdf.setFontSize(9);
                    pdf.text(`Notes: ${notes}`, 14, notesY);
                }

                // --- V3 Visual Proof Appendix ---
                // Only append if it's the main AI output or an active V3 session is present
                const sessionToPrint = activeV3Sessions[0];
                if (sessionToPrint && sessionToPrint.v3Results && sessionToPrint.images) {
                    const selectedImages = sessionToPrint.images.filter(i => i.selected);
                    if (selectedImages.length > 0) {
                        pdf.addPage();
                        pdf.setFontSize(16);
                        pdf.setTextColor(33, 33, 33);
                        pdf.text('APPENDIX: AI VISUAL PROOF', 14, 20);
                        pdf.setFontSize(10);
                        pdf.text('The following floor plans indicate the exact locations of detected items.', 14, 28);

                        for (const imgData of selectedImages) {
                            if (!imgData.storageUrl) continue;
                            const pageResults = sessionToPrint.v3Results[imgData.id];
                            if (!pageResults) continue;

                            pdf.addPage();
                            pdf.setFontSize(12);
                            pdf.text(`Page: ${imgData.originalFileName || imgData.pageNumber}`, 14, 15);

                            try {
                                // Load image via proxy or direct fetch to avoid CORS canvas taint if possible
                                const imgBlob = await fetch(imgData.storageUrl).then(r => r.blob());
                                const imgDataUrl = await new Promise<string>(res => {
                                    const reader = new FileReader();
                                    reader.onload = e => res(e.target!.result as string);
                                    reader.readAsDataURL(imgBlob);
                                });

                                const imgWidth = imgData.dimensions?.width || 1000;
                                const imgHeight = imgData.dimensions?.height || 1000;

                                // Fit onto A4 (210x297mm). Let's use max w: 190, max h: 260
                                const pdfW = 190;
                                const pdfH = 260;
                                const ratio = Math.min(pdfW / imgWidth, pdfH / imgHeight);
                                    
                                const printW = imgWidth * ratio;
                                const printH = imgHeight * ratio;
                                const printX = (210 - printW) / 2; // Center horizontally
                                const printY = 25;

                                pdf.addImage(imgDataUrl, 'PNG', printX, printY, printW, printH);

                                // Draw bounding boxes
                                pdf.setLineWidth(0.5);
                                Object.entries(pageResults).forEach(([itemType, boxes]) => {
                                    const colorHex = stringToColor(itemType);
                                    const [r, g, b] = hexToRgb(colorHex);
                                    pdf.setDrawColor(r, g, b);
                                    
                                    boxes.forEach((item: any) => {
                                        // box is [ymin, xmin, ymax, xmax] normalized 0-1000
                                        const boxArr = Array.isArray(item) ? item : item?.box;
                                        if (!boxArr) return;
                                        const [ymin, xmin, ymax, xmax] = boxArr;
                                        const bx = printX + (xmin / 1000) * printW;
                                        const by = printY + (ymin / 1000) * printH;
                                        const bw = ((xmax - xmin) / 1000) * printW;
                                        const bh = ((ymax - ymin) / 1000) * printH;

                                        pdf.rect(bx, by, bw, bh);
                                    });
                                });

                            } catch (e) {
                                console.error('Failed to append visual proof page:', e);
                                pdf.setFontSize(10);
                                pdf.setTextColor(255, 0, 0);
                                pdf.text(`Failed to load image for visual proof`, 14, 30);
                            }
                        }
                    }
                }

                const pdfBlobUrl = pdf.output('bloburl');
                window.open(pdfBlobUrl, '_blank');
                const safeName = projectName.replace(/\s+/g, '_');
                const suffix = label ? `_${label.replace(/\s+/g, '_')}` : '';
                pdf.save(`${safeName}_Estimate${suffix}.pdf`);
                setSaveSnackbar('PDF готов, скачивание началось');
            } catch (err: any) {
                console.error('PDF generation error', err);
                setSaveSnackbar(`Ошибка генерации PDF: ${err.message || 'Сбой'}`);
            } finally {
                setIsGeneratingPDF(false);
            }
    };

    // ===== Excel Export =====
    const generateExcelExport = () => {
        const wb = XLSX.utils.book_new();

        // Gather all sections
        const allSections: { name: string; items: any[]; qtyMap: any }[] = [
            ...Object.entries(DEVICES).map(([key, items]) => ({ name: key.charAt(0).toUpperCase() + key.slice(1), items, qtyMap: quantities })),
            { name: 'Wire & Conduit', items: WIRE, qtyMap: wireQty },
            { name: 'Panels & Gear', items: gearData, qtyMap: gearQty },
            { name: 'Pool & Spa', items: poolData, qtyMap: poolQty },
            { name: 'Generator', items: genData, qtyMap: genQty },
            { name: 'Landscape', items: landData, qtyMap: landQty },
        ];

        // Sheet 1: All Items
        const itemsData: any[][] = [
            ['ELECTRICAL ESTIMATE'],
            [`Project: ${projectName} | ${projectType} | ${sqft} sq ft | ${stories} story`],
            [`Date: ${new Date().toLocaleDateString()} | Overhead: ${overheadPct}% | Profit: ${profitPct}%`],
            [],
            ['Section', 'Item', 'Material $', 'Labor Hr', 'Qty', 'Mat Total $', 'Labor Total Hr'],
        ];
        allSections.forEach(sec => {
            sec.items.forEach(item => {
                const qty = sec.qtyMap[item.id] || 0;
                if (qty > 0) {
                    itemsData.push([
                        sec.name, item.name, item.matRate, item.laborRate,
                        qty, qty * item.matRate, +(qty * item.laborRate).toFixed(2),
                    ]);
                }
            });
        });
        const wsItems = XLSX.utils.aoa_to_sheet(itemsData);
        // Set column widths
        wsItems['!cols'] = [
            { wch: 18 }, { wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 14 },
        ];
        XLSX.utils.book_append_sheet(wb, wsItems, 'Estimate');

        // Sheet 2: Equipment S.B.O.
        const eqData: any[][] = [
            ['EQUIPMENT (S.B.O.)'],
            [],
            ['Item', 'Default Price', 'Actual Price'],
        ];
        EQUIPMENT_SBO.forEach(eq => {
            const price = equipmentPrices[eq.id] || 0;
            eqData.push([eq.name, eq.defaultPrice, price]);
        });
        eqData.push([]);
        eqData.push(['Equipment Net', '', calc.eqNet]);
        eqData.push(['Tax + Markup', '', calc.eqTax + calc.eqMarkup]);
        eqData.push(['Equipment Total', '', calc.eqTotal]);
        const wsEq = XLSX.utils.aoa_to_sheet(eqData);
        wsEq['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 14 }];
        XLSX.utils.book_append_sheet(wb, wsEq, 'Equipment');

        // Sheet 3: Summary
        const summaryData: any[][] = [
            ['📋 PROJECT OVERVIEW'],
            ['Area (sq ft)', overview.areaSqft > 0 ? overview.areaSqft : '—'],
            ['Total Devices', overview.totalDevices],
            ['BOM Cost (Base Materials)', overview.totalBomCost],
            ['Cost/sq.ft', overview.costValidation.costPerSqft > 0 ? `$${overview.costValidation.costPerSqft.toFixed(2)}` : '—'],
            ['Cost Validation', overview.costValidation.status === 'ok' ? 'Normal range' : 'WARNING — check estimate'],
            ['Files/Rooms', overview.roomCount],
            ['Room Validation', overview.roomValidation.status === 'ok' ? 'Normal' : 'WARNING — possible duplication'],
            [],
            ['SUMMARY'],
            [],
            ['Parameter', 'Value'],
            ['Project Name', projectName],
            ['Project Type', projectType],
            ['Area (sq ft)', sqft],
            ['Stories', stories],
            ['Labor Rate ($/hr)', laborRate],
            [],
            ['Materials (Base)', calc.materialsBase],
            ['Materials (+18%)', calc.materialsFinal],
            ['Sales Tax (7%)', calc.salesTaxMat],
            ['Total Labor Hours', +calc.totalHrs.toFixed(1)],
            ['Labor Cost', calc.laborCost],
            ['Mat + Labor', calc.matLaborCost],
            [`Overhead (${overheadPct}%)`, calc.overhead],
            [`Profit (${profitPct}%)`, calc.profit],
            ['BASE PRICE', calc.basePrice],
            [],
            ['Equipment Net', calc.eqNet],
            ['Equipment Tax+Markup', calc.eqTax + calc.eqMarkup],
            ['Equipment Total', calc.eqTotal],
            [],
            ['TOTAL PRICE', calc.totalPrice],
            ['Cost per sq ft', +(calc.totalPrice / sqft).toFixed(2)],
            [],
            ['Notes', notes || ''],
        ];
        const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
        wsSummary['!cols'] = [{ wch: 22 }, { wch: 18 }];
        XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

        XLSX.writeFile(wb, `${projectName.replace(/\s+/g, '_')}_Estimate.xlsx`);
    };

    const generatePrintContent = () => {
        const date = new Date().toLocaleDateString();
        const costTag = overview.costValidation.status === 'ok' ? 'Normal' : 'WARNING';
        const roomTag = overview.roomValidation.status === 'ok' ? 'Normal' : 'WARNING';
        return `
ELECTRICAL ESTIMATE
==========================================
Project: ${projectName}
Date: ${date}
Type: ${projectType === 'commercial' ? 'Commercial' : 'Residential'}
Size: ${sqft} sq ft | ${stories} story

📋 PROJECT OVERVIEW
• Area: ${overview.areaSqft > 0 ? overview.areaSqft.toLocaleString() : '—'} sq ft
• Devices: ${overview.totalDevices.toLocaleString()}
• BOM Cost: ${fmt(overview.totalBomCost)}
• Cost/sq.ft: $${overview.costValidation.costPerSqft.toFixed(2)} [${costTag}]
• Room validation: ${overview.roomCount} files [${roomTag}]
──────────────────

SUMMARY
------------------------------------------
Materials (Base):     ${fmt(calc.materialsBase)}
Materials (+18%):     ${fmt(calc.materialsFinal)}
Labor (${fmtHr(calc.totalHrs)}):   ${fmt(calc.laborCost)}
------------------------------------------
Mat + Labor:          ${fmt(calc.matLaborCost)}
Overhead (${overheadPct}%):        ${fmt(calc.overhead)}
Profit (${profitPct}%):          ${fmt(calc.profit)}
Sales Tax:            ${fmt(calc.salesTaxMat)}
------------------------------------------
BASE PRICE:           ${fmt(calc.basePrice)}

EQUIPMENT (S.B.O.)
------------------------------------------
Net:                  ${fmt(calc.eqNet)}
Tax + Markup:         ${fmt(calc.eqTax + calc.eqMarkup)}
Equipment Total:      ${fmt(calc.eqTotal)}

==========================================
TOTAL PRICE:          ${fmt(calc.totalPrice)}
==========================================
Cost per sq ft:       ${fmt(calc.totalPrice / sqft)}

Notes: ${notes || 'N/A'}
    `;
    };

    const copyToClipboard = () => {
        navigator.clipboard.writeText(generatePrintContent());
        alert('Copied to clipboard!');
    };

    const downloadTxt = () => {
        const element = document.createElement("a");
        const file = new Blob([generatePrintContent()], { type: 'text/plain' });
        element.href = URL.createObjectURL(file);
        element.download = `${projectName.replace(/\s+/g, '_')}_Estimate.txt`;
        document.body.appendChild(element);
        element.click();
    };

    // ===== Save Project =====
    const handleSaveProject = async () => {
        if (!userProfile?.companyId || !userProfile?.id) {
            setSaveSnackbar('Войдите в систему для сохранения');
            return;
        }
        if (!projectIdMatch) {
            setSaveSnackbar('Ошибка: Отсутствует привязка к Проекту. Начните расчет из Библиотеки Проектов.');
            return;
        }
        setSavingProject(true);
        try {
            // Merge all quantity maps
            const allQuantities: Record<string, number> = {};
            Object.entries(quantities).forEach(([k, v]: [string, any]) => { if (v > 0) allQuantities[k] = v; });
            Object.entries(gearQty).forEach(([k, v]: [string, any]) => { if (v > 0) allQuantities[k] = v; });
            Object.entries(poolQty).forEach(([k, v]: [string, any]) => { if (v > 0) allQuantities[k] = v; });
            Object.entries(genQty).forEach(([k, v]: [string, any]) => { if (v > 0) allQuantities[k] = v; });
            Object.entries(landQty).forEach(([k, v]: [string, any]) => { if (v > 0) allQuantities[k] = v; });
            Object.entries(wireQty).forEach(([k, v]: [string, any]) => { if (v > 0) allQuantities[k] = v; });

            const dataToSave = {
                companyId: userProfile.companyId,
                createdBy: userProfile.id,
                projectId: projectIdMatch,
                projectName,
                areaSqft: sqft,
                batchId: `manual_${Date.now()}`,
                quantities: allQuantities,
                originalQuantities: allQuantities,
                laborRate,
                wirePrice: 0.45,
                totalMaterials: calc.materialsFinal,
                totalLabor: calc.laborCost,
                totalWire: calc.sectionsData.wire_auto.mat + calc.sectionsData.wire_manual.mat,
                grandTotal: calc.totalPrice,
                filesCount: 0,
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

            // Also update the root project's square footage
            if (sqft > 0 && projectIdMatch) {
                await projectsApi.update(projectIdMatch, { areaSqft: sqft });
            }

            setSaveSnackbar('Проект сохранён ✅');
            setAutosaveStatus('saved');
        } catch (err: any) {
            console.error('Save failed:', err);
            setSaveSnackbar(`Ошибка сохранения: ${err.message || 'Сбой сети'}`);
            setAutosaveStatus('idle');
        }
        setSavingProject(false);
    };

    // ===== Auto Save Project (every 30s) =====
    useEffect(() => {
        if (!currentEstimateId || savingProject || !userProfile?.companyId || !projectIdMatch) return;

        const timer = setTimeout(() => {
            setAutosaveStatus('saving');
            const allQuantities: Record<string, number> = {};
            Object.entries(quantities).forEach(([k, v]: [string, any]) => { if (v > 0) allQuantities[k] = v; });
            Object.entries(gearQty).forEach(([k, v]: [string, any]) => { if (v > 0) allQuantities[k] = v; });
            Object.entries(poolQty).forEach(([k, v]: [string, any]) => { if (v > 0) allQuantities[k] = v; });
            Object.entries(genQty).forEach(([k, v]: [string, any]) => { if (v > 0) allQuantities[k] = v; });
            Object.entries(landQty).forEach(([k, v]: [string, any]) => { if (v > 0) allQuantities[k] = v; });
            Object.entries(wireQty).forEach(([k, v]: [string, any]) => { if (v > 0) allQuantities[k] = v; });

            savedEstimateApi.update(currentEstimateId, {
                projectName,
                quantities: allQuantities,
                laborRate,
                wirePrice: 0.45,
                totalMaterials: calc.materialsFinal,
                totalLabor: calc.laborCost,
                totalWire: calc.sectionsData.wire_auto.mat + calc.sectionsData.wire_manual.mat,
                grandTotal: calc.totalPrice,
                status: 'draft',
                ...(notes ? { notes } : {}),
            }).then(() => {
                setAutosaveStatus('saved');
            }).catch(err => {
                console.error('Autosave failed:', err);
                setAutosaveStatus('idle');
            });
        }, 30000);

        return () => clearTimeout(timer);
    }, [quantities, gearQty, poolQty, genQty, landQty, wireQty, projectName, laborRate, calc, notes, currentEstimateId, savingProject, userProfile, projectIdMatch]);

    return (
        <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', pb: 8 }}>
            <AppBar position="static" color="default" elevation={1} sx={{ bgcolor: 'background.paper' }}>
                <Toolbar>
                    <Typography variant="h6" color="primary" sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                        <FlashOnIcon /> Electrical Estimator Pro
                    </Typography>
                    <Button
                        color="inherit"
                        sx={{ mr: 1 }}
                        startIcon={<ProjectsIcon />}
                        onClick={() => window.location.href = '/estimates/projects'}
                    >
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
                                        <Button
                                            size="small"
                                            onClick={() => setIsEditingRates(!isEditingRates)}
                                            color={isEditingRates ? "success" : "primary"}
                                            variant={isEditingRates ? "contained" : "text"}
                                            sx={{ mr: 1 }}
                                        >
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
                                    {Object.entries(TEMPLATES).map(([key, t]: [string, any]) => (
                                        <Tooltip key={key} title={t.descriptionRu || t.name} arrow>
                                            <Chip
                                                label={t.name.split(' ')[0]}
                                                onClick={() => applyTemplate(key)}
                                                size="small"
                                                color="primary"
                                                variant="outlined"
                                                clickable
                                            />
                                        </Tooltip>
                                    ))}
                                    <Tooltip title="Clear All">
                                        <IconButton size="small" color="error" onClick={clearAll}>
                                            <ClearIcon />
                                        </IconButton>
                                    </Tooltip>
                                    <Button
                                        size="small"
                                        startIcon={<AutoAwesomeIcon />}
                                        onClick={() => {
                                            setResumeSessionId(undefined);
                                            setShowAiDialog(true);
                                        }}
                                        sx={{ ml: 'auto', background: 'linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)', color: 'white' }}
                                    >
                                        AI Analysis
                                    </Button>
                                    <Tooltip title="Export">
                                        <Button
                                            size="small"
                                            color="success"
                                            variant="outlined"
                                            startIcon={isGeneratingPDF ? <CircularProgress size={16} color="inherit" /> : <ExportIcon />}
                                            onClick={(e) => setExportAnchorEl(e.currentTarget)}
                                            disabled={isGeneratingPDF}
                                        >
                                            {isGeneratingPDF ? 'Generating...' : 'Export ▾'}
                                        </Button>
                                    </Tooltip>
                                    <Menu
                                        anchorEl={exportAnchorEl}
                                        open={Boolean(exportAnchorEl)}
                                        onClose={() => setExportAnchorEl(null)}
                                    >
                                        <MenuItem onClick={() => { generateEstimatePDF(); setExportAnchorEl(null); }}>
                                            <PdfIcon sx={{ mr: 1 }} fontSize="small" /> Смета (PDF)
                                        </MenuItem>

                                        {currentEstimateData?.aiResults?.gemini && (
                                            <MenuItem onClick={() => { generateEstimatePDF('Gemini AI Output', currentEstimateData.aiResults.gemini); setExportAnchorEl(null); }}>
                                                <PdfIcon sx={{ mr: 1, color: 'info.main' }} fontSize="small" /> Gemini AI Смета
                                            </MenuItem>
                                        )}
                                        {currentEstimateData?.aiResults?.claude && (
                                            <MenuItem onClick={() => { generateEstimatePDF('Claude AI Output', currentEstimateData.aiResults.claude); setExportAnchorEl(null); }}>
                                                <PdfIcon sx={{ mr: 1, color: 'warning.main' }} fontSize="small" /> Claude AI Смета
                                            </MenuItem>
                                        )}
                                        {currentEstimateData?.aiResults?.openai && (
                                            <MenuItem onClick={() => { generateEstimatePDF('OpenAI Output', currentEstimateData.aiResults.openai); setExportAnchorEl(null); }}>
                                                <PdfIcon sx={{ mr: 1, color: 'success.main' }} fontSize="small" /> OpenAI Смета
                                            </MenuItem>
                                        )}
                                        <Divider />

                                        <MenuItem onClick={() => { generateExcelExport(); setExportAnchorEl(null); }}>
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
                                    <Button
                                        size="small"
                                        variant="contained"
                                        color="primary"
                                        startIcon={<SaveIcon />}
                                        onClick={handleSaveProject}
                                        disabled={savingProject}
                                    >
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
                                    <Button 
                                        variant="contained" 
                                        color="secondary" 
                                        onClick={() => {
                                            setResumeSessionId(activeV3Sessions[0].id);
                                            setShowAiDialog(true);
                                        }}
                                        sx={{ whiteSpace: 'nowrap' }}
                                    >
                                        Resume Session
                                    </Button>
                                </Paper>
                            )}

                            <Tabs
                                value={activeTab}
                                onChange={(_, v) => setActiveTab(v)}
                                variant="scrollable"
                                scrollButtons="auto"
                                sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'grey.50' }}
                            >
                                {tabs.map((tab, index) => (
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
                                                <Section items={devicesData.lighting} qtyMap={quantities} onChange={updateQty(setQuantities)} title="Lighting" icon={<LightIcon />} category="devices" isMobile={isMobile} isEditingRates={isEditingRates} onRateChange={updateRate} getConfidence={getConfidence} getAnomaly={getAnomaly} onShowLineage={handleShowLineage} />
                                                <Section items={devicesData.receptacles} qtyMap={quantities} onChange={updateQty(setQuantities)} title="Receptacles" icon={<PowerIcon />} category="devices" isMobile={isMobile} isEditingRates={isEditingRates} onRateChange={updateRate} getConfidence={getConfidence} getAnomaly={getAnomaly} onShowLineage={handleShowLineage} />
                                                <Section items={devicesData.switches} qtyMap={quantities} onChange={updateQty(setQuantities)} title="Switches" icon={<SwitchIcon />} category="devices" isMobile={isMobile} isEditingRates={isEditingRates} onRateChange={updateRate} getConfidence={getConfidence} getAnomaly={getAnomaly} onShowLineage={handleShowLineage} />
                                            </Grid>
                                            <Grid size={{ xs: 12, md: 6 }}>
                                                <Section items={devicesData.appliances} qtyMap={quantities} onChange={updateQty(setQuantities)} title="Appliances" icon={<ApplianceIcon />} category="devices" isMobile={isMobile} isEditingRates={isEditingRates} onRateChange={updateRate} getConfidence={getConfidence} getAnomaly={getAnomaly} onShowLineage={handleShowLineage} />
                                                <Section items={devicesData.hvac} qtyMap={quantities} onChange={updateQty(setQuantities)} title="HVAC" icon={<HvacIcon />} category="devices" isMobile={isMobile} isEditingRates={isEditingRates} onRateChange={updateRate} getConfidence={getConfidence} getAnomaly={getAnomaly} onShowLineage={handleShowLineage} />
                                                <Section items={devicesData.lowvoltage} qtyMap={quantities} onChange={updateQty(setQuantities)} title="Low Voltage" icon={<LowVoltageIcon />} category="devices" isMobile={isMobile} isEditingRates={isEditingRates} onRateChange={updateRate} getConfidence={getConfidence} getAnomaly={getAnomaly} onShowLineage={handleShowLineage} />
                                            </Grid>
                                        </Grid>
                                    </>
                                )}

                                {activeTab === 1 && (
                                    <Section items={WIRE} qtyMap={wireQty} onChange={updateQty(setWireQty)} title="Wiring & Rough-In" icon={<CableIcon />} category="wire" isMobile={isMobile} isEditingRates={isEditingRates} onRateChange={updateRate} />
                                )}

                                {activeTab === 2 && (
                                    <Section items={gearData} qtyMap={gearQty} onChange={updateQty(setGearQty)} title="Panels & Service" icon={<GearIcon />} category="gear" isMobile={isMobile} isEditingRates={isEditingRates} onRateChange={updateRate} />
                                )}

                                {activeTab === 3 && (
                                    <Section items={poolData} qtyMap={poolQty} onChange={updateQty(setPoolQty)} title="Pool & Spa" icon={<PoolIcon />} category="pool" isMobile={isMobile} isEditingRates={isEditingRates} onRateChange={updateRate} />
                                )}

                                {activeTab === 4 && (
                                    <Section items={genData} qtyMap={genQty} onChange={updateQty(setGenQty)} title="Generator & Backup" icon={<GeneratorIcon />} category="generator" isMobile={isMobile} isEditingRates={isEditingRates} onRateChange={updateRate} />
                                )}

                                {activeTab === 5 && (
                                    <Section items={landData} qtyMap={landQty} onChange={updateQty(setLandQty)} title="Landscape Lighting" icon={<LandscapeIcon />} category="landscape" isMobile={isMobile} isEditingRates={isEditingRates} onRateChange={updateRate} />
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
                                                        <TextField
                                                            size="small"
                                                            type="number"
                                                            value={equipmentPrices[eq.id] || ''}
                                                            onChange={(e) => updateEquipment(eq.id, e.target.value)}
                                                            placeholder={eq.defaultPrice.toString()}
                                                            InputProps={{
                                                                startAdornment: <InputAdornment position="start">$</InputAdornment>,
                                                            }}
                                                            sx={{ width: 120 }}
                                                        />
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
                                                    {Object.entries(calc.sectionsData).map(([key, val]: [string, any]) => (
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
                                                        {Object.entries(calc.wireByType).map(([type, len]: [string, any]) => (
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
                                            <TextField
                                                fullWidth
                                                multiline
                                                rows={4}
                                                label="Project Notes"
                                                value={notes}
                                                onChange={(e) => setNotes(e.target.value)}
                                                placeholder="Add any additional notes here..."
                                            />
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
                                    <Chip
                                        size="small"
                                        label={overview.costValidation.status === 'ok'
                                            ? `$${overview.costValidation.costPerSqft.toFixed(2)}/sq.ft ✅`
                                            : `$${overview.costValidation.costPerSqft.toFixed(2)}/sq.ft ⚠️`
                                        }
                                        color={overview.costValidation.status === 'ok' ? 'success' : 'warning'}
                                        sx={{ fontSize: '0.75rem', mb: 0.5 }}
                                    />
                                    {overview.costValidation.status !== 'ok' && (
                                        <Typography variant="caption" display="block" color="warning.dark">
                                            {overview.costValidation.message}
                                        </Typography>
                                    )}
                                </Box>
                                <Box>
                                    <Chip
                                        size="small"
                                        label={overview.roomValidation.status === 'ok'
                                            ? `${overview.roomCount} files ✅`
                                            : `${overview.roomCount} files ⚠️`
                                        }
                                        color={overview.roomValidation.status === 'ok' ? 'success' : 'warning'}
                                        sx={{ fontSize: '0.75rem', mb: 0.5 }}
                                    />
                                    {overview.roomValidation.status !== 'ok' && (
                                        <Typography variant="caption" display="block" color="warning.dark">
                                            {overview.roomValidation.message}
                                        </Typography>
                                    )}
                                </Box>
                            </Box>
                        </Paper>

                        <Paper sx={{ p: 2, position: 'sticky', top: 20 }}>
                            <Typography variant="h6" gutterBottom>Estimate Summary</Typography>
                            <Divider sx={{ mb: 2 }} />

                            <Box mb={3}>
                                <Typography variant="subtitle2" color="primary" gutterBottom>Materials</Typography>
                                <Box display="flex" justifyContent="space-between">
                                    <Typography variant="body2" color="text.secondary">Base</Typography>
                                    <Typography variant="body2">{fmt(calc.materialsBase)}</Typography>
                                </Box>
                                <Box display="flex" justifyContent="space-between">
                                    <Typography variant="body2" color="text.secondary">Markup (18%)</Typography>
                                    <Typography variant="body2">{fmt(calc.miscMarkup)}</Typography>
                                </Box>
                                <Box display="flex" justifyContent="space-between" mt={1}>
                                    <Typography variant="body2" fontWeight="bold">Total Materials</Typography>
                                    <Typography variant="body2" fontWeight="bold">{fmt(calc.materialsFinal)}</Typography>
                                </Box>
                            </Box>

                            <Box mb={3}>
                                <Typography variant="subtitle2" color="primary" gutterBottom>Labor</Typography>
                                <Box display="flex" justifyContent="space-between">
                                    <Typography variant="body2" color="text.secondary">Hours</Typography>
                                    <Typography variant="body2">{fmtHr(calc.totalHrs)}</Typography>
                                </Box>
                                <Box display="flex" justifyContent="space-between">
                                    <Typography variant="body2" color="text.secondary">Rate</Typography>
                                    <Typography variant="body2">${laborRate}/hr</Typography>
                                </Box>
                                <Box display="flex" justifyContent="space-between" mt={1}>
                                    <Typography variant="body2" fontWeight="bold">Total Labor</Typography>
                                    <Typography variant="body2" fontWeight="bold">{fmt(calc.laborCost)}</Typography>
                                </Box>
                            </Box>

                            <Divider sx={{ my: 2 }} />

                            <Box mb={2}>
                                <Grid container spacing={1} alignItems="center">
                                    <Grid size={{ xs: 6 }}>
                                        <Typography variant="body2">Overhead %</Typography>
                                    </Grid>
                                    <Grid size={{ xs: 6 }}>
                                        <TextField
                                            size="small"
                                            type="number"
                                            value={overheadPct}
                                            onChange={(e) => setOverheadPct(parseInt(e.target.value) || 0)}
                                            InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
                                        />
                                    </Grid>
                                    <Grid size={{ xs: 6 }}>
                                        <Typography variant="body2">Profit %</Typography>
                                    </Grid>
                                    <Grid size={{ xs: 6 }}>
                                        <TextField
                                            size="small"
                                            type="number"
                                            value={profitPct}
                                            onChange={(e) => setProfitPct(parseInt(e.target.value) || 0)}
                                            InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
                                        />
                                    </Grid>
                                </Grid>
                            </Box>

                            <Box bgcolor="grey.100" p={2} borderRadius={1}>
                                <Box display="flex" justifyContent="space-between" mb={1}>
                                    <Typography variant="body2">Base Price</Typography>
                                    <Typography variant="body2">{fmt(calc.basePrice)}</Typography>
                                </Box>
                                <Box display="flex" justifyContent="space-between" mb={1}>
                                    <Typography variant="body2">Equipment</Typography>
                                    <Typography variant="body2">{fmt(calc.eqTotal)}</Typography>
                                </Box>
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
            <Dialog 
                open={showAiDialog} 
                onClose={() => setShowAiDialog(false)}
                maxWidth="lg"
                fullWidth
            >
                <V3PipelineContainer 
                    companyId={userProfile?.companyId || ''}
                    userId={userProfile?.id || ''}
                    initialSessionId={resumeSessionId}
                    sqft={sqft}
                    stories={stories}
                    projectType={projectType}
                    onAnalysisComplete={(results: any, v3R?: any, anom?: any, imgs?: any[]) => {
                        handleAiApply(results);
                        if (v3R) setV3Results(v3R);
                        if (anom) setAnomalies(anom);
                        if (imgs) setV3Images(imgs);
                    }}
                    onCancel={() => setShowAiDialog(false)}
                />
            </Dialog>

            {
                pendingMappingData && (
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
                )
            }

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
                        
                        const avgConf = Math.round(boxes.reduce((s, b: any) => s + (b.confidence || 0), 0) / boxes.length);
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
                            <Button 
                                size="small" 
                                variant="outlined" 
                                fullWidth 
                                onClick={() => {
                                    setLineageAnchorEl(null);
                                    setShowVisualProof(true);
                                }}
                            >
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
                            images={v3Images}
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
            {
                isMobile && (
                    <Paper
                        elevation={3}
                        sx={{
                            position: 'fixed',
                            bottom: 0,
                            left: 0,
                            right: 0,
                            p: 2,
                            bgcolor: 'primary.main',
                            color: 'primary.contrastText',
                            zIndex: 1000
                        }}
                    >
                        <Box display="flex" justifyContent="space-between" alignItems="center">
                            <Box>
                                <Typography variant="caption">Total Estimate</Typography>
                                <Typography variant="h6" fontWeight="bold">{fmt(calc.totalPrice)}</Typography>
                            </Box>
                            <Button variant="contained" color="secondary" onClick={() => setActiveTab(7)}>
                                View Summary
                            </Button>
                        </Box>
                    </Paper>
                )
            }

            {/* Save Snackbar */}
            <Snackbar
                open={!!saveSnackbar}
                autoHideDuration={3000}
                onClose={() => setSaveSnackbar('')}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert
                    onClose={() => setSaveSnackbar('')}
                    severity={saveSnackbar.includes('✅') ? 'success' : 'error'}
                    variant="filled"
                >
                    {saveSnackbar}
                </Alert>
            </Snackbar>
        </Box >
    );
}
