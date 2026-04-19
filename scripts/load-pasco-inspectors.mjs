/**
 * Load Pasco County inspectors into Firestore contacts collection
 * Run: node scripts/load-pasco-inspectors.mjs
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, Timestamp, getDocs, query, where } from 'firebase/firestore';

// Firebase config from the project
const firebaseConfig = {
  apiKey: "AIzaSyDjBgLGw60VDlMkFu3w9DiSwTftH6nTh8E",
  authDomain: "profit-step.firebaseapp.com",
  projectId: process.env.GOOGLE_CLOUD_PROJECT || "profit-step",
  storageBucket: "profit-step.firebasestorage.app",
  messagingSenderId: "155664324159",
  appId: "1:155664324159:web:87900e4aab0a78aa57ca8a",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

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
  console.log('Loading Pasco County inspectors...\n');

  for (const inspector of inspectors) {
    // Check if already exists by name
    const existing = await getDocs(
      query(collection(db, 'contacts'), where('name', '==', inspector.name))
    );

    if (!existing.empty) {
      console.log(`⏭️  ${inspector.name} — already exists (skipped)`);
      continue;
    }

    const docRef = await addDoc(collection(db, 'contacts'), {
      ...inspector,
      createdAt: Timestamp.now(),
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
