/**
 * Unit tests for warehouse providers.
 *
 * - SerpApiWebSearchProvider → request + response parsing (mocked axios)
 * - SendGridRFQEmailProvider → payload shape + headers (mocked axios)
 * - Factory → env-driven provider selection with stub fallback
 */

import axios from 'axios';
import {
  SerpApiWebSearchProvider,
  serpApiToCandidate,
  scoreTitleAgainstQuery,
  SendGridRFQEmailProvider,
  buildSendGridPayload,
  getWebSearchProvider,
  getRFQEmailProvider,
  __resetProvidersForTests,
} from '../src/warehouse/agent/providers';
import { InMemoryWebSearchProvider } from '../src/warehouse/agent/capabilities/webSearchItem';
import { InMemoryRFQEmailProvider } from '../src/warehouse/agent/capabilities/sendVendorRFQ';

// ═══════════════════════════════════════════════════════════════════
//  SerpAPI provider
// ═══════════════════════════════════════════════════════════════════

describe('scoreTitleAgainstQuery', () => {
  it('scores token overlap', () => {
    expect(scoreTitleAgainstQuery('LED Strip Warm White 3m', 'led strip warm')).toBeGreaterThan(0.8);
  });
  it('returns 0 for no overlap', () => {
    expect(scoreTitleAgainstQuery('some random product', 'completely different stuff')).toBe(0);
  });
  it('handles empty inputs', () => {
    expect(scoreTitleAgainstQuery('', 'hello')).toBe(0);
    expect(scoreTitleAgainstQuery('hello', '')).toBe(0);
  });
});

describe('serpApiToCandidate', () => {
  it('converts a complete row', () => {
    const row = {
      title: 'Home Depot 10ft LED Strip',
      source: 'Home Depot',
      extracted_price: 29.98,
      link: 'https://homedepot.com/x',
      thumbnail: 'https://t.co/img',
      rating: 4.5,
    };
    const c = serpApiToCandidate(row as any, 'LED Strip');
    expect(c).not.toBeNull();
    expect(c?.source).toBe('home_depot');
    expect(c?.price).toBe(29.98);
    expect(c?.vendor).toBe('Home Depot');
    expect(c?.confidence).toBeGreaterThan(0);
  });

  it('parses price from "price" string when extracted missing', () => {
    const c = serpApiToCandidate(
      { title: 'X', source: 'Amazon', price: '$24.99', link: 'u' } as any,
      'x',
    );
    expect(c?.price).toBe(24.99);
    expect(c?.source).toBe('amazon');
  });

  it('rejects rows without required fields', () => {
    expect(serpApiToCandidate({ title: 'X', source: 'v' } as any, 'q')).toBeNull(); // no url
    expect(serpApiToCandidate({ title: 'X', link: 'u' } as any, 'q')).toBeNull(); // no vendor
    expect(serpApiToCandidate({ source: 'v', link: 'u' } as any, 'q')).toBeNull(); // no title
  });

  it('rejects rows with zero or negative price', () => {
    expect(
      serpApiToCandidate(
        { title: 'X', source: 'v', link: 'u', extracted_price: 0 } as any,
        'q',
      ),
    ).toBeNull();
  });
});

describe('SerpApiWebSearchProvider.search', () => {
  function mockHttp() {
    const get = jest.fn();
    return { http: { get } as any, get };
  }

  it('calls SerpAPI with correct params and maps shopping_results', async () => {
    const { http, get } = mockHttp();
    get.mockResolvedValueOnce({
      data: {
        shopping_results: [
          {
            title: 'LED Strip A',
            source: 'Home Depot',
            extracted_price: 29.98,
            link: 'u1',
          },
          {
            title: 'LED Strip B',
            source: 'Amazon',
            extracted_price: 24.99,
            link: 'u2',
          },
        ],
      },
    });

    const p = new SerpApiWebSearchProvider({ apiKey: 'key123', http });
    const result = await p.search({ query: 'LED Strip', maxResults: 5 });

    expect(get).toHaveBeenCalledTimes(1);
    const callArgs = get.mock.calls[0];
    expect(callArgs[0]).toBe('https://serpapi.com/search');
    expect(callArgs[1].params.q).toBe('LED Strip');
    expect(callArgs[1].params.api_key).toBe('key123');
    expect(callArgs[1].params.engine).toBe('google_shopping');

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0].vendor).toBe('Home Depot');
  });

  it('returns empty candidates on network error', async () => {
    const { http, get } = mockHttp();
    get.mockRejectedValueOnce(new Error('timeout'));
    const p = new SerpApiWebSearchProvider({ apiKey: 'k', http });
    const result = await p.search({ query: 'q' });
    expect(result.candidates).toEqual([]);
  });

  it('returns empty candidates when SerpAPI responds with error', async () => {
    const { http, get } = mockHttp();
    get.mockResolvedValueOnce({ data: { error: 'Invalid API key' } });
    const p = new SerpApiWebSearchProvider({ apiKey: 'bad', http });
    const result = await p.search({ query: 'q' });
    expect(result.candidates).toEqual([]);
    expect((result.rawProviderResponse as any)?.error).toBe('Invalid API key');
  });

  it('throws on empty apiKey', () => {
    expect(() => new SerpApiWebSearchProvider({ apiKey: '' })).toThrow(/apiKey/);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  SendGrid provider
// ═══════════════════════════════════════════════════════════════════

describe('buildSendGridPayload', () => {
  it('produces v3 mail-send shape', () => {
    const payload = buildSendGridPayload({
      to: 'vendor@x.com',
      from: 'rfq@profit-step.com',
      replyTo: 'rfq@profit-step.com',
      subject: 'RFQ 1 item',
      body: 'hello',
      customArgs: { rfqId: 'rfq_1', vendorId: 'vendor_x' },
    });
    expect(payload.personalizations[0].to).toEqual([{ email: 'vendor@x.com' }]);
    expect(payload.personalizations[0].custom_args).toEqual({ rfqId: 'rfq_1', vendorId: 'vendor_x' });
    expect(payload.from.email).toBe('rfq@profit-step.com');
    expect(payload.subject).toBe('RFQ 1 item');
    expect(payload.content[0]).toEqual({ type: 'text/plain', value: 'hello' });
  });
});

describe('SendGridRFQEmailProvider.send', () => {
  function mockHttp() {
    const post = jest.fn();
    return { http: { post } as any, post };
  }

  it('sends to SendGrid v3 and returns message id', async () => {
    const { http, post } = mockHttp();
    post.mockResolvedValueOnce({
      status: 202,
      headers: { 'x-message-id': 'sg-abc-123' },
    });

    const p = new SendGridRFQEmailProvider({ apiKey: 'SG.xxx', http });
    const result = await p.send({
      to: 'v@x.com',
      from: 'rfq@profit-step.com',
      replyTo: 'rfq@profit-step.com',
      subject: 's',
      body: 'b',
      customArgs: { rfqId: 'r1', vendorId: 'v1' },
    });

    expect(result.messageId).toBe('sg-abc-123');
    expect(post).toHaveBeenCalledTimes(1);
    const [url, body, config] = post.mock.calls[0];
    expect(url).toBe('https://api.sendgrid.com/v3/mail/send');
    expect(body.personalizations[0].to[0].email).toBe('v@x.com');
    expect(config.headers.Authorization).toBe('Bearer SG.xxx');
  });

  it('propagates SendGrid errors with detail', async () => {
    const { http, post } = mockHttp();
    post.mockRejectedValueOnce({
      response: { status: 401, data: { errors: [{ message: 'invalid key' }] } },
    });
    const p = new SendGridRFQEmailProvider({ apiKey: 'k', http });
    await expect(
      p.send({
        to: 'v@x.com',
        from: 'rfq@profit-step.com',
        replyTo: 'rfq@profit-step.com',
        subject: 's',
        body: 'b',
        customArgs: { rfqId: 'r', vendorId: 'v' },
      }),
    ).rejects.toThrow(/401/);
  });

  it('throws on empty apiKey', () => {
    expect(() => new SendGridRFQEmailProvider({ apiKey: '' })).toThrow(/apiKey/);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Factory
// ═══════════════════════════════════════════════════════════════════

describe('factory — env-driven selection', () => {
  beforeEach(() => {
    __resetProvidersForTests();
    delete process.env.SERPAPI_API_KEY;
    delete process.env.SENDGRID_API_KEY;
  });

  it('returns InMemory stubs when keys missing', () => {
    expect(getWebSearchProvider()).toBeInstanceOf(InMemoryWebSearchProvider);
    expect(getRFQEmailProvider()).toBeInstanceOf(InMemoryRFQEmailProvider);
  });

  it('returns SerpAPI provider when key present', () => {
    process.env.SERPAPI_API_KEY = 'sa-live-key';
    expect(getWebSearchProvider()).toBeInstanceOf(SerpApiWebSearchProvider);
  });

  it('returns SendGrid provider when key present', () => {
    process.env.SENDGRID_API_KEY = 'SG.key';
    expect(getRFQEmailProvider()).toBeInstanceOf(SendGridRFQEmailProvider);
  });

  it('caches provider instance across calls', () => {
    process.env.SERPAPI_API_KEY = 'k';
    const a = getWebSearchProvider();
    const b = getWebSearchProvider();
    expect(a).toBe(b);
  });

  it('explicit override bypasses env', () => {
    delete process.env.SERPAPI_API_KEY;
    expect(getWebSearchProvider('explicit-key')).toBeInstanceOf(SerpApiWebSearchProvider);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Axios types coverage — prevents accidental unused-imports
// ═══════════════════════════════════════════════════════════════════

test('axios is available', () => {
  // guard: axios imported; this test just keeps the dependency used
  expect(typeof axios).toBe('function');
});
