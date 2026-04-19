/**
 * Maps WarehouseError codes to HTTP status codes.
 *
 * Used by route handlers to return consistent error payloads per
 * docs/warehouse/core/04_external_api/SPEC.md §7.
 */

import { Response } from 'express';
import { z } from 'zod';
import { isWarehouseError, WarehouseError, WarehouseErrorCode } from '../core/posting/errors';

const HTTP_STATUS_BY_CODE: Record<WarehouseErrorCode, number> = {
  VALIDATION_ERROR: 400,
  INVALID_UOM: 400,
  PROJECT_ID_REQUIRED: 400,
  DOCUMENT_NOT_FOUND: 404,
  ITEM_NOT_FOUND: 404,
  LOCATION_NOT_FOUND: 404,
  DOCUMENT_NOT_IN_POSTABLE_STATE: 409,
  DOCUMENT_NOT_EDITABLE: 409,
  DOCUMENT_ALREADY_VOIDED: 409,
  CANNOT_REVERSE_REVERSAL: 409,
  INSUFFICIENT_STOCK: 409,
  INSUFFICIENT_AVAILABLE_STOCK: 409,
  NEGATIVE_STOCK_BLOCKED: 409,
  IDEMPOTENCY_KEY_CONFLICT: 409,
  ITEM_INACTIVE: 409,
  LOCATION_INACTIVE: 409,
  TRANSFER_SAME_LOCATION: 409,
  UOM_CONVERSION_FAILED: 422,
  EMPTY_DOCUMENT: 422,
  INTERNAL_ERROR: 500,
};

export function httpStatusFor(code: WarehouseErrorCode): number {
  return HTTP_STATUS_BY_CODE[code] ?? 500;
}

/**
 * Translate an arbitrary error into a standard JSON response.
 *
 * WarehouseError → typed payload with its HTTP status.
 * ZodError       → 400 VALIDATION_ERROR with field details.
 * Anything else  → 500 INTERNAL_ERROR (logs go through regular route logger).
 */
export function sendWarehouseError(res: Response, err: unknown): void {
  if (isWarehouseError(err)) {
    res.status(httpStatusFor(err.code)).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details ?? null,
      },
    });
    return;
  }

  if (err instanceof z.ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request payload failed validation',
        details: { zodIssues: err.issues },
      },
    });
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message,
      details: null,
    },
  });
}

/**
 * Small helper so route code stays clean: wrap the handler body and catch.
 */
export function wrapRoute<T extends (...args: any[]) => Promise<void>>(fn: T): T {
  return (async (req: any, res: any, next: any) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      sendWarehouseError(res, err);
    }
  }) as T;
}

export { WarehouseError };
