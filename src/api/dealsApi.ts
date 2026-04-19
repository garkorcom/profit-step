import { getAuth } from 'firebase/auth';

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

export type DealStage =
  | 'new' | 'survey_scheduled' | 'survey_done' | 'estimate_draft'
  | 'estimate_sent' | 'negotiation' | 'won' | 'lost';

export type DealStatus = 'open' | 'won' | 'lost';
export type DealPriority = 'low' | 'medium' | 'high';

export interface DealResource {
  id: string;
  clientId: string;
  clientName: string | null;
  title: string;
  stage: DealStage;
  status: DealStatus;
  value: { amount: number; currency: string } | null;
  priority: DealPriority;
  expectedCloseDate: string | null;
  actualCloseDate: string | null;
  lostReason: string | null;
  source: string | null;
  workAddress: string | null;
  notes: string | null;
  tags: string[];
  projectId: string | null;
  ownerId: string | null;
  createdAt: string | null;
}

export interface CreateDealInput {
  clientId: string;
  title?: string;
  pipelineId?: string;
  stage?: DealStage;
  value?: { amount: number; currency: string };
  priority?: DealPriority;
  expectedCloseDate?: string;
  source?: string;
  workAddress?: string;
  notes?: string;
  tags?: string[];
  idempotencyKey?: string;
}

export async function createDeal(input: CreateDealInput): Promise<{ dealId: string }> {
  const res = await fetch(`${getApiUrl()}/api/deals`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readErr(res));
  return (await res.json()) as { dealId: string };
}

export async function listDeals(params: { clientId?: string; status?: DealStatus; limit?: number } = {}): Promise<DealResource[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
  const url = `${getApiUrl()}/api/deals${qs.toString() ? `?${qs}` : ''}`;
  const res = await fetch(url, { headers: await authHeaders() });
  if (!res.ok) throw new Error(await readErr(res));
  const body = await res.json();
  return body.deals as DealResource[];
}

export async function updateDeal(
  id: string,
  patch: Partial<CreateDealInput> & {
    status?: DealStatus;
    stage?: DealStage;
    lostReason?: string;
    actualCloseDate?: string;
    projectId?: string;
  },
): Promise<void> {
  const res = await fetch(`${getApiUrl()}/api/deals/${id}`, {
    method: 'PATCH',
    headers: await authHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await readErr(res));
}
