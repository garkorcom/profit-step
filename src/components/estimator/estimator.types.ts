/**
 * @fileoverview Types, constants, and configuration for the Electrical Estimator.
 * @module components/estimator/estimator.types
 */

// ─── Equipment SBO ────────────────────────────────────────

export interface EquipmentSBOItem {
  id: string;
  name: string;
  defaultPrice: number;
}

export const EQUIPMENT_SBO: EquipmentSBOItem[] = [
  { id: 'eq_fixtures', name: 'Light Fixtures Package', defaultPrice: 5000 },
  { id: 'eq_fans', name: 'Ceiling Fans Package', defaultPrice: 1500 },
  { id: 'eq_landscape', name: 'Landscape Fixtures', defaultPrice: 2500 },
  { id: 'eq_generator', name: 'Generator Unit', defaultPrice: 12000 },
  { id: 'eq_smart', name: 'Smart Home Devices', defaultPrice: 3000 },
  { id: 'eq_audio', name: 'Audio/Speakers', defaultPrice: 2000 },
  { id: 'eq_security', name: 'Security System', defaultPrice: 1500 },
  { id: 'eq_ev_charger', name: 'EV Charger Unit', defaultPrice: 800 },
];

// ─── Quantity Maps ────────────────────────────────────────

export type QuantityMap = Record<string, number>;

// ─── Wire Rates ───────────────────────────────────────────

export interface WireRate {
  name: string;
  rate: number;
  laborPer100: number;
}

export const WIRE_RATES: Record<string, WireRate> = {
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

// ─── Templates ────────────────────────────────────────────

export interface EstimateTemplate {
  name: string;
  descriptionRu: string;
  sqft: number;
  stories: number;
  type: string;
  devices: QuantityMap;
  gear: QuantityMap;
  pool: QuantityMap;
  generator: QuantityMap;
  landscape: QuantityMap;
  equipment: QuantityMap;
}

export const TEMPLATES: Record<string, EstimateTemplate> = {
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

// ─── Electrical Device Item ───────────────────────────────

export interface ElectricalItem {
  id: string;
  name: string;
  matRate: number;
  laborRate: number;
  wireType?: string;
  wireLen?: number;
}

// ─── Calculation Result ───────────────────────────────────

export interface SectionData {
  mat: number;
  labor: number;
}

export interface EstimatorCalcResult {
  sectionsData: Record<string, SectionData>;
  wireByType: Record<string, number>;
  materialsBase: number;
  miscMarkup: number;
  materialsFinal: number;
  salesTaxMat: number;
  productiveHrs: number;
  nonProdHrs: number;
  totalHrs: number;
  laborCost: number;
  matLaborCost: number;
  overhead: number;
  profit: number;
  eqNet: number;
  eqTax: number;
  eqMarkup: number;
  eqTotal: number;
  basePrice: number;
  totalPrice: number;
}

// ─── Format Helpers ───────────────────────────────────────

export const fmt = (v: number) => '$' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export const fmtHr = (v: number) => v.toFixed(1) + ' hr';
