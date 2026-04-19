/**
 * Seed data — 4 common vendors for MVP dogfood.
 *
 * Real partnerships will come through Phase 4+ (RFQ email workflow).
 * These are placeholder references so receipts + POs can be attributed.
 */

export interface VendorSeed {
  id: string;
  name: string;
  vendorType: 'big_box' | 'local_supply' | 'subcontractor_proxy' | 'online';
  contactEmail?: string;
  contactName?: string;
  preferredForCategories?: string[];
  defaultPaymentTerms?: string;
}

export const SEED_VENDORS: readonly VendorSeed[] = [
  {
    id: 'vendor_home_depot',
    name: 'Home Depot',
    vendorType: 'big_box',
    contactEmail: 'pro@homedepot.local',
    preferredForCategories: ['cat_electrical_cable', 'cat_electrical_device', 'cat_hardware', 'cat_consumables'],
    defaultPaymentTerms: 'COD',
  },
  {
    id: 'vendor_lowes',
    name: "Lowe's",
    vendorType: 'big_box',
    contactEmail: 'pro@lowes.local',
    preferredForCategories: ['cat_electrical_cable', 'cat_hardware', 'cat_consumables'],
    defaultPaymentTerms: 'COD',
  },
  {
    id: 'vendor_ferguson',
    name: 'Ferguson Plumbing Supply',
    vendorType: 'local_supply',
    contactName: 'Sales Desk',
    contactEmail: 'orders@ferguson.local',
    preferredForCategories: ['cat_plumbing', 'cat_plumbing_fittings'],
    defaultPaymentTerms: 'Net 30',
  },
  {
    id: 'vendor_local_electrical',
    name: 'Local Electrical Supply',
    vendorType: 'local_supply',
    preferredForCategories: ['cat_electrical_fixture', 'cat_electrical_device'],
    defaultPaymentTerms: 'Net 15',
  },
];

if (new Set(SEED_VENDORS.map((v) => v.id)).size !== SEED_VENDORS.length) {
  throw new Error('SEED_VENDORS contains duplicate ids');
}
