/**
 * Meetings API — thin wrapper around /api/meetings agent endpoints.
 * See functions/src/agent/routes/meetings.ts for the backend contract.
 *
 * All calls require Firebase Auth. UI surfaces pass Meeting entities in/out;
 * ISO-8601 strings are the wire format for timestamps.
 */

import { getAuth } from 'firebase/auth';
import {
  Meeting,
  CreateMeetingInput,
  UpdateMeetingInput,
  ListMeetingsParams,
} from '../types/meeting.types';

const getApiUrl = (): string =>
  import.meta.env.VITE_FIREBASE_FUNCTIONS_URL ||
  'https://us-central1-profit-step.cloudfunctions.net/agentApi';

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAuth().currentUser?.getIdToken();
  if (!token) throw new Error('Not authenticated');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function readErr(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body.error || body.message || res.statusText;
  } catch {
    return res.statusText;
  }
}

export async function listMeetings(params: ListMeetingsParams = {}): Promise<Meeting[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const url = `${getApiUrl()}/api/meetings${qs.toString() ? `?${qs}` : ''}`;
  const res = await fetch(url, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`listMeetings: ${await readErr(res)}`);
  const body = await res.json();
  return body.meetings as Meeting[];
}

export async function getMeeting(id: string): Promise<Meeting> {
  const res = await fetch(`${getApiUrl()}/api/meetings/${id}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`getMeeting: ${await readErr(res)}`);
  return (await res.json()) as Meeting;
}

export async function createMeeting(input: CreateMeetingInput): Promise<{ meetingId: string }> {
  const res = await fetch(`${getApiUrl()}/api/meetings`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`createMeeting: ${await readErr(res)}`);
  return (await res.json()) as { meetingId: string };
}

export async function updateMeeting(id: string, input: UpdateMeetingInput): Promise<void> {
  const res = await fetch(`${getApiUrl()}/api/meetings/${id}`, {
    method: 'PATCH',
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`updateMeeting: ${await readErr(res)}`);
}

export async function cancelMeeting(id: string): Promise<void> {
  const res = await fetch(`${getApiUrl()}/api/meetings/${id}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`cancelMeeting: ${await readErr(res)}`);
}
