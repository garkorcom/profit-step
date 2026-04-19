/**
 * Unit tests for the Telegram warehouseHandler.
 *
 * Focus: safe-by-default behavior (beta gate), phrase heuristic,
 * dispatch logic. Underlying capabilities + Telegram I/O are mocked so
 * we don't hit Gemini or send real messages.
 */

// Mocks must be set up before importing the module under test.
jest.mock('../src/triggers/telegram/telegramUtils', () => ({
  sendMessage: jest.fn().mockResolvedValue(undefined),
  findPlatformUser: jest.fn().mockResolvedValue(null),
}));

jest.mock('../src/warehouse/agent', () => ({
  parseOnSiteInventory: jest.fn(),
  parseReceipt: jest.fn(),
}));

jest.mock('../src/warehouse/api/loaders', () => ({
  loadCatalog: jest.fn().mockResolvedValue([]),
  loadClients: jest.fn().mockResolvedValue([]),
  loadVendors: jest.fn().mockResolvedValue([]),
}));

// Avoid initializing admin SDK in test context
jest.mock('firebase-admin', () => ({
  firestore: () => ({}),
  apps: [],
  initializeApp: jest.fn(),
}));

// axios mock for photo download
jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
  },
}));

import {
  getBetaUsers,
  isWarehouseBetaUser,
  looksLikeOnSitePhrase,
  tryHandleWarehouseMessage,
} from '../src/triggers/telegram/handlers/warehouseHandler';
import { parseOnSiteInventory, parseReceipt } from '../src/warehouse/agent';
import { sendMessage } from '../src/triggers/telegram/telegramUtils';

const mockedSendMessage = sendMessage as jest.Mock;
const mockedParseOnSite = parseOnSiteInventory as jest.Mock;
const mockedParseReceipt = parseReceipt as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.WAREHOUSE_BETA_USERS;
});

// ═══════════════════════════════════════════════════════════════════
//  Feature flag
// ═══════════════════════════════════════════════════════════════════

describe('feature flag', () => {
  it('getBetaUsers returns empty set when env missing', () => {
    expect(getBetaUsers().size).toBe(0);
  });

  it('parses comma-separated IDs', () => {
    process.env.WAREHOUSE_BETA_USERS = '111,222, 333 ';
    const set = getBetaUsers();
    expect(set.has('111')).toBe(true);
    expect(set.has('222')).toBe(true);
    expect(set.has('333')).toBe(true);
    expect(set.size).toBe(3);
  });

  it('isWarehouseBetaUser reflects the set', () => {
    process.env.WAREHOUSE_BETA_USERS = '111,222';
    expect(isWarehouseBetaUser(111)).toBe(true);
    expect(isWarehouseBetaUser('222')).toBe(true);
    expect(isWarehouseBetaUser(999)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Heuristic
// ═══════════════════════════════════════════════════════════════════

describe('looksLikeOnSitePhrase', () => {
  it.each([
    ['на Dvorkin 3 розетки', true],
    ['Я на Dvorkin, тут 3 коробки', true],
    ['тут есть 5 розеток', true],
    ['тут лежат провода', true],
    ['at 500 Biscayne there are 4 GFCI', true],
    ['here are 5 outlets', true],
  ])('accepts "%s" as on-site', (text, expected) => {
    expect(looksLikeOnSitePhrase(text)).toBe(expected);
  });

  it.each([
    ['', false],
    ['привет', false],
    ['/start', false],
    ['/stock wire', false],
    ['короткое', false],
    ['какой сегодня день', false],
    ['Sarah сказала привет', false], // doesn't match any pattern
  ])('rejects "%s"', (text, expected) => {
    expect(looksLikeOnSitePhrase(text)).toBe(expected);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Dispatch — safe defaults
// ═══════════════════════════════════════════════════════════════════

describe('tryHandleWarehouseMessage — safe defaults', () => {
  const buildMessage = (text?: string, userId = 111, photo?: any[]) => ({
    chat: { id: userId },
    from: { id: userId, first_name: 'Test' },
    text,
    photo,
  });

  it('returns false without touching anything when user not in beta', async () => {
    process.env.WAREHOUSE_BETA_USERS = '999';
    const claimed = await tryHandleWarehouseMessage(buildMessage('на Dvorkin 3 розетки', 111));
    expect(claimed).toBe(false);
    expect(mockedSendMessage).not.toHaveBeenCalled();
    expect(mockedParseOnSite).not.toHaveBeenCalled();
  });

  it('returns false for empty env var', async () => {
    const claimed = await tryHandleWarehouseMessage(buildMessage('на Dvorkin 3 розетки', 111));
    expect(claimed).toBe(false);
  });

  it('returns false for malformed message (no chat/from)', async () => {
    process.env.WAREHOUSE_BETA_USERS = '111';
    const claimed = await tryHandleWarehouseMessage({});
    expect(claimed).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Dispatch — on-site text
// ═══════════════════════════════════════════════════════════════════

describe('tryHandleWarehouseMessage — on-site dispatch', () => {
  beforeEach(() => {
    process.env.WAREHOUSE_BETA_USERS = '111';
  });

  it('calls parseOnSiteInventory for heuristic match', async () => {
    mockedParseOnSite.mockResolvedValue({
      ok: true,
      siteHint: { clientName: 'Dvorkin' },
      items: [
        { rawText: '3 розетки', name: 'Outlet 15A', qty: 3, unit: 'each', confidence: 0.95, needsClarification: false, catalogItemId: 'item_outlet' },
      ],
    });

    const claimed = await tryHandleWarehouseMessage({
      chat: { id: 111 },
      from: { id: 111 },
      text: 'на Dvorkin 3 розетки',
    });
    expect(claimed).toBe(true);
    expect(mockedParseOnSite).toHaveBeenCalledTimes(1);
    expect(mockedSendMessage).toHaveBeenCalled();
    // 2nd call formats the result
    const lastCall = mockedSendMessage.mock.calls[mockedSendMessage.mock.calls.length - 1][1];
    expect(lastCall).toContain('Dvorkin');
    expect(lastCall).toContain('Outlet 15A');
  });

  it('calls parseOnSiteInventory via /onsite command', async () => {
    mockedParseOnSite.mockResolvedValue({ ok: false, reason: 'too_vague' });

    const claimed = await tryHandleWarehouseMessage({
      chat: { id: 111 },
      from: { id: 111 },
      text: '/onsite что-то там',
    });
    expect(claimed).toBe(true);
    expect(mockedParseOnSite).toHaveBeenCalledTimes(1);
    // User gets a failure message
    const lastMsg = mockedSendMessage.mock.calls[mockedSendMessage.mock.calls.length - 1][1];
    expect(lastMsg).toMatch(/кратко/i);
  });

  it('surfaces parse failure without crashing', async () => {
    mockedParseOnSite.mockResolvedValue({ ok: false, reason: 'ai_unavailable' });

    const claimed = await tryHandleWarehouseMessage({
      chat: { id: 111 },
      from: { id: 111 },
      text: 'на Dvorkin 3 розетки',
    });
    expect(claimed).toBe(true);
    const lastMsg = mockedSendMessage.mock.calls[mockedSendMessage.mock.calls.length - 1][1];
    expect(lastMsg).toMatch(/недоступен|AI/i);
  });

  it('does NOT claim greeting / casual text', async () => {
    const claimed = await tryHandleWarehouseMessage({
      chat: { id: 111 },
      from: { id: 111 },
      text: 'привет, как дела',
    });
    expect(claimed).toBe(false);
    expect(mockedParseOnSite).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Dispatch — receipt photo
// ═══════════════════════════════════════════════════════════════════

describe('tryHandleWarehouseMessage — receipt photo', () => {
  beforeEach(() => {
    process.env.WAREHOUSE_BETA_USERS = '111';
    process.env.WORKER_BOT_TOKEN = 'test-token';

    // Mock the 2-step axios flow: getFile + file download
    const axios = require('axios').default as { get: jest.Mock };
    axios.get.mockReset();
    axios.get
      .mockResolvedValueOnce({ data: { result: { file_path: 'photos/abc.jpg' } } })
      .mockResolvedValueOnce({ data: Buffer.from('fakeimage') });
  });

  it('downloads photo and calls parseReceipt', async () => {
    mockedParseReceipt.mockResolvedValue({
      ok: true,
      vendor: { name: 'Home Depot' },
      date: '2026-04-18',
      totals: { total: 142.5, currency: 'USD' },
      items: [
        { rawText: 'Outlet', name: 'Outlet 15A', qty: 10, unit: 'each', confidence: 0.95, catalogItemId: 'item_outlet', totalPrice: 24.9, needsReview: false },
      ],
      draftPayload: { docType: 'receipt', costCategory: 'materials', source: 'ai', lines: [], unmatched: [] } as any,
    });

    const claimed = await tryHandleWarehouseMessage({
      chat: { id: 111 },
      from: { id: 111 },
      photo: [
        { file_id: 'small', file_size: 100 },
        { file_id: 'large', file_size: 500 },
      ],
    });
    expect(claimed).toBe(true);
    expect(mockedParseReceipt).toHaveBeenCalledTimes(1);
    const lastMsg = mockedSendMessage.mock.calls[mockedSendMessage.mock.calls.length - 1][1];
    expect(lastMsg).toContain('Home Depot');
    expect(lastMsg).toContain('$142.50');
  });

  it('replies with "попробуй переснять" on receipt_unreadable', async () => {
    mockedParseReceipt.mockResolvedValue({ ok: false, reason: 'receipt_unreadable' });

    const claimed = await tryHandleWarehouseMessage({
      chat: { id: 111 },
      from: { id: 111 },
      photo: [{ file_id: 'f1' }],
    });
    expect(claimed).toBe(true);
    const lastMsg = mockedSendMessage.mock.calls[mockedSendMessage.mock.calls.length - 1][1];
    expect(lastMsg).toMatch(/нечитаемый|пересн/i);
  });
});
