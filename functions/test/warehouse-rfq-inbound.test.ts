/**
 * Unit tests for the inbound RFQ reply parser + correlation helper.
 */

import {
  correlateRfqId,
  parseRfqReply,
} from '../src/warehouse/agent/capabilities/parseRfqReply';

function ok(response: any) {
  return async (_s: string, _t: string) => JSON.stringify(response);
}

describe('correlateRfqId', () => {
  it('extracts from subject', () => {
    expect(correlateRfqId({ subject: 'Re: RFQ ref rfq_abc123' })).toBe('rfq_abc123');
  });

  it('extracts from body when subject is generic', () => {
    expect(
      correlateRfqId({
        subject: 'Re: your quote',
        body: 'Thanks! Quote ref rfq_xyz_789 per your request.',
      }),
    ).toBe('rfq_xyz_789');
  });

  it('extracts from In-Reply-To header', () => {
    expect(correlateRfqId({ inReplyTo: 'original-msg rfq_m001 @profit.com' })).toBe('rfq_m001');
  });

  it('returns null when no rfq_ token appears', () => {
    expect(correlateRfqId({ subject: 'Unrelated', body: 'Hello' })).toBeNull();
  });

  it('returns first match when multiple tokens present', () => {
    expect(correlateRfqId({ body: 'rfq_a rfq_b' })).toBe('rfq_a');
  });
});

describe('parseRfqReply — happy paths', () => {
  it('parses a two-line vendor reply with overall terms', async () => {
    const gemini = ok({
      items: [
        { itemHint: 'Lutron Diva Dimmer', qty: 4, unit: 'each', unitCost: 18.5, totalCost: null, leadTimeDays: 3, availability: 'in_stock', note: null },
        { itemHint: 'Leviton Wall Plate 1G', qty: 10, unit: 'each', unitCost: 1.1, totalCost: null, leadTimeDays: null, availability: null, note: null },
      ],
      overall: { paymentTerms: 'Net 30', validUntil: null, shippingCost: 0, currency: 'USD' },
    });
    const result = await parseRfqReply(
      { emailBody: 'Here is your quote...............', rfqId: 'rfq_x', vendorId: 'vendor_y' },
      gemini,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.length).toBe(2);
    expect(result.items[0].unitCost).toBe(18.5);
    expect(result.rfqId).toBe('rfq_x');
    expect(result.vendorId).toBe('vendor_y');
    expect(result.overall.paymentTerms).toBe('Net 30');
  });

  it('treats availability values not in enum as null', async () => {
    const gemini = ok({
      items: [
        { itemHint: 'A', qty: 1, unit: 'each', unitCost: 5, availability: 'limited' },
      ],
      overall: {},
    });
    const result = await parseRfqReply({ emailBody: 'x'.repeat(50) }, gemini);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0].availability).toBeNull();
  });

  it('preserves negative answers (out_of_stock with null cost)', async () => {
    const gemini = ok({
      items: [{ itemHint: 'Special Relay', availability: 'out_of_stock' }],
      overall: {},
    });
    const result = await parseRfqReply({ emailBody: 'Sorry, out of stock. Regards.' }, gemini);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0].availability).toBe('out_of_stock');
    expect(result.items[0].unitCost).toBeNull();
  });
});

describe('parseRfqReply — failure paths', () => {
  it('short body → unreadable without hitting Gemini', async () => {
    const caller = jest.fn();
    const r = await parseRfqReply({ emailBody: 'hi' }, caller as any);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('unreadable');
    expect(caller).not.toHaveBeenCalled();
  });

  it('Gemini unavailable', async () => {
    const r = await parseRfqReply({ emailBody: 'body text long enough' }, async () => null);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('ai_unavailable');
  });

  it('not_a_quote when Gemini flags it', async () => {
    const r = await parseRfqReply(
      { emailBody: 'Out of office until Monday.' },
      ok({ error: 'not_a_quote' }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('not_a_quote');
  });

  it('parse_error on malformed JSON', async () => {
    const r = await parseRfqReply({ emailBody: 'x'.repeat(50) }, async () => '{not: json}');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('parse_error');
  });

  it('parse_error when structure broken', async () => {
    const r = await parseRfqReply({ emailBody: 'x'.repeat(50) }, ok({ irrelevant: true }));
    expect(r.ok).toBe(false);
  });
});
