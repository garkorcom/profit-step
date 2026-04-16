/**
 * Shared types and constants for the Reconciliation module.
 * Extracted from ReconciliationPage.tsx to allow reuse across hooks and components.
 */
import { Timestamp } from 'firebase/firestore';

// ─── Constants ─────────────────────────────────────────────

export const COST_CATEGORY_LABELS: Record<string, string> = {
  materials: '🧱 Материалы',
  tools: '🛠️ Инструменты',
  reimbursement: '💷 Возмещение',
  fuel: '⛽ Топливо',
  housing: '🏠 Жилье (Рента)',
  food: '🍔 Питание',
  permit: '📄 Документы',
  other: '📦 Прочее',
};

export const FUEL_KEYWORDS = ['TESLA', 'SHELL', 'CHEVRON', 'EXXON', 'MARATHON', 'RACETRAC', 'CIRCLE K', 'WAWA', 'CHARGEPOINT', 'PILOT', 'SUPERCHARGER'];

export const MONTH_LABELS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

/** Tampa + ~100 mile radius -- all FL cities within driving distance */
export const TAMPA_100MI_CITIES = [
  // Tampa metro core
  'tampa', 'wesley chapel', 'zephyrhills', 'brandon', 'riverview',
  'lutz', 'land o lakes', 'new port richey', 'plant city',
  'valrico', 'seffner', 'temple terrace', 'odessa', 'spring hill',
  'lakeland', 'dade city', 'brooksville',
  // Pinellas (St Pete / Clearwater)
  'st petersburg', 'clearwater', 'largo', 'pinellas park', 'dunedin',
  'tarpon springs', 'palm harbor', 'safety harbor', 'seminole', 'treasure island',
  'indian rocks beach', 'madeira beach', 'st pete beach',
  // Sarasota / Manatee
  'sarasota', 'bradenton', 'palmetto', 'venice', 'north port', 'englewood',
  'ellenton', 'parrish', 'longboat key', 'siesta key', 'osprey', 'nokomis',
  // Polk county
  'winter haven', 'bartow', 'auburndale', 'haines city', 'lake wales',
  'polk city', 'mulberry', 'eagle lake', 'lake alfred', 'davenport',
  // Pasco / Hernando / Citrus
  'hudson', 'port richey', 'holiday', 'crystal river', 'inverness',
  'homosassa', 'weeki wachee', 'san antonio',
  // Orlando metro (~85mi)
  'orlando', 'kissimmee', 'sanford', 'winter park', 'altamonte springs',
  'casselberry', 'oviedo', 'apopka', 'clermont', 'leesburg',
  'mount dora', 'tavares', 'eustis', 'ocala', 'the villages',
  'celebration', 'st cloud', 'windermere', 'winter garden',
  // Charlotte / Lee (borderline 100mi)
  'port charlotte', 'punta gorda', 'cape coral', 'fort myers',
  'lehigh acres', 'bonita springs', 'estero',
  // Volusia (Daytona, ~120mi but common for FL business)
  'daytona beach', 'deland', 'deltona', 'new smyrna beach', 'ormond beach',
  'fern park',
];

// ─── Types ─────────────────────────────────────────────────

export type QuickFilter = 'all' | 'tampa' | 'company' | 'personal' | 'unassigned' | 'fuel' | 'duplicates';
export type SortField = 'date' | 'amount' | 'cleanMerchant' | 'categoryId';
export type SortDir = 'asc' | 'desc';

export interface ReconcileTx {
  id: string;
  date: string | Timestamp;
  rawDescription: string;
  cleanMerchant: string;
  amount: number;
  paymentType: 'company' | 'cash';
  categoryId: string;
  projectId: string | null;
  employeeId?: string | null;
  employeeName?: string | null;
  note?: string;
  confidence: 'high' | 'low';
  status: 'draft' | 'approved' | 'ignored';
  verifiedBy?: string | null;
  verifiedAt?: Timestamp | null;
  clarificationStatus?: 'pending' | 'answered' | 'send_failed' | null;
  clarificationAskedAt?: Timestamp | null;
}

export interface EnrichedTx extends ReconcileTx {
  _location: string;
}

export interface EmployeeOption {
  id: string;
  name: string;
}

export interface FilterStats {
  tampa: { count: number; sum: string };
  company: { count: number; sum: string };
  personal: { count: number; sum: string };
  fuel: { count: number; sum: string };
  unassigned: { count: number; sum: string };
  duplicates: { count: number; sum: string };
}

export interface SummaryData {
  tampa: number;
  company: number;
  personal: number;
  total: number;
}

// ─── Helper functions ──────────────────────────────────────

/** Parse any date-like value to a JS Date */
export const toDate = (d: string | Timestamp | Date | null | undefined): Date | null => {
  if (!d) return null;
  if (typeof d === 'string') return new Date(d);
  if (d instanceof Date) return d;
  if (typeof (d as Timestamp).toDate === 'function') return (d as Timestamp).toDate();
  return null;
};

export const renderDate = (d: string | Timestamp | Date | null | undefined) => {
  const date = toDate(d);
  return date ? date.toLocaleDateString() : '';
};

export const normalizeDate = (d: string | Timestamp | Date | null | undefined): string => {
  const date = toDate(d);
  return date ? date.toISOString() : new Date().toISOString();
};

export const getMonthKey = (d: string | Timestamp | Date | null | undefined): string => {
  const date = toDate(d);
  if (!date || isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

export const fmtDollar = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(1).replace(/\.0$/, '')}K` : `$${n.toFixed(0)}`;

export const isFuelTransaction = (t: { categoryId: string; rawDescription: string }): boolean => {
  if (t.categoryId === 'fuel') return true;
  const upper = (t.rawDescription || '').toUpperCase();
  return FUEL_KEYWORDS.some(kw => upper.includes(kw));
};

export const isTampaArea = (location: string): boolean =>
  TAMPA_100MI_CITIES.includes(location.toLowerCase());

export const parseLocation = (rawDescription: string): string => {
  if (!rawDescription) return '';
  const upper = rawDescription.toUpperCase();
  const knownCities = [
    // Tampa + 100mi (match TAMPA_100MI_CITIES)
    'TAMPA', 'WESLEY CHAPEL', 'ZEPHYRHILLS', 'BRANDON', 'RIVERVIEW',
    'LUTZ', 'LAND O LAKES', 'NEW PORT RICHEY', 'PLANT CITY',
    'VALRICO', 'SEFFNER', 'TEMPLE TERRACE', 'ODESSA', 'SPRING HILL',
    'LAKELAND', 'DADE CITY', 'BROOKSVILLE',
    'ST PETERSBURG', 'CLEARWATER', 'LARGO', 'PINELLAS PARK', 'DUNEDIN',
    'TARPON SPRINGS', 'PALM HARBOR', 'SAFETY HARBOR', 'SEMINOLE',
    'SARASOTA', 'BRADENTON', 'PALMETTO', 'VENICE', 'NORTH PORT', 'ENGLEWOOD',
    'ELLENTON', 'PARRISH', 'OSPREY', 'NOKOMIS',
    'WINTER HAVEN', 'BARTOW', 'AUBURNDALE', 'HAINES CITY', 'LAKE WALES',
    'POLK CITY', 'MULBERRY', 'DAVENPORT',
    'HUDSON', 'PORT RICHEY', 'CRYSTAL RIVER', 'INVERNESS',
    'ORLANDO', 'KISSIMMEE', 'SANFORD', 'WINTER PARK', 'ALTAMONTE SPRINGS',
    'CASSELBERRY', 'OVIEDO', 'APOPKA', 'CLERMONT', 'LEESBURG',
    'MOUNT DORA', 'OCALA', 'ST CLOUD', 'WINTER GARDEN', 'CELEBRATION',
    'PORT CHARLOTTE', 'PUNTA GORDA', 'CAPE CORAL', 'FORT MYERS',
    'LEHIGH ACRES', 'BONITA SPRINGS', 'ESTERO',
    'DAYTONA BEACH', 'DELAND', 'DELTONA', 'NEW SMYRNA BEACH', 'ORMOND BEACH',
    'FERN PARK',
    // South FL + other states
    'MIAMI', 'FORT LAUDERDALE', 'HOLLYWOOD', 'POMPANO BEACH', 'BOCA RATON',
    'WEST PALM BEACH', 'JACKSONVILLE', 'GAINESVILLE', 'TALLAHASSEE',
    'NAPLES', 'HALLANDALE', 'MIRAMAR', 'HIALEAH', 'HOMESTEAD',
    'DEERFIELD BEACH', 'PLANTATION', 'DAVIE', 'SUNRISE',
    'CORAL SPRINGS', 'MARGATE', 'COCONUT CREEK', 'BOYNTON BEACH',
    'DELRAY BEACH', 'LAKE WORTH', 'PALM BEACH',
    'NEW YORK', 'CHICAGO', 'HOUSTON', 'ATLANTA', 'LEXINGTON',
  ];
  for (const city of knownCities) {
    if (upper.includes(city)) return city.charAt(0) + city.slice(1).toLowerCase();
  }
  const stateMatch = upper.match(/\b([A-Z][A-Z\s]+?)\s+[A-Z]{2}\s*\d{0,5}\s*$/);
  if (stateMatch) {
    const candidate = stateMatch[1].trim();
    if (candidate.length >= 3 && candidate.length <= 25) {
      return candidate.charAt(0) + candidate.slice(1).toLowerCase();
    }
  }
  return '';
};
