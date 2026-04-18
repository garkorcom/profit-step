/**
 * UC4.b — Web search for items not in the catalog.
 *
 * Interface-first design: the capability accepts a `WebSearchProvider`
 * that executes the actual search. Production will wire SerpAPI; tests
 * (and dev) pass a stub.
 *
 * Reference: docs/warehouse/improvements/09_web_sourcing/SPEC.md.
 */

// ═══════════════════════════════════════════════════════════════════
//  Provider contract
// ═══════════════════════════════════════════════════════════════════

export interface WebSearchQuery {
  /** Free-form product name, e.g. "3m LED strip warm white 2700K". */
  query: string;
  /** Optional spec hints Gemini might extract. */
  specs?: string[];
  /** Max number of candidates to return. */
  maxResults?: number;
  /** Location for price localization. */
  location?: string;
}

export interface WebSearchCandidate {
  source: 'google_shopping' | 'home_depot' | 'lowes' | 'amazon' | 'other';
  title: string;
  vendor: string;
  price: number;
  currency: string; // default USD
  url: string;
  thumbnailUrl?: string;
  rating?: number;
  /** 0..1 — how well this result matches the original query. */
  confidence: number;
}

export interface WebSearchResult {
  query: WebSearchQuery;
  candidates: WebSearchCandidate[];
  searchedAt: string;
  /** Provider-specific raw payload kept for debugging. Not exposed to LLM. */
  rawProviderResponse?: unknown;
}

export interface WebSearchProvider {
  readonly name: string;
  search(query: WebSearchQuery): Promise<WebSearchResult>;
}

// ═══════════════════════════════════════════════════════════════════
//  Capability wrapper (cache + scoring)
// ═══════════════════════════════════════════════════════════════════

export interface WebSearchCache {
  get(key: string): Promise<WebSearchResult | null>;
  set(key: string, value: WebSearchResult, ttlSeconds: number): Promise<void>;
}

export interface WebSearchItemOptions {
  provider: WebSearchProvider;
  cache?: WebSearchCache;
  cacheTTLSeconds?: number; // default 7 days per spec
}

/**
 * Search for an item with optional caching.
 */
export async function webSearchItem(
  query: WebSearchQuery,
  options: WebSearchItemOptions,
): Promise<WebSearchResult> {
  const maxResults = query.maxResults ?? 3;
  const cacheKey = `ws:${query.query.toLowerCase().trim()}:${query.location ?? 'us'}:${maxResults}`;

  if (options.cache) {
    const cached = await options.cache.get(cacheKey);
    if (cached) return cached;
  }

  const result = await options.provider.search({ ...query, maxResults });
  // Rank: confidence × price-inverse (cheaper wins among equal-confidence)
  result.candidates.sort((a, b) => {
    if (Math.abs(b.confidence - a.confidence) > 0.05) return b.confidence - a.confidence;
    return a.price - b.price;
  });
  result.candidates = result.candidates.slice(0, maxResults);

  if (options.cache) {
    await options.cache.set(cacheKey, result, options.cacheTTLSeconds ?? 7 * 24 * 3600);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════
//  In-memory stub provider (for dev + tests)
// ═══════════════════════════════════════════════════════════════════

export class InMemoryWebSearchProvider implements WebSearchProvider {
  readonly name = 'in_memory_stub';

  constructor(private readonly seededResults: Map<string, WebSearchCandidate[]> = new Map()) {}

  seed(query: string, candidates: WebSearchCandidate[]): void {
    this.seededResults.set(query.toLowerCase().trim(), candidates);
  }

  async search(query: WebSearchQuery): Promise<WebSearchResult> {
    const seeded = this.seededResults.get(query.query.toLowerCase().trim()) ?? [];
    return {
      query,
      candidates: seeded.slice(0, query.maxResults ?? 3),
      searchedAt: new Date().toISOString(),
    };
  }
}

/**
 * In-memory cache suitable for tests. Production will wire a Firestore-
 * backed cache keyed on query hash.
 */
export class InMemoryWebSearchCache implements WebSearchCache {
  private store = new Map<string, { value: WebSearchResult; expiresAt: number }>();

  async get(key: string): Promise<WebSearchResult | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: WebSearchResult, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
}
