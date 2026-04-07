/**
 * Portal visibility filter — security boundary for the client portal.
 *
 * Pure function that transforms full internal client data into a strictly
 * filtered subset safe to expose via GET /api/portal/:slug.
 *
 * ⚠️ THIS FILE IS THE SECURITY BOUNDARY. Every field in the output type
 * is an explicit allow-list. Adding new fields to Client / Estimate /
 * etc. WILL NOT automatically propagate here. That's intentional — the
 * default for new data is "not visible to client", and an explicit
 * decision must be made to expose it.
 *
 * Unit tests in functions/test/portalFilter.test.ts MUST cover every
 * known internal field and assert it's absent from the result.
 *
 * See src/pages/dashbord-for-client/SPEC.md §3 for the full architecture.
 */

// ─── Input types (internal, full data) ────────────────────────────────

export interface InternalClient {
  id: string;
  name: string;
  type?: 'person' | 'company';
  address?: string;
  workLocation?: { address?: string; latitude?: number; longitude?: number };
  contacts?: Array<{
    id?: string;
    name?: string;
    email?: string;
    phone?: string;
    position?: string;
  }>;
  // ─── Internal fields that MUST be stripped ──
  email?: string;
  phone?: string;
  status?: string;
  tags?: string[];
  services?: string[];
  industry?: string;
  source?: string;
  sourceName?: string;
  sourceType?: string;
  totalRevenue?: number;
  assignedTo?: string;
  createdBy?: string;
  lastContactedAt?: unknown;
  customFields?: Record<string, unknown>;
  // Allow any other field — unknown fields default to stripped (not
  // passed through), because the output type explicitly enumerates
  // what's kept.
  [key: string]: unknown;
}

export interface InternalEstimateItem {
  id?: string;
  description?: string;
  name?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  total?: number;
  notes?: string;
  // ─── Internal-only fields (MUST be stripped) ──
  unitCostPrice?: number;
  totalCost?: number;
  laborCost?: number;
  hourlyRate?: number;
  plannedHours?: number;
  subcontractorName?: string;
  subcontractCost?: number;
  catalogItemId?: string;
  type?: string;
  [key: string]: unknown;
}

export interface InternalEstimate {
  id: string;
  number?: string;
  status?: string;
  estimateType?: 'internal' | 'commercial';
  total?: number;
  notes?: string;
  items?: InternalEstimateItem[];
  clientItems?: InternalEstimateItem[];
  internalItems?: InternalEstimateItem[];
  // ─── Internal-only fields (MUST be stripped) ──
  internalTotal?: number;
  internalSubtotal?: number;
  internalLaborCost?: number;
  internalSubcontractCost?: number;
  totalMarkup?: number;
  marginPercent?: number;
  approvalDate?: unknown;
  approvedBy?: string;
  lockedBy?: string;
  lockReason?: string;
  [key: string]: unknown;
}

export interface InternalProject {
  id: string;
  name?: string;
  status?: string;
  [key: string]: unknown;
}

export interface InternalTask {
  id: string;
  title?: string;
  status?: string;
  priority?: string;
  context?: string;
  description?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  dueDate?: unknown;
  clientVisible?: boolean;
  [key: string]: unknown;
}

export interface InternalLedgerEntry {
  id: string;
  type?: 'credit' | 'debit';
  amount?: number;
  description?: string;
  date?: unknown;
  category?: string;
  [key: string]: unknown;
}

export interface InternalPhoto {
  name: string;
  url: string;
  category?: 'render' | 'progress' | 'before';
  visibility?: 'internal' | 'public';
  [key: string]: unknown;
}

export interface InternalDashboardData {
  client: InternalClient;
  projects: InternalProject[];
  estimates: InternalEstimate[];
  tasks: InternalTask[];
  ledger: InternalLedgerEntry[];
  photos: InternalPhoto[];
}

// ─── Output types (portal-safe, explicit allow-list) ──────────────────

export interface PortalEstimateItem {
  id: string | null;
  description: string;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  total: number | null;
  notes: string | null;
}

export interface PortalEstimate {
  id: string;
  number: string | null;
  status: string | null;
  total: number | null;
  notes: string | null;
  items: PortalEstimateItem[];
}

export interface PortalProject {
  id: string;
  name: string | null;
  status: string | null;
}

export interface PortalTask {
  id: string;
  title: string | null;
  status: string | null;
  context: string | null;
  description: string | null;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface PortalLedgerEntry {
  id: string;
  type: 'credit' | 'debit' | null;
  amount: number | null;
  description: string | null;
  date: unknown;
}

export interface PortalPhoto {
  name: string;
  url: string;
  category: 'render' | 'progress' | 'before' | null;
}

export interface PortalClient {
  id: string;
  name: string;
  address: string | null;
  projectAddress: string | null;
  contactName: string | null;
}

export interface PortalData {
  client: PortalClient;
  projects: PortalProject[];
  estimates: PortalEstimate[];
  tasks: PortalTask[];
  ledger: PortalLedgerEntry[];
  photos: PortalPhoto[];
}

// ─── Filter functions ────────────────────────────────────────────────

/**
 * Strip an estimate item to only portal-safe fields.
 * Explicit allow-list: only the fields below are copied. All other
 * fields (unitCostPrice, totalCost, subcontractor*, laborCost, etc.)
 * are dropped.
 */
export function filterEstimateItem(item: InternalEstimateItem): PortalEstimateItem {
  return {
    id: item.id ?? null,
    description: item.description || item.name || '',
    quantity: typeof item.quantity === 'number' ? item.quantity : null,
    unit: item.unit ?? null,
    unitPrice: typeof item.unitPrice === 'number' ? item.unitPrice : null,
    total: typeof item.total === 'number' ? item.total : null,
    notes: item.notes ?? null,
  };
}

/**
 * Strip an estimate document. Only "commercial" estimates pass through;
 * anything marked internal (via estimateType or notes heuristic) is
 * returned as null and should be filtered out by the caller.
 *
 * Uses clientItems if present (V4), otherwise items, never internalItems.
 */
export function filterEstimate(estimate: InternalEstimate): PortalEstimate | null {
  // Rule 1: Explicit internal marker
  if (estimate.estimateType === 'internal') return null;

  // Rule 2: Heuristic on notes/number (catches old data where estimateType wasn't set)
  const internalPattern = /internal|внутренн/i;
  if (estimate.notes && internalPattern.test(estimate.notes)) return null;
  if (estimate.number && internalPattern.test(estimate.number)) return null;

  // Source items: prefer V4 clientItems, fallback to V3 items.
  // NEVER use internalItems — that's the cost-side data.
  const source = estimate.clientItems || estimate.items || [];

  return {
    id: estimate.id,
    number: estimate.number ?? null,
    status: estimate.status ?? null,
    total: typeof estimate.total === 'number' ? estimate.total : null,
    notes: estimate.notes ?? null,
    items: source.map(filterEstimateItem),
  };
}

export function filterProject(p: InternalProject): PortalProject {
  return {
    id: p.id,
    name: p.name ?? null,
    status: p.status ?? null,
  };
}

/**
 * Filter a task. Tasks that are explicitly flagged as internal
 * (clientVisible === false) are dropped; all others are returned with
 * a stripped-down shape. Internal assignee, hours, and cost info are
 * never propagated.
 */
export function filterTask(t: InternalTask): PortalTask | null {
  if (t.clientVisible === false) return null;
  return {
    id: t.id,
    title: t.title ?? null,
    status: t.status ?? null,
    context: t.context ?? null,
    description: t.description ?? null,
    createdAt: t.createdAt ?? null,
    updatedAt: t.updatedAt ?? null,
  };
}

export function filterLedgerEntry(e: InternalLedgerEntry): PortalLedgerEntry {
  return {
    id: e.id,
    type: e.type ?? null,
    amount: typeof e.amount === 'number' ? e.amount : null,
    description: e.description ?? null,
    date: e.date ?? null,
  };
}

export function filterPhoto(p: InternalPhoto): PortalPhoto | null {
  // Drop photos explicitly marked internal
  if (p.visibility === 'internal') return null;
  return {
    name: p.name,
    url: p.url,
    category: p.category ?? null,
  };
}

export function filterClient(c: InternalClient): PortalClient {
  const projectAddress =
    (typeof c.workLocation?.address === 'string' ? c.workLocation.address : null) || null;
  const primaryContact = c.contacts && c.contacts.length > 0 ? c.contacts[0] : null;
  return {
    id: c.id,
    name: c.name,
    address: c.address ?? null,
    projectAddress: projectAddress || c.address || null,
    contactName: primaryContact?.name ?? null,
    // EXPLICITLY NOT INCLUDED:
    // email, phone, status, tags, services, industry, source, sourceName,
    // sourceType, totalRevenue, assignedTo, createdBy, lastContactedAt,
    // customFields, workLocation (coordinates), contact emails/phones,
    // contact positions, and anything else not listed above.
  };
}

/**
 * Main entrypoint. Takes full internal client data and returns a
 * strictly filtered portal-safe subset.
 *
 * Guaranteed by this function:
 * - No unitCostPrice in any item
 * - No internalItems exposed
 * - No internal cost totals (totalCost, internalTotal, etc.)
 * - No supplier/subcontractor names or costs
 * - No client email/phone/totalRevenue/status/tags/industry
 * - No hourly rates, labor costs, planned hours
 * - Estimates marked internal are dropped entirely
 * - Tasks flagged clientVisible=false are dropped
 * - Photos marked visibility=internal are dropped
 *
 * Unit tests enforce these guarantees — see portalFilter.test.ts.
 */
export function buildPortalResponse(data: InternalDashboardData): PortalData {
  return {
    client: filterClient(data.client),
    projects: data.projects.map(filterProject),
    estimates: data.estimates
      .map(filterEstimate)
      .filter((e): e is PortalEstimate => e !== null),
    tasks: data.tasks
      .map(filterTask)
      .filter((t): t is PortalTask => t !== null),
    ledger: data.ledger.map(filterLedgerEntry),
    photos: data.photos
      .map(filterPhoto)
      .filter((p): p is PortalPhoto => p !== null),
  };
}
