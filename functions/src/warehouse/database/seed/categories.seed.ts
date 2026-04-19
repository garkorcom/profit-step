/**
 * Seed data — 10 canonical categories для construction inventory.
 */

export interface CategorySeed {
  id: string;
  name: string;
  slug: string;
  parentId?: string;
  displayOrder: number;
}

export const SEED_CATEGORIES: readonly CategorySeed[] = [
  { id: 'cat_electrical', name: 'Electrical', slug: 'electrical', displayOrder: 10 },
  { id: 'cat_electrical_cable', name: 'Cable / Wire', slug: 'electrical_cable', parentId: 'cat_electrical', displayOrder: 11 },
  { id: 'cat_electrical_device', name: 'Devices (outlets, switches)', slug: 'electrical_device', parentId: 'cat_electrical', displayOrder: 12 },
  { id: 'cat_electrical_fixture', name: 'Fixtures (lights, fans)', slug: 'electrical_fixture', parentId: 'cat_electrical', displayOrder: 13 },
  { id: 'cat_plumbing', name: 'Plumbing', slug: 'plumbing', displayOrder: 20 },
  { id: 'cat_plumbing_fittings', name: 'Fittings', slug: 'plumbing_fittings', parentId: 'cat_plumbing', displayOrder: 21 },
  { id: 'cat_hvac', name: 'HVAC', slug: 'hvac', displayOrder: 30 },
  { id: 'cat_tools', name: 'Tools', slug: 'tools', displayOrder: 40 },
  { id: 'cat_consumables', name: 'Consumables', slug: 'consumables', displayOrder: 50 },
  { id: 'cat_hardware', name: 'Hardware (screws, anchors, nails)', slug: 'hardware', displayOrder: 60 },
] as const;
