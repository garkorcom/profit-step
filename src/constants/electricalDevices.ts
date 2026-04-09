/**
 * Electrical Estimator Device & Equipment Constants
 * Extracted to avoid circular dependency issues when importing from page components.
 */

export const DEVICES = {
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

export const GEAR = [
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

export const POOL = [
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

export const GENERATOR = [
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

export const LANDSCAPE = [
    { id: 'land_trans_300', name: 'LV Transformer 300W', matRate: 145, laborRate: 1.0 },
    { id: 'land_trans_600', name: 'LV Transformer 600W', matRate: 225, laborRate: 1.5 },
    { id: 'land_trans_900', name: 'LV Transformer 900W', matRate: 325, laborRate: 2.0 },
    { id: 'land_path', name: 'Path Light (S.B.O.)', matRate: 0, laborRate: 0.25, wireLen: 25, wireType: '12-2lv' },
    { id: 'land_spot', name: 'Spot Light (S.B.O.)', matRate: 0, laborRate: 0.30, wireLen: 30, wireType: '12-2lv' },
    { id: 'land_well', name: 'Well Light (S.B.O.)', matRate: 0, laborRate: 0.40, wireLen: 35, wireType: '12-2lv' },
    { id: 'land_flood', name: 'Flood Light 120V', matRate: 85, laborRate: 0.60, wireLen: 55, wireType: '12-2' },
    { id: 'land_wire', name: 'LV Wire Run (per 100ft)', matRate: 45, laborRate: 0.50 },
];

export const WIRE = [
    { id: 'wire_14_2', name: '14/2 NM-B Romex (per 250ft)', matRate: 45, laborRate: 0.50 },
    { id: 'wire_14_3', name: '14/3 NM-B Romex (per 250ft)', matRate: 65, laborRate: 0.55 },
    { id: 'wire_12_2', name: '12/2 NM-B Romex (per 250ft)', matRate: 65, laborRate: 0.50 },
    { id: 'wire_12_3', name: '12/3 NM-B Romex (per 250ft)', matRate: 85, laborRate: 0.55 },
    { id: 'wire_10_2', name: '10/2 NM-B Romex (per 250ft)', matRate: 85, laborRate: 0.60 },
    { id: 'wire_10_3', name: '10/3 NM-B Romex (per 250ft)', matRate: 115, laborRate: 0.65 },
    { id: 'wire_6_3', name: '6/3 SER Cable (per 10ft)', matRate: 12, laborRate: 0.15 },
    { id: 'wire_4_3', name: '4/3 SER Cable (per 10ft)', matRate: 18, laborRate: 0.18 },
    { id: 'wire_2_0', name: '2/0 SER Cable (per 10ft)', matRate: 28, laborRate: 0.22 },
    { id: 'wire_emt_half', name: 'EMT Conduit 1/2" (per 10ft)', matRate: 4, laborRate: 0.15 },
    { id: 'wire_emt_3_4', name: 'EMT Conduit 3/4" (per 10ft)', matRate: 5, laborRate: 0.18 },
    { id: 'wire_emt_1', name: 'EMT Conduit 1" (per 10ft)', matRate: 8, laborRate: 0.25 },
    { id: 'wire_emt_2', name: 'EMT Conduit 2" (per 10ft)', matRate: 18, laborRate: 0.35 },
    { id: 'wire_pvc_1', name: 'PVC Conduit 1" (per 10ft)', matRate: 5, laborRate: 0.20 },
    { id: 'wire_pvc_2', name: 'PVC Conduit 2" (per 10ft)', matRate: 12, laborRate: 0.28 },
    { id: 'wire_mc_12_2', name: 'MC Cable 12/2 (per 250ft)', matRate: 120, laborRate: 0.40 },
    { id: 'wire_thhn_10', name: 'THHN #10 (per 500ft)', matRate: 95, laborRate: 0.30 },
];

/**
 * Pre-built item name lookup table for all known device/equipment IDs.
 * Used by analysis and verification components to display human-readable names.
 */
interface NamedItem { id: string; name: string }
export const ITEM_NAMES: Record<string, string> = {};
Object.values(DEVICES).flat().forEach((d: NamedItem) => { ITEM_NAMES[d.id] = d.name; });
[GEAR, POOL, GENERATOR, LANDSCAPE, WIRE].forEach((arr: NamedItem[]) => arr.forEach(d => { ITEM_NAMES[d.id] = d.name; }));

