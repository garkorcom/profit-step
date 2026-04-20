/**
 * Inventory V2 Schema Validation Tests
 *
 * Validates Zod schemas for:
 * - Catalog items (create, update, list)
 * - Locations (create with vehicle validation, check-in)
 * - Transactions V2 (commit, self-checkout)
 * - Category policies (create, update)
 * - Barcode array handling
 */
import {
  CreateCatalogItemSchema,
  UpdateCatalogItemSchema,
  ListCatalogQuerySchema,
  CreateLocationSchema,
  // UpdateLocationSchema — tested indirectly via API integration tests
  CommitTransactionSchema,
  SelfCheckoutSchema,
  CategoryPolicySchema,
  UpdateCategoryPolicySchema,
  DEFAULT_CATEGORY_POLICIES,
} from '../src/agent/schemas/inventoryV2Schemas';

describe('Inventory V2 Schemas', () => {

  // ─── CreateCatalogItemSchema ──────────────────────────────────

  describe('CreateCatalogItemSchema', () => {
    test('valid minimal catalog item', () => {
      const result = CreateCatalogItemSchema.parse({
        name: 'Wire 12 AWG',
        sku: 'WIRE-12AWG',
      });
      expect(result.name).toBe('Wire 12 AWG');
      expect(result.sku).toBe('WIRE-12AWG');
      expect(result.barcodes).toEqual([]);
      expect(result.category).toBe('other');
      expect(result.unit).toBe('pcs');
      expect(result.suppliers).toEqual([]);
    });

    test('valid full catalog item with barcodes array', () => {
      const result = CreateCatalogItemSchema.parse({
        name: 'Wire 12 AWG',
        sku: 'WIRE-12AWG',
        barcodes: ['4006381333931', 'INTERNAL-W12', '00123456789'],
        category: 'wire',
        unit: 'ft',
        minStock: 100,
        avgPrice: 0.52,
        suppliers: ['Home Depot', 'Grainger'],
      });
      expect(result.barcodes).toHaveLength(3);
      expect(result.category).toBe('wire');
      expect(result.minStock).toBe(100);
    });

    test('rejects empty name', () => {
      expect(() => CreateCatalogItemSchema.parse({ name: '', sku: 'X' })).toThrow();
    });

    test('rejects empty sku', () => {
      expect(() => CreateCatalogItemSchema.parse({ name: 'Wire', sku: '' })).toThrow();
    });

    test('rejects invalid category', () => {
      expect(() => CreateCatalogItemSchema.parse({
        name: 'Wire', sku: 'W', category: 'invalid_cat',
      })).toThrow();
    });

    test('rejects negative minStock', () => {
      expect(() => CreateCatalogItemSchema.parse({
        name: 'Wire', sku: 'W', minStock: -5,
      })).toThrow();
    });

    test('accepts all valid categories', () => {
      const categories = ['electrical', 'plumbing', 'audio_video', 'hardware', 'tools',
        'fasteners', 'smart_devices', 'panels', 'wire', 'other'];
      for (const cat of categories) {
        const result = CreateCatalogItemSchema.parse({ name: 'X', sku: 'X', category: cat });
        expect(result.category).toBe(cat);
      }
    });

    test('accepts all valid units', () => {
      const units = ['pcs', 'pack', 'roll', 'ft', 'box', 'spool', 'm', 'kg', 'l'];
      for (const unit of units) {
        const result = CreateCatalogItemSchema.parse({ name: 'X', sku: 'X', unit });
        expect(result.unit).toBe(unit);
      }
    });
  });

  // ─── UpdateCatalogItemSchema ──────────────────────────────────

  describe('UpdateCatalogItemSchema', () => {
    test('valid partial update', () => {
      const result = UpdateCatalogItemSchema.parse({ name: 'New Name' });
      expect(result.name).toBe('New Name');
    });

    test('rejects empty object', () => {
      expect(() => UpdateCatalogItemSchema.parse({})).toThrow('At least one field');
    });

    test('allows nullable photoUrl', () => {
      const result = UpdateCatalogItemSchema.parse({ photoUrl: null });
      expect(result.photoUrl).toBeNull();
    });

    test('allows updating barcodes', () => {
      const result = UpdateCatalogItemSchema.parse({ barcodes: ['NEW-123', 'NEW-456'] });
      expect(result.barcodes).toEqual(['NEW-123', 'NEW-456']);
    });
  });

  // ─── CreateLocationSchema ─────────────────────────────────────

  describe('CreateLocationSchema', () => {
    test('valid physical location', () => {
      const result = CreateLocationSchema.parse({
        name: 'Main Warehouse',
        type: 'physical',
        address: '123 Main St',
        assignedTo: ['user1', 'user2'],
      });
      expect(result.name).toBe('Main Warehouse');
      expect(result.type).toBe('physical');
      expect(result.selfCheckoutEnabled).toBe(false);
      expect(result.assignedTo).toEqual(['user1', 'user2']);
    });

    test('valid vehicle with licensePlate', () => {
      const result = CreateLocationSchema.parse({
        name: 'Van 007',
        type: 'vehicle',
        licensePlate: 'ABC-1234',
      });
      expect(result.licensePlate).toBe('ABC-1234');
    });

    test('rejects vehicle WITHOUT licensePlate', () => {
      expect(() => CreateLocationSchema.parse({
        name: 'Van 007',
        type: 'vehicle',
      })).toThrow('licensePlate');
    });

    test('physical location does NOT require licensePlate', () => {
      const result = CreateLocationSchema.parse({ name: 'Warehouse' });
      expect(result.type).toBe('physical');
      expect(result.licensePlate).toBeUndefined();
    });

    test('valid jobsite location', () => {
      const result = CreateLocationSchema.parse({
        name: 'Project Alpha Site',
        type: 'jobsite',
        projectId: 'proj123',
        clientId: 'client456',
      });
      expect(result.type).toBe('jobsite');
      expect(result.projectId).toBe('proj123');
    });

    test('selfCheckoutEnabled defaults to false', () => {
      const result = CreateLocationSchema.parse({ name: 'Warehouse' });
      expect(result.selfCheckoutEnabled).toBe(false);
    });

    test('selfCheckoutEnabled can be set to true', () => {
      const result = CreateLocationSchema.parse({
        name: 'Warehouse',
        selfCheckoutEnabled: true,
      });
      expect(result.selfCheckoutEnabled).toBe(true);
    });
  });

  // ─── CommitTransactionSchema ──────────────────────────────────

  describe('CommitTransactionSchema', () => {
    test('valid basic transaction', () => {
      const result = CommitTransactionSchema.parse({
        catalogItemId: 'item1',
        locationId: 'loc1',
        type: 'purchase',
        quantity: 100,
      });
      expect(result.type).toBe('purchase');
      expect(result.quantity).toBe(100);
    });

    test('all transaction types accepted', () => {
      const types = [
        'purchase', 'write_off', 'transfer_out', 'transfer_in',
        'adjustment', 'return', 'reservation_issue', 'reservation_return',
        'self_checkout',
      ];
      for (const t of types) {
        const result = CommitTransactionSchema.parse({
          catalogItemId: 'x', locationId: 'y', type: t, quantity: 1,
        });
        expect(result.type).toBe(t);
      }
    });

    test('rejects zero quantity', () => {
      expect(() => CommitTransactionSchema.parse({
        catalogItemId: 'x', locationId: 'y', type: 'purchase', quantity: 0,
      })).toThrow();
    });

    test('rejects negative quantity', () => {
      expect(() => CommitTransactionSchema.parse({
        catalogItemId: 'x', locationId: 'y', type: 'purchase', quantity: -5,
      })).toThrow();
    });

    test('optional fields are optional', () => {
      const result = CommitTransactionSchema.parse({
        catalogItemId: 'x', locationId: 'y', type: 'purchase', quantity: 1,
      });
      expect(result.unitPrice).toBeUndefined();
      expect(result.relatedTaskId).toBeUndefined();
      expect(result.transactionGroupId).toBeUndefined();
    });

    test('accepts transfer with toLocationId', () => {
      const result = CommitTransactionSchema.parse({
        catalogItemId: 'x', locationId: 'y', type: 'transfer_out',
        quantity: 10, toLocationId: 'z', transactionGroupId: 'grp-1',
      });
      expect(result.toLocationId).toBe('z');
      expect(result.transactionGroupId).toBe('grp-1');
    });
  });

  // ─── SelfCheckoutSchema ───────────────────────────────────────

  describe('SelfCheckoutSchema', () => {
    test('valid self-checkout', () => {
      const result = SelfCheckoutSchema.parse({
        catalogItemId: 'wire1',
        locationId: 'main_warehouse',
        quantity: 200,
      });
      expect(result.quantity).toBe(200);
    });

    test('rejects missing catalogItemId', () => {
      expect(() => SelfCheckoutSchema.parse({
        locationId: 'x', quantity: 1,
      })).toThrow();
    });

    test('accepts optional notes', () => {
      const result = SelfCheckoutSchema.parse({
        catalogItemId: 'x', locationId: 'y', quantity: 1, notes: 'Urgent',
      });
      expect(result.notes).toBe('Urgent');
    });
  });

  // ─── CategoryPolicySchema ─────────────────────────────────────

  describe('CategoryPolicySchema', () => {
    test('valid policy', () => {
      const result = CategoryPolicySchema.parse({
        categoryId: 'wire',
        displayName: 'Wire & Cable',
        autoApproveTransfer: { maxQty: 500, maxUsdValue: 200 },
        anomalyDetection: { multiplier: 1.3, minUsdVariance: 50 },
      });
      expect(result.autoApproveTransfer.maxQty).toBe(500);
      expect(result.anomalyDetection.multiplier).toBe(1.3);
    });

    test('rejects multiplier below 1', () => {
      expect(() => CategoryPolicySchema.parse({
        categoryId: 'wire',
        displayName: 'Wire',
        autoApproveTransfer: { maxQty: 500, maxUsdValue: 200 },
        anomalyDetection: { multiplier: 0.5, minUsdVariance: 50 },
      })).toThrow();
    });

    test('rejects negative maxUsdValue', () => {
      expect(() => CategoryPolicySchema.parse({
        categoryId: 'wire',
        displayName: 'Wire',
        autoApproveTransfer: { maxQty: 500, maxUsdValue: -10 },
        anomalyDetection: { multiplier: 1.3, minUsdVariance: 50 },
      })).toThrow();
    });
  });

  // ─── Default Policies ─────────────────────────────────────────

  describe('DEFAULT_CATEGORY_POLICIES', () => {
    test('has 5 default policies', () => {
      expect(DEFAULT_CATEGORY_POLICIES).toHaveLength(5);
    });

    test('all pass schema validation', () => {
      for (const policy of DEFAULT_CATEGORY_POLICIES) {
        expect(() => CategoryPolicySchema.parse(policy)).not.toThrow();
      }
    });

    test('covers key categories', () => {
      const ids = DEFAULT_CATEGORY_POLICIES.map((p) => p.categoryId);
      expect(ids).toContain('fasteners');
      expect(ids).toContain('wire');
      expect(ids).toContain('tools');
      expect(ids).toContain('smart_devices');
      expect(ids).toContain('panels');
    });

    test('wire policy: multiplier 1.3, minUsdVariance $50', () => {
      const wire = DEFAULT_CATEGORY_POLICIES.find((p) => p.categoryId === 'wire')!;
      expect(wire.anomalyDetection.multiplier).toBe(1.3);
      expect(wire.anomalyDetection.minUsdVariance).toBe(50);
    });

    test('fasteners policy: higher tolerance (2.0x)', () => {
      const fasteners = DEFAULT_CATEGORY_POLICIES.find((p) => p.categoryId === 'fasteners')!;
      expect(fasteners.anomalyDetection.multiplier).toBe(2.0);
      expect(fasteners.autoApproveTransfer.maxQty).toBe(1000);
    });
  });

  // ─── UpdateCategoryPolicySchema ───────────────────────────────

  describe('UpdateCategoryPolicySchema', () => {
    test('valid partial update', () => {
      const result = UpdateCategoryPolicySchema.parse({
        displayName: 'New Name',
      });
      expect(result.displayName).toBe('New Name');
    });

    test('rejects empty object', () => {
      expect(() => UpdateCategoryPolicySchema.parse({})).toThrow('At least one field');
    });

    test('accepts autoApproveTransfer only', () => {
      const result = UpdateCategoryPolicySchema.parse({
        autoApproveTransfer: { maxQty: 1000, maxUsdValue: 100 },
      });
      expect(result.autoApproveTransfer!.maxQty).toBe(1000);
    });
  });

  // ─── ListCatalogQuerySchema ───────────────────────────────────

  describe('ListCatalogQuerySchema', () => {
    test('defaults', () => {
      const result = ListCatalogQuerySchema.parse({});
      expect(result.limit).toBe(100);
      expect(result.offset).toBe(0);
      expect(result.lowStockOnly).toBe(false);
    });

    test('lowStockOnly transforms string to boolean', () => {
      const result = ListCatalogQuerySchema.parse({ lowStockOnly: 'true' });
      expect(result.lowStockOnly).toBe(true);
    });

    test('limit coerces string to number', () => {
      const result = ListCatalogQuerySchema.parse({ limit: '50' });
      expect(result.limit).toBe(50);
    });

    test('rejects limit > 500', () => {
      expect(() => ListCatalogQuerySchema.parse({ limit: '1000' })).toThrow();
    });
  });
});
