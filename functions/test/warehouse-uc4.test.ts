/**
 * Unit tests for UC4 — buildProcurementPlan + webSearchItem + sendVendorRFQ.
 *
 * Pure-function tests. External providers (web search / RFQ email) are
 * replaced by in-memory stubs so we can assert on their inputs/outputs
 * without hitting SerpAPI or SendGrid.
 */

import {
  buildProcurementPlan,
  buildReservationDrafts,
  type BuildProcurementPlanInput,
  type EstimateLine,
} from '../src/warehouse/agent/capabilities/buildProcurementPlan';
import {
  InMemoryWebSearchCache,
  InMemoryWebSearchProvider,
  webSearchItem,
} from '../src/warehouse/agent/capabilities/webSearchItem';
import {
  composeRFQEnvelope,
  InMemoryRFQEmailProvider,
  sendVendorRFQ,
  type RFQRequest,
} from '../src/warehouse/agent/capabilities/sendVendorRFQ';
import type { WhBalance, WhItem, WhVendor } from '../src/warehouse/core/types';
import { makeBalanceKey } from '../src/warehouse/core/types';

// ═══════════════════════════════════════════════════════════════════
//  Fixtures
// ═══════════════════════════════════════════════════════════════════

const LOC_WH = 'loc_warehouse_miami';
const LOC_VAN = 'loc_van_denis';
const LOC_DEST = 'loc_site_dvorkin';

function mkItem(
  id: string,
  name: string,
  category: string,
  baseUOM: string,
  avgCost: number,
): WhItem {
  return {
    id,
    schemaVersion: 1,
    sku: id.replace('item_', '').toUpperCase(),
    name,
    category,
    baseUOM,
    purchaseUOMs: [{ uom: baseUOM, factor: 1, isDefault: true }],
    allowedIssueUOMs: [baseUOM],
    lastPurchasePrice: avgCost,
    averageCost: avgCost,
    isTrackable: false,
    isActive: true,
    createdAt: null as any,
    updatedAt: null as any,
    createdBy: 'system',
    createdByType: 'system',
  };
}

function mkVendor(
  id: string,
  name: string,
  vendorType: WhVendor['vendorType'],
  categories: string[],
  email?: string,
): WhVendor {
  return {
    id,
    schemaVersion: 1,
    name,
    vendorType,
    preferredForCategories: categories,
    contactEmail: email,
    isActive: true,
    createdAt: null as any,
    updatedAt: null as any,
    createdBy: 'system',
    createdByType: 'system',
  };
}

function mkBalance(locationId: string, itemId: string, onHand: number): WhBalance {
  return {
    id: makeBalanceKey(locationId, itemId),
    schemaVersion: 1,
    locationId,
    itemId,
    onHandQty: onHand,
    reservedQty: 0,
    availableQty: onHand,
    updatedAt: null as any,
  };
}

const CATALOG: WhItem[] = [
  mkItem('item_outlet_15a_white', 'Outlet 15A Duplex White', 'cat_electrical_device', 'each', 2.49),
  mkItem('item_wire_12_2_nmb', 'Wire 12-2 NM-B', 'cat_electrical_cable', 'ft', 0.36),
  mkItem('item_gfci_15a', 'GFCI Outlet 15A', 'cat_electrical_device', 'each', 14.5),
  mkItem('item_box_1g_plastic', 'Electrical Box 1-Gang Plastic', 'cat_electrical_device', 'each', 0.89),
];

const VENDORS: WhVendor[] = [
  mkVendor('vendor_home_depot', 'Home Depot', 'big_box', ['cat_electrical_device', 'cat_electrical_cable', 'cat_consumables'], 'pro@homedepot.local'),
  mkVendor('vendor_local_electrical', 'Local Electrical Supply', 'local_supply', ['cat_electrical_fixture'], 'sales@local.local'),
];

function baseInput(
  estimateLines: EstimateLine[],
  balances: Map<string, WhBalance> = new Map(),
): BuildProcurementPlanInput {
  return {
    estimateId: 'est_1',
    projectId: 'proj_dvorkin',
    estimateLines,
    catalog: CATALOG,
    balances,
    vendors: VENDORS,
  };
}

// ═══════════════════════════════════════════════════════════════════
//  buildProcurementPlan
// ═══════════════════════════════════════════════════════════════════

describe('buildProcurementPlan — happy paths', () => {
  it('allocates entirely from internal when stock is sufficient', () => {
    const balances = new Map([
      [makeBalanceKey(LOC_WH, 'item_outlet_15a_white'), mkBalance(LOC_WH, 'item_outlet_15a_white', 100)],
    ]);
    const plan = buildProcurementPlan(
      baseInput(
        [{ id: 'el1', itemHint: 'Outlet 15A Duplex', qty: 40, unit: 'each', unitCost: 2.8 }],
        balances,
      ),
    );
    expect(plan.buckets.internalAllocation).toHaveLength(1);
    expect(plan.buckets.internalAllocation[0].qtyAllocated).toBe(40);
    expect(plan.buckets.internalAllocation[0].qtyShortfall).toBe(0);
    expect(plan.buckets.buyFromVendor).toHaveLength(0);
    expect(plan.summary.allInternallyAvailable).toBe(true);
  });

  it('splits: allocate what exists + buy shortfall from preferred vendor', () => {
    const balances = new Map([
      [makeBalanceKey(LOC_WH, 'item_outlet_15a_white'), mkBalance(LOC_WH, 'item_outlet_15a_white', 10)],
    ]);
    const plan = buildProcurementPlan(
      baseInput(
        [{ id: 'el1', itemHint: 'Outlet 15A Duplex White', qty: 40, unit: 'each', unitCost: 2.8 }],
        balances,
      ),
    );
    expect(plan.buckets.internalAllocation[0].qtyAllocated).toBe(10);
    expect(plan.buckets.internalAllocation[0].qtyShortfall).toBe(30);
    expect(plan.buckets.buyFromVendor).toHaveLength(1);
    expect(plan.buckets.buyFromVendor[0].vendorId).toBe('vendor_home_depot');
    expect(plan.buckets.buyFromVendor[0].qtyToBuy).toBe(30);
    expect(plan.summary.allInternallyAvailable).toBe(false);
  });

  it('aggregates internalAllocation across multiple locations', () => {
    const balances = new Map([
      [makeBalanceKey(LOC_WH, 'item_wire_12_2_nmb'), mkBalance(LOC_WH, 'item_wire_12_2_nmb', 200)],
      [makeBalanceKey(LOC_VAN, 'item_wire_12_2_nmb'), mkBalance(LOC_VAN, 'item_wire_12_2_nmb', 100)],
    ]);
    const plan = buildProcurementPlan(
      baseInput(
        [{ id: 'el1', itemHint: 'Wire 12-2 NM-B', qty: 250, unit: 'ft', unitCost: 0.4 }],
        balances,
      ),
    );
    expect(plan.buckets.internalAllocation[0].qtyAllocated).toBe(250);
    expect(plan.buckets.internalAllocation[0].onHandBefore).toHaveLength(2);
    // First location in the list should be the warehouse (larger stock)
    expect(plan.buckets.internalAllocation[0].onHandBefore[0].locationId).toBe(LOC_WH);
  });

  it('routes known item without preferred vendor to needsQuote', () => {
    // Add an item category with no vendor mapping
    const itemFixture = mkItem(
      'item_specialty',
      'Specialty Relay Contactor',
      'cat_specialty_relay',
      'each',
      45,
    );
    const plan = buildProcurementPlan({
      estimateId: 'est_1',
      projectId: 'proj_x',
      estimateLines: [{ id: 'el1', itemHint: 'Specialty Relay Contactor', qty: 2, unit: 'each', unitCost: 50 }],
      catalog: [...CATALOG, itemFixture],
      balances: new Map(),
      vendors: VENDORS,
    });

    expect(plan.buckets.needsQuote).toHaveLength(1);
    expect(plan.buckets.needsQuote[0].reason).toBe('no_preferred_vendor');
    expect(plan.buckets.needsQuote[0].qtyNeeded).toBe(2);
    expect(plan.buckets.buyFromVendor).toHaveLength(0);
  });

  it('routes unknown item to needsWebSearch', () => {
    const plan = buildProcurementPlan(
      baseInput([
        { id: 'el1', itemHint: 'Decorative LED profile 3m warm white', qty: 5, unit: 'each', unitCost: 30 },
      ]),
    );
    expect(plan.buckets.needsWebSearch).toHaveLength(1);
    expect(plan.buckets.needsWebSearch[0].itemHint).toMatch(/LED profile/i);
  });

  it('handles a multi-line estimate with all four buckets', () => {
    const itemSpecialty = mkItem(
      'item_specialty',
      'Specialty Relay Contactor',
      'cat_specialty_relay',
      'each',
      45,
    );
    const balances = new Map([
      [makeBalanceKey(LOC_WH, 'item_wire_12_2_nmb'), mkBalance(LOC_WH, 'item_wire_12_2_nmb', 1000)],
    ]);
    const plan = buildProcurementPlan({
      estimateId: 'est_big',
      projectId: 'proj_big',
      estimateLines: [
        { id: 'el1', itemHint: 'Wire 12-2 NM-B', qty: 300, unit: 'ft', unitCost: 0.4 }, // internal
        { id: 'el2', itemHint: 'Outlet 15A Duplex White', qty: 40, unit: 'each', unitCost: 2.8 }, // buy HD
        { id: 'el3', itemHint: 'Specialty Relay Contactor', qty: 2, unit: 'each', unitCost: 50 }, // needs quote
        { id: 'el4', itemHint: 'Totally Unknown Widget XYZ', qty: 1, unit: 'each', unitCost: 99 }, // web search
      ],
      catalog: [...CATALOG, itemSpecialty],
      balances,
      vendors: VENDORS,
    });

    expect(plan.buckets.internalAllocation.length).toBeGreaterThanOrEqual(1);
    expect(plan.buckets.buyFromVendor.length).toBeGreaterThanOrEqual(1);
    expect(plan.buckets.needsQuote.length).toBeGreaterThanOrEqual(1);
    expect(plan.buckets.needsWebSearch.length).toBeGreaterThanOrEqual(1);
    expect(plan.summary.totalLines).toBe(4);
    expect(plan.summary.allInternallyAvailable).toBe(false);
  });

  it('computes summary totals correctly', () => {
    const balances = new Map([
      [makeBalanceKey(LOC_WH, 'item_outlet_15a_white'), mkBalance(LOC_WH, 'item_outlet_15a_white', 10)],
    ]);
    const plan = buildProcurementPlan(
      baseInput(
        [{ id: 'el1', itemHint: 'Outlet 15A Duplex White', qty: 40, unit: 'each', unitCost: 2.8 }],
        balances,
      ),
    );
    expect(plan.summary.totalEstimateValue).toBeCloseTo(40 * 2.8, 2);
    // 10 allocated × avg 2.49 ≈ $24.90
    expect(plan.summary.internallyAllocatedValue).toBeCloseTo(10 * 2.49, 2);
    // 30 to buy × last price 2.49 ≈ $74.70
    expect(plan.summary.externalPurchaseValue).toBeCloseTo(30 * 2.49, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  buildReservationDrafts
// ═══════════════════════════════════════════════════════════════════

describe('buildReservationDrafts', () => {
  it('creates one transfer draft per source location', () => {
    const balances = new Map([
      [makeBalanceKey(LOC_WH, 'item_wire_12_2_nmb'), mkBalance(LOC_WH, 'item_wire_12_2_nmb', 150)],
      [makeBalanceKey(LOC_VAN, 'item_wire_12_2_nmb'), mkBalance(LOC_VAN, 'item_wire_12_2_nmb', 100)],
    ]);
    const plan = buildProcurementPlan(
      baseInput(
        [{ id: 'el1', itemHint: 'Wire 12-2 NM-B', qty: 200, unit: 'ft', unitCost: 0.4 }],
        balances,
      ),
    );
    const drafts = buildReservationDrafts(plan, {
      destinationLocationId: LOC_DEST,
      catalog: CATALOG,
    });
    // 150 from WH + 50 from Van → 2 drafts
    expect(drafts).toHaveLength(2);
    const wh = drafts.find((d) => d.sourceLocationId === LOC_WH);
    const van = drafts.find((d) => d.sourceLocationId === LOC_VAN);
    expect(wh?.lines[0].qty).toBe(150);
    expect(van?.lines[0].qty).toBe(50);
    // Each draft targets the destination + carries project + TTL
    for (const draft of drafts) {
      expect(draft.destinationLocationId).toBe(LOC_DEST);
      expect(draft.projectId).toBe('proj_dvorkin');
      expect(draft.reservationExpiresAt).toBeTruthy();
    }
  });

  it('skips draft when source equals destination', () => {
    const balances = new Map([
      [makeBalanceKey(LOC_DEST, 'item_wire_12_2_nmb'), mkBalance(LOC_DEST, 'item_wire_12_2_nmb', 500)],
    ]);
    const plan = buildProcurementPlan(
      baseInput(
        [{ id: 'el1', itemHint: 'Wire 12-2 NM-B', qty: 100, unit: 'ft', unitCost: 0.4 }],
        balances,
      ),
    );
    const drafts = buildReservationDrafts(plan, {
      destinationLocationId: LOC_DEST,
      catalog: CATALOG,
    });
    expect(drafts).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  webSearchItem
// ═══════════════════════════════════════════════════════════════════

describe('webSearchItem', () => {
  it('delegates to provider + ranks results by confidence then price', async () => {
    const provider = new InMemoryWebSearchProvider();
    provider.seed('led strip warm white', [
      { source: 'google_shopping', title: 'LED Strip B', vendor: 'Amazon', price: 35, currency: 'USD', url: 'u2', confidence: 0.7 },
      { source: 'home_depot', title: 'LED Strip A', vendor: 'Home Depot', price: 30, currency: 'USD', url: 'u1', confidence: 0.9 },
      { source: 'lowes', title: 'LED Strip C', vendor: 'Lowes', price: 40, currency: 'USD', url: 'u3', confidence: 0.9 },
    ]);

    const result = await webSearchItem({ query: 'LED Strip Warm White' }, { provider });

    expect(result.candidates).toHaveLength(3);
    // Highest confidence: 0.9 Home Depot vs 0.9 Lowes → sorted by price (HD cheaper)
    expect(result.candidates[0].vendor).toBe('Home Depot');
    expect(result.candidates[1].vendor).toBe('Lowes');
    expect(result.candidates[2].vendor).toBe('Amazon');
  });

  it('caches results when cache provided', async () => {
    const provider = new InMemoryWebSearchProvider();
    provider.seed('a', [{ source: 'google_shopping', title: 'A', vendor: 'X', price: 1, currency: 'USD', url: 'u', confidence: 1 }]);
    const cache = new InMemoryWebSearchCache();

    const first = await webSearchItem({ query: 'a' }, { provider, cache });
    const second = await webSearchItem({ query: 'a' }, { provider, cache });

    expect(first.searchedAt).toBe(second.searchedAt); // cached entry reused
  });

  it('honors maxResults', async () => {
    const provider = new InMemoryWebSearchProvider();
    provider.seed('many', Array.from({ length: 10 }, (_, i) => ({
      source: 'google_shopping' as const,
      title: `r${i}`,
      vendor: 'v',
      price: i,
      currency: 'USD',
      url: 'u',
      confidence: 0.9,
    })));

    const r = await webSearchItem({ query: 'many', maxResults: 3 }, { provider });
    expect(r.candidates).toHaveLength(3);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  sendVendorRFQ
// ═══════════════════════════════════════════════════════════════════

describe('composeRFQEnvelope', () => {
  it('builds a valid envelope with line items', () => {
    const envelope = composeRFQEnvelope(
      {
        vendorId: 'vendor_ferguson',
        vendorName: 'Ferguson',
        vendorEmail: 'orders@ferguson.local',
        projectId: 'proj_x',
        projectName: 'Dvorkin',
        requesterName: 'Denis',
        requesterCompany: 'Profit Step',
        items: [{ itemHint: 'Lutron Diva Dimmer White', qty: 4, unit: 'each' }],
      },
      { fromAddress: 'rfq@profit-step.com', replyToAddress: 'rfq@profit-step.com' },
      'rfq_test_1',
    );

    expect(envelope.to).toBe('orders@ferguson.local');
    expect(envelope.from).toBe('rfq@profit-step.com');
    expect(envelope.subject).toMatch(/RFQ: 1 items for Dvorkin — Profit Step/);
    expect(envelope.body).toContain('Lutron Diva Dimmer White × 4 each');
    expect(envelope.body).toContain('RFQ ref: rfq_test_1');
    expect(envelope.customArgs.rfqId).toBe('rfq_test_1');
  });
});

describe('sendVendorRFQ', () => {
  const baseReq = (overrides: Partial<RFQRequest> = {}): RFQRequest => ({
    vendorId: 'vendor_ferguson',
    vendorName: 'Ferguson',
    vendorEmail: 'orders@ferguson.local',
    requesterName: 'Denis',
    requesterCompany: 'Profit Step',
    items: [{ itemHint: 'Lutron Diva Dimmer White', qty: 4, unit: 'each' }],
    ...overrides,
  });

  it('sends via the provider and captures the envelope', async () => {
    const provider = new InMemoryRFQEmailProvider();
    const result = await sendVendorRFQ(baseReq(), {
      provider,
      compose: { fromAddress: 'rfq@profit-step.com', replyToAddress: 'rfq@profit-step.com' },
      rfqId: 'rfq_fixed',
    });
    expect(result.rfqId).toBe('rfq_fixed');
    expect(result.providerMessageId).toBe('mem-1');
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0].to).toBe('orders@ferguson.local');
  });

  it('throws when vendor has no email', async () => {
    const provider = new InMemoryRFQEmailProvider();
    await expect(
      sendVendorRFQ(baseReq({ vendorEmail: '' }), {
        provider,
        compose: { fromAddress: 'rfq@profit-step.com', replyToAddress: 'rfq@profit-step.com' },
      }),
    ).rejects.toThrow(/contactEmail/);
  });

  it('throws when items is empty', async () => {
    const provider = new InMemoryRFQEmailProvider();
    await expect(
      sendVendorRFQ(baseReq({ items: [] }), {
        provider,
        compose: { fromAddress: 'rfq@profit-step.com', replyToAddress: 'rfq@profit-step.com' },
      }),
    ).rejects.toThrow(/at least one item/);
  });
});
