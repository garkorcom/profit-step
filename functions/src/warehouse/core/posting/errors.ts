/**
 * Warehouse error taxonomy.
 *
 * All errors from the posting engine are instances of WarehouseError with
 * a stable `code`. The route layer maps codes → HTTP status (see
 * docs/warehouse/core/04_external_api/SPEC.md §7).
 */

export type WarehouseErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_UOM'
  | 'PROJECT_ID_REQUIRED'
  | 'DOCUMENT_NOT_FOUND'
  | 'DOCUMENT_NOT_IN_POSTABLE_STATE'
  | 'DOCUMENT_NOT_EDITABLE'
  | 'DOCUMENT_ALREADY_VOIDED'
  | 'CANNOT_REVERSE_REVERSAL'
  | 'INSUFFICIENT_STOCK'
  | 'INSUFFICIENT_AVAILABLE_STOCK'
  | 'NEGATIVE_STOCK_BLOCKED'
  | 'IDEMPOTENCY_KEY_CONFLICT'
  | 'UOM_CONVERSION_FAILED'
  | 'EMPTY_DOCUMENT'
  | 'ITEM_INACTIVE'
  | 'ITEM_NOT_FOUND'
  | 'LOCATION_NOT_FOUND'
  | 'LOCATION_INACTIVE'
  | 'TRANSFER_SAME_LOCATION'
  | 'INTERNAL_ERROR';

export class WarehouseError extends Error {
  constructor(
    public readonly code: WarehouseErrorCode,
    message?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message ?? code);
    this.name = 'WarehouseError';
    // Preserve prototype chain across ts-jest / Node boundary.
    Object.setPrototypeOf(this, WarehouseError.prototype);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details ?? null,
    };
  }
}

export function isWarehouseError(e: unknown): e is WarehouseError {
  return e instanceof WarehouseError;
}
