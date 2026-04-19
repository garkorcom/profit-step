/**
 * Unit tests for UC2 parseReceipt.
 *
 * The Gemini Vision call is injected so we can feed canonical outputs
 * without actually hitting the model.
 */

import {
  parseReceipt,
  type ParseReceiptInput,
} from '../src/warehouse/agent/capabilities/parseReceipt';

const CATALOG = [
  { id: 'item_wire_12_2_nmb', name: 'Wire 12-2 NM-B', sku: 'WIRE-12-2-NMB' },
  { id: 'item_outlet_15a_white', name: 'Outlet 15A Duplex White', sku: 'OUTLET-15A-WHT' },
  { id: 'item_wirenut_yellow', name: 'Wire Nut Yellow', sku: 'WIRENUT-YEL' },
  { id: 'item_box_1g_plastic', name: 'Electrical Box 1-Gang Plastic', sku: 'BOX-1G-PL' },
];

const VENDORS = [
  { id: 'vendor_home_depot', name: 'Home Depot' },
  { id: 'vendor_lowes', name: "Lowe's" },
];

function baseInput(overrides: Partial<ParseReceiptInput> = {}): ParseReceiptInput {
  return {
    userId: 'u1',
    imageBase64: 'AAAA',
    imageMimeType: 'image/jpeg',
    catalog: CATALOG,
    vendors: VENDORS,
    ...overrides,
  };
}

function ok(response: any) {
  return async (_sys: string, _txt: string, _img: string, _mime: string) => JSON.stringify(response);
}

describe('parseReceipt — happy path', () => {
  it('parses a full Home Depot receipt + matches all lines', async () => {
    const gemini = ok({
      vendor: 'Home Depot',
      vendorStoreNumber: '#8502',
      date: '2026-04-18',
      time: '14:17',
      totals: { subtotal: 132.0, tax: 10.5, total: 142.5, currency: 'USD' },
      items: [
        { rawText: 'WIRE 12-2 WG NM-B 250', name: 'Wire 12-2 NM-B 250 ft', qty: 1, unit: 'roll_250ft', unitPrice: 89, totalPrice: 89, confidence: 0.95 },
        { rawText: '15A OUTLET DUPLEX WHT', name: 'Outlet 15A Duplex White', qty: 10, unit: 'each', unitPrice: 2.49, totalPrice: 24.9, confidence: 0.95 },
        { rawText: 'WIRE NUT YELLOW 100PK', name: 'Wire Nut Yellow', qty: 1, unit: 'pack', unitPrice: 8.99, totalPrice: 8.99, confidence: 0.9 },
        { rawText: 'BOX 1G PLASTIC', name: 'Electrical Box 1-Gang', qty: 10, unit: 'each', unitPrice: 0.89, totalPrice: 8.9, confidence: 0.95 },
      ],
    });
    const res = await parseReceipt(
      baseInput({ targetLocationId: 'loc_van_denis', photoHash: 'sha_abc' }),
      gemini,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.vendor.name).toBe('Home Depot');
    expect(res.vendor.resolvedVendorId).toBe('vendor_home_depot');
    expect(res.vendor.storeNumber).toBe('#8502');
    expect(res.totals.total).toBe(142.5);
    expect(res.items.length).toBe(4);
    // Each line matched to catalog
    for (const l of res.items) expect(l.catalogItemId).toBeDefined();

    expect(res.draftPayload.docType).toBe('receipt');
    expect(res.draftPayload.destinationLocationId).toBe('loc_van_denis');
    expect(res.draftPayload.vendorId).toBe('vendor_home_depot');
    expect(res.draftPayload.idempotencyKey).toBe('sha_abc');
    expect(res.draftPayload.lines.length).toBe(4);
    expect(res.draftPayload.unmatched.length).toBe(0);
  });

  it('separates unmatched lines for manual catalog creation', async () => {
    const gemini = ok({
      vendor: 'Home Depot',
      date: '2026-04-18',
      totals: { total: 50, currency: 'USD' },
      items: [
        { rawText: 'WIRE 12-2 250', name: 'Wire 12-2 NM-B', qty: 1, unit: 'roll_250ft', unitPrice: 45, totalPrice: 45, confidence: 0.95 },
        { rawText: 'SOMETHING UNKNOWN', name: 'Dummy Widget XYZ123', qty: 2, unit: 'each', unitPrice: 2.5, totalPrice: 5, confidence: 0.8 },
      ],
    });
    const res = await parseReceipt(baseInput(), gemini);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.draftPayload.lines.length).toBe(1);
    expect(res.draftPayload.unmatched.length).toBe(1);
    expect(res.draftPayload.unmatched[0].name).toBe('Dummy Widget XYZ123');
  });

  it('passes through activeProjectId + activePhaseCode to draftPayload', async () => {
    const gemini = ok({
      vendor: 'Home Depot',
      date: '2026-04-18',
      totals: { total: 10, currency: 'USD' },
      items: [
        { rawText: '15A OUTLET', name: 'Outlet 15A Duplex White', qty: 4, unit: 'each', unitPrice: 2.49, totalPrice: 9.96, confidence: 0.95 },
      ],
    });
    const res = await parseReceipt(
      baseInput({ activeProjectId: 'proj_dvorkin', activePhaseCode: 'rough_in' }),
      gemini,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.draftPayload.projectId).toBe('proj_dvorkin');
    expect(res.draftPayload.phaseCode).toBe('rough_in');
  });
});

describe('parseReceipt — failure modes', () => {
  it('returns receipt_unreadable for empty image', async () => {
    const res = await parseReceipt(baseInput({ imageBase64: '' }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('receipt_unreadable');
  });

  it('returns ai_unavailable if Gemini fails', async () => {
    const res = await parseReceipt(baseInput(), async () => null);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('ai_unavailable');
  });

  it('returns not_a_receipt when Gemini says so', async () => {
    const res = await parseReceipt(baseInput(), ok({ error: 'not_a_receipt' }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('not_a_receipt');
  });

  it('returns receipt_unreadable when Gemini says so', async () => {
    const res = await parseReceipt(baseInput(), ok({ error: 'receipt_unreadable' }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('receipt_unreadable');
  });

  it('returns parse_error for malformed JSON', async () => {
    const res = await parseReceipt(baseInput(), async () => '{not json}');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('parse_error');
  });

  it('returns parse_error when structure is broken', async () => {
    const res = await parseReceipt(baseInput(), ok({ vendor: 'Home Depot' /* no items */ }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('parse_error');
  });
});
