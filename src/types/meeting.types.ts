/**
 * Meeting type definitions — mirrors functions/src/agent/schemas/meetingSchemas.ts.
 * Kept in sync with the backend by convention; add matching entries here whenever
 * MEETING_TYPES / MEETING_STATUSES change on the backend.
 *
 * Spec: docs/tasks/CRM_OVERHAUL_SPEC_V1.md §5.3.
 */

export type MeetingType =
  | 'first_contact'
  | 'site_survey'
  | 'estimate_review'
  | 'contract_signing'
  | 'site_visit'
  | 'stage_acceptance'
  | 'final_handover'
  | 'service';

export type MeetingStatus =
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export const MEETING_TYPE_LABELS: Record<MeetingType, string> = {
  first_contact: 'Первый контакт',
  site_survey: 'Замер',
  estimate_review: 'Презентация КП',
  contract_signing: 'Подписание',
  site_visit: 'Выезд',
  stage_acceptance: 'Приёмка этапа',
  final_handover: 'Финальная сдача',
  service: 'Сервис',
};

export const MEETING_STATUS_LABELS: Record<MeetingStatus, string> = {
  scheduled: 'Запланирована',
  in_progress: 'В процессе',
  completed: 'Завершена',
  cancelled: 'Отменена',
  no_show: 'Не явился',
};

export interface MeetingAttendee {
  userId?: string;
  name: string;
  role?: string;
  phone?: string;
  email?: string;
}

export interface Meeting {
  id: string;
  clientId: string;
  clientName?: string | null;
  companyId?: string | null;
  dealId?: string | null;
  projectId?: string | null;
  type: MeetingType;
  title?: string | null;
  status: MeetingStatus;
  startAt: string; // ISO-8601
  endAt?: string | null;
  location?: string | null;
  attendees: MeetingAttendee[];
  clientAttendees: MeetingAttendee[];
  agenda?: string | null;
  outcome?: string | null;
  nextSteps?: string | null;
  calendarEventId?: string | null;
  createdBy?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  cancelledAt?: string | null;
}

export interface CreateMeetingInput {
  clientId: string;
  dealId?: string;
  projectId?: string;
  type: MeetingType;
  title?: string;
  status?: MeetingStatus;
  startAt: string;
  endAt?: string;
  location?: string;
  attendees?: MeetingAttendee[];
  clientAttendees?: MeetingAttendee[];
  agenda?: string;
  idempotencyKey?: string;
}

export interface UpdateMeetingInput {
  type?: MeetingType;
  title?: string;
  status?: MeetingStatus;
  startAt?: string;
  endAt?: string;
  location?: string;
  attendees?: MeetingAttendee[];
  clientAttendees?: MeetingAttendee[];
  agenda?: string;
  outcome?: string;
  nextSteps?: string;
  calendarEventId?: string;
}

export interface ListMeetingsParams {
  clientId?: string;
  dealId?: string;
  projectId?: string;
  type?: MeetingType;
  status?: MeetingStatus;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}
