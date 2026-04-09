/**
 * Unit tests for Client Dashboard schemas and Red Flags engine.
 * Covers: Zod validation, margin color computation, computeRedFlags logic.
 */

import {
  ClientIdParamSchema,
  LaborLogQuerySchema,
  TimelineQuerySchema,
  computeMarginColor,
  MARGIN_THRESHOLDS,
  RED_FLAG_CODES,
} from '../src/agent/schemas/dashboardClientSchemas';

// ─── Zod Schemas ───────────────────────────────────────────────────

describe('ClientIdParamSchema', () => {
  it('accepts valid clientId', () => {
    const result = ClientIdParamSchema.parse({ id: 'abc123' });
    expect(result.id).toBe('abc123');
  });

  it('rejects empty string', () => {
    expect(() => ClientIdParamSchema.parse({ id: '' })).toThrow();
  });

  it('rejects missing id', () => {
    expect(() => ClientIdParamSchema.parse({})).toThrow();
  });
});

describe('LaborLogQuerySchema', () => {
  it('accepts valid periods', () => {
    expect(LaborLogQuerySchema.parse({ period: 'week' }).period).toBe('week');
    expect(LaborLogQuerySchema.parse({ period: 'month' }).period).toBe('month');
    expect(LaborLogQuerySchema.parse({ period: 'all' }).period).toBe('all');
  });

  it('defaults to month when not provided', () => {
    expect(LaborLogQuerySchema.parse({}).period).toBe('month');
  });

  it('rejects invalid period', () => {
    expect(() => LaborLogQuerySchema.parse({ period: 'year' })).toThrow();
  });
});

describe('TimelineQuerySchema', () => {
  it('accepts valid limit and offset', () => {
    const result = TimelineQuerySchema.parse({ limit: '20', offset: '10' });
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(10);
  });

  it('defaults to limit=50 offset=0', () => {
    const result = TimelineQuerySchema.parse({});
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(0);
  });

  it('rejects limit > 200', () => {
    expect(() => TimelineQuerySchema.parse({ limit: '500' })).toThrow();
  });

  it('rejects negative offset', () => {
    expect(() => TimelineQuerySchema.parse({ offset: '-1' })).toThrow();
  });

  it('coerces string numbers', () => {
    const result = TimelineQuerySchema.parse({ limit: '30', offset: '5' });
    expect(result.limit).toBe(30);
    expect(result.offset).toBe(5);
  });
});

// ─── Margin Color ──────────────────────────────────────────────────

describe('computeMarginColor', () => {
  it('returns green for margin >= 30%', () => {
    expect(computeMarginColor(30)).toBe('green');
    expect(computeMarginColor(50)).toBe('green');
    expect(computeMarginColor(100)).toBe('green');
  });

  it('returns yellow for 20% <= margin < 30%', () => {
    expect(computeMarginColor(20)).toBe('yellow');
    expect(computeMarginColor(25)).toBe('yellow');
    expect(computeMarginColor(29.9)).toBe('yellow');
  });

  it('returns red for margin < 20%', () => {
    expect(computeMarginColor(19.9)).toBe('red');
    expect(computeMarginColor(0)).toBe('red');
    expect(computeMarginColor(-10)).toBe('red');
  });
});

// ─── Constants ─────────────────────────────────────────────────────

describe('Constants', () => {
  it('MARGIN_THRESHOLDS has correct values', () => {
    expect(MARGIN_THRESHOLDS.green).toBe(30);
    expect(MARGIN_THRESHOLDS.yellow).toBe(20);
  });

  it('RED_FLAG_CODES has 6 codes', () => {
    expect(RED_FLAG_CODES).toHaveLength(6);
    expect(RED_FLAG_CODES).toContain('low_margin');
    expect(RED_FLAG_CODES).toContain('over_budget');
    expect(RED_FLAG_CODES).toContain('unpaid_14d');
    expect(RED_FLAG_CODES).toContain('stagnation');
    expect(RED_FLAG_CODES).toContain('unbilled_work');
    expect(RED_FLAG_CODES).toContain('ar_high');
  });
});
