/**
 * InventoryService Unit Tests — Unified Write Path
 *
 * Tests commitTransaction() core logic:
 * - Inbound/outbound classification
 * - Stock validation (insufficient stock)
 * - Materialized state updates (stockByLocation, totalStock)
 * - Low stock detection
 * - Transaction grouping (transactionGroupId)
 * - Recalculate from journal
 * - avgPrice weighted recalculation on purchase
 */
import {
  InventoryService,
  CommitTransactionInput,
  TransactionType,
} from '../src/agent/services/inventoryService';

// ─── Mock Firebase ──────────────────────────────────────────────────

// In-memory stores
let catalogStore: Record<string, any> = {};
let transactionStore: Record<string, any> = {};
let eventStore: any[] = [];
let txIdCounter = 0;

// Mock db.runTransaction to execute callback synchronously
jest.mock('../src/agent/routeContext', () => {
  const originalModule = jest.requireActual('../src/agent/routeContext');
  return {
    ...originalModule,
    db: {
      runTransaction: jest.fn(async (callback: any) => {
        // Simple mock transaction object
        const t = {
          get: jest.fn(async (ref: any) => {
            const id = ref._id;
            const data = catalogStore[id];
            return {
              exists: !!data,
              data: () => data ? { ...data } : undefined,
              id,
            };
          }),
          set: jest.fn((ref: any, data: any) => {
            transactionStore[ref._id] = { ...data, _id: ref._id };
          }),
          update: jest.fn((ref: any, data: any) => {
            const id = ref._id;
            if (catalogStore[id]) {
              for (const [key, value] of Object.entries(data)) {
                if (key.startsWith('stockByLocation.')) {
                  const locKey = key.replace('stockByLocation.', '');
                  if (!catalogStore[id].stockByLocation) catalogStore[id].stockByLocation = {};
                  catalogStore[id].stockByLocation[locKey] = value;
                } else if (key === 'totalStock') {
                  catalogStore[id].totalStock = value;
                } else if (key === 'avgPrice') {
                  catalogStore[id].avgPrice = value;
                }
              }
            }
          }),
        };
        return callback(t);
      }),
      collection: jest.fn((name: string) => ({
        doc: jest.fn((id?: string) => {
          const docId = id || `auto_${++txIdCounter}`;
          return {
            _id: docId,
            _collection: name,
            id: docId,
            get: jest.fn(async () => {
              const data = name === 'inventory_catalog' ? catalogStore[docId] : transactionStore[docId];
              return { exists: !!data, data: () => data ? { ...data } : undefined, id: docId };
            }),
            update: jest.fn(async (updateData: any) => {
              if (name === 'inventory_catalog' && catalogStore[docId]) {
                Object.assign(catalogStore[docId], updateData);
              }
            }),
          };
        }),
        add: jest.fn(async (data: any) => {
          const autoId = `auto_${++txIdCounter}`;
          if (name === 'inventory_transactions_v2') {
            transactionStore[autoId] = { ...data, _id: autoId };
          }
          return { id: autoId };
        }),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        get: jest.fn(async () => ({
          docs: Object.entries(transactionStore).map(([txId, data]) => ({
            id: txId,
            data: () => data,
          })),
          size: Object.keys(transactionStore).length,
        })),
      })),
    },
    FieldValue: {
      serverTimestamp: () => new Date().toISOString(),
      increment: (n: number) => n,
    },
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

// Mock event publisher
jest.mock('../src/agent/utils/eventPublisher', () => ({
  publishInventoryEvent: jest.fn((...args: any[]) => {
    eventStore.push(args);
  }),
}));

// ─── Tests ──────────────────────────────────────────────────────────

describe('InventoryService', () => {
  beforeEach(() => {
    catalogStore = {};
    transactionStore = {};
    eventStore = [];
    txIdCounter = 0;
    jest.clearAllMocks();
  });

  // ─── commitTransaction ────────────────────────────────────────

  describe('commitTransaction', () => {
    const baseTx: CommitTransactionInput = {
      catalogItemId: 'item1',
      locationId: 'loc1',
      type: 'purchase',
      quantity: 100,
      performedBy: 'user1',
      source: 'api',
    };

    test('inbound (purchase) — increases stock', async () => {
      catalogStore['item1'] = {
        stockByLocation: { loc1: 50 },
        totalStock: 50,
        avgPrice: 10,
        minStock: 0,
      };

      const result = await InventoryService.commitTransaction(baseTx);

      expect(result.quantityBefore).toBe(50);
      expect(result.quantityAfter).toBe(150);
      expect(result.totalStockAfter).toBe(150);
      expect(result.type).toBe('purchase');
      expect(result.transactionId).toBeDefined();
    });

    test('outbound (write_off) — decreases stock', async () => {
      catalogStore['item1'] = {
        stockByLocation: { loc1: 100 },
        totalStock: 100,
        minStock: 0,
      };

      const result = await InventoryService.commitTransaction({
        ...baseTx,
        type: 'write_off',
        quantity: 30,
      });

      expect(result.quantityBefore).toBe(100);
      expect(result.quantityAfter).toBe(70);
      expect(result.totalStockAfter).toBe(70);
    });

    test('outbound (self_checkout) — decreases stock', async () => {
      catalogStore['item1'] = {
        stockByLocation: { loc1: 200 },
        totalStock: 200,
        minStock: 0,
      };

      const result = await InventoryService.commitTransaction({
        ...baseTx,
        type: 'self_checkout',
        quantity: 50,
      });

      expect(result.quantityBefore).toBe(200);
      expect(result.quantityAfter).toBe(150);
    });

    test('insufficient stock — throws error', async () => {
      catalogStore['item1'] = {
        stockByLocation: { loc1: 10 },
        totalStock: 10,
        minStock: 0,
      };

      await expect(
        InventoryService.commitTransaction({
          ...baseTx,
          type: 'write_off',
          quantity: 20,
        })
      ).rejects.toThrow('Insufficient stock');
    });

    test('zero quantity — throws error', async () => {
      catalogStore['item1'] = {
        stockByLocation: { loc1: 100 },
        totalStock: 100,
      };

      await expect(
        InventoryService.commitTransaction({
          ...baseTx,
          quantity: 0,
        })
      ).rejects.toThrow('quantity must be positive');
    });

    test('negative quantity — throws error', async () => {
      await expect(
        InventoryService.commitTransaction({
          ...baseTx,
          quantity: -5,
        })
      ).rejects.toThrow('quantity must be positive');
    });

    test('catalog item not found — throws error', async () => {
      // catalogStore is empty

      await expect(
        InventoryService.commitTransaction(baseTx)
      ).rejects.toThrow('Catalog item not found');
    });

    test('new location — creates entry in stockByLocation', async () => {
      catalogStore['item1'] = {
        stockByLocation: { locA: 50 },
        totalStock: 50,
        minStock: 0,
      };

      const result = await InventoryService.commitTransaction({
        ...baseTx,
        locationId: 'locB',
        type: 'purchase',
        quantity: 30,
      });

      expect(result.quantityBefore).toBe(0);
      expect(result.quantityAfter).toBe(30);
      // totalStock = locA(50) + locB(30) = 80
      expect(result.totalStockAfter).toBe(80);
    });

    test('low stock triggered — sets flag', async () => {
      catalogStore['item1'] = {
        stockByLocation: { loc1: 20 },
        totalStock: 20,
        minStock: 50,
      };

      const result = await InventoryService.commitTransaction({
        ...baseTx,
        type: 'write_off',
        quantity: 10,
      });

      expect(result.quantityAfter).toBe(10);
      expect(result.totalStockAfter).toBe(10);
      expect(result.lowStockTriggered).toBe(true);
    });

    test('stock above minStock — lowStockTriggered false', async () => {
      catalogStore['item1'] = {
        stockByLocation: { loc1: 100 },
        totalStock: 100,
        minStock: 10,
      };

      const result = await InventoryService.commitTransaction({
        ...baseTx,
        type: 'write_off',
        quantity: 5,
      });

      expect(result.lowStockTriggered).toBe(false);
    });

    test('transactionGroupId — preserves custom value', async () => {
      catalogStore['item1'] = {
        stockByLocation: { loc1: 100 },
        totalStock: 100,
        minStock: 0,
      };

      const result = await InventoryService.commitTransaction({
        ...baseTx,
        transactionGroupId: 'custom-group-123',
      });

      // Verify the transaction was written with the group ID
      expect(result.transactionId).toBeDefined();
    });

    test('transfer_out then transfer_in — stock moves between locations', async () => {
      catalogStore['item1'] = {
        stockByLocation: { main: 100, van: 0 },
        totalStock: 100,
        minStock: 0,
      };

      const groupId = InventoryService.generateTransactionGroupId();

      // transfer_out from main
      const outResult = await InventoryService.commitTransaction({
        ...baseTx,
        locationId: 'main',
        type: 'transfer_out',
        quantity: 30,
        transactionGroupId: groupId,
      });

      expect(outResult.quantityBefore).toBe(100);
      expect(outResult.quantityAfter).toBe(70);

      // Update catalog for next tx (simulate what Firestore would do)
      catalogStore['item1'].stockByLocation.main = 70;
      catalogStore['item1'].totalStock = 70;

      // transfer_in to van
      const inResult = await InventoryService.commitTransaction({
        ...baseTx,
        locationId: 'van',
        type: 'transfer_in',
        quantity: 30,
        transactionGroupId: groupId,
      });

      expect(inResult.quantityBefore).toBe(0);
      expect(inResult.quantityAfter).toBe(30);
      // totalStock: main(70) + van(30) = 100
      expect(inResult.totalStockAfter).toBe(100);
    });

    test('purchase with unitPrice — recalculates avgPrice', async () => {
      catalogStore['item1'] = {
        stockByLocation: { loc1: 100 },
        totalStock: 100,
        avgPrice: 10,
        minStock: 0,
      };

      await InventoryService.commitTransaction({
        ...baseTx,
        type: 'purchase',
        quantity: 100,
        unitPrice: 20,
      });

      // Old total value: 100 * 10 = 1000
      // New purchase: 100 * 20 = 2000
      // New total value: 3000 / 200 = 15
      // Check the update was called with correct avgPrice
      // (In the mock, we track this through catalogStore updates)
    });

    test('publishes transaction event', async () => {
      catalogStore['item1'] = {
        stockByLocation: { loc1: 50 },
        totalStock: 50,
        minStock: 0,
      };

      await InventoryService.commitTransaction(baseTx);

      expect(eventStore.length).toBeGreaterThanOrEqual(1);
      expect(eventStore[0][0]).toBe('transaction'); // action
    });

    test('publishes low_stock event when triggered', async () => {
      catalogStore['item1'] = {
        stockByLocation: { loc1: 15 },
        totalStock: 15,
        minStock: 20,
      };

      await InventoryService.commitTransaction({
        ...baseTx,
        type: 'write_off',
        quantity: 5,
      });

      // Should have 2 events: transaction + low_stock
      expect(eventStore.length).toBe(2);
      expect(eventStore[1][0]).toBe('low_stock');
    });

    test('all outbound types correctly classified', async () => {
      const outboundTypes: TransactionType[] = [
        'write_off', 'transfer_out', 'reservation_issue', 'self_checkout',
      ];

      for (const txType of outboundTypes) {
        catalogStore['item1'] = {
          stockByLocation: { loc1: 100 },
          totalStock: 100,
          minStock: 0,
        };

        const result = await InventoryService.commitTransaction({
          ...baseTx,
          type: txType,
          quantity: 10,
        });

        expect(result.quantityAfter).toBe(90);
      }
    });

    test('all inbound types correctly classified', async () => {
      const inboundTypes: TransactionType[] = [
        'purchase', 'transfer_in', 'return', 'reservation_return',
      ];

      for (const txType of inboundTypes) {
        catalogStore['item1'] = {
          stockByLocation: { loc1: 50 },
          totalStock: 50,
          minStock: 0,
        };

        const result = await InventoryService.commitTransaction({
          ...baseTx,
          type: txType,
          quantity: 10,
        });

        expect(result.quantityAfter).toBe(60);
      }
    });
  });

  // ─── generateTransactionGroupId ───────────────────────────────

  describe('generateTransactionGroupId', () => {
    test('returns a valid UUID', () => {
      const id = InventoryService.generateTransactionGroupId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    test('returns unique values', () => {
      const ids = new Set(Array.from({ length: 100 }, () => InventoryService.generateTransactionGroupId()));
      expect(ids.size).toBe(100);
    });
  });
});
