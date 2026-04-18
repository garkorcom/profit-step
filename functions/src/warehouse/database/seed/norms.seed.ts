/**
 * Seed data — 20 canonical task-templates → material norms.
 *
 * Each norm declares how much of each item is consumed per 1 unit of task.
 * Used by UC3 (auto-writeoff) and UC4 (procurement plan).
 *
 * Item ids must match functions/src/warehouse/database/seed/items.seed.ts.
 */

export interface NormSeed {
  id: string;
  taskType: string;
  name: string;
  description?: string;
  items: Array<{ itemId: string; qtyPerUnit: number; note?: string }>;
  estimatedLaborHours?: number;
}

export const SEED_NORMS: readonly NormSeed[] = [
  // ── Electrical ─────────────────────────────────────────────────────
  {
    id: 'norm_install_outlet',
    taskType: 'install_outlet',
    name: 'Install standard outlet (15A)',
    items: [
      { itemId: 'item_outlet_15a_white', qtyPerUnit: 1 },
      { itemId: 'item_wire_12_2_nmb', qtyPerUnit: 5 },
      { itemId: 'item_box_1g_plastic', qtyPerUnit: 1 },
      { itemId: 'item_wirenut_yellow', qtyPerUnit: 3 },
      { itemId: 'item_wall_plate_1g_white', qtyPerUnit: 1 },
      { itemId: 'item_cable_staples', qtyPerUnit: 2 },
    ],
    estimatedLaborHours: 0.5,
  },
  {
    id: 'norm_replace_outlet',
    taskType: 'replace_outlet',
    name: 'Replace existing outlet',
    items: [
      { itemId: 'item_outlet_15a_white', qtyPerUnit: 1 },
      { itemId: 'item_wirenut_yellow', qtyPerUnit: 2 },
    ],
    estimatedLaborHours: 0.25,
  },
  {
    id: 'norm_install_switch',
    taskType: 'install_switch',
    name: 'Install single-pole switch',
    items: [
      { itemId: 'item_switch_spst_white', qtyPerUnit: 1 },
      { itemId: 'item_wire_14_2_nmb', qtyPerUnit: 4 },
      { itemId: 'item_box_1g_plastic', qtyPerUnit: 1 },
      { itemId: 'item_wirenut_yellow', qtyPerUnit: 2 },
      { itemId: 'item_wall_plate_1g_white', qtyPerUnit: 1 },
    ],
    estimatedLaborHours: 0.4,
  },
  {
    id: 'norm_replace_switch',
    taskType: 'replace_switch',
    name: 'Replace existing switch',
    items: [
      { itemId: 'item_switch_spst_white', qtyPerUnit: 1 },
      { itemId: 'item_wirenut_yellow', qtyPerUnit: 2 },
    ],
    estimatedLaborHours: 0.2,
  },
  {
    id: 'norm_install_gfci',
    taskType: 'install_gfci',
    name: 'Install GFCI outlet',
    items: [
      { itemId: 'item_gfci_15a', qtyPerUnit: 1 },
      { itemId: 'item_wire_12_2_nmb', qtyPerUnit: 6 },
      { itemId: 'item_box_1g_plastic', qtyPerUnit: 1 },
      { itemId: 'item_wirenut_yellow', qtyPerUnit: 4 },
      { itemId: 'item_wall_plate_1g_white', qtyPerUnit: 1 },
    ],
    estimatedLaborHours: 0.5,
  },
  {
    id: 'norm_install_3way',
    taskType: 'install_3way_switch',
    name: 'Install 3-way switch (pair)',
    items: [
      { itemId: 'item_switch_3way_white', qtyPerUnit: 2 },
      { itemId: 'item_wire_12_3_nmb', qtyPerUnit: 20 },
      { itemId: 'item_box_1g_plastic', qtyPerUnit: 2 },
      { itemId: 'item_wirenut_yellow', qtyPerUnit: 6 },
      { itemId: 'item_wall_plate_1g_white', qtyPerUnit: 2 },
    ],
    estimatedLaborHours: 1.2,
  },
  {
    id: 'norm_install_fan',
    taskType: 'install_fan',
    name: 'Install ceiling fan',
    items: [
      { itemId: 'item_ceiling_fan_52', qtyPerUnit: 1 },
      { itemId: 'item_fan_support_box', qtyPerUnit: 1 },
      { itemId: 'item_wire_14_2_nmb', qtyPerUnit: 3 },
      { itemId: 'item_wirenut_yellow', qtyPerUnit: 4 },
    ],
    estimatedLaborHours: 1.5,
  },
  {
    id: 'norm_replace_light_fixture',
    taskType: 'replace_light_fixture',
    name: 'Replace ceiling light fixture',
    items: [
      { itemId: 'item_light_fixture_basic', qtyPerUnit: 1 },
      { itemId: 'item_wirenut_yellow', qtyPerUnit: 3 },
    ],
    estimatedLaborHours: 0.5,
  },
  {
    id: 'norm_install_recessed_led',
    taskType: 'install_recessed_led',
    name: 'Install recessed LED can',
    items: [
      { itemId: 'item_recessed_led_6', qtyPerUnit: 1 },
      { itemId: 'item_wire_14_2_nmb', qtyPerUnit: 8 },
      { itemId: 'item_wirenut_yellow', qtyPerUnit: 3 },
    ],
    estimatedLaborHours: 0.8,
  },
  {
    id: 'norm_install_dimmer',
    taskType: 'install_dimmer',
    name: 'Install dimmer switch',
    items: [
      { itemId: 'item_dimmer_single_pole', qtyPerUnit: 1 },
      { itemId: 'item_wirenut_yellow', qtyPerUnit: 2 },
    ],
    estimatedLaborHours: 0.3,
  },
  {
    id: 'norm_run_cable',
    taskType: 'run_cable',
    name: 'Run 12-2 cable per foot (base)',
    description: 'qtyPerUnit=1 meaning per 1 foot of task',
    items: [
      { itemId: 'item_wire_12_2_nmb', qtyPerUnit: 1 },
      { itemId: 'item_cable_staples', qtyPerUnit: 0.2 },
    ],
  },

  // ── Plumbing ───────────────────────────────────────────────────────
  {
    id: 'norm_replace_faucet',
    taskType: 'replace_faucet',
    name: 'Replace kitchen/bath faucet',
    items: [
      { itemId: 'item_faucet_basic', qtyPerUnit: 1 },
      { itemId: 'item_supply_line_12', qtyPerUnit: 2 },
      { itemId: 'item_teflon_tape', qtyPerUnit: 1 },
    ],
    estimatedLaborHours: 1.0,
  },
  {
    id: 'norm_fix_leak_under_sink',
    taskType: 'fix_leak',
    name: 'Fix under-sink leak (P-trap/supply)',
    items: [
      { itemId: 'item_teflon_tape', qtyPerUnit: 1 },
      { itemId: 'item_pvc_coupling_05', qtyPerUnit: 1 },
      { itemId: 'item_pvc_cement', qtyPerUnit: 0.2 },
    ],
    estimatedLaborHours: 0.8,
  },
  {
    id: 'norm_install_supply_line',
    taskType: 'install_supply_line',
    name: 'Install braided supply line',
    items: [
      { itemId: 'item_supply_line_12', qtyPerUnit: 1 },
      { itemId: 'item_teflon_tape', qtyPerUnit: 0.5 },
    ],
    estimatedLaborHours: 0.3,
  },

  // ── Drywall / paint ────────────────────────────────────────────────
  {
    id: 'norm_patch_drywall',
    taskType: 'patch_drywall',
    name: 'Patch drywall (up to 12"×12" area)',
    items: [
      { itemId: 'item_joint_compound', qtyPerUnit: 0.1 },
      { itemId: 'item_drywall_tape', qtyPerUnit: 0.1 },
      { itemId: 'item_drywall_screw_158', qtyPerUnit: 8 },
    ],
    estimatedLaborHours: 0.5,
  },
  {
    id: 'norm_paint_wall',
    taskType: 'paint_wall',
    name: 'Paint wall (per 100 sqft)',
    description: 'qtyPerUnit scales with sqft',
    items: [
      { itemId: 'item_primer_1gal', qtyPerUnit: 0.25 },
      { itemId: 'item_paint_white_1gal', qtyPerUnit: 0.3 },
    ],
    estimatedLaborHours: 1.5,
  },
  {
    id: 'norm_caulk_joint',
    taskType: 'caulk_joint',
    name: 'Caulk joint / seam',
    items: [{ itemId: 'item_caulk_white', qtyPerUnit: 0.25 }],
    estimatedLaborHours: 0.1,
  },

  // ── HVAC / misc ────────────────────────────────────────────────────
  {
    id: 'norm_replace_hvac_filter',
    taskType: 'replace_hvac_filter',
    name: 'Replace HVAC filter',
    items: [{ itemId: 'item_hvac_filter_20x25', qtyPerUnit: 1 }],
    estimatedLaborHours: 0.15,
  },
  {
    id: 'norm_hang_tv',
    taskType: 'hang_tv',
    name: 'Hang TV on wall (mount supplied by customer)',
    items: [
      { itemId: 'item_wood_screw_2', qtyPerUnit: 4 },
      { itemId: 'item_anchor_toggle', qtyPerUnit: 4 },
    ],
    estimatedLaborHours: 1.0,
  },
  {
    id: 'norm_install_shelf',
    taskType: 'install_shelf',
    name: 'Install wall shelf (up to 36")',
    items: [
      { itemId: 'item_wood_screw_2', qtyPerUnit: 4 },
      { itemId: 'item_anchor_toggle', qtyPerUnit: 4 },
    ],
    estimatedLaborHours: 0.5,
  },
];

if (new Set(SEED_NORMS.map((n) => n.taskType)).size !== SEED_NORMS.length) {
  throw new Error('SEED_NORMS contains duplicate taskType');
}
if (new Set(SEED_NORMS.map((n) => n.id)).size !== SEED_NORMS.length) {
  throw new Error('SEED_NORMS contains duplicate ids');
}
