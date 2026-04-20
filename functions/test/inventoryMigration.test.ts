/**
 * Tests for InventoryMigrationService — V1 → V2 data migration
 *
 * Covers:
 * - Warehouse → Location mapping (physical/vehicle types, same doc IDs)
 * - Item → Catalog mapping (stockByLocation, barcodes, category)
 * - Transaction type mapping (in→purchase, out→write_off, transfer→pair)
 * - Idempotency (skip already-migrated docs)
 * - Dry run report
 * - Edge cases (missing fields, archived warehouses, transfers)
 */

// ─── Mock Firebase ─────────────────────────────────────────────────

const mockBatchSet = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue(undefined);

// In-memory Firestore collections
const collections: Record<string, Map<string, any>> = {
  warehouses: new Map(),
  inventory_items: new Map(),
  inventory_transactions: new Map(),
  inventory_locations: new Map(),
  inventory_catalog: new Map(),
  inventory_transactions_v2: new Map(),
};

let autoIdCounter = 0;

const mockCollection = jest.fn((name: string) => ({
  doc: jest.fn((id?: string) => {
    const docId = id || `auto_${++autoIdCounter}`;
    return {
      id: docId,
      get: jest.fn().mockResolvedValue({
        exists: collections[name]?.has(docId) ?? false,
        id: docId,
        data: () => collections[name]?.get(docId) ?? undefined,
      }),
    };
  }),
  get: jest.fn().mockImplementation(async () => {
    const coll = collections[name] || new Map();
    return {
      empty: coll.size === 0,
      size: coll.size,
      docs: Array.from(coll.entries()).map(([id, data]) => ({
        id,
        data: () => data,
        ref: { id },
      })),
    };
  }),
  where: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      get: jest.fn().mockImplementation(async () => {
        const coll = collections[name] || new Map();
        // Filter for migrationSourceId != null
        const filtered = Array.from(coll.entries()).filter(
          ([_, data]) => data.migrationSourceId != null
        );
        return {
          empty: filtered.length === 0,
          size: filtered.length,
          docs: filtered.map(([id, data]) => ({
            id,
            data: () => data,
          })),
        };
      }),
    }),
    get: jest.fn().mockImplementation(async () => {
      const coll = collections[name] || new Map();
      const filtered = Array.from(coll.entries()).filter(
        ([_, data]) => data.migrationSourceId != null
      );
      return {
        empty: filtered.length === 0,
        size: filtered.length,
        docs: filtered.map(([id, data]) => ({
          id,
          data: () => data,
        })),
      };
    }),
  }),
  select: jest.fn().mockReturnValue({
    get: jest.fn().mockImplementation(async () => {
      const coll = collections[name] || new Map();
      return {
        empty: coll.size === 0,
        size: coll.size,
        docs: Array.from(coll.entries()).map(([id, data]) => ({
          id,
          data: () => data,
        })),
      };
    }),
  }),
}));

jest.mock('../src/agent/routeContext', () => ({
  db: {
    collection: mockCollection,
    batch: jest.fn(() => ({
      set: mockBatchSet,
      commit: mockBatchCommit,
    })),
  },
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// ─── Import after mocks ───────────────────────────────────────────

import { InventoryMigrationService } from '../src/agent/services/inventoryMigration';

// ─── Helpers ──────────────────────────────────────────────────────

function resetCollections() {
  for (const key of Object.keys(collections)) {
    collections[key].clear();
  }
  autoIdCounter = 0;
  mockBatchSet.mockClear();
  mockBatchCommit.mockClear();
}

function addWarehouse(id: string, data: any) {
  collections.warehouses.set(id, data);
}

function addItem(id: string, data: any) {
  collections.inventory_items.set(id, data);
}

function addTransaction(id: string, data: any) {
  collections.inventory_transactions.set(id, data);
}

function addV2Location(id: string, data: any) {
  collections.inventory_locations.set(id, data);
}

function addV2CatalogItem(id: string, data: any) {
  collections.inventory_catalog.set(id, data);
}

function addV2Transaction(id: string, data: any) {
  collections.inventory_transactions_v2.set(id, data);
}

// ─── Tests ────────────────────────────────────────────────────────

describe('InventoryMigrationService', () => {
  beforeEach(() => {
    resetCollections();
  });

  // ── Warehouse → Location Migration ───────────────────────────────

  describe('migrateWarehouses', () => {
    it('migrates physical warehouse to location with same ID', async () => {
      addWarehouse('wh1', {
        name: 'Main Warehouse',
        type: 'physical',
        address: '123 Main St',
        description: 'Primary storage',
        projectId: 'proj1',
        createdBy: 'user1',
        createdAt: '2026-01-01',
      });

      const result = await InventoryMigrationService.migrateWarehouses('admin');

      expect(result.migrated).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(mockBatchSet).toHaveBeenCalledTimes(1);

      // Verify the V2 doc structure
      const setCall = mockBatchSet.mock.calls[0];
      const v2Doc = setCall[1];
      expect(v2Doc.name).toBe('Main Warehouse');
      expect(v2Doc.type).toBe('physical');
      expect(v2Doc.address).toBe('123 Main St');
      expect(v2Doc.notes).toBe('Primary storage');
      expect(v2Doc.projectId).toBe('proj1');
      expect(v2Doc.checkedInBy).toBeNull();
      expect(v2Doc.migrationSourceId).toBe('wh1');
      expect(v2Doc.migrationSourceCollection).toBe('warehouses');
    });

    it('migrates vehicle warehouse with licensePlate', async () => {
      addWarehouse('van1', {
        name: 'Van #12',
        type: 'vehicle',
        licensePlate: 'ABC-123',
      });

      const result = await InventoryMigrationService.migrateWarehouses('admin');

      expect(result.migrated).toBe(1);
      const v2Doc = mockBatchSet.mock.calls[0][1];
      expect(v2Doc.type).toBe('vehicle');
      expect(v2Doc.licensePlate).toBe('ABC-123');
    });

    it('defaults vehicle without licensePlate to placeholder', async () => {
      addWarehouse('van2', { name: 'Old Van', type: 'vehicle' });

      await InventoryMigrationService.migrateWarehouses('admin');

      const v2Doc = mockBatchSet.mock.calls[0][1];
      expect(v2Doc.licensePlate).toBe('MIGRATED-NO-PLATE');
    });

    it('skips already migrated locations (idempotent)', async () => {
      addWarehouse('wh1', { name: 'Warehouse 1' });
      addV2Location('wh1', { name: 'Already exists' });

      const result = await InventoryMigrationService.migrateWarehouses('admin');

      expect(result.migrated).toBe(0);
      expect(result.skipped).toBe(1);
      expect(mockBatchSet).not.toHaveBeenCalled();
    });

    it('preserves archived flag', async () => {
      addWarehouse('wh_arch', { name: 'Archived', archived: true });

      await InventoryMigrationService.migrateWarehouses('admin');

      const v2Doc = mockBatchSet.mock.calls[0][1];
      expect(v2Doc.archived).toBe(true);
    });

    it('returns empty stats for no warehouses', async () => {
      const result = await InventoryMigrationService.migrateWarehouses('admin');
      expect(result.migrated).toBe(0);
      expect(result.skipped).toBe(0);
    });
  });

  // ── Item → Catalog Migration ────────────────────────────────────

  describe('migrateCatalogItems', () => {
    it('migrates item to catalog with stockByLocation', async () => {
      addItem('item1', {
        name: 'Wire 12AWG',
        warehouseId: 'wh1',
        quantity: 50,
        unit: 'ft',
        category: 'electrical',
        minStock: 10,
        barcode: 'BC123',
        photoUrl: 'https://example.com/photo.jpg',
        notes: 'Red wire',
        createdBy: 'user1',
      });

      const result = await InventoryMigrationService.migrateCatalogItems('admin');

      expect(result.migrated).toBe(1);
      const v2Doc = mockBatchSet.mock.calls[0][1];
      expect(v2Doc.name).toBe('Wire 12AWG');
      expect(v2Doc.sku).toBeNull();
      expect(v2Doc.barcodes).toEqual(['BC123']);
      expect(v2Doc.category).toBe('electrical');
      expect(v2Doc.unit).toBe('ft');
      expect(v2Doc.minStock).toBe(10);
      expect(v2Doc.stockByLocation).toEqual({ wh1: 50 });
      expect(v2Doc.totalStock).toBe(50);
      expect(v2Doc.avgPrice).toBe(0);
      expect(v2Doc.migrationSourceWarehouseId).toBe('wh1');
    });

    it('handles item with no barcode', async () => {
      addItem('item2', { name: 'Screws', warehouseId: 'wh1', quantity: 100 });

      await InventoryMigrationService.migrateCatalogItems('admin');

      const v2Doc = mockBatchSet.mock.calls[0][1];
      expect(v2Doc.barcodes).toEqual([]);
    });

    it('maps unknown category to "other"', async () => {
      addItem('item3', { name: 'Widget', warehouseId: 'wh1', quantity: 5, category: 'unknown_cat' });

      await InventoryMigrationService.migrateCatalogItems('admin');

      const v2Doc = mockBatchSet.mock.calls[0][1];
      expect(v2Doc.category).toBe('other');
    });

    it('maps valid V2 categories correctly', async () => {
      addItem('item4', { name: 'Cable Ties', warehouseId: 'wh1', quantity: 200, category: 'fasteners' });

      await InventoryMigrationService.migrateCatalogItems('admin');

      const v2Doc = mockBatchSet.mock.calls[0][1];
      expect(v2Doc.category).toBe('fasteners');
    });

    it('handles zero quantity', async () => {
      addItem('item5', { name: 'Empty', warehouseId: 'wh1', quantity: 0 });

      await InventoryMigrationService.migrateCatalogItems('admin');

      const v2Doc = mockBatchSet.mock.calls[0][1];
      expect(v2Doc.stockByLocation).toEqual({ wh1: 0 });
      expect(v2Doc.totalStock).toBe(0);
    });

    it('skips already migrated catalog items', async () => {
      addItem('item1', { name: 'Wire', warehouseId: 'wh1', quantity: 50 });
      addV2CatalogItem('item1', { name: 'Already exists' });

      const result = await InventoryMigrationService.migrateCatalogItems('admin');

      expect(result.migrated).toBe(0);
      expect(result.skipped).toBe(1);
    });
  });

  // ── Transaction Migration ───────────────────────────────────────

  describe('migrateTransactions', () => {
    it('maps "in" → "purchase"', async () => {
      addTransaction('tx1', {
        warehouseId: 'wh1',
        itemId: 'item1',
        type: 'in',
        quantity: 10,
        quantityBefore: 0,
        quantityAfter: 10,
        performedBy: 'user1',
      });

      const result = await InventoryMigrationService.migrateTransactions('admin');

      expect(result.migrated).toBe(1);
      const v2Doc = mockBatchSet.mock.calls[0][1];
      expect(v2Doc.type).toBe('purchase');
      expect(v2Doc.catalogItemId).toBe('item1');
      expect(v2Doc.locationId).toBe('wh1');
      expect(v2Doc.quantity).toBe(10);
      expect(v2Doc.source).toBe('proxy');
      expect(v2Doc.migrationSourceId).toBe('tx1');
    });

    it('maps "out" → "write_off"', async () => {
      addTransaction('tx2', {
        warehouseId: 'wh1',
        itemId: 'item1',
        type: 'out',
        quantity: 5,
        relatedTaskId: 'task1',
        normId: 'norm1',
      });

      await InventoryMigrationService.migrateTransactions('admin');

      const v2Doc = mockBatchSet.mock.calls[0][1];
      expect(v2Doc.type).toBe('write_off');
      expect(v2Doc.relatedTaskId).toBe('task1');
      expect(v2Doc.relatedNormId).toBe('norm1');
    });

    it('maps "transfer" → transfer_out + transfer_in pair', async () => {
      addTransaction('tx3', {
        warehouseId: 'wh1',
        itemId: 'item1',
        type: 'transfer',
        quantity: 20,
        toWarehouseId: 'van1',
      });

      const result = await InventoryMigrationService.migrateTransactions('admin');

      // Should create 2 V2 transactions
      expect(result.migrated).toBe(2);
      expect(mockBatchSet).toHaveBeenCalledTimes(2);

      const outDoc = mockBatchSet.mock.calls[0][1];
      const inDoc = mockBatchSet.mock.calls[1][1];

      expect(outDoc.type).toBe('transfer_out');
      expect(outDoc.locationId).toBe('wh1');
      expect(outDoc.toLocationId).toBe('van1');
      expect(outDoc.transactionGroupId).toBeDefined();

      expect(inDoc.type).toBe('transfer_in');
      expect(inDoc.locationId).toBe('van1'); // destination becomes location
      expect(inDoc.transactionGroupId).toBe(outDoc.transactionGroupId); // same group

      expect(outDoc.migrationSourceId).toBe('tx3');
      expect(inDoc.migrationSourceId).toBe('tx3_in');
    });

    it('skips already migrated transactions', async () => {
      addTransaction('tx1', { warehouseId: 'wh1', itemId: 'item1', type: 'in', quantity: 10 });
      addV2Transaction('v2tx1', { migrationSourceId: 'tx1' });

      const result = await InventoryMigrationService.migrateTransactions('admin');

      expect(result.migrated).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it('handles missing fields gracefully', async () => {
      addTransaction('tx_sparse', {
        warehouseId: 'wh1',
        itemId: 'item1',
        type: 'out',
        quantity: 3,
        // no relatedTaskId, normId, notes, performedBy
      });

      const result = await InventoryMigrationService.migrateTransactions('admin');

      expect(result.migrated).toBe(1);
      const v2Doc = mockBatchSet.mock.calls[0][1];
      expect(v2Doc.relatedTaskId).toBeNull();
      expect(v2Doc.relatedNormId).toBeNull();
      expect(v2Doc.notes).toBeNull();
      expect(v2Doc.performedBy).toBe('admin'); // fallback
    });
  });

  // ── Full Migration ──────────────────────────────────────────────

  describe('runMigration', () => {
    it('runs all three migrations and returns combined report', async () => {
      addWarehouse('wh1', { name: 'WH1', type: 'physical' });
      addItem('item1', { name: 'Wire', warehouseId: 'wh1', quantity: 50 });
      addTransaction('tx1', { warehouseId: 'wh1', itemId: 'item1', type: 'in', quantity: 50 });

      const result = await InventoryMigrationService.runMigration('admin');

      expect(result.locations.migrated).toBe(1);
      expect(result.catalog.migrated).toBe(1);
      expect(result.transactions.migrated).toBe(1);
      expect(result.totalDuration).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Dry Run ─────────────────────────────────────────────────────

  describe('dryRun', () => {
    it('reports counts without writing anything', async () => {
      addWarehouse('wh1', { name: 'WH1' });
      addWarehouse('wh2', { name: 'WH2' });
      addItem('item1', { name: 'Wire', warehouseId: 'wh1', quantity: 50 });
      addTransaction('tx1', { type: 'in', quantity: 50 });
      addV2Location('loc_existing', { name: 'Already migrated' });

      const report = await InventoryMigrationService.dryRun();

      expect(report.warehouses).toBe(2);
      expect(report.items).toBe(1);
      expect(report.transactions).toBe(1);
      expect(report.alreadyMigrated.locations).toBe(1);
    });
  });
});
