import { Timestamp } from 'firebase/firestore';

// --- Shared Types ---

export type Currency = 'USD' | 'EUR' | 'RUB' | 'UAH' | 'KZT';

export interface Money {
  amount: number;
  currency: Currency;
}

// --- Company (Tenant) ---

export type CompanyStatus = 'active' | 'suspended' | 'archived';

export interface Company {
  id: string;
  name: string;
  ownerId: string;
  status: CompanyStatus;

  // Contact Info
  email?: string;
  phone?: string;
  website?: string;
  address?: string;
  paymentDetails?: string; // Bank info, Zelle, etc.

  // Flags
  isArchived?: boolean;
  name_lowercase?: string; // For search
  ownerCompanyId?: string; // For hierarchy if needed

  // Billing
  subscriptionPlan?: 'free' | 'pro' | 'enterprise';
  subscriptionStatus?: 'active' | 'past_due' | 'canceled';

  // Settings
  settings?: {
    currency?: Currency;
    dateFormat?: string;
    timezone?: string;
  };

  createdAt: Timestamp;
  updatedAt?: Timestamp;
  deletedAt?: Timestamp;
}

export interface PaginatedCompaniesResult {
  companies: Company[];

  // Pagination cursors
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  firstDoc: any; // QueryDocumentSnapshot (kept as `any` — consumers assign directly to DocumentSnapshot)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lastDoc: any; // QueryDocumentSnapshot

  // Metadata
  reads: number;
  duration: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;

  // Legacy/Optional
  lastDocId?: string | null;
  hasMore?: boolean;
}

// --- Client (Customer 360) ---

export type ClientType = 'person' | 'company';
export type ClientStatus = 'new' | 'contacted' | 'qualified' | 'customer' | 'churned' | 'done';

export interface ClientContact {
  id: string;           // Unique ID for React key
  name: string;         // Contact person name
  position?: string;    // Job title/role
  phone: string;
  email?: string;
}

// ─── Client Card V2 additive types (spec CLIENT_CARD_V2_SPEC §4.1) ────

export type LifecycleStage =
  | 'lead'         // первый контакт
  | 'prospect'     // квалифицирован
  | 'active'       // текущий клиент в работе
  | 'repeat'       // повторные сделки
  | 'churned'      // отказался / не на связи
  | 'vip';         // стратегически важный

export type ClientSegment = 'A' | 'B' | 'C' | 'VIP';
export type ChurnRisk = 'low' | 'medium' | 'high';
export type PreferredChannel = 'phone' | 'email' | 'telegram' | 'whatsapp';

export interface ClientDecisionMaker {
  name: string;
  role?: string;
  phone?: string;
  email?: string;
  isPrimary?: boolean;
}

export interface ClientTaxInfo {
  ein?: string;
  taxExempt?: boolean;
  taxRate?: number;
}

export interface ClientBillingInfo {
  billingName?: string;
  billingAddress?: string;
  bankAccount?: string;
  routingNumber?: string;
  paymentTerms?: string; // 'net-30' / 'net-15' / 'on-receipt'
}

export interface Client {
  id: string;
  companyId: string;
  type: ClientType;
  name: string;

  // Contacts
  contacts: ClientContact[];

  // Sub-services / Job Types (e.g. Plumbing, Electrical)
  services?: string[];

  // Legacy fields (kept for compatibility, but prefer contacts array)
  email?: string;
  phone?: string;
  website?: string;
  address?: string;

  // Business Info
  industry?: string;
  source?: string;
  sourceType?: 'contact' | 'company' | 'manual';
  sourceId?: string; // Links to the specific contact or company ID
  sourceName?: string; // Display name of the source
  status: ClientStatus; // legacy — prefer lifecycleStage going forward

  // Location / Geofence
  workLocation?: {
    latitude: number;
    longitude: number;
    radius: number; // miles
    address?: string;
  };

  // Financials
  totalRevenue: number; // LTV (legacy name — consumers now read `ltv` field)

  // Metadata
  tags: string[];
  assignedTo: string;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastContactedAt?: Timestamp;

  /**
   * AI-friendly aliases for project matching (RAG context)
   * Examples: ["Вилла", "Ванила", "Майами", "Villa"]
   * Used by Smart Dispatcher to match voice mentions to project IDs
   */
  aliases?: string[];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  customFields?: Record<string, any>;

  // ── Client Card V2 additive fields ────────────────────────────────
  // All optional — legacy clients stay valid. Populated by migration
  // script + cron + Firestore triggers. See CLIENT_CARD_V2_SPEC.md.

  /** Manual stage set by manager OR mapped from legacy `status` at migration */
  lifecycleStage?: LifecycleStage;
  /** Manual segment (A/B/C/VIP). Default 'B' at migration. */
  segment?: ClientSegment;

  /** Client who referred this one (for referral tracking) */
  referralByClientId?: string | null;
  preferredChannel?: PreferredChannel;
  preferredLanguage?: 'ru' | 'en';
  timezone?: string; // IANA

  taxInfo?: ClientTaxInfo;
  billingInfo?: ClientBillingInfo;
  currency?: Currency;

  decisionMakers?: ClientDecisionMaker[];

  // Computed / materialized (see §2.3 of spec). Do NOT edit manually.
  healthScore?: number;       // 0-100
  churnRisk?: ChurnRisk;
  ltv?: number;               // canonical LTV (sum of paid invoices)
  totalMargin?: number;
  avgPaymentDelayDays?: number;
  lastContactAt?: Timestamp | null;
  activeDealsCount?: number;
  activeProjectsCount?: number;
  openOverdueTasks?: number;
  npsScore?: number | null;   // 0-10, from NPS survey
  computedAt?: Timestamp;     // when metrics last computed

  // Note: `isFavorite` is per-user and lives in `client_favorites/{userId}_{clientId}`,
  // NOT on the client document (would require per-user client copies otherwise).
}

export interface Site {
  id: string;
  clientId: string;
  companyId: string;

  name: string; // e.g. "Miami Beach House"
  address: string;

  // Geo-fencing
  geo: {
    lat: number;
    lng: number;
    radius: number; // meters, default 100
  };

  accessCodes?: string; // Encrypted/Hidden
  photos: string[];

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// --- Pipeline & Deals ---

export interface Pipeline {
  id: string;
  companyId: string;
  name: string;
  stages: PipelineStage[];
  isDefault: boolean;
}

export interface PipelineStage {
  id: string;
  name: string;
  order: number;
  color?: string;
  probability?: number; // Win probability in %
}

export type DealPriority = 'low' | 'medium' | 'high';
export type DealStatus = 'open' | 'won' | 'lost';

export interface Deal {
  id: string;
  companyId: string;
  clientId: string; // Link to Client
  pipelineId: string;
  stageId: string;

  title: string;
  value: Money;

  priority: DealPriority;
  status: DealStatus;

  expectedCloseDate?: Timestamp;

  assignedTo: string;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;

  // Lost reason
  lostReason?: string;
}

// --- Tasks ---

export type TaskType = 'call' | 'email' | 'meeting' | 'task' | 'deadline';
export type TaskPriority = 'low' | 'medium' | 'high';
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'canceled';

export interface Task {
  id: string;
  companyId: string;

  // Relations
  clientId?: string;
  dealId?: string;

  title: string;
  description?: string;
  type: TaskType;

  dueDate: Timestamp;
  completedAt?: Timestamp;

  priority: TaskPriority;
  status: TaskStatus;

  assignedTo: string;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// --- Activity History (Timeline) ---

export type ActivityType =
  | 'note'
  | 'email_sent'
  | 'call_log'
  | 'status_change'
  | 'deal_stage_change'
  | 'task_completed'
  // --- Time-Lapse & Media Updates ---
  | 'media_added'
  | 'voice_report'
  | 'location_checkin'
  | 'task_status_changed'
  | 'document_uploaded'
  | 'ai_summary';

export interface ActivityLog {
  id: string;
  companyId: string;

  // Context
  clientId?: string;
  dealId?: string;
  taskId?: string; // Direct link to Gantt task
  projectId?: string; // --- Project Time-Lapse Context ---

  // Visibility & Environment
  isInternalOnly?: boolean; // Hidden from client portal
  location?: { lat: number; lng: number }; // GPS Checkin
  weatherData?: string; // Snapshot of weather

  type: ActivityType;
  content: string; // Description, message body, or AI transcription
  
  // Extra data: photoUrls, audioUrl, fileUrls, aiTranslation, sentiment
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>;

  performedBy: string; // User ID
  performedAt: Timestamp;
}

// --- Project Accounting System ---
// Project and ProjectStatus are now unified in project.types.ts
export { type Project, type ProjectStatus } from './project.types';

export type LedgerEntryType = 'debit' | 'credit';
export type LedgerCategory =
  | 'labor'       // Work sessions
  | 'materials'   // Shopping/supplies
  | 'admin'       // Administrative costs
  | 'documents'   // Permits, etc.
  | 'payment'     // Client payment
  | 'adjustment'; // Manual correction

export type LedgerSourceType = 'work_session' | 'shopping_receipt' | 'manual';

export interface LedgerEntry {
  id: string;
  projectId: string;
  clientId: string;
  companyId: string;

  type: LedgerEntryType;
  category: LedgerCategory;

  amount: number;
  description: string;

  // Auto-link to source document
  sourceType: LedgerSourceType;
  sourceId?: string; // ID of work_session or receipt

  // Contact Integration
  linkedContactId?: string;
  linkedContactName?: string;

  // Transaction date (may differ from createdAt)
  date: Timestamp;

  // Metadata
  createdAt: Timestamp;
  createdBy: string;
}

