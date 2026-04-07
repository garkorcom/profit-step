/**
 * Unit tests for portalFilter.ts — the security boundary between
 * internal client data and the client portal response.
 *
 * These tests are CRITICAL: every passing test enforces that specific
 * internal fields CANNOT leak to the client portal under any data
 * configuration. Failing tests mean a potential financial/privacy leak.
 *
 * If you add new fields to InternalClient/InternalEstimate/etc in
 * portalFilter.ts, add a corresponding test here that verifies the
 * new field is NOT in the filtered output.
 */

import {
  buildPortalResponse,
  filterClient,
  filterEstimate,
  filterEstimateItem,
  filterTask,
  filterPhoto,
  type InternalDashboardData,
  type InternalEstimate,
  type InternalEstimateItem,
  type InternalClient,
} from '../src/agent/utils/portalFilter';

// ─── Helpers ──────────────────────────────────────────────────────────

function fullInternalClient(overrides: Partial<InternalClient> = {}): InternalClient {
  return {
    id: 'client-1',
    name: 'Jim Dvorkin',
    type: 'person',
    address: '17201 Collins Ave #2405, Sunny Isles',
    workLocation: {
      address: '17201 Collins Ave #2405',
      latitude: 25.9434,
      longitude: -80.1206,
    },
    email: 'jim@example.com',
    phone: '+1-305-555-0100',
    status: 'customer',
    tags: ['high-value', 'repeat-customer'],
    services: ['renovation'],
    industry: 'real-estate',
    source: 'referral',
    sourceName: 'Previous client John',
    // Use a distinctive number that is NOT a substring of anything
    // legitimately exposed (total estimates, etc.)
    totalRevenue: 7654321,
    assignedTo: 'denis',
    createdBy: 'admin',
    customFields: { vip: true, notes: 'prefers morning calls' },
    contacts: [
      {
        id: 'c1',
        name: 'Jim Dvorkin',
        email: 'jim@example.com',
        phone: '+1-305-555-0100',
        position: 'Owner',
      },
    ],
    ...overrides,
  };
}

function fullInternalEstimateItem(
  overrides: Partial<InternalEstimateItem> = {}
): InternalEstimateItem {
  // Uses distinct digit patterns for each field so substring-match
  // assertions can't false-positive (e.g. "5000" as a substring of "25000").
  return {
    id: 'item-1',
    description: 'Master bathroom renovation',
    quantity: 1,
    unit: 'ea',
    unitPrice: 22111, // sell price (allowed in portal)
    total: 22111,     // sell total (allowed in portal)
    notes: 'Premium finishes',
    // Internal-only fields that MUST NOT leak:
    unitCostPrice: 13777,           // distinct from unitPrice
    totalCost: 13777,               // distinct
    laborCost: 8444,                // distinct
    hourlyRate: 78,                 // distinct
    plannedHours: 108,              // distinct
    subcontractorName: 'Joe Plumbing LLC',
    subcontractCost: 5333,          // distinct
    catalogItemId: 'catalog-bath-full',
    type: 'service',
    ...overrides,
  };
}

// ─── filterClient ─────────────────────────────────────────────────────

describe('filterClient', () => {
  it('keeps only allow-listed fields (no leaks)', () => {
    const internal = fullInternalClient();
    const portal = filterClient(internal);

    // Allowed
    expect(portal.id).toBe('client-1');
    expect(portal.name).toBe('Jim Dvorkin');
    expect(portal.address).toBe('17201 Collins Ave #2405, Sunny Isles');
    expect(portal.projectAddress).toBe('17201 Collins Ave #2405');
    expect(portal.contactName).toBe('Jim Dvorkin');

    // NEVER ALLOWED — these are the critical security invariants
    const keys = Object.keys(portal);
    expect(keys).not.toContain('email');
    expect(keys).not.toContain('phone');
    expect(keys).not.toContain('status');
    expect(keys).not.toContain('tags');
    expect(keys).not.toContain('services');
    expect(keys).not.toContain('industry');
    expect(keys).not.toContain('source');
    expect(keys).not.toContain('sourceName');
    expect(keys).not.toContain('totalRevenue');
    expect(keys).not.toContain('assignedTo');
    expect(keys).not.toContain('createdBy');
    expect(keys).not.toContain('customFields');
    expect(keys).not.toContain('workLocation'); // coordinates never leak
    expect(keys).not.toContain('contacts'); // full contact array with emails/phones never leaks
  });

  it('does not reveal contact emails/phones via serialization', () => {
    const internal = fullInternalClient();
    const portal = filterClient(internal);
    const json = JSON.stringify(portal);

    // These exact strings must NOT appear in the serialized JSON
    expect(json).not.toContain('jim@example.com');
    expect(json).not.toContain('+1-305-555-0100');
    expect(json).not.toContain('Owner'); // contact position
    expect(json).not.toContain('7654321'); // totalRevenue
    expect(json).not.toContain('high-value'); // tag
    expect(json).not.toContain('referral'); // source
  });

  it('handles client with no contacts gracefully', () => {
    const internal = fullInternalClient({ contacts: [] });
    const portal = filterClient(internal);
    expect(portal.contactName).toBe(null);
  });

  it('handles client with no address gracefully', () => {
    const internal = fullInternalClient({ address: undefined, workLocation: undefined });
    const portal = filterClient(internal);
    expect(portal.address).toBe(null);
    expect(portal.projectAddress).toBe(null);
  });
});

// ─── filterEstimateItem ───────────────────────────────────────────────

describe('filterEstimateItem', () => {
  it('strips unitCostPrice and all internal cost fields', () => {
    const internal = fullInternalEstimateItem();
    const portal = filterEstimateItem(internal);

    // Allowed
    expect(portal.description).toBe('Master bathroom renovation');
    expect(portal.quantity).toBe(1);
    expect(portal.unit).toBe('ea');
    expect(portal.unitPrice).toBe(22111);
    expect(portal.total).toBe(22111);

    // NEVER ALLOWED
    const keys = Object.keys(portal);
    expect(keys).not.toContain('unitCostPrice');
    expect(keys).not.toContain('totalCost');
    expect(keys).not.toContain('laborCost');
    expect(keys).not.toContain('hourlyRate');
    expect(keys).not.toContain('plannedHours');
    expect(keys).not.toContain('subcontractorName');
    expect(keys).not.toContain('subcontractCost');
    expect(keys).not.toContain('catalogItemId');
    expect(keys).not.toContain('type');
  });

  it('does not leak cost data via JSON serialization', () => {
    const internal = fullInternalEstimateItem();
    const portal = filterEstimateItem(internal);
    const json = JSON.stringify(portal);

    expect(json).not.toContain('13777'); // unitCostPrice + totalCost
    expect(json).not.toContain('8444');  // laborCost
    expect(json).not.toContain('5333');  // subcontractCost
    expect(json).not.toContain('Joe Plumbing');
    expect(json).not.toContain('catalog-bath-full');
  });

  it('falls back to item.name when description is missing', () => {
    const item: InternalEstimateItem = {
      name: 'Demo',
      quantity: 2,
      unitPrice: 500,
      total: 1000,
    };
    const portal = filterEstimateItem(item);
    expect(portal.description).toBe('Demo');
  });
});

// ─── filterEstimate ───────────────────────────────────────────────────

describe('filterEstimate', () => {
  it('drops estimate with estimateType="internal"', () => {
    const internal: InternalEstimate = {
      id: 'est-1',
      estimateType: 'internal',
      total: 150000,
      items: [fullInternalEstimateItem()],
    };
    expect(filterEstimate(internal)).toBe(null);
  });

  it('drops estimate with "internal" substring in notes', () => {
    const internal: InternalEstimate = {
      id: 'est-2',
      notes: 'This is our internal cost estimate',
      items: [],
    };
    expect(filterEstimate(internal)).toBe(null);
  });

  it('drops estimate with Cyrillic "внутренн" in notes', () => {
    const internal: InternalEstimate = {
      id: 'est-3',
      notes: 'Внутренний расчёт',
      items: [],
    };
    expect(filterEstimate(internal)).toBe(null);
  });

  it('drops estimate with "internal" in number', () => {
    const internal: InternalEstimate = {
      id: 'est-4',
      number: 'EST-INTERNAL-001',
      items: [],
    };
    expect(filterEstimate(internal)).toBe(null);
  });

  it('passes through estimate with estimateType="commercial"', () => {
    const internal: InternalEstimate = {
      id: 'est-5',
      number: 'EST-001',
      status: 'sent',
      estimateType: 'commercial',
      total: 184222,
      items: [fullInternalEstimateItem()],
    };
    const portal = filterEstimate(internal);
    expect(portal).not.toBe(null);
    expect(portal!.id).toBe('est-5');
    expect(portal!.number).toBe('EST-001');
    expect(portal!.total).toBe(184222);
    expect(portal!.items).toHaveLength(1);
  });

  it('prefers clientItems over items for V4 estimates', () => {
    const internal: InternalEstimate = {
      id: 'est-6',
      estimateType: 'commercial',
      total: 100,
      items: [fullInternalEstimateItem({ description: 'V3 legacy item' })],
      clientItems: [
        fullInternalEstimateItem({ description: 'V4 client item', unitPrice: 222, total: 222 }),
      ],
      internalItems: [
        fullInternalEstimateItem({ description: 'INTERNAL item', unitCostPrice: 55 }),
      ],
    };
    const portal = filterEstimate(internal);
    expect(portal!.items).toHaveLength(1);
    expect(portal!.items[0].description).toBe('V4 client item');
    expect(portal!.items[0].unitPrice).toBe(222);
  });

  it('NEVER uses internalItems as source', () => {
    // Adversarial: clientItems and items both undefined, only internalItems exist
    const internal: InternalEstimate = {
      id: 'est-7',
      estimateType: 'commercial',
      total: 100,
      internalItems: [fullInternalEstimateItem({ description: 'INTERNAL only' })],
    };
    const portal = filterEstimate(internal);
    // Falls back to empty — does NOT pull from internalItems
    expect(portal!.items).toEqual([]);
  });

  it('never exposes internal cost fields on the estimate itself', () => {
    // Use values that aren't substrings of each other or the allowed `total`
    const internal: InternalEstimate = {
      id: 'est-8',
      estimateType: 'commercial',
      total: 9876,                  // allowed in portal
      internalTotal: 6333,          // distinct, must not leak
      internalSubtotal: 6111,       // distinct
      internalLaborCost: 2777,      // distinct
      internalSubcontractCost: 1555,// distinct
      totalMarkup: 4222,            // distinct
      marginPercent: 43,            // distinct
      items: [],
    };
    const portal = filterEstimate(internal);
    const keys = Object.keys(portal!);
    expect(keys).not.toContain('internalTotal');
    expect(keys).not.toContain('internalSubtotal');
    expect(keys).not.toContain('internalLaborCost');
    expect(keys).not.toContain('internalSubcontractCost');
    expect(keys).not.toContain('totalMarkup');
    expect(keys).not.toContain('marginPercent');
    expect(keys).not.toContain('estimateType');

    const json = JSON.stringify(portal);
    expect(json).not.toContain('6333'); // internalTotal
    expect(json).not.toContain('4222'); // totalMarkup
    expect(json).not.toContain('2777'); // internalLaborCost
    expect(json).not.toContain('1555'); // internalSubcontractCost
    // Sanity: the allowed total IS present
    expect(json).toContain('9876');
  });
});

// ─── filterTask ───────────────────────────────────────────────────────

describe('filterTask', () => {
  it('drops task with clientVisible=false', () => {
    expect(
      filterTask({
        id: 't-1',
        title: 'Secret internal task',
        clientVisible: false,
      })
    ).toBe(null);
  });

  it('passes through task with clientVisible=true', () => {
    const portal = filterTask({
      id: 't-2',
      title: 'Install sink',
      status: 'in_progress',
      context: 'plumbing',
      clientVisible: true,
    });
    expect(portal).not.toBe(null);
    expect(portal!.title).toBe('Install sink');
  });

  it('passes through task with clientVisible undefined (default allow)', () => {
    const portal = filterTask({
      id: 't-3',
      title: 'Demo bathroom',
    });
    expect(portal).not.toBe(null);
  });

  it('never exposes assignee info', () => {
    // Extra fields are allowed by the [key: string]: unknown index
    // signature on InternalTask. The filter MUST still strip them.
    const portal = filterTask({
      id: 't-4',
      title: 'Install tile',
      assignedTo: 'employee-123',
      assigneeName: 'John Worker',
      hourlyRate: 50,
    });
    const keys = Object.keys(portal!);
    expect(keys).not.toContain('assignedTo');
    expect(keys).not.toContain('assigneeName');
    expect(keys).not.toContain('hourlyRate');
  });
});

// ─── filterPhoto ──────────────────────────────────────────────────────

describe('filterPhoto', () => {
  it('drops photo with visibility="internal"', () => {
    expect(
      filterPhoto({
        name: 'secret.jpg',
        url: 'https://storage/secret.jpg',
        visibility: 'internal',
      })
    ).toBe(null);
  });

  it('passes through public photos', () => {
    const portal = filterPhoto({
      name: 'progress_01.jpg',
      url: 'https://storage/progress_01.jpg',
      category: 'progress',
    });
    expect(portal).not.toBe(null);
    expect(portal!.name).toBe('progress_01.jpg');
    expect(portal!.category).toBe('progress');
  });
});

// ─── buildPortalResponse (integration) ────────────────────────────────

describe('buildPortalResponse', () => {
  function fullInternalData(): InternalDashboardData {
    return {
      client: fullInternalClient(),
      projects: [
        { id: 'p1', name: 'Master Reno', status: 'active', internalNotes: 'secret' },
      ],
      estimates: [
        {
          id: 'e1',
          number: 'EST-001',
          estimateType: 'commercial',
          total: 184222,
          internalTotal: 138777,
          items: [fullInternalEstimateItem()],
        },
        {
          id: 'e2',
          number: 'EST-INTERNAL',
          estimateType: 'internal',
          total: 138777,
          items: [fullInternalEstimateItem()],
        },
      ],
      tasks: [
        { id: 't1', title: 'Install sink', clientVisible: true },
        { id: 't2', title: 'Adjust pricing strategy', clientVisible: false },
      ],
      ledger: [
        {
          id: 'l1',
          type: 'credit',
          amount: 27600,
          description: 'Deposit',
          date: new Date('2026-04-01'),
        },
      ],
      photos: [
        { name: 'render_01.jpg', url: 'https://s/r1', category: 'render' },
        { name: 'cost_breakdown.jpg', url: 'https://s/cb', visibility: 'internal' },
      ],
    };
  }

  it('returns strictly filtered subset', () => {
    const portal = buildPortalResponse(fullInternalData());

    // Client filtered
    expect(portal.client.name).toBe('Jim Dvorkin');
    expect((portal.client as any).totalRevenue).toBeUndefined();
    expect((portal.client as any).email).toBeUndefined();

    // Projects passed through (simple shape)
    expect(portal.projects).toHaveLength(1);
    expect(Object.keys(portal.projects[0])).toEqual(['id', 'name', 'status']);

    // Estimates: only commercial one
    expect(portal.estimates).toHaveLength(1);
    expect(portal.estimates[0].id).toBe('e1');

    // Tasks: only clientVisible
    expect(portal.tasks).toHaveLength(1);
    expect(portal.tasks[0].id).toBe('t1');

    // Ledger: all kept (no filter on ledger per current spec)
    expect(portal.ledger).toHaveLength(1);
    expect(portal.ledger[0].amount).toBe(27600);

    // Photos: internal one dropped
    expect(portal.photos).toHaveLength(1);
    expect(portal.photos[0].name).toBe('render_01.jpg');
  });

  it('end-to-end serialization has no internal data', () => {
    const portal = buildPortalResponse(fullInternalData());
    const json = JSON.stringify(portal);

    // Client leaks
    expect(json).not.toContain('jim@example.com');
    expect(json).not.toContain('+1-305-555');
    expect(json).not.toContain('7654321'); // totalRevenue
    expect(json).not.toContain('high-value'); // tag
    expect(json).not.toContain('referral'); // source
    // "vip" substring check omitted — too short, likely false positives

    // Estimate leaks
    expect(json).not.toContain('138777'); // internalTotal
    expect(json).not.toContain('13777');  // unitCostPrice/totalCost
    expect(json).not.toContain('Joe Plumbing');

    // Task leaks
    expect(json).not.toContain('Adjust pricing strategy');

    // Photo leaks — internal photo dropped, render photo kept
    expect(json).not.toContain('cost_breakdown.jpg');
    expect(portal.photos).toHaveLength(1);
    expect(portal.photos[0].name).toBe('render_01.jpg');

    // Sanity: commercial data IS present
    expect(json).toContain('EST-001');
    expect(json).toContain('184222');
    expect(json).toContain('Install sink');
    expect(json).toContain('render_01.jpg');
  });

  it('handles empty input without throwing', () => {
    const portal = buildPortalResponse({
      client: { id: 'x', name: 'Empty' },
      projects: [],
      estimates: [],
      tasks: [],
      ledger: [],
      photos: [],
    });
    expect(portal.client.name).toBe('Empty');
    expect(portal.projects).toEqual([]);
    expect(portal.estimates).toEqual([]);
  });
});
