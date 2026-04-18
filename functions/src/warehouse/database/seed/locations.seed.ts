/**
 * Seed data — starting set of locations for the clean-slate bootstrap.
 *
 * One main warehouse + three vans (one per active employee) + one quarantine
 * zone. Site locations are created on-the-fly via UC1 (see docs/warehouse/
 * improvements/06_onsite_voice/SPEC.md).
 */

export interface LocationSeed {
  id: string;
  name: string;
  locationType: 'warehouse' | 'van' | 'site' | 'quarantine';
  ownerEmployeeId?: string;
  licensePlate?: string;
  address?: string;
  twoPhaseTransferEnabled?: boolean;
}

export const SEED_LOCATIONS: readonly LocationSeed[] = [
  {
    id: 'loc_warehouse_miami',
    name: 'Main Warehouse (Miami)',
    locationType: 'warehouse',
    address: 'Miami, FL',
    twoPhaseTransferEnabled: false,
  },
  {
    id: 'loc_van_denis',
    name: 'Van Денис',
    locationType: 'van',
    ownerEmployeeId: 'emp_denis',
    twoPhaseTransferEnabled: false,
  },
  {
    id: 'loc_van_gena',
    name: 'Van Гена',
    locationType: 'van',
    ownerEmployeeId: 'emp_gena',
    twoPhaseTransferEnabled: false,
  },
  {
    id: 'loc_van_masha',
    name: 'Van Маша',
    locationType: 'van',
    ownerEmployeeId: 'emp_masha',
    twoPhaseTransferEnabled: false,
  },
  {
    id: 'loc_quarantine_main',
    name: 'Quarantine (damaged / returns)',
    locationType: 'quarantine',
  },
];

if (new Set(SEED_LOCATIONS.map((l) => l.id)).size !== SEED_LOCATIONS.length) {
  throw new Error('SEED_LOCATIONS contains duplicate ids');
}
