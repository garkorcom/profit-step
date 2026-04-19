/**
 * Unit tests for Meeting Zod schemas.
 *
 * Contracts this file pins:
 *   - Required fields (clientId, type, startAt) reject on absence
 *   - Enum bounds on type/status
 *   - ISO-8601 validation on startAt/endAt
 *   - endAt >= startAt cross-field refine
 *   - UpdateMeetingSchema rejects empty bodies
 *   - Default status = 'scheduled' applied on create
 */

import {
  CreateMeetingSchema,
  UpdateMeetingSchema,
  ListMeetingsQuerySchema,
  MEETING_TYPES,
  MEETING_STATUSES,
} from '../src/agent/schemas/meetingSchemas';

describe('MEETING_TYPES / MEETING_STATUSES', () => {
  it('exports the canonical type tuple', () => {
    expect(MEETING_TYPES).toEqual([
      'first_contact',
      'site_survey',
      'estimate_review',
      'contract_signing',
      'site_visit',
      'stage_acceptance',
      'final_handover',
      'service',
    ]);
  });

  it('exports the canonical status tuple', () => {
    expect(MEETING_STATUSES).toEqual([
      'scheduled',
      'in_progress',
      'completed',
      'cancelled',
      'no_show',
    ]);
  });
});

describe('CreateMeetingSchema', () => {
  const baseValid = {
    clientId: 'client_1',
    type: 'site_survey',
    startAt: '2026-05-01T10:00:00.000Z',
  };

  it('accepts a minimal valid payload and defaults status to scheduled', () => {
    const result = CreateMeetingSchema.safeParse(baseValid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('scheduled');
      expect(result.data.attendees).toEqual([]);
      expect(result.data.clientAttendees).toEqual([]);
    }
  });

  it('rejects missing clientId', () => {
    const result = CreateMeetingSchema.safeParse({ type: 'site_survey', startAt: baseValid.startAt });
    expect(result.success).toBe(false);
  });

  it('rejects missing type', () => {
    const result = CreateMeetingSchema.safeParse({ clientId: 'x', startAt: baseValid.startAt });
    expect(result.success).toBe(false);
  });

  it('rejects missing startAt', () => {
    const result = CreateMeetingSchema.safeParse({ clientId: 'x', type: 'site_survey' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown type value', () => {
    const result = CreateMeetingSchema.safeParse({ ...baseValid, type: 'bogus' });
    expect(result.success).toBe(false);
  });

  it('rejects non-ISO startAt', () => {
    const result = CreateMeetingSchema.safeParse({ ...baseValid, startAt: 'tomorrow 3pm' });
    expect(result.success).toBe(false);
  });

  it('rejects endAt earlier than startAt', () => {
    const result = CreateMeetingSchema.safeParse({
      ...baseValid,
      endAt: '2026-04-30T09:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('accepts endAt equal to startAt (zero-duration meetings allowed)', () => {
    const result = CreateMeetingSchema.safeParse({
      ...baseValid,
      endAt: baseValid.startAt,
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional dealId and projectId', () => {
    const result = CreateMeetingSchema.safeParse({
      ...baseValid,
      dealId: 'deal_1',
      projectId: 'project_1',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dealId).toBe('deal_1');
      expect(result.data.projectId).toBe('project_1');
    }
  });

  it('accepts attendees with userId (internal) and without (external/client)', () => {
    const result = CreateMeetingSchema.safeParse({
      ...baseValid,
      attendees: [{ userId: 'uid_1', name: 'Denis', role: 'PM' }],
      clientAttendees: [{ name: 'Jim Dvorkin', email: 'jim@example.com' }],
    });
    expect(result.success).toBe(true);
  });
});

describe('UpdateMeetingSchema', () => {
  it('accepts a single-field update (outcome only)', () => {
    const result = UpdateMeetingSchema.safeParse({ outcome: 'Client signed the estimate' });
    expect(result.success).toBe(true);
  });

  it('rejects an empty body', () => {
    const result = UpdateMeetingSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('accepts status transition to completed (outcome check happens server-side)', () => {
    const result = UpdateMeetingSchema.safeParse({ status: 'completed' });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown status value', () => {
    const result = UpdateMeetingSchema.safeParse({ status: 'postponed' });
    expect(result.success).toBe(false);
  });
});

describe('ListMeetingsQuerySchema', () => {
  it('accepts no filters and applies defaults', () => {
    const result = ListMeetingsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(0);
    }
  });

  it('coerces string limit/offset from query params', () => {
    const result = ListMeetingsQuerySchema.safeParse({ limit: '10', offset: '20' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
      expect(result.data.offset).toBe(20);
    }
  });

  it('rejects limit > 200', () => {
    const result = ListMeetingsQuerySchema.safeParse({ limit: '500' });
    expect(result.success).toBe(false);
  });
});
