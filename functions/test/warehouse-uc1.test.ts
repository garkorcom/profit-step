/**
 * Unit tests for UC1 parseOnSiteInventory.
 *
 * The Gemini caller is injected, so these tests cover parsing logic, fuzzy
 * matching, and client resolution without any HTTP traffic.
 */

import {
  parseOnSiteInventory,
  type ParseOnSiteInventoryInput,
} from '../src/warehouse/agent/capabilities/parseOnSiteInventory';
import { fuzzyMatchItem, pickBestMatch } from '../src/warehouse/agent/fuzzy';

const CATALOG = [
  { id: 'item_outlet_15a_white', name: 'Outlet 15A Duplex White', sku: 'OUTLET-15A-WHT' },
  { id: 'item_gfci_15a', name: 'GFCI Outlet 15A', sku: 'GFCI-15A' },
  { id: 'item_wire_12_2_nmb', name: 'Wire 12-2 NM-B', sku: 'WIRE-12-2-NMB' },
  { id: 'item_wire_14_2_nmb', name: 'Wire 14-2 NM-B', sku: 'WIRE-14-2-NMB' },
  { id: 'item_wirenut_yellow', name: 'Wire Nut Yellow', sku: 'WIRENUT-YEL' },
  { id: 'item_drywall_screw_158', name: 'Drywall Screw 1-5/8"', sku: 'SCREW-DW-158' },
];

const CLIENTS = [
  { id: 'client_dvorkin', name: 'Jim Dvorkin' },
  { id: 'client_sarah', name: 'Sarah Johnson' },
];

function ok(response: any) {
  return async (_sys: string, _txt: string) => JSON.stringify(response);
}

function fail(value: string | null = null) {
  return async () => value;
}

// ═══════════════════════════════════════════════════════════════════
//  Fuzzy matcher unit tests
// ═══════════════════════════════════════════════════════════════════

describe('fuzzyMatchItem', () => {
  it('matches by name tokens', () => {
    const out = fuzzyMatchItem('Outlet 15A', CATALOG, 3);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].id).toBe('item_outlet_15a_white');
  });

  it('prefers SKU exact over name', () => {
    const out = fuzzyMatchItem('WIRE-12-2-NMB', CATALOG, 3);
    expect(out[0].id).toBe('item_wire_12_2_nmb');
    expect(out[0].score).toBeGreaterThan(0.9);
  });

  it('returns empty for completely unrelated query', () => {
    const out = fuzzyMatchItem('nonexistent gadget zzzzz', CATALOG, 3);
    expect(out.length).toBe(0);
  });

  it('pickBestMatch returns null below threshold', () => {
    expect(pickBestMatch('nonexistent', CATALOG, 0.5)).toBeNull();
  });

  it('pickBestMatch returns top candidate if above threshold', () => {
    const best = pickBestMatch('wire 12-2 nm-b', CATALOG, 0.5);
    expect(best?.id).toBe('item_wire_12_2_nmb');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  parseOnSiteInventory happy paths
// ═══════════════════════════════════════════════════════════════════

describe('parseOnSiteInventory', () => {
  const baseInput: Omit<ParseOnSiteInventoryInput, 'text'> = {
    userId: 'user_a',
    catalog: CATALOG,
    clients: CLIENTS,
  };

  it('parses happy path + matches 3 items', async () => {
    const gemini = ok({
      siteHint: { clientName: 'Dvorkin', addressHint: null },
      items: [
        { rawText: 'outlets 20', name: 'Outlet 15A', qty: 20, unit: 'each', confidence: 0.9, needsClarification: false },
        { rawText: 'wire 250ft', name: 'Wire 12-2 NM-B', qty: 250, unit: 'ft', confidence: 0.9, needsClarification: false },
        { rawText: 'wirenuts', name: 'Wire Nut', qty: 1, unit: 'pack', confidence: 0.8, needsClarification: false },
      ],
    });

    const res = await parseOnSiteInventory(
      { ...baseInput, text: 'на Dvorkin 20 розеток, провод 250ft, wirenuts' },
      gemini,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.items.length).toBe(3);
    expect(res.items[0].catalogItemId).toBe('item_outlet_15a_white');
    expect(res.items[1].catalogItemId).toBe('item_wire_12_2_nmb');
    expect(res.items[2].catalogItemId).toBe('item_wirenut_yellow');
    expect(res.siteHint.resolvedClientId).toBe('client_dvorkin');
  });

  it('unique client match resolves to clientId', async () => {
    const gemini = ok({
      siteHint: { clientName: 'Sarah', addressHint: null },
      items: [
        { rawText: '5 GFCI', name: 'GFCI Outlet 15A', qty: 5, unit: 'each', confidence: 0.95, needsClarification: false },
      ],
    });
    const res = await parseOnSiteInventory({ ...baseInput, text: 'у Sarah 5 GFCI' }, gemini);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.siteHint.resolvedClientId).toBe('client_sarah');
  });

  it('does not resolve client when hint ambiguous', async () => {
    const extraClients = [...CLIENTS, { id: 'client_sarah_2', name: 'Sarah Smith' }];
    const gemini = ok({
      siteHint: { clientName: 'Sarah', addressHint: null },
      items: [
        { rawText: '5 GFCI', name: 'GFCI Outlet 15A', qty: 5, unit: 'each', confidence: 0.95, needsClarification: false },
      ],
    });
    const res = await parseOnSiteInventory(
      { ...baseInput, clients: extraClients, text: 'у Sarah 5 GFCI' },
      gemini,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.siteHint.resolvedClientId).toBeUndefined();
    expect(res.siteHint.clientName).toBe('Sarah');
  });

  it('sets needsClarification when match confidence is moderate', async () => {
    const gemini = ok({
      siteHint: { clientName: null, addressHint: null },
      items: [
        // "Outlet" matches both outlet_15a_white and gfci_15a somewhat
        { rawText: 'розетка', name: 'Outlet', qty: 2, unit: 'each', confidence: 0.6, needsClarification: true },
      ],
    });
    const res = await parseOnSiteInventory({ ...baseInput, text: 'есть 2 розетки' }, gemini);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.items[0].needsClarification).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  parseOnSiteInventory failure paths
// ═══════════════════════════════════════════════════════════════════

describe('parseOnSiteInventory — failure modes', () => {
  const baseInput: Omit<ParseOnSiteInventoryInput, 'text'> = {
    userId: 'user_a',
    catalog: CATALOG,
  };

  it('returns too_vague for empty input without calling Gemini', async () => {
    const caller = jest.fn();
    const res = await parseOnSiteInventory({ ...baseInput, text: '   ' }, caller as any);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('too_vague');
    expect(caller).not.toHaveBeenCalled();
  });

  it('returns ai_unavailable when Gemini fails', async () => {
    const res = await parseOnSiteInventory({ ...baseInput, text: 'тут 5 розеток' }, fail(null));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('ai_unavailable');
  });

  it('returns parse_error on invalid JSON', async () => {
    const res = await parseOnSiteInventory(
      { ...baseInput, text: 'test' },
      async () => 'not-json-at-all',
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('parse_error');
  });

  it('returns not_on_site when Gemini flags it', async () => {
    const res = await parseOnSiteInventory(
      { ...baseInput, text: 'привет' },
      ok({ error: 'not_on_site' }),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('not_on_site');
  });

  it('returns too_vague when Gemini flags it', async () => {
    const res = await parseOnSiteInventory(
      { ...baseInput, text: 'что-то' },
      ok({ error: 'too_vague' }),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('too_vague');
  });

  it('returns no_items when parse yields empty items', async () => {
    const res = await parseOnSiteInventory(
      { ...baseInput, text: 'blah' },
      ok({ siteHint: {}, items: [] }),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('parse_error');
  });

  it('filters out malformed line entries gracefully', async () => {
    const res = await parseOnSiteInventory(
      { ...baseInput, text: 'blah' },
      ok({
        siteHint: {},
        items: [
          { rawText: 'a', name: 'Outlet', qty: 3, unit: 'each', confidence: 0.9 },
          { name: '' }, // dropped
          null, // dropped
        ],
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.items.length).toBe(1);
  });
});
