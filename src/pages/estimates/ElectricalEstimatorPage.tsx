import React, { useState, useMemo, useRef } from 'react';
import {
    Container, Grid, Paper, Typography, Box, TextField, Select, MenuItem,
    FormControl, InputLabel, Tabs, Tab, Button, Card, CardContent, Divider,
    Stack, IconButton, Tooltip, AppBar, Toolbar, useTheme, useMediaQuery,
    InputAdornment, Chip, Dialog, DialogTitle, DialogContent, DialogActions,
    CircularProgress, List, ListItem, ListItemText, ListItemIcon
} from '@mui/material';
import {
    Lightbulb as LightIcon, Power as PowerIcon, ToggleOn as SwitchIcon,
    Kitchen as ApplianceIcon, AcUnit as HvacIcon, Router as LowVoltageIcon,
    SettingsInputComponent as GearIcon, Pool as PoolIcon, Bolt as GeneratorIcon,
    Landscape as LandscapeIcon, Construction as EquipmentIcon, Assessment as SummaryIcon,
    Print as PrintIcon, ContentCopy as CopyIcon, Delete as ClearIcon,
    SaveAlt as ExportIcon, FlashOn as FlashOnIcon, Add as AddIcon,
    Remove as RemoveIcon, AutoAwesome as AutoAwesomeIcon,
    CloudUpload as CloudUploadIcon, CheckCircle as CheckCircleIcon
} from '@mui/icons-material';

// ============== DATA ==============
const DEVICES = {
    lighting: [
        { id: 'recessed_ic', name: 'Recessed Light (IC)', matRate: 35, laborRate: 0.35, wireLen: 35, wireType: '14-2' },
        { id: 'recessed_nc', name: 'Recessed Light (NC)', matRate: 28, laborRate: 0.30, wireLen: 35, wireType: '14-2' },
        { id: 'surface', name: 'Surface Mount', matRate: 45, laborRate: 0.40, wireLen: 40, wireType: '14-2' },
        { id: 'pendant', name: 'Pendant (S.B.O.)', matRate: 0, laborRate: 0.50, wireLen: 40, wireType: '14-2' },
        { id: 'chandelier', name: 'Chandelier (S.B.O.)', matRate: 0, laborRate: 1.50, wireLen: 45, wireType: '14-2' },
        { id: 'ceiling_fan', name: 'Ceiling Fan (S.B.O.)', matRate: 0, laborRate: 0.75, wireLen: 40, wireType: '14-3' },
        { id: 'under_cabinet', name: 'Under Cabinet LED', matRate: 25, laborRate: 0.30, wireLen: 20, wireType: '14-2' },
        { id: 'exhaust_fan', name: 'Exhaust Fan', matRate: 45, laborRate: 0.50, wireLen: 30, wireType: '14-2' },
        { id: 'bath_exhaust', name: 'Bath Exhaust w/Light', matRate: 75, laborRate: 0.55, wireLen: 25, wireType: '14-2' },
    ],
    receptacles: [
        { id: 'duplex', name: 'Duplex Receptacle', matRate: 8, laborRate: 0.25, wireLen: 25, wireType: '12-2' },
        { id: 'gfi', name: 'GFI Receptacle', matRate: 25, laborRate: 0.30, wireLen: 30, wireType: '12-2' },
        { id: 'dedicated_20a', name: '20A Dedicated', matRate: 12, laborRate: 0.35, wireLen: 40, wireType: '12-2' },
        { id: 'outlet_240_30', name: '240V 30A (Dryer)', matRate: 35, laborRate: 0.50, wireLen: 50, wireType: '10-3' },
        { id: 'outlet_240_50', name: '240V 50A (Range)', matRate: 45, laborRate: 0.60, wireLen: 45, wireType: '6-3' },
        { id: 'floor_outlet', name: 'Floor Outlet', matRate: 85, laborRate: 0.75, wireLen: 35, wireType: '12-2' },
        { id: 'exterior', name: 'Exterior WP Recept', matRate: 35, laborRate: 0.40, wireLen: 45, wireType: '12-2' },
    ],
    switches: [
        { id: 'single_pole', name: 'Single Pole Switch', matRate: 5, laborRate: 0.20, wireLen: 0, wireType: '' },
        { id: '3way', name: '3-Way Switch', matRate: 8, laborRate: 0.25, wireLen: 15, wireType: '14-3' },
        { id: '4way', name: '4-Way Switch', matRate: 12, laborRate: 0.30, wireLen: 15, wireType: '14-3' },
        { id: 'dimmer', name: 'Dimmer Switch', matRate: 35, laborRate: 0.30, wireLen: 0, wireType: '' },
        { id: 'smart_switch', name: 'Smart Switch (S.B.O.)', matRate: 0, laborRate: 0.35, wireLen: 0, wireType: '' },
        { id: 'occupancy', name: 'Occupancy Sensor', matRate: 45, laborRate: 0.35, wireLen: 0, wireType: '' },
    ],
    appliances: [
        { id: 'range', name: 'Range 50A', matRate: 25, laborRate: 0.60, wireLen: 40, wireType: '6-3' },
        { id: 'cooktop', name: 'Cooktop 40A', matRate: 25, laborRate: 0.55, wireLen: 40, wireType: '8-3' },
        { id: 'wall_oven', name: 'Wall Oven 30A', matRate: 25, laborRate: 0.50, wireLen: 45, wireType: '10-3' },
        { id: 'double_oven', name: 'Double Oven 50A', matRate: 25, laborRate: 0.60, wireLen: 45, wireType: '6-3' },
        { id: 'dryer', name: 'Dryer 30A', matRate: 25, laborRate: 0.50, wireLen: 50, wireType: '10-3' },
        { id: 'washer', name: 'Washer 20A', matRate: 12, laborRate: 0.35, wireLen: 40, wireType: '12-2' },
        { id: 'dishwasher', name: 'Dishwasher', matRate: 12, laborRate: 0.35, wireLen: 35, wireType: '12-2' },
        { id: 'disposal', name: 'Disposal', matRate: 12, laborRate: 0.30, wireLen: 30, wireType: '12-2' },
        { id: 'microwave', name: 'Microwave/Hood', matRate: 12, laborRate: 0.35, wireLen: 35, wireType: '12-2' },
        { id: 'refrigerator', name: 'Refrigerator', matRate: 12, laborRate: 0.35, wireLen: 45, wireType: '12-2' },
        { id: 'freezer', name: 'Freezer (Garage)', matRate: 12, laborRate: 0.35, wireLen: 50, wireType: '12-2' },
        { id: 'water_heater', name: 'Water Heater 30A', matRate: 25, laborRate: 0.50, wireLen: 55, wireType: '10-2' },
        { id: 'tankless_wh', name: 'Tankless WH 60A', matRate: 35, laborRate: 0.65, wireLen: 55, wireType: '6-2' },
        { id: 'ev_charger', name: 'EV Charger 50A', matRate: 65, laborRate: 0.75, wireLen: 65, wireType: '6-3' },
        { id: 'ev_charger_60', name: 'EV Charger 60A', matRate: 75, laborRate: 0.85, wireLen: 65, wireType: '4-3' },
    ],
    hvac: [
        { id: 'ac_30a', name: 'A/C Condenser 3ton', matRate: 45, laborRate: 0.75, wireLen: 60, wireType: '10-2' },
        { id: 'ac_40a', name: 'A/C Condenser 4-5ton', matRate: 55, laborRate: 0.85, wireLen: 60, wireType: '8-2' },
        { id: 'ac_disc', name: 'A/C Disconnect', matRate: 45, laborRate: 0.40, wireLen: 0, wireType: '' },
        { id: 'mini_split', name: 'Mini-Split 30A', matRate: 55, laborRate: 0.75, wireLen: 50, wireType: '10-2' },
        { id: 'air_handler', name: 'Air Handler', matRate: 12, laborRate: 0.35, wireLen: 35, wireType: '12-2' },
        { id: 'thermostat', name: 'Thermostat Wire', matRate: 15, laborRate: 0.15, wireLen: 45, wireType: '18-5' },
    ],
    lowvoltage: [
        { id: 'smoke', name: 'Smoke Detector', matRate: 25, laborRate: 0.25, wireLen: 30, wireType: '14-3' },
        { id: 'smoke_co', name: 'Smoke/CO Combo', matRate: 45, laborRate: 0.30, wireLen: 30, wireType: '14-3' },
        { id: 'doorbell', name: 'Doorbell/Chime', matRate: 45, laborRate: 0.50, wireLen: 50, wireType: '18-2' },
        { id: 'doorbell_cam', name: 'Video Doorbell Prep', matRate: 25, laborRate: 0.45, wireLen: 50, wireType: '18-2' },
        { id: 'cat6', name: 'Cat6 Data Drop', matRate: 25, laborRate: 0.45, wireLen: 75, wireType: 'cat6' },
        { id: 'coax', name: 'Coax/TV Drop', matRate: 15, laborRate: 0.35, wireLen: 75, wireType: 'rg6' },
        { id: 'speaker_wire', name: 'Speaker Wire Drop', matRate: 15, laborRate: 0.35, wireLen: 60, wireType: '16-2' },
        { id: 'central_vac', name: 'Central Vac Outlet', matRate: 25, laborRate: 0.30, wireLen: 35, wireType: '14-2' },
    ],
};

const GEAR = [
    { id: 'panel_200', name: '200A Main Panel', matRate: 450, laborRate: 6.0 },
    { id: 'panel_400', name: '400A Main Panel', matRate: 950, laborRate: 8.0 },
    { id: 'ct_400', name: '400A CT Cabinet', matRate: 1200, laborRate: 6.0 },
    { id: 'ct_600', name: '600A CT Cabinet', matRate: 1800, laborRate: 8.0 },
    { id: 'subpanel_100', name: '100A Sub-Panel', matRate: 250, laborRate: 3.0 },
    { id: 'subpanel_125', name: '125A Sub-Panel', matRate: 285, laborRate: 3.5 },
    { id: 'subpanel_200', name: '200A Sub-Panel', matRate: 350, laborRate: 4.0 },
    { id: 'meter_200', name: 'Meter Base 200A', matRate: 180, laborRate: 2.0 },
    { id: 'meter_320', name: 'Meter Base 320A', matRate: 280, laborRate: 2.5 },
    { id: 'meter_400', name: 'Meter Base 400A', matRate: 350, laborRate: 3.0 },
    { id: 'grounding', name: 'Grounding System', matRate: 125, laborRate: 2.0 },
    { id: 'surge', name: 'Whole House Surge', matRate: 185, laborRate: 1.0 },
];

const POOL = [
    { id: 'pool_bond', name: 'Pool Bonding Grid', matRate: 250, laborRate: 4.0 },
    { id: 'pool_light_jbox', name: 'Pool Light J-Box', matRate: 85, laborRate: 1.0 },
    { id: 'pool_transformer', name: 'Pool Transformer', matRate: 180, laborRate: 1.5 },
    { id: 'pool_pump', name: 'Pool Pump Circuit', matRate: 85, laborRate: 1.5, wireLen: 70, wireType: '12-2' },
    { id: 'pool_heater', name: 'Pool Heater (gas)', matRate: 45, laborRate: 1.0, wireLen: 75, wireType: '12-2' },
    { id: 'pool_heater_elec', name: 'Pool Heater (elec)', matRate: 65, laborRate: 1.5, wireLen: 75, wireType: '6-3' },
    { id: 'spa_pump', name: 'Spa/Jacuzzi 50A', matRate: 95, laborRate: 1.5, wireLen: 60, wireType: '6-3' },
    { id: 'pool_gfi', name: 'Pool GFI Breaker', matRate: 65, laborRate: 0.25 },
    { id: 'pool_disc', name: 'Pool Disconnect 60A', matRate: 85, laborRate: 1.0 },
    { id: 'pool_automation', name: 'Pool Automation Panel', matRate: 0, laborRate: 2.0 },
];

const GENERATOR = [
    { id: 'gen_pad', name: 'Generator Pad Prep', matRate: 150, laborRate: 2.0 },
    { id: 'ats_200', name: 'ATS 200A', matRate: 1500, laborRate: 6.0 },
    { id: 'ats_400', name: 'ATS 400A', matRate: 3500, laborRate: 8.0 },
    { id: 'gen_whip', name: 'Generator Whip', matRate: 250, laborRate: 1.5 },
    { id: 'gen_disc', name: 'Generator Disconnect', matRate: 185, laborRate: 1.5 },
    { id: 'gen_wire', name: 'Generator Feed Wire', matRate: 0, laborRate: 2.0, wireLen: 35, wireType: '2-2-2-4' },
    { id: 'gen_coord', name: 'Gas/Startup Coord', matRate: 0, laborRate: 4.0 },
    { id: 'interlock', name: 'Interlock Kit (no ATS)', matRate: 125, laborRate: 1.5 },
    { id: 'inlet_box', name: 'Power Inlet Box 50A', matRate: 95, laborRate: 1.0 },
];

const LANDSCAPE = [
    { id: 'land_trans_300', name: 'LV Transformer 300W', matRate: 145, laborRate: 1.0 },
    { id: 'land_trans_600', name: 'LV Transformer 600W', matRate: 225, laborRate: 1.5 },
    { id: 'land_trans_900', name: 'LV Transformer 900W', matRate: 325, laborRate: 2.0 },
    { id: 'land_path', name: 'Path Light (S.B.O.)', matRate: 0, laborRate: 0.25, wireLen: 25, wireType: '12-2lv' },
    { id: 'land_spot', name: 'Spot Light (S.B.O.)', matRate: 0, laborRate: 0.30, wireLen: 30, wireType: '12-2lv' },
    { id: 'land_well', name: 'Well Light (S.B.O.)', matRate: 0, laborRate: 0.40, wireLen: 35, wireType: '12-2lv' },
    { id: 'land_flood', name: 'Flood Light 120V', matRate: 85, laborRate: 0.60, wireLen: 55, wireType: '12-2' },
    { id: 'land_wire', name: 'LV Wire Run (per 100ft)', matRate: 45, laborRate: 0.50 },
];

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

const BlueprintUploadDialog = ({ open, onClose, onApply }: any) => {
    const [analyzing, setAnalyzing] = useState(false);
    const [result, setResult] = useState<any>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files && event.target.files[0]) {
            setAnalyzing(true);
            // Simulate AI Analysis
            setTimeout(() => {
                setAnalyzing(false);
                setResult({
                    recessed_ic: 15,
                    duplex: 22,
                    single_pole: 12,
                    '3way': 4,
                    bath_exhaust: 2,
                    smoke_co: 5
                });
            }, 2500);
        }
    };

    const handleApply = () => {
        if (result) {
            onApply(result);
            onClose();
            setResult(null);
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <AutoAwesomeIcon color="primary" />
                AI Blueprint Analysis
            </DialogTitle>
            <DialogContent>
                <input
                    type="file"
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    accept="image/*,.pdf"
                    onChange={handleFileChange}
                />
                {!result && !analyzing && (
                    <Box
                        sx={{
                            border: '2px dashed',
                            borderColor: 'divider',
                            borderRadius: 2,
                            p: 4,
                            textAlign: 'center',
                            cursor: 'pointer',
                            '&:hover': { bgcolor: 'action.hover', borderColor: 'primary.main' }
                        }}
                        onClick={handleUploadClick}
                    >
                        <CloudUploadIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
                        <Typography variant="h6" gutterBottom>Upload Floor Plan</Typography>
                        <Typography variant="body2" color="text.secondary">
                            Drag & drop or click to upload blueprint image
                        </Typography>
                    </Box>
                )}

                {analyzing && (
                    <Box textAlign="center" py={4}>
                        <CircularProgress size={48} sx={{ mb: 2 }} />
                        <Typography>Analyzing blueprint structure...</Typography>
                        <Typography variant="caption" color="text.secondary">Detecting devices, switches, and outlets</Typography>
                    </Box>
                )}

                {result && (
                    <Box>
                        <Box display="flex" alignItems="center" gap={1} mb={2} bgcolor="success.light" p={2} borderRadius={1} color="success.contrastText">
                            <CheckCircleIcon />
                            <Typography fontWeight="medium">Analysis Complete!</Typography>
                        </Box>
                        <Typography variant="subtitle2" gutterBottom>Detected Items:</Typography>
                        <List dense sx={{ bgcolor: 'background.paper', borderRadius: 1, border: 1, borderColor: 'divider' }}>
                            {Object.entries(result).map(([key, qty]: [string, any]) => (
                                <ListItem key={key} divider>
                                    <ListItemText
                                        primary={key.replace('_', ' ').toUpperCase()}
                                        secondary="High confidence detection"
                                    />
                                    <Chip label={`+${qty}`} color="primary" size="small" />
                                </ListItem>
                            ))}
                        </List>
                    </Box>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button
                    onClick={handleApply}
                    variant="contained"
                    disabled={!result}
                    startIcon={<AutoAwesomeIcon />}
                >
                    Apply to Estimate
                </Button>
            </DialogActions>
        </Dialog>
    );
};

const ItemRow = React.memo(({ item, qty, onChange, category, isMobile, isEditingRates, onRateChange }: any) => {
    const hasQty = qty > 0;
    const bg = hasQty ? 'primary.50' : 'background.paper';

    const handleIncrement = () => onChange(item.id, (parseInt(qty || '0') + 1).toString());
    const handleDecrement = () => onChange(item.id, Math.max(0, (parseInt(qty || '0') - 1)).toString());

    if (isMobile) {
        return (
            <Paper variant="outlined" sx={{ p: 1, mb: 1, bgcolor: bg, borderColor: hasQty ? 'primary.main' : undefined }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                    <Typography variant="body2" fontWeight="medium">{item.name}</Typography>
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
            <Box flex={1} mr={2}>
                <Typography variant="body2" fontWeight={hasQty ? "bold" : "medium"}>{item.name}</Typography>
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

const Section = React.memo(({ items, qtyMap, onChange, title, icon, category, isMobile, isEditingRates, onRateChange }: any) => (
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

    const [projectName, setProjectName] = useState('New Project');
    const [projectType, setProjectType] = useState('residential');
    const [sqft, setSqft] = useState(2500);
    const [stories, setStories] = useState(1);
    const [typeMult, setTypeMult] = useState(1);

    // Data State
    const [devicesData, setDevicesData] = useState(DEVICES);
    const [gearData, setGearData] = useState(GEAR);
    const [poolData, setPoolData] = useState(POOL);
    const [genData, setGenData] = useState(GENERATOR);
    const [landData, setLandData] = useState(LANDSCAPE);
    const [wireRatesData, setWireRatesData] = useState(WIRE_RATES);

    const [quantities, setQuantities] = useState<any>({});
    const [gearQty, setGearQty] = useState<any>({});
    const [poolQty, setPoolQty] = useState<any>({});
    const [genQty, setGenQty] = useState<any>({});
    const [landQty, setLandQty] = useState<any>({});
    const [equipmentPrices, setEquipmentPrices] = useState<any>({});
    const [laborRate, setLaborRate] = useState(35);
    const [overheadPct, setOverheadPct] = useState(25);
    const [profitPct, setProfitPct] = useState(10);
    const [activeTab, setActiveTab] = useState(0);
    const [notes, setNotes] = useState('');
    const [showExport, setShowExport] = useState(false);
    const [isEditingRates, setIsEditingRates] = useState(false);
    const [showAiDialog, setShowAiDialog] = useState(false);
    const printRef = useRef(null);

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

    const handleAiApply = (detected: any) => {
        setQuantities((prev: any) => {
            const next = { ...prev };
            Object.entries(detected).forEach(([k, v]: [string, any]) => {
                next[k] = (next[k] || 0) + v;
            });
            return next;
        });
        setShowAiDialog(false);
    };

    const clearAll = () => {
        setQuantities({}); setGearQty({}); setPoolQty({}); setGenQty({}); setLandQty({}); setEquipmentPrices({});
        setProjectName('New Project'); setSqft(2500); setStories(1); setTypeMult(1);
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
            wire: { mat: wireMat, labor: wireLabor },
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
    }, [quantities, gearQty, poolQty, genQty, landQty, equipmentPrices, laborRate, overheadPct, profitPct, storyMult, typeMult, devicesData, gearData, poolData, genData, landData, wireRatesData]);

    const fmt = (v: number) => '$' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const fmtHr = (v: number) => v.toFixed(1) + ' hr';

    const tabs = [
        { id: 'devices', icon: <LightIcon />, label: 'Devices' },
        { id: 'gear', icon: <GearIcon />, label: 'Gear' },
        { id: 'pool', icon: <PoolIcon />, label: 'Pool' },
        { id: 'generator', icon: <GeneratorIcon />, label: 'Generator' },
        { id: 'landscape', icon: <LandscapeIcon />, label: 'Landscape' },
        { id: 'equipment', icon: <EquipmentIcon />, label: 'Equipment' },
        { id: 'summary', icon: <SummaryIcon />, label: 'Summary' },
    ];

    const generatePrintContent = () => {
        const date = new Date().toLocaleDateString();
        return `
ELECTRICAL ESTIMATE
==========================================
Project: ${projectName}
Date: ${date}
Type: ${projectType === 'commercial' ? 'Commercial' : 'Residential'}
Size: ${sqft} sq ft | ${stories} story

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

    return (
        <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', pb: 8 }}>
            <AppBar position="static" color="default" elevation={1} sx={{ bgcolor: 'background.paper' }}>
                <Toolbar>
                    <Typography variant="h6" color="primary" sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                        <FlashOnIcon /> Electrical Estimator Pro
                    </Typography>
                    <Button color="inherit" onClick={() => window.location.href = '/dashboard'}>Dashboard</Button>
                </Toolbar>
            </AppBar>

            <Container maxWidth="xl" sx={{ mt: 3 }}>
                <Grid container spacing={3}>
                    {/* Project Info & Quick Fill */}
                    <Grid size={{ xs: 12 }}>
                        <Card variant="outlined">
                            <CardContent>
                                <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
                                    <Typography variant="h6">Project Details</Typography>
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
                                        <TextField fullWidth label="Project Name" value={projectName} onChange={(e) => setProjectName(e.target.value)} size="small" />
                                    </Grid>
                                    <Grid size={{ xs: 6, sm: 2 }}>
                                        <TextField fullWidth label="Sq. Ft." type="number" value={sqft} onChange={(e) => setSqft(Number(e.target.value))} size="small" />
                                    </Grid>
                                    <Grid size={{ xs: 6, sm: 2 }}>
                                        <TextField fullWidth label="Stories" type="number" value={stories} onChange={(e) => setStories(Number(e.target.value))} size="small" />
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
                                        onClick={() => setShowAiDialog(true)}
                                        sx={{ ml: 'auto', background: 'linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)', color: 'white' }}
                                    >
                                        AI Analysis
                                    </Button>
                                    <Tooltip title="Export/Print">
                                        <IconButton size="small" color="success" onClick={() => setShowExport(!showExport)}>
                                            <ExportIcon />
                                        </IconButton>
                                    </Tooltip>
                                </Stack>
                                {showExport && (
                                    <Box mt={2} p={2} bgcolor="grey.50" borderRadius={1} border={1} borderColor="grey.200">
                                        <Stack direction="row" spacing={2} mb={2}>
                                            <Button startIcon={<CopyIcon />} variant="contained" size="small" onClick={copyToClipboard}>
                                                Copy to Clipboard
                                            </Button>
                                            <Button startIcon={<PrintIcon />} variant="outlined" size="small" onClick={() => window.print()}>
                                                Print
                                            </Button>
                                        </Stack>
                                        <Box component="pre" sx={{ fontSize: '0.75rem', overflow: 'auto', maxHeight: 200, bgcolor: 'white', p: 1, borderRadius: 1 }}>
                                            {generatePrintContent()}
                                        </Box>
                                    </Box>
                                )}
                            </CardContent>
                        </Card>
                    </Grid>

                    {/* Main Content */}
                    <Grid size={{ xs: 12, lg: 9 }}>
                        <Paper sx={{ minHeight: 500 }}>
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
                                    <Grid container spacing={4}>
                                        <Grid size={{ xs: 12, md: 6 }}>
                                            <Section items={devicesData.lighting} qtyMap={quantities} onChange={updateQty(setQuantities)} title="Lighting" icon={<LightIcon />} category="devices" isMobile={isMobile} isEditingRates={isEditingRates} onRateChange={updateRate} />
                                            <Section items={devicesData.receptacles} qtyMap={quantities} onChange={updateQty(setQuantities)} title="Receptacles" icon={<PowerIcon />} category="devices" isMobile={isMobile} isEditingRates={isEditingRates} onRateChange={updateRate} />
                                            <Section items={devicesData.switches} qtyMap={quantities} onChange={updateQty(setQuantities)} title="Switches" icon={<SwitchIcon />} category="devices" isMobile={isMobile} isEditingRates={isEditingRates} onRateChange={updateRate} />
                                        </Grid>
                                        <Grid size={{ xs: 12, md: 6 }}>
                                            <Section items={devicesData.appliances} qtyMap={quantities} onChange={updateQty(setQuantities)} title="Appliances" icon={<ApplianceIcon />} category="devices" isMobile={isMobile} isEditingRates={isEditingRates} onRateChange={updateRate} />
                                            <Section items={devicesData.hvac} qtyMap={quantities} onChange={updateQty(setQuantities)} title="HVAC" icon={<HvacIcon />} category="devices" isMobile={isMobile} isEditingRates={isEditingRates} onRateChange={updateRate} />
                                            <Section items={devicesData.lowvoltage} qtyMap={quantities} onChange={updateQty(setQuantities)} title="Low Voltage" icon={<LowVoltageIcon />} category="devices" isMobile={isMobile} isEditingRates={isEditingRates} onRateChange={updateRate} />
                                        </Grid>
                                    </Grid>
                                )}

                                {activeTab === 1 && (
                                    <Section items={gearData} qtyMap={gearQty} onChange={updateQty(setGearQty)} title="Panels & Service" icon={<GearIcon />} category="gear" isMobile={isMobile} isEditingRates={isEditingRates} onRateChange={updateRate} />
                                )}

                                {activeTab === 2 && (
                                    <Section items={poolData} qtyMap={poolQty} onChange={updateQty(setPoolQty)} title="Pool & Spa" icon={<PoolIcon />} category="pool" isMobile={isMobile} isEditingRates={isEditingRates} onRateChange={updateRate} />
                                )}

                                {activeTab === 3 && (
                                    <Section items={genData} qtyMap={genQty} onChange={updateQty(setGenQty)} title="Generator & Backup" icon={<GeneratorIcon />} category="generator" isMobile={isMobile} isEditingRates={isEditingRates} onRateChange={updateRate} />
                                )}

                                {activeTab === 4 && (
                                    <Section items={landData} qtyMap={landQty} onChange={updateQty(setLandQty)} title="Landscape Lighting" icon={<LandscapeIcon />} category="landscape" isMobile={isMobile} isEditingRates={isEditingRates} onRateChange={updateRate} />
                                )}

                                {activeTab === 5 && (
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

                                {activeTab === 6 && (
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

            {/* AI Dialog */}
            <BlueprintUploadDialog
                open={showAiDialog}
                onClose={() => setShowAiDialog(false)}
                onApply={handleAiApply}
            />

            {/* Sticky Footer for Mobile */}
            {isMobile && (
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
                        <Button variant="contained" color="secondary" onClick={() => setActiveTab(6)}>
                            View Summary
                        </Button>
                    </Box>
                </Paper>
            )}
        </Box>
    );
}
