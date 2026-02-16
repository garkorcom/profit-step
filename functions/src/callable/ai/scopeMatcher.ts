/**
 * @fileoverview scopeMatcher.ts
 * Pure functions for scope analysis: Fuse.js pre-filter + electrical synonym expansion.
 * Extracted for testability from generateAiTask.ts.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Fuse = require("fuse.js");

// ============================================================
// ELECTRICAL SYNONYM DICTIONARY
// ============================================================

export const ELECTRICAL_SYNONYMS: Record<string, string[]> = {
    plug: ["receptacle", "outlet", "duplex", "розетка", "розетку", "розеток"],
    light: ["luminaire", "fixture", "can light", "recessed", "светильник", "свет"],
    wire: ["cable", "romex", "conductor", "mc cable", "thhn", "кабель", "провод"],
    switch: ["toggle", "dimmer", "smart switch", "decora", "выключатель"],
    panel: ["loadcenter", "breaker box", "distribution", "щиток", "щит"],
    breaker: ["circuit breaker", "afci", "gfci breaker", "автомат"],
    gfi: ["gfci", "gfi outlet", "gfci receptacle"],
    can: ["recessed light", "pot light", "downlight"],
    pipe: ["conduit", "emt", "pvc conduit", "rigid"],
    box: ["junction box", "j-box", "pull box", "outlet box"],
    meter: ["meter base", "meter can", "ct cabinet"],
    disconnect: ["safety switch", "fused disconnect", "non-fused"],
    fan: ["ceiling fan", "exhaust fan", "bath fan", "вентилятор"],
    smoke: ["smoke detector", "smoke alarm", "combo detector"],
    track: ["track lighting", "track head", "monorail"],
    sub: ["sub-panel", "sub panel", "subpanel"],
    xfmr: ["transformer", "buck boost", "step down", "трансформатор"],
    outlet: ["receptacle", "plug", "duplex", "розетка", "розетку", "розеток"],
    motor: ["blower", "pump motor", "fan motor"],
};

// ============================================================
// TYPES
// ============================================================

export interface EstimateItem {
    lineNumber: string;
    description: string;
    zone?: string;
    division?: string;
    status: string;
    amount: number;
    tags?: string[];
}

export interface ScopeCandidate {
    item: EstimateItem;
    score: number;
}

// ============================================================
// SYNONYM EXPANSION
// ============================================================

/**
 * Expand a list of keywords with electrical synonyms.
 * "fix the plug" → ["fix", "plug", "receptacle", "outlet", "duplex", "розетка"]
 */
export function expandWithSynonyms(keywords: string[]): string[] {
    const expanded = new Set(keywords);
    for (const kw of keywords) {
        const lower = kw.toLowerCase();
        // Check if keyword IS a synonym key
        if (ELECTRICAL_SYNONYMS[lower]) {
            for (const syn of ELECTRICAL_SYNONYMS[lower]) expanded.add(syn);
        }
        // Check if keyword appears in any synonym list (reverse lookup)
        for (const [key, syns] of Object.entries(ELECTRICAL_SYNONYMS)) {
            if (syns.some((s) => s.includes(lower) || lower.includes(s))) {
                expanded.add(key);
                for (const s of syns) expanded.add(s);
            }
        }
    }
    return Array.from(expanded);
}

// ============================================================
// SCOPE PRE-FILTER (Fuse.js)
// ============================================================

export function findScopeCandidates(
    userInput: string,
    estimateItems: EstimateItem[]
): ScopeCandidate[] {
    if (!estimateItems.length) return [];

    // Extract keywords from user input (keep Cyrillic via а-яёА-ЯЁ)
    const rawKeywords = userInput
        .toLowerCase()
        .replace(/[^\w\sа-яёА-ЯЁ]/gi, "")
        .split(/\s+/)
        .filter((w) => w.length > 2)
        // Naive English plural stripping: "lights"→"light", "outlets"→"outlet"
        .map((w) => w.replace(/s$/, ""));

    // Expand with synonyms, then also include raw keywords for Fuse fuzzy matching
    const expandedKeywords = expandWithSynonyms(rawKeywords);

    // Guard: if no keyword is (even fuzzily) electrical, bail early to prevent false positives
    if (expandedKeywords.length === rawKeywords.length &&
        !rawKeywords.some((kw) => isElectricalKeyword(kw))) {
        return [];
    }

    // Build a searchable text field for each estimate item
    const searchableItems = estimateItems.map((item) => ({
        ...item,
        searchText: [
            item.description,
            item.zone || "",
            item.division || "",
            ...(item.tags || []),
        ]
            .join(" ")
            .toLowerCase(),
    }));

    // Fuse.js fuzzy search — threshold 0.35 balances typo tolerance vs precision
    const fuse = new Fuse(searchableItems, {
        keys: ["searchText", "description", "zone", "division", "tags"],
        threshold: 0.35,
        includeScore: true,
        ignoreLocation: true,
        useExtendedSearch: false,
    });

    // Search with each expanded keyword, collect unique matches
    const matchMap = new Map<string, number>();

    for (const keyword of expandedKeywords) {
        const results = fuse.search(keyword);
        for (const r of results) {
            const key = r.item.lineNumber;
            const score = 1 - (r.score || 0.5); // Fuse score is 0=perfect, invert it
            matchMap.set(key, Math.max(matchMap.get(key) || 0, score));
        }
    }

    // Convert to array, sort, return top 5
    return Array.from(matchMap.entries())
        .map(([lineNumber, score]) => ({
            item: estimateItems.find((i) => i.lineNumber === lineNumber)!,
            score,
        }))
        .filter((c) => c.score > 0.5)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
}

/**
 * Check if a keyword matches any entry in the electrical synonym dictionary.
 * Supports exact matches, substring matches, and Levenshtein fuzzy matches (distance ≤ 2).
 */
export function isElectricalKeyword(keyword: string): boolean {
    const lower = keyword.toLowerCase();
    if (ELECTRICAL_SYNONYMS[lower]) return true;

    // Collect all known electrical terms
    const allTerms: string[] = Object.keys(ELECTRICAL_SYNONYMS);
    for (const syns of Object.values(ELECTRICAL_SYNONYMS)) {
        allTerms.push(...syns);
    }

    for (const term of allTerms) {
        // Substring match
        if (term.includes(lower) || lower.includes(term)) return true;
        // Fuzzy match: Levenshtein distance ≤ 2 for words 5+ chars
        if (lower.length >= 5 && term.length >= 5 && levenshtein(lower, term) <= 2) return true;
    }
    return false;
}

/**
 * Simple Levenshtein distance implementation.
 */
function levenshtein(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + cost
            );
        }
    }
    return dp[m][n];
}
