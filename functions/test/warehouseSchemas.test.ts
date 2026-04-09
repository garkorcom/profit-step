/**
 * Unit tests for warehouse Zod schemas in inventorySchemas.ts.
 *
 * Covers:
 *   - CreateWarehouseSchema: physical (default), vehicle (with refine),
 *     field requirements, defaults
 *   - UpdateWarehouseSchema: partial updates, at-least-one refine,
 *     nullable clientId/projectId (for unbinding)
 *   - WAREHOUSE_TYPES tuple export
 *
 * These tests are the contract between the frontend (which sends
 * create/update payloads) and the PATCH route guard (which re-checks
 * vehicle=>licensePlate on the merged state). Keep them in sync with
 * any schema changes.
 */

import {
  CreateWarehouseSchema,
  UpdateWarehouseSchema,
  WAREHOUSE_TYPES,
  WarehouseType,
} from '../src/agent/schemas/inventorySchemas';

describe('WAREHOUSE_TYPES', () => {
  it('exports the canonical type tuple', () => {
    expect(WAREHOUSE_TYPES).toEqual(['physical', 'vehicle']);
  });

  it('is readonly (tuple) — TS-level guarantee', () => {
    // Runtime check: attempting to mutate should not affect subsequent reads
    // (readonly const assertion freezes at type level)
    const copy: readonly WarehouseType[] = WAREHOUSE_TYPES;
    expect(copy.length).toBe(2);
  });
});

describe('CreateWarehouseSchema', () => {
  describe('physical warehouse (default type)', () => {
    it('accepts minimal payload — only name', () => {
      const result = CreateWarehouseSchema.safeParse({ name: 'Main Warehouse' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('physical'); // default applied
        expect(result.data.name).toBe('Main Warehouse');
      }
    });

    it('accepts full physical payload', () => {
      const result = CreateWarehouseSchema.safeParse({
        name: 'Brooklyn Storage',
        type: 'physical',
        address: '123 Main St, Brooklyn NY',
        description: 'Tools and materials',
        clientId: 'client_123',
        projectId: 'proj_456',
        idempotencyKey: 'abc-def-ghi',
      });
      expect(result.success).toBe(true);
    });

    it('accepts physical with licensePlate (ignored but not rejected)', () => {
      const result = CreateWarehouseSchema.safeParse({
        name: 'Warehouse with plate',
        type: 'physical',
        licensePlate: 'NY-ZZZ-0000',
      });
      expect(result.success).toBe(true);
    });

    it('accepts physical with explicit type=physical', () => {
      const result = CreateWarehouseSchema.safeParse({
        name: 'Explicit Physical',
        type: 'physical',
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.type).toBe('physical');
    });
  });

  describe('vehicle warehouse', () => {
    it('accepts vehicle with licensePlate', () => {
      const result = CreateWarehouseSchema.safeParse({
        name: 'Ford Transit #3',
        type: 'vehicle',
        licensePlate: 'NY-ABC-1234',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('vehicle');
        expect(result.data.licensePlate).toBe('NY-ABC-1234');
      }
    });

    it('accepts vehicle with licensePlate + location', () => {
      const result = CreateWarehouseSchema.safeParse({
        name: 'Ford Transit #3',
        type: 'vehicle',
        licensePlate: 'NY-ABC-1234',
        location: 'Garage at 456 Elm St',
      });
      expect(result.success).toBe(true);
    });

    it('rejects vehicle WITHOUT licensePlate', () => {
      const result = CreateWarehouseSchema.safeParse({
        name: 'Ford Transit #3',
        type: 'vehicle',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('licensePlate');
        expect(result.error.issues[0].message).toMatch(/licensePlate is required/i);
      }
    });

    it('rejects vehicle with EMPTY licensePlate', () => {
      const result = CreateWarehouseSchema.safeParse({
        name: 'Ford Transit #3',
        type: 'vehicle',
        licensePlate: '',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('licensePlate');
      }
    });

    it('rejects vehicle with null licensePlate', () => {
      const result = CreateWarehouseSchema.safeParse({
        name: 'Ford Transit #3',
        type: 'vehicle',
        licensePlate: null,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('validation errors', () => {
    it('rejects empty name', () => {
      const result = CreateWarehouseSchema.safeParse({ name: '' });
      expect(result.success).toBe(false);
    });

    it('rejects missing name', () => {
      const result = CreateWarehouseSchema.safeParse({ type: 'physical' });
      expect(result.success).toBe(false);
    });

    it('rejects unknown type', () => {
      const result = CreateWarehouseSchema.safeParse({
        name: 'Test',
        type: 'mobile' as unknown as WarehouseType,
      });
      expect(result.success).toBe(false);
    });

    it('rejects unknown type "truck"', () => {
      const result = CreateWarehouseSchema.safeParse({
        name: 'Test',
        type: 'truck' as unknown as WarehouseType,
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('UpdateWarehouseSchema', () => {
  describe('single-field updates', () => {
    it('accepts name only', () => {
      const result = UpdateWarehouseSchema.safeParse({ name: 'New Name' });
      expect(result.success).toBe(true);
    });

    it('accepts type only (vehicle refine NOT enforced here)', () => {
      const result = UpdateWarehouseSchema.safeParse({ type: 'vehicle' });
      expect(result.success).toBe(true);
      // Note: this is intentional — the PATCH route enforces
      // "vehicle => licensePlate" on the merged (existing + patch) state,
      // not on the patch alone. This allows setting type: 'vehicle' in
      // a separate call from setting licensePlate.
    });

    it('accepts licensePlate only', () => {
      const result = UpdateWarehouseSchema.safeParse({
        licensePlate: 'NY-ZZZ-0000',
      });
      expect(result.success).toBe(true);
    });

    it('accepts location only', () => {
      const result = UpdateWarehouseSchema.safeParse({
        location: 'Updated location',
      });
      expect(result.success).toBe(true);
    });

    it('accepts address only', () => {
      const result = UpdateWarehouseSchema.safeParse({ address: 'New addr' });
      expect(result.success).toBe(true);
    });

    it('accepts description only', () => {
      const result = UpdateWarehouseSchema.safeParse({
        description: 'Updated description',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('clientId/projectId nullable', () => {
    it('accepts null clientId for unbinding', () => {
      const result = UpdateWarehouseSchema.safeParse({ clientId: null });
      expect(result.success).toBe(true);
    });

    it('accepts null projectId for unbinding', () => {
      const result = UpdateWarehouseSchema.safeParse({ projectId: null });
      expect(result.success).toBe(true);
    });

    it('accepts string clientId', () => {
      const result = UpdateWarehouseSchema.safeParse({
        clientId: 'client_xyz',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('multi-field updates', () => {
    it('accepts name + type + licensePlate together', () => {
      const result = UpdateWarehouseSchema.safeParse({
        name: 'Ford Transit #5',
        type: 'vehicle',
        licensePlate: 'NY-QQQ-9999',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('refine: at least one field', () => {
    it('rejects completely empty object', () => {
      const result = UpdateWarehouseSchema.safeParse({});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toMatch(/at least one field/i);
      }
    });
  });

  describe('validation errors', () => {
    it('rejects empty name', () => {
      const result = UpdateWarehouseSchema.safeParse({ name: '' });
      expect(result.success).toBe(false);
    });

    it('rejects unknown type', () => {
      const result = UpdateWarehouseSchema.safeParse({
        type: 'unknown' as unknown as WarehouseType,
      });
      expect(result.success).toBe(false);
    });
  });
});
