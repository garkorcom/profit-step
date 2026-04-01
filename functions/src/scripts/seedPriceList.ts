/**
 * Seed inventory_catalog with standard FL 2026 electrical/plumbing prices.
 * 
 * Usage:
 *   cd functions && npx ts-node src/scripts/seedPriceList.ts
 *   OR: node -e "require('./src/scripts/seedPriceList')"
 */

import * as admin from 'firebase-admin';

// Initialize if not already
if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'profit-step' });
}
const db = admin.firestore();

const PRICE_LIST = [
  // --- Wire / Cable ---
  { name: '1.5 mm2 (14/2 AWG) Copper Wire - 100m', category: 'materials', unit: 'roll', avgPrice: 89.00, description: 'Standard lighting circuit wire, 100m spool' },
  { name: '2.5 mm2 (12/2 AWG) Copper Wire - 100m', category: 'materials', unit: 'roll', avgPrice: 129.00, description: 'Standard receptacle circuit wire, 100m spool' },
  { name: '6.0 mm2 (10/2 AWG) Copper Wire - 100m', category: 'materials', unit: 'roll', avgPrice: 219.00, description: 'Heavy-duty appliance wire (oven, HVAC)' },
  { name: '10.0 mm2 (8/3 AWG) Copper Wire - 100m', category: 'materials', unit: 'roll', avgPrice: 349.00, description: 'EV charger / heavy load wire' },
  { name: '12/2 MC Cable (ft)', category: 'materials', unit: 'ft', avgPrice: 1.85, description: 'Metal-clad cable per foot' },

  // --- Breakers ---
  { name: '16A Single-Pole Breaker', category: 'materials', unit: 'ea', avgPrice: 8.50, description: 'Standard lighting breaker' },
  { name: '20A Single-Pole Breaker', category: 'materials', unit: 'ea', avgPrice: 9.50, description: 'Standard receptacle breaker' },
  { name: '40A Double-Pole Breaker', category: 'materials', unit: 'ea', avgPrice: 18.00, description: 'Heavy appliance breaker (oven, HVAC)' },
  { name: '20A RCBO / GFCI Breaker (Wet Zone)', category: 'materials', unit: 'ea', avgPrice: 32.00, description: 'Ground-fault protection for wet zones' },

  // --- Panel Enclosures ---
  { name: '12-way Distribution Panel Enclosure', category: 'materials', unit: 'ea', avgPrice: 85.00, description: 'Small panel (up to 12 circuits)' },
  { name: '24-way Distribution Panel Enclosure', category: 'materials', unit: 'ea', avgPrice: 145.00, description: 'Medium panel (up to 24 circuits)' },
  { name: '36-way Distribution Panel Enclosure', category: 'materials', unit: 'ea', avgPrice: 225.00, description: 'Large panel (up to 36 circuits)' },

  // --- Devices ---
  { name: 'Standard Socket / Receptacle', category: 'materials', unit: 'ea', avgPrice: 3.50, description: '15A/20A duplex receptacle' },
  { name: 'Lighting Fixture / Switch', category: 'materials', unit: 'ea', avgPrice: 4.50, description: 'Single-pole switch or basic fixture' },
  { name: 'Appliance Junction Box', category: 'materials', unit: 'ea', avgPrice: 2.25, description: 'Standard single/double gang box' },
  { name: 'Standard Single Gang Box', category: 'materials', unit: 'ea', avgPrice: 1.50, description: 'PVC single gang old work box' },
  { name: 'Plastic Wallplate', category: 'materials', unit: 'ea', avgPrice: 0.75, description: 'Standard white wallplate cover' },
  { name: 'Lighting Support Bracket/Wire', category: 'materials', unit: 'ea', avgPrice: 5.00, description: 'Ceiling fixture mounting bracket' },

  // --- Plumbing ---
  { name: '1/2 inch PEX Pipe - 100ft', category: 'materials', unit: 'ft', avgPrice: 0.65, description: 'PEX-A tubing per foot' },
  { name: '1-1/2 inch PVC Pipe - 10ft', category: 'materials', unit: 'ft', avgPrice: 0.85, description: 'Schedule 40 PVC drain pipe per foot' },
  { name: 'P-Trap Kit 1-1/2 inch', category: 'materials', unit: 'ea', avgPrice: 8.50, description: 'Standard P-trap assembly' },
  { name: 'Angle Stop Valve 1/2 x 3/8', category: 'materials', unit: 'ea', avgPrice: 12.00, description: 'Quarter-turn angle stop valve' },

  // --- Labor Rates ---
  { name: 'Electrician Labor (hrs)', category: 'labor', unit: 'hr', avgPrice: 55.00, description: 'Journeyman electrician hourly rate (FL)' },
  { name: 'Plumber Labor', category: 'labor', unit: 'hr', avgPrice: 65.00, description: 'Licensed plumber hourly rate (FL)' },

  // --- Low Voltage / Smart Home ---
  { name: 'CAT6 Cable (ft)', category: 'materials', unit: 'ft', avgPrice: 0.45, description: 'Cat6 ethernet cable per foot' },
  { name: 'RG6 Coax Cable (ft)', category: 'materials', unit: 'ft', avgPrice: 0.35, description: 'RG6 coaxial cable per foot' },
  { name: 'Smart Dimmer Switch', category: 'materials', unit: 'ea', avgPrice: 35.00, description: 'WiFi smart dimmer (Lutron/Leviton)' },
  { name: 'LED Recessed Light 6"', category: 'materials', unit: 'ea', avgPrice: 18.00, description: '6-inch LED retrofit can light' },
  { name: 'Smoke Detector (hardwired)', category: 'materials', unit: 'ea', avgPrice: 28.00, description: 'Hardwired smoke/CO combo detector' },
  { name: 'Ceiling Fan Bracket Box', category: 'materials', unit: 'ea', avgPrice: 12.00, description: 'Fan-rated ceiling box' },
  { name: 'GFCI Receptacle 20A', category: 'materials', unit: 'ea', avgPrice: 16.00, description: 'Ground-fault receptacle for kitchens/baths' },
  { name: 'Conduit EMT 3/4" (10ft)', category: 'materials', unit: 'stick', avgPrice: 8.50, description: 'Electrical metallic tubing 10ft stick' },
  { name: 'Wire Nuts Assorted (box)', category: 'materials', unit: 'box', avgPrice: 6.50, description: 'Box of 100 assorted wire connectors' },
  { name: 'Electrical Tape (roll)', category: 'materials', unit: 'ea', avgPrice: 2.50, description: 'Standard vinyl electrical tape' },
];

async function seedCatalog() {
  const catalogRef = db.collection('inventory_catalog');

  // Load existing items for dedup
  const snapshot = await catalogRef.get();
  const existing: Record<string, string> = {};
  snapshot.forEach((doc) => {
    const data = doc.data();
    if (data.name) existing[data.name] = doc.id;
  });

  let added = 0;
  let updated = 0;

  for (const item of PRICE_LIST) {
    if (item.name in existing) {
      await catalogRef.doc(existing[item.name]).update({
        avgPrice: item.avgPrice,
        lastPurchasePrice: item.avgPrice,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      updated++;
      console.log(`  📝 Updated: ${item.name} → $${item.avgPrice}`);
    } else {
      await catalogRef.add({
        name: item.name,
        category: item.category,
        unit: item.unit,
        avgPrice: item.avgPrice,
        lastPurchasePrice: item.avgPrice,
        clientMarkupPercent: 30,
        stockByLocation: { warehouse: 0 },
        totalStock: 0,
        minStock: 0,
        isTrackable: false,
        isArchived: false,
        description: item.description || '',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: 'price_list_seed',
      });
      added++;
      console.log(`  ✅ Added:   ${item.name} → $${item.avgPrice}`);
    }
  }

  console.log(`\n🏁 Done! Added: ${added}, Updated: ${updated}, Total: ${PRICE_LIST.length}`);
}

console.log('🌱 Seeding inventory_catalog with FL 2026 prices...\n');
seedCatalog().then(() => process.exit(0)).catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
