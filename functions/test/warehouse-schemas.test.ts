/**
 * Zod schema tests for the new warehouse module.
 *
 * Mirrors docs/warehouse/core/01_data_model/TESTS.md §1.
 */

import {
  CreateWhDocumentSchema,
  CreateWhItemSchema,
  CreateWhLocationSchema,
  CreateWhNormSchema,
  CreateWhVendorSchema,
} from '../src/warehouse/database/schemas';

describe('CreateWhItemSchema', () => {
  const valid = {
    sku: 'WIRE-12-2-NMB',
    name: 'Wire 12-2 NM-B',
    category: 'cat_electrical_cable',
    baseUOM: 'ft',
    purchaseUOMs: [
      { uom: 'ft', factor: 1, isDefault: false },
      { uom: 'roll_250ft', factor: 250, isDefault: true },
    ],
    allowedIssueUOMs: ['ft'],
    lastPurchasePrice: 0.36,
    averageCost: 0.36,
    isTrackable: false,
  };

  it('accepts a valid item', () => {
    const r = CreateWhItemSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it('rejects lowercase SKU', () => {
    const r = CreateWhItemSchema.safeParse({ ...valid, sku: 'wire-12' });
    expect(r.success).toBe(false);
  });

  it('rejects two defaults in purchaseUOMs', () => {
    const r = CreateWhItemSchema.safeParse({
      ...valid,
      purchaseUOMs: [
        { uom: 'ft', factor: 1, isDefault: true },
        { uom: 'roll_250ft', factor: 250, isDefault: true },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('rejects zero-factor UOM', () => {
    const r = CreateWhItemSchema.safeParse({
      ...valid,
      purchaseUOMs: [{ uom: 'ft', factor: 0, isDefault: true }],
    });
    expect(r.success).toBe(false);
  });

  it('accepts baseUOM if present in allowedIssueUOMs only', () => {
    const r = CreateWhItemSchema.safeParse({
      ...valid,
      purchaseUOMs: [{ uom: 'roll_250ft', factor: 250, isDefault: true }],
      allowedIssueUOMs: ['ft'],
    });
    expect(r.success).toBe(true);
  });
});

describe('CreateWhLocationSchema', () => {
  it('accepts warehouse without ownerEmployeeId', () => {
    const r = CreateWhLocationSchema.safeParse({
      name: 'Main WH',
      locationType: 'warehouse',
      twoPhaseTransferEnabled: false,
    });
    expect(r.success).toBe(true);
  });

  it('rejects van without ownerEmployeeId', () => {
    const r = CreateWhLocationSchema.safeParse({
      name: 'Van X',
      locationType: 'van',
      twoPhaseTransferEnabled: false,
    });
    expect(r.success).toBe(false);
  });

  it('accepts site with relatedClientId', () => {
    const r = CreateWhLocationSchema.safeParse({
      name: 'Site Dvorkin',
      locationType: 'site',
      relatedClientId: 'client_dvorkin',
      twoPhaseTransferEnabled: false,
    });
    expect(r.success).toBe(true);
  });
});

describe('CreateWhDocumentSchema', () => {
  const baseLine = { itemId: 'item_outlet_15a_white', uom: 'each', qty: 3 };

  it('accepts a receipt with destinationLocationId', () => {
    const r = CreateWhDocumentSchema.safeParse({
      docType: 'receipt',
      eventDate: '2026-04-18',
      destinationLocationId: 'loc_van_denis',
      lines: [baseLine],
      source: 'ui',
    });
    expect(r.success).toBe(true);
  });

  it('rejects receipt without destinationLocationId', () => {
    const r = CreateWhDocumentSchema.safeParse({
      docType: 'receipt',
      eventDate: '2026-04-18',
      lines: [baseLine],
      source: 'ui',
    });
    expect(r.success).toBe(false);
  });

  it('rejects issue without sourceLocationId', () => {
    const r = CreateWhDocumentSchema.safeParse({
      docType: 'issue',
      eventDate: '2026-04-18',
      reason: 'internal_shop_use',
      lines: [baseLine],
      source: 'ui',
    });
    expect(r.success).toBe(false);
  });

  it('rejects transfer with source == destination', () => {
    const r = CreateWhDocumentSchema.safeParse({
      docType: 'transfer',
      eventDate: '2026-04-18',
      sourceLocationId: 'loc_A',
      destinationLocationId: 'loc_A',
      lines: [baseLine],
      source: 'ui',
    });
    expect(r.success).toBe(false);
  });

  it('rejects project_* issue without projectId', () => {
    const r = CreateWhDocumentSchema.safeParse({
      docType: 'issue',
      eventDate: '2026-04-18',
      sourceLocationId: 'loc_van_denis',
      reason: 'project_installation',
      lines: [baseLine],
      source: 'ui',
    });
    expect(r.success).toBe(false);
  });

  it('accepts project_installation with projectId', () => {
    const r = CreateWhDocumentSchema.safeParse({
      docType: 'issue',
      eventDate: '2026-04-18',
      sourceLocationId: 'loc_van_denis',
      reason: 'project_installation',
      projectId: 'proj_dvorkin',
      phaseCode: 'rough_in',
      lines: [baseLine],
      source: 'ui',
    });
    expect(r.success).toBe(true);
  });

  it('rejects empty lines', () => {
    const r = CreateWhDocumentSchema.safeParse({
      docType: 'receipt',
      eventDate: '2026-04-18',
      destinationLocationId: 'loc_van_denis',
      lines: [],
      source: 'ui',
    });
    expect(r.success).toBe(false);
  });
});

describe('CreateWhNormSchema', () => {
  it('accepts a valid norm', () => {
    const r = CreateWhNormSchema.safeParse({
      taskType: 'install_outlet',
      name: 'Install outlet',
      items: [{ itemId: 'item_outlet_15a_white', qtyPerUnit: 1 }],
    });
    expect(r.success).toBe(true);
  });

  it('rejects non-snake_case taskType', () => {
    const r = CreateWhNormSchema.safeParse({
      taskType: 'InstallOutlet',
      name: 'Install outlet',
      items: [{ itemId: 'item_outlet_15a_white', qtyPerUnit: 1 }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects empty items', () => {
    const r = CreateWhNormSchema.safeParse({
      taskType: 'install_outlet',
      name: 'Install outlet',
      items: [],
    });
    expect(r.success).toBe(false);
  });
});

describe('CreateWhVendorSchema', () => {
  it('accepts a big-box vendor', () => {
    const r = CreateWhVendorSchema.safeParse({
      name: 'Home Depot',
      vendorType: 'big_box',
      contactEmail: 'pro@homedepot.com',
    });
    expect(r.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const r = CreateWhVendorSchema.safeParse({
      name: 'Bad',
      vendorType: 'online',
      contactEmail: 'not-an-email',
    });
    expect(r.success).toBe(false);
  });
});
