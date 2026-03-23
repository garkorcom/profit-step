/**
 * Load Pasco County inspectors into Firestore using Firebase Admin SDK
 * Run from functions/ context: cd functions && node ../scripts/load-pasco-inspectors-admin.mjs
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Use firebase-admin from functions/node_modules
const admin = require('firebase-admin');

// Initialize with default credentials (uses Firebase CLI auth)
admin.initializeApp({ projectId: 'profit-step' });
const db = admin.firestore();

const TAMPA_PROJECT_ID = 'MEPjJFnapZVPgbXmyGP2';

const inspectors = [
  {
    name: 'Clay Tomer',
    phones: [{ number: '727-602-7271', label: 'Work' }],
    roles: ['Inspector', 'Electrical Inspector', 'Chief Electrical Inspector'],
    defaultCity: 'Pasco County',
    notes: 'Chief Electrical Inspector — Pasco County',
    linkedProjects: [TAMPA_PROJECT_ID],
    createdBy: 'system_import',
    messengers: {},
    emails: [],
  },
  {
    name: 'Scott Carley',
    phones: [{ number: '727-359-9756', label: 'Work' }],
    roles: ['Inspector', 'Building Inspector', 'Chief Building Inspector'],
    defaultCity: 'Pasco County',
    notes: 'Chief Building Inspector — Pasco County',
    linkedProjects: [TAMPA_PROJECT_ID],
    createdBy: 'system_import',
    messengers: {},
    emails: [],
  },
  {
    name: 'Roger Perdue',
    phones: [{ number: '727-267-5092', label: 'Work' }],
    roles: ['Inspector', 'Mechanical Inspector', 'Chief Mechanical Inspector'],
    defaultCity: 'Pasco County',
    notes: 'Chief Mechanical Inspector — Pasco County',
    linkedProjects: [TAMPA_PROJECT_ID],
    createdBy: 'system_import',
    messengers: {},
    emails: [],
  },
  {
    name: 'Richard Lydecker',
    phones: [{ number: '727-267-7111', label: 'Work' }],
    roles: ['Inspector', 'Building Inspector', 'Building Inspector LEAD'],
    defaultCity: 'Pasco County',
    notes: 'Building Inspector LEAD — Pasco County',
    linkedProjects: [TAMPA_PROJECT_ID],
    createdBy: 'system_import',
    messengers: {},
    emails: [],
  },
  {
    name: 'David Riker',
    phones: [{ number: '727-359-8129', label: 'Work' }],
    roles: ['Inspector', 'Building Inspector', 'Building Inspector LEAD'],
    defaultCity: 'Pasco County',
    notes: 'Building Inspector LEAD — Pasco County',
    linkedProjects: [TAMPA_PROJECT_ID],
    createdBy: 'system_import',
    messengers: {},
    emails: [],
  },
];

async function main() {
  console.log('Loading Pasco County inspectors via Admin SDK...\n');

  for (const inspector of inspectors) {
    // Check if already exists
    const existing = await db.collection('contacts')
      .where('name', '==', inspector.name)
      .get();

    if (!existing.empty) {
      console.log(`⏭️  ${inspector.name} — already exists (skipped)`);
      continue;
    }

    const docRef = await db.collection('contacts').add({
      ...inspector,
      createdAt: admin.firestore.Timestamp.now(),
    });

    console.log(`✅ ${inspector.name} — created (${docRef.id})`);
  }

  console.log('\nDone!');
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
