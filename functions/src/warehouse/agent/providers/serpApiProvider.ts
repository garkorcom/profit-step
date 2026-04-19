/**
 * SerpAPI Google Shopping — production WebSearchProvider.
 *
 * Reads `SERPAPI_API_KEY` at construction time (callers pick it up from
 * Firebase Secret Manager). Keeps the HTTP call + response parsing local;
 * the rest of the codebase only sees the generic WebSearchProvider
 * interface.
 *
 * Docs: https://serpapi.com/google-shopping-api
 */

import axios, { AxiosInstance } from 'axios';
import { logger } from 'firebase-functions';
import type {
  WebSearchCandidate,
  WebSearchProvider,
  WebSearchQuery,
  WebSearchResult,
} from '../capabilities/webSearchItem';

// ═══════════════════════════════════════════════════════════════════
//  Response shape (subset we care about)
// ═══════════════════════════════════════════════════════════════════

interface SerpApiShoppingResult {
  position?: number;
  title?: string;
  source?: string; // vendor
  price?: string; // formatted, e.g. "$29.98"
  extracted_price?: number;
  link?: string;
  product_link?: string;
  thumbnail?: string;
  rating?: number;
  reviews?: number;
}

interface SerpApiResponse {
  shopping_results?: SerpApiShoppingResult[];
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════
//  Provider
// ═══════════════════════════════════════════════════════════════════

export interface SerpApiOptions {
  apiKey: string;
  /** Used to localize pricing. Defaults to Miami, FL. */
  defaultLocation?: string;
  /** Inject axios instance for tests. */
  http?: AxiosInstance;
  timeoutMs?: number;
}

export class SerpApiWebSearchProvider implements WebSearchProvider {
  readonly name = 'serpapi_google_shopping';
  private readonly http: AxiosInstance;
  private readonly apiKey: string;
  private readonly defaultLocation: string;
  private readonly timeoutMs: number;

  constructor(opts: SerpApiOptions) {
    if (!opts.apiKey) throw new Error('SerpApiWebSearchProvider: apiKey is required');
    this.apiKey = opts.apiKey;
    this.defaultLocation = opts.defaultLocation ?? 'Miami, Florida, United States';
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.http = opts.http ?? axios.create();
  }

  async search(query: WebSearchQuery): Promise<WebSearchResult> {
    const params = {
      engine: 'google_shopping',
      q: query.query,
      location: query.location ?? this.defaultLocation,
      gl: 'us',
      hl: 'en',
      api_key: this.apiKey,
      num: String(Math.min(query.maxResults ?? 10, 20)),
    };

    let data: SerpApiResponse;
    try {
      const resp = await this.http.get<SerpApiResponse>('https://serpapi.com/search', {
        params,
        timeout: this.timeoutMs,
      });
      data = resp.data;
    } catch (e: any) {
      logger.warn('SerpApi: request failed', { error: e?.message, query: query.query });
      return {
        query,
        candidates: [],
        searchedAt: new Date().toISOString(),
      };
    }

    if (data.error) {
      logger.warn('SerpApi: provider error', { error: data.error, query: query.query });
      return {
        query,
        candidates: [],
        searchedAt: new Date().toISOString(),
        rawProviderResponse: { error: data.error },
      };
    }

    const rows = data.shopping_results ?? [];
    const candidates = rows
      .map((row) => toCandidate(row, query.query))
      .filter((c): c is WebSearchCandidate => c !== null);

    return {
      query,
      candidates,
      searchedAt: new Date().toISOString(),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Row → candidate (exported for tests)
// ═══════════════════════════════════════════════════════════════════

export function toCandidate(row: SerpApiShoppingResult, originalQuery: string): WebSearchCandidate | null {
  const title = row.title?.trim();
  const vendor = (row.source ?? '').trim();
  const url = row.link || row.product_link || '';
  if (!title || !vendor || !url) return null;

  const priceNum =
    typeof row.extracted_price === 'number'
      ? row.extracted_price
      : parsePriceString(row.price);
  if (!priceNum || priceNum <= 0) return null;

  const source: WebSearchCandidate['source'] = inferSource(vendor);
  const confidence = scoreTitleAgainstQuery(title, originalQuery);

  return {
    source,
    title,
    vendor,
    price: priceNum,
    currency: 'USD',
    url,
    thumbnailUrl: row.thumbnail,
    rating: row.rating,
    confidence,
  };
}

function parsePriceString(s?: string): number | null {
  if (!s) return null;
  const match = s.match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!match) return null;
  const n = parseFloat(match[1]);
  return Number.isFinite(n) ? n : null;
}

function inferSource(vendor: string): WebSearchCandidate['source'] {
  const v = vendor.toLowerCase();
  if (v.includes('home depot')) return 'home_depot';
  if (v.includes("lowe")) return 'lowes';
  if (v.includes('amazon')) return 'amazon';
  if (v.includes('google')) return 'google_shopping';
  return 'other';
}

/**
 * Crude title-vs-query score: token overlap normalized by query length.
 * Returns [0, 1]. Good enough as a default; callers can replace per UC.
 */
export function scoreTitleAgainstQuery(title: string, query: string): number {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1);
  const qTokens = new Set(norm(query));
  const tTokens = norm(title);
  if (qTokens.size === 0 || tTokens.length === 0) return 0;
  let hits = 0;
  for (const t of tTokens) if (qTokens.has(t)) hits++;
  return Math.min(1, hits / qTokens.size);
}
