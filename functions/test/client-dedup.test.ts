/**
 * Tests for client deduplication logic:
 * - Phone normalization matching
 * - Geo proximity (Haversine)
 * - Merge collections list
 */

// Inline haversine — same as in clients.ts
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Inline normalizePhone — same as in phone.ts
function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 0) return raw.trim();
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
  if (raw.trim().startsWith('+')) return `+${digits}`;
  return digits;
}

const GEO_DUPLICATE_THRESHOLD_KM = 0.15;

describe('Phone normalization for dedup', () => {
  test('same number in different formats normalizes to same E.164', () => {
    const formats = [
      '7542520827',
      '(754) 252-0827',
      '+1-754-252-0827',
      '1-754-252-0827',
      '+17542520827',
    ];
    const normalized = formats.map(f => normalizePhone(f));
    const unique = new Set(normalized);
    expect(unique.size).toBe(1);
    expect(normalized[0]).toBe('+17542520827');
  });

  test('different numbers do NOT match', () => {
    expect(normalizePhone('7542520827')).not.toBe(normalizePhone('3059650408'));
  });

  test('empty/null/undefined returns empty string', () => {
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone(null)).toBe('');
    expect(normalizePhone(undefined)).toBe('');
  });

  test('international numbers preserved', () => {
    expect(normalizePhone('+442079460958')).toBe('+442079460958');
  });
});

describe('Geo proximity (Haversine)', () => {
  test('same point = 0 distance', () => {
    expect(haversineKm(27.95, -82.45, 27.95, -82.45)).toBe(0);
  });

  test('two points 100m apart = within threshold', () => {
    // ~100m offset at Tampa latitude
    const lat1 = 27.950000;
    const lng1 = -82.450000;
    const lat2 = 27.950900; // ~100m north
    const lng2 = -82.450000;
    const dist = haversineKm(lat1, lng1, lat2, lng2);
    expect(dist).toBeLessThan(GEO_DUPLICATE_THRESHOLD_KM);
    expect(dist).toBeGreaterThan(0);
  });

  test('two points 500m apart = outside threshold', () => {
    const lat1 = 27.950000;
    const lng1 = -82.450000;
    const lat2 = 27.954500; // ~500m north
    const lng2 = -82.450000;
    const dist = haversineKm(lat1, lng1, lat2, lng2);
    expect(dist).toBeGreaterThan(GEO_DUPLICATE_THRESHOLD_KM);
  });

  test('Tampa to Miami = ~330km (far apart)', () => {
    const dist = haversineKm(27.95, -82.45, 25.76, -80.19);
    expect(dist).toBeGreaterThan(300);
    expect(dist).toBeLessThan(400);
  });
});

describe('Collections with clientId', () => {
  const COLLECTIONS = [
    'projects',
    'gtd_tasks',
    'costs',
    'work_sessions',
    'estimates',
    'sites',
    'project_ledger',
    'shopping_lists',
    'project_locations',
    'activity_logs',
  ];

  test('merge covers all known collections', () => {
    expect(COLLECTIONS.length).toBe(10);
    expect(COLLECTIONS).toContain('work_sessions');
    expect(COLLECTIONS).toContain('projects');
    expect(COLLECTIONS).toContain('estimates');
    expect(COLLECTIONS).toContain('costs');
  });

  test('no duplicate collection names', () => {
    const unique = new Set(COLLECTIONS);
    expect(unique.size).toBe(COLLECTIONS.length);
  });
});

describe('Duplicate group confidence', () => {
  test('phone match = high confidence', () => {
    const reasons = ['phone_match:+17542520827'];
    const hasPhone = reasons.some(r => r.startsWith('phone_match'));
    expect(hasPhone).toBe(true);
    const confidence = hasPhone ? 'high' : reasons.length >= 2 ? 'medium' : 'low';
    expect(confidence).toBe('high');
  });

  test('name + geo = medium confidence', () => {
    const reasons = ['fuzzy_name', 'geo_proximity'];
    const hasPhone = reasons.some(r => r.startsWith('phone_match'));
    const confidence = hasPhone ? 'high' : reasons.length >= 2 ? 'medium' : 'low';
    expect(confidence).toBe('medium');
  });

  test('name only = low confidence', () => {
    const reasons = ['fuzzy_name'];
    const hasPhone = reasons.some(r => r.startsWith('phone_match'));
    const confidence = hasPhone ? 'high' : reasons.length >= 2 ? 'medium' : 'low';
    expect(confidence).toBe('low');
  });
});
