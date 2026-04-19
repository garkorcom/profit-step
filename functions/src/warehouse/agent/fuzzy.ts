/**
 * Tiny fuzzy matcher for item catalog lookup.
 *
 * Avoids a hard dependency on Fuse.js at the warehouse-module level —
 * this is intentionally simple so the scoring is predictable in tests.
 * Good enough for UC1 (40-ish seed items). If we outgrow it, swap in Fuse.
 */

export interface FuzzyCandidate {
  id: string;
  name: string;
  sku?: string;
  aliases?: string[];
}

export interface FuzzyMatch {
  id: string;
  name: string;
  score: number; // 0..1 higher = better
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-zа-я0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(s: string): string[] {
  return normalize(s).split(' ').filter(Boolean);
}

function tokenOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sb = new Set(b);
  let overlap = 0;
  for (const t of a) if (sb.has(t)) overlap++;
  // normalize by average length so long names don't dominate
  return overlap / Math.max(a.length, b.length);
}

function exactSkuBonus(query: string, sku?: string): number {
  if (!sku) return 0;
  const qn = normalize(query);
  const sn = normalize(sku);
  if (qn === sn) return 1;
  if (qn.includes(sn) || sn.includes(qn)) return 0.7;
  return 0;
}

/**
 * Rank candidates by how well they match the query. Returns top-K sorted.
 */
export function fuzzyMatchItem(query: string, candidates: FuzzyCandidate[], topK = 3): FuzzyMatch[] {
  const queryTokens = tokenize(query);

  const scored = candidates.map((c) => {
    const nameScore = tokenOverlap(queryTokens, tokenize(c.name));
    const aliasScore = Math.max(
      0,
      ...(c.aliases ?? []).map((a) => tokenOverlap(queryTokens, tokenize(a))),
    );
    const sku = exactSkuBonus(query, c.sku);
    const score = Math.max(nameScore, aliasScore, sku);
    return { id: c.id, name: c.name, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter((s) => s.score > 0).slice(0, topK);
}

export function pickBestMatch(
  query: string,
  candidates: FuzzyCandidate[],
  threshold = 0.5,
): FuzzyMatch | null {
  const top = fuzzyMatchItem(query, candidates, 1)[0];
  if (!top) return null;
  return top.score >= threshold ? top : null;
}
