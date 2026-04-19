import { z } from 'zod';

// ─── Meeting Schemas ────────────────────────────────────────────────
//
// Spec: CRM_OVERHAUL_SPEC_V1.md §5.3 — Meeting is a first-class entity attached
// to Client (always), and optionally to Deal or Project. Types cover the whole
// lifecycle from first contact through warranty service.

export const MEETING_TYPES = [
  'first_contact',    // первый контакт
  'site_survey',      // замер
  'estimate_review',  // презентация КП
  'contract_signing', // подписание
  'site_visit',       // выезд на объект (в ходе работ)
  'stage_acceptance', // приёмка этапа
  'final_handover',   // финальная сдача
  'service',          // сервисное обслуживание / гарантия
] as const;

export type MeetingType = (typeof MEETING_TYPES)[number];

export const MEETING_STATUSES = [
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
] as const;

export type MeetingStatus = (typeof MEETING_STATUSES)[number];

const AttendeeSchema = z.object({
  // uid for internal employees, null/undefined for external client attendees
  userId: z.string().optional(),
  name: z.string().min(1),
  role: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
});

/**
 * Create schema. `clientId` is required — Meeting without a client is meaningless.
 * `dealId` / `projectId` optional — meeting can be tied to a sale (Deal), to an
 * active project (Project), or neither (freestanding outreach).
 */
export const CreateMeetingSchema = z.object({
  clientId: z.string().min(1),
  dealId: z.string().optional(),
  projectId: z.string().optional(),
  type: z.enum(MEETING_TYPES),
  title: z.string().min(1).optional(),
  status: z.enum(MEETING_STATUSES).default('scheduled'),
  startAt: z.string().datetime(),
  endAt: z.string().datetime().optional(),
  location: z.string().optional(),
  attendees: z.array(AttendeeSchema).default([]),
  clientAttendees: z.array(AttendeeSchema).default([]),
  agenda: z.string().optional(),
  calendarEventId: z.string().optional(),
  idempotencyKey: z.string().optional(),
}).refine(
  data => !data.endAt || new Date(data.endAt).getTime() >= new Date(data.startAt).getTime(),
  { message: 'endAt must be >= startAt', path: ['endAt'] },
);

/**
 * Update schema — partial. `outcome` field is the key gate: spec §5.4 requires
 * outcome to be filled after a meeting before its Deal can progress further.
 * Enforcement of that gate lives in the Deal stage-transition logic (to build
 * in a later slice); this schema just accepts the field.
 */
export const UpdateMeetingSchema = z.object({
  type: z.enum(MEETING_TYPES).optional(),
  title: z.string().min(1).optional(),
  status: z.enum(MEETING_STATUSES).optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  location: z.string().optional(),
  attendees: z.array(AttendeeSchema).optional(),
  clientAttendees: z.array(AttendeeSchema).optional(),
  agenda: z.string().optional(),
  outcome: z.string().optional(),
  nextSteps: z.string().optional(),
  calendarEventId: z.string().optional(),
}).refine(
  data => Object.keys(data).length > 0,
  { message: 'At least one field required' },
);

export const ListMeetingsQuerySchema = z.object({
  clientId: z.string().optional(),
  dealId: z.string().optional(),
  projectId: z.string().optional(),
  type: z.enum(MEETING_TYPES).optional(),
  status: z.enum(MEETING_STATUSES).optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  limit: z.coerce.number().min(1).max(200).default(50),
  offset: z.coerce.number().min(0).default(0),
});
