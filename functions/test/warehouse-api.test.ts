/**
 * Unit tests for the warehouse API surface that don't need Firestore.
 *
 * - error-code → HTTP mapping
 * - sendWarehouseError response shape
 * - router structure (no mounting errors at import time)
 */

import { Router } from 'express';
import { httpStatusFor, sendWarehouseError } from '../src/warehouse/api/errorHandler';
import { WarehouseError } from '../src/warehouse/core/posting/errors';
import warehouseRouter from '../src/warehouse/api/routes';
import { z } from 'zod';

describe('httpStatusFor', () => {
  it.each([
    ['VALIDATION_ERROR', 400],
    ['INVALID_UOM', 400],
    ['PROJECT_ID_REQUIRED', 400],
    ['DOCUMENT_NOT_FOUND', 404],
    ['ITEM_NOT_FOUND', 404],
    ['DOCUMENT_NOT_IN_POSTABLE_STATE', 409],
    ['INSUFFICIENT_STOCK', 409],
    ['NEGATIVE_STOCK_BLOCKED', 409],
    ['CANNOT_REVERSE_REVERSAL', 409],
    ['UOM_CONVERSION_FAILED', 422],
    ['EMPTY_DOCUMENT', 422],
    ['INTERNAL_ERROR', 500],
  ] as const)('%s → %d', (code, status) => {
    expect(httpStatusFor(code)).toBe(status);
  });
});

describe('sendWarehouseError', () => {
  function mockRes() {
    const calls: Array<{ status: number; body: unknown }> = [];
    let pendingStatus = 200;
    const res = {
      status(code: number) {
        pendingStatus = code;
        return this;
      },
      json(body: unknown) {
        calls.push({ status: pendingStatus, body });
        return this;
      },
    } as any;
    return { res, calls };
  }

  it('serializes WarehouseError with code + details', () => {
    const { res, calls } = mockRes();
    sendWarehouseError(res, new WarehouseError('INSUFFICIENT_STOCK', 'Only 3 left', { available: 3 }));
    expect(calls[0].status).toBe(409);
    expect(calls[0].body).toEqual({
      error: { code: 'INSUFFICIENT_STOCK', message: 'Only 3 left', details: { available: 3 } },
    });
  });

  it('serializes ZodError as VALIDATION_ERROR 400', () => {
    const schema = z.object({ x: z.number() });
    const parsed = schema.safeParse({ x: 'nope' });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const { res, calls } = mockRes();
    sendWarehouseError(res, parsed.error);
    expect(calls[0].status).toBe(400);
    expect((calls[0].body as any).error.code).toBe('VALIDATION_ERROR');
    expect((calls[0].body as any).error.details.zodIssues).toBeDefined();
  });

  it('falls back to INTERNAL_ERROR for unknown', () => {
    const { res, calls } = mockRes();
    sendWarehouseError(res, new Error('whoops'));
    expect(calls[0].status).toBe(500);
    expect((calls[0].body as any).error.code).toBe('INTERNAL_ERROR');
    expect((calls[0].body as any).error.message).toBe('whoops');
  });
});

describe('warehouseRouter structure', () => {
  it('is an Express router', () => {
    expect(warehouseRouter).toBeDefined();
    expect(typeof warehouseRouter).toBe('function'); // Express router is a function with a stack
    // Sanity: should have mounted sub-routers (stack grows as routes register)
    expect((warehouseRouter as unknown as { stack: unknown[] }).stack?.length ?? 0).toBeGreaterThan(0);
  });

  it('is compatible with `app.use`', () => {
    const app = Router();
    expect(() => app.use(warehouseRouter)).not.toThrow();
  });
});
