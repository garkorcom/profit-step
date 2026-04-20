/**
 * Tests for Inventory Proxy — V1 → V2 dual-write adapter
 *
 * Covers:
 * - proxyTransactionToV2: in→purchase, out→write_off, transfer→pair
 * - proxyBulkTaskToV2: multiple items batch write-off
 * - proxyNormWriteOffToV2: norm-based write-off forwarding
 * - addDeprecationHeaders: RFC 8594 Sunset header
 * - Fire-and-forget: V2 errors don't propagate
 */

// ─── Mock InventoryService ────────────────────────────────────────

const mockCommitTransaction = jest.fn().mockResolvedValue({
  transactionId: 'v2_tx_1',
  catalogItemId: 'item1',
  locationId: 'wh1',
  type: 'write_off',
  quantity: 10,
  quantityBefore: 50,
  quantityAfter: 40,
  totalStockAfter: 40,
  lowStockTriggered: false,
});

const mockGenerateGroupId = jest.fn().mockReturnValue('group-uuid-123');

jest.mock('../src/agent/services/inventoryService', () => ({
  InventoryService: {
    commitTransaction: mockCommitTransaction,
    generateTransactionGroupId: mockGenerateGroupId,
  },
}));

jest.mock('../src/agent/routeContext', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// ─── Import after mocks ───────────────────────────────────────────

import {
  addDeprecationHeaders,
  proxyTransactionToV2,
  proxyBulkTaskToV2,
  proxyNormWriteOffToV2,
} from '../src/agent/services/inventoryProxy';

// ─── Tests ────────────────────────────────────────────────────────

describe('inventoryProxy', () => {
  beforeEach(() => {
    mockCommitTransaction.mockClear();
    mockGenerateGroupId.mockClear();
  });

  // ── addDeprecationHeaders ───────────────────────────────────────

  describe('addDeprecationHeaders', () => {
    it('sets Deprecation, Sunset, Link, and X-Deprecated-Endpoint headers', () => {
      const headers: Record<string, string> = {};
      const mockRes = {
        set: jest.fn((key: string, value: string) => { headers[key] = value; }),
      };

      addDeprecationHeaders(mockRes, 'POST /api/inventory/transactions');

      expect(mockRes.set).toHaveBeenCalledTimes(4);
      expect(headers['Deprecation']).toBe('true');
      expect(headers['Sunset']).toBeDefined();
      expect(headers['Link']).toBe('</api/inventory/v2/>; rel="successor-version"');
      expect(headers['X-Deprecated-Endpoint']).toBe('POST /api/inventory/transactions');
    });

    it('sets Sunset date ~60 days in the future', () => {
      const headers: Record<string, string> = {};
      const mockRes = { set: jest.fn((k: string, v: string) => { headers[k] = v; }) };

      addDeprecationHeaders(mockRes, 'test');

      const sunsetDate = new Date(headers['Sunset']);
      const now = new Date();
      const diffDays = (sunsetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(58);
      expect(diffDays).toBeLessThan(62);
    });
  });

  // ── proxyTransactionToV2 ────────────────────────────────────────

  describe('proxyTransactionToV2', () => {
    it('proxies "in" as "purchase" to V2', async () => {
      await proxyTransactionToV2({
        warehouseId: 'wh1',
        itemId: 'item1',
        type: 'in',
        quantity: 25,
        performedBy: 'user1',
        notes: 'received shipment',
      });

      expect(mockCommitTransaction).toHaveBeenCalledTimes(1);
      expect(mockCommitTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          catalogItemId: 'item1',
          locationId: 'wh1',
          type: 'purchase',
          quantity: 25,
          source: 'proxy',
          performedBy: 'user1',
          notes: '[proxy] received shipment',
        })
      );
    });

    it('proxies "out" as "write_off" to V2', async () => {
      await proxyTransactionToV2({
        warehouseId: 'wh1',
        itemId: 'item1',
        type: 'out',
        quantity: 5,
        relatedTaskId: 'task1',
        performedBy: 'worker1',
      });

      expect(mockCommitTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'write_off',
          quantity: 5,
          relatedTaskId: 'task1',
        })
      );
    });

    it('proxies "transfer" as transfer_out + transfer_in pair', async () => {
      await proxyTransactionToV2({
        warehouseId: 'wh1',
        itemId: 'item1',
        type: 'transfer',
        quantity: 15,
        toWarehouseId: 'van1',
        performedBy: 'worker1',
      });

      expect(mockGenerateGroupId).toHaveBeenCalledTimes(1);
      expect(mockCommitTransaction).toHaveBeenCalledTimes(2);

      // First call: transfer_out from source
      expect(mockCommitTransaction.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          catalogItemId: 'item1',
          locationId: 'wh1',
          type: 'transfer_out',
          quantity: 15,
          toLocationId: 'van1',
          transactionGroupId: 'group-uuid-123',
        })
      );

      // Second call: transfer_in to destination
      expect(mockCommitTransaction.mock.calls[1][0]).toEqual(
        expect.objectContaining({
          catalogItemId: 'item1',
          locationId: 'van1',
          type: 'transfer_in',
          quantity: 15,
          transactionGroupId: 'group-uuid-123',
        })
      );
    });

    it('does NOT throw when V2 write fails (fire-and-forget)', async () => {
      mockCommitTransaction.mockRejectedValueOnce(new Error('V2 service down'));

      // Should NOT throw
      await expect(proxyTransactionToV2({
        warehouseId: 'wh1',
        itemId: 'item1',
        type: 'out',
        quantity: 5,
        performedBy: 'user1',
      })).resolves.toBeUndefined();
    });

    it('adds default notes when none provided', async () => {
      await proxyTransactionToV2({
        warehouseId: 'wh1',
        itemId: 'item1',
        type: 'in',
        quantity: 10,
        performedBy: 'user1',
      });

      expect(mockCommitTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          notes: '[proxy] V1 in',
        })
      );
    });
  });

  // ── proxyBulkTaskToV2 ──────────────────────────────────────────

  describe('proxyBulkTaskToV2', () => {
    it('creates write_off for each item in batch', async () => {
      await proxyBulkTaskToV2(
        'wh1',
        'task1',
        [
          { itemId: 'item1', quantity: 10 },
          { itemId: 'item2', quantity: 5, notes: 'partial' },
        ],
        'worker1',
      );

      expect(mockCommitTransaction).toHaveBeenCalledTimes(2);

      expect(mockCommitTransaction.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          catalogItemId: 'item1',
          locationId: 'wh1',
          type: 'write_off',
          quantity: 10,
          relatedTaskId: 'task1',
          source: 'proxy',
        })
      );

      expect(mockCommitTransaction.mock.calls[1][0]).toEqual(
        expect.objectContaining({
          catalogItemId: 'item2',
          quantity: 5,
          notes: '[proxy] partial',
        })
      );
    });

    it('continues processing remaining items when one fails', async () => {
      mockCommitTransaction
        .mockRejectedValueOnce(new Error('item1 failed'))
        .mockResolvedValueOnce({});

      await proxyBulkTaskToV2(
        'wh1',
        'task1',
        [
          { itemId: 'item1', quantity: 10 },
          { itemId: 'item2', quantity: 5 },
        ],
        'worker1',
      );

      // Both should be attempted
      expect(mockCommitTransaction).toHaveBeenCalledTimes(2);
    });
  });

  // ── proxyNormWriteOffToV2 ──────────────────────────────────────

  describe('proxyNormWriteOffToV2', () => {
    it('creates write_off for each norm item with correct quantities', async () => {
      await proxyNormWriteOffToV2(
        'wh1',
        'task1',
        'norm_outlet',
        [
          { itemId: 'wire', quantity: 30 },  // 10ft per station × 3 stations
          { itemId: 'outlet', quantity: 3 },  // 1 per station × 3
        ],
        'worker1',
      );

      expect(mockCommitTransaction).toHaveBeenCalledTimes(2);

      expect(mockCommitTransaction.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          catalogItemId: 'wire',
          locationId: 'wh1',
          type: 'write_off',
          quantity: 30,
          relatedTaskId: 'task1',
          relatedNormId: 'norm_outlet',
          source: 'proxy',
          notes: '[proxy] V1 norm write-off (normId: norm_outlet)',
        })
      );

      expect(mockCommitTransaction.mock.calls[1][0]).toEqual(
        expect.objectContaining({
          catalogItemId: 'outlet',
          quantity: 3,
          relatedNormId: 'norm_outlet',
        })
      );
    });

    it('does not throw when V2 norm write fails', async () => {
      mockCommitTransaction.mockRejectedValue(new Error('V2 down'));

      await expect(proxyNormWriteOffToV2(
        'wh1', 'task1', 'norm1',
        [{ itemId: 'item1', quantity: 5 }],
        'worker1',
      )).resolves.toBeUndefined();
    });
  });
});
