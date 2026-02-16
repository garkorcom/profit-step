/**
 * @fileoverview scopeMatcher.test.ts
 * Unit tests for Fuse.js pre-filter + electrical synonym expansion.
 * QA Checklist Part 4: Tests PF-01 through PF-13.
 */

import { findScopeCandidates, expandWithSynonyms } from "../src/callable/ai/scopeMatcher";
import { villaEstimateItems } from "./fixtures/aiTaskTestData";

describe("expandWithSynonyms", () => {
    test("expands 'plug' into receptacle/outlet/duplex/розетка", () => {
        const result = expandWithSynonyms(["plug"]);
        expect(result).toContain("plug");
        expect(result).toContain("receptacle");
        expect(result).toContain("outlet");
        expect(result).toContain("duplex");
        expect(result).toContain("розетка");
    });

    test("expands 'gfi' into gfci variants", () => {
        const result = expandWithSynonyms(["gfi"]);
        expect(result).toContain("gfci");
        expect(result).toContain("gfi outlet");
        expect(result).toContain("gfci receptacle");
    });

    test("reverse lookup: 'receptacle' expands to 'plug' and 'outlet'", () => {
        const result = expandWithSynonyms(["receptacle"]);
        expect(result).toContain("plug");
        expect(result).toContain("outlet");
    });

    test("Russian synonym: 'розетка' reverse-expands to plug/outlet/receptacle", () => {
        const result = expandWithSynonyms(["розетка"]);
        expect(result).toContain("plug");
        expect(result).toContain("outlet");
        expect(result).toContain("receptacle");
    });
});

describe("findScopeCandidates", () => {
    // --- PF-01: Synonym expansion ---
    test('PF-01: "plug" matches "receptacle" items', () => {
        const result = findScopeCandidates("fix the plug", villaEstimateItems);
        expect(result.length).toBeGreaterThan(0);
        // Should match items with receptacle/outlet tags
        const allTags = result.flatMap((r) => r.item.tags || []);
        expect(
            allTags.some((t) => ["receptacle", "outlet", "duplex"].includes(t))
        ).toBe(true);
    });

    // --- PF-02: light → luminaire ---
    test('PF-02: "light" matches luminaire/fixture items', () => {
        const result = findScopeCandidates(
            "install the lights in kitchen",
            villaEstimateItems
        );
        expect(result.some((r) => r.item.lineNumber === "E-11")).toBe(true);
    });

    // --- PF-03: can lights → recessed ---
    test('PF-03: "can lights" matches recessed', () => {
        const result = findScopeCandidates("add more can lights", villaEstimateItems);
        expect(result.some((r) => r.item.tags?.includes("recessed"))).toBe(true);
    });

    // --- PF-04: breaker box → panel ---
    test('PF-04: "breaker box" matches "panel"', () => {
        const result = findScopeCandidates(
            "check the breaker box",
            villaEstimateItems
        );
        expect(result.some((r) => r.item.tags?.includes("panel"))).toBe(true);
    });

    // --- PF-05: gfi → gfci ---
    test('PF-05: "gfi" matches "gfci"', () => {
        const result = findScopeCandidates("gfi keeps tripping", villaEstimateItems);
        expect(result.some((r) => r.item.tags?.includes("gfci"))).toBe(true);
    });

    // --- PF-06: Zone filtering (kitchen) ---
    test('PF-06: "kitchen outlet" prioritizes kitchen zone', () => {
        const result = findScopeCandidates(
            "kitchen outlet not working",
            villaEstimateItems
        );
        expect(result.length).toBeGreaterThan(0);
        expect(result[0].item.zone).toBe("Kitchen");
        expect(result[0].item.lineNumber).toBe("E-07");
    });

    // --- PF-07: Zone filtering (pool) ---
    test('PF-07: "pool pump" matches pool zone', () => {
        const result = findScopeCandidates(
            "connect the pool pump",
            villaEstimateItems
        );
        expect(result.length).toBeGreaterThan(0);
        expect(result[0].item.lineNumber).toBe("E-14");
    });

    // --- PF-08: No false positive (Ring doorbell) ---
    test('PF-08: "Ring doorbell" returns 0 candidates', () => {
        const result = findScopeCandidates(
            "install Ring doorbell camera",
            villaEstimateItems
        );
        expect(result.length).toBe(0);
    });

    // --- PF-09: No false positive (painting) ---
    test('PF-09: "paint the walls" returns 0 (not electrical)', () => {
        const result = findScopeCandidates(
            "paint the walls in living room",
            villaEstimateItems
        );
        expect(result.length).toBe(0);
    });

    // --- PF-10: Fuzzy matching with typos ---
    test('PF-10: "recesed lihgts" (typo) still matches recessed', () => {
        const result = findScopeCandidates(
            "install recesed lihgts",
            villaEstimateItems
        );
        expect(result.some((r) => r.item.lineNumber === "E-11")).toBe(true);
    });

    // --- PF-11: Russian synonym ---
    test('PF-11: "розетка" (Russian) matches receptacle items', () => {
        const result = findScopeCandidates(
            "починить розетку в ванной",
            villaEstimateItems
        );
        expect(
            result.some((r) => r.item.tags?.includes("receptacle"))
        ).toBe(true);
    });

    // --- PF-12: Score ordering ---
    test('PF-12: "kitchen gfci outlet" ranks E-07 above E-09', () => {
        const result = findScopeCandidates(
            "kitchen gfci outlet",
            villaEstimateItems
        );
        expect(result.length).toBeGreaterThanOrEqual(2);
        expect(result[0].item.lineNumber).toBe("E-07");
    });

    // --- PF-13: Max 5 results cap ---
    test("PF-13: Never returns more than 5 candidates", () => {
        const result = findScopeCandidates(
            "electrical work wire outlet switch light panel breaker",
            villaEstimateItems
        );
        expect(result.length).toBeLessThanOrEqual(5);
    });

    // --- Edge: Empty items ---
    test("returns empty array for empty estimate items", () => {
        const result = findScopeCandidates("fix the plug", []);
        expect(result).toEqual([]);
    });

    // --- Edge: Empty input ---
    test("returns empty array for empty input", () => {
        const result = findScopeCandidates("", villaEstimateItems);
        expect(result).toEqual([]);
    });
});
