/**
 * Agent API Test Setup
 * - Initializes Firebase Admin with emulator
 * - Exports supertest request + auth headers
 * - Seed / cleanup helpers for Firestore
 */

import * as admin from 'firebase-admin';

// Initialize admin for emulator (idempotent)
if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: 'profit-step-test' });
}

const db = admin.firestore();

// ─── Auth ───────────────────────────────────────────────────────────

export const API_KEY = 'test-agent-key';
export const OWNER_UID = 'test-owner-uid';

export function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${API_KEY}` };
}

// ─── Import app AFTER env is set ────────────────────────────────────

// Dynamic import to ensure env vars are ready
let _app: any;
export async function getApp() {
  if (!_app) {
    const mod = await import('../../src/agent/agentApi');
    _app = (mod as any).agentApp;
  }
  return _app;
}

// ─── Seed Helpers ───────────────────────────────────────────────────

export async function seedClient(overrides: Record<string, any> = {}): Promise<string> {
  const ref = db.collection('clients').doc();
  await ref.set({
    name: 'Test Client',
    address: '123 Test St, Austin TX',
    contactPerson: 'John Test',
    phone: '+1-555-000-0000',
    email: 'test@test.com',
    notes: '',
    status: 'active',
    type: 'commercial',
    source: 'test',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...overrides,
  });
  return ref.id;
}

export async function seedTask(clientId: string, overrides: Record<string, any> = {}): Promise<string> {
  const ref = db.collection('gtd_tasks').doc();
  await ref.set({
    ownerId: OWNER_UID,
    title: 'Test Task',
    description: 'Test description',
    status: 'inbox',
    priority: 'medium',
    context: '@office',
    clientId,
    clientName: 'Test Client',
    source: 'test',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...overrides,
  });
  return ref.id;
}

export async function seedCost(clientId: string, overrides: Record<string, any> = {}): Promise<string> {
  const ref = db.collection('costs').doc();
  await ref.set({
    userId: OWNER_UID,
    userName: 'Test Owner',
    clientId,
    clientName: 'Test Client',
    category: 'materials',
    categoryLabel: 'Материалы',
    amount: 100,
    originalAmount: 100,
    description: 'Test cost',
    status: 'confirmed',
    source: 'test',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    ...overrides,
  });
  return ref.id;
}

export async function seedProject(clientId: string, overrides: Record<string, any> = {}): Promise<string> {
  const ref = db.collection('projects').doc();
  await ref.set({
    id: ref.id,
    companyId: 'test-company-id',
    clientId,
    clientName: 'Test Client',
    name: 'Test Project',
    description: '',
    status: 'active',
    type: 'work',
    files: [],
    totalDebit: 0,
    totalCredit: 0,
    balance: 0,
    createdBy: OWNER_UID,
    source: 'test',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...overrides,
  });
  return ref.id;
}

export async function seedEstimate(clientId: string, overrides: Record<string, any> = {}): Promise<string> {
  const ref = db.collection('estimates').doc();
  await ref.set({
    companyId: 'test-company-id',
    clientId,
    clientName: 'Test Client',
    number: `EST-${Date.now().toString().slice(-6)}`,
    status: 'draft',
    items: [
      { id: 'item-1', description: 'Wire 12AWG', quantity: 100, unitPrice: 1.5, total: 150, type: 'material' },
      { id: 'item-2', description: 'Installation', quantity: 8, unitPrice: 50, total: 400, type: 'labor' },
    ],
    subtotal: 550,
    taxRate: 0,
    taxAmount: 0,
    total: 550,
    notes: '',
    terms: '',
    validUntil: null,
    createdBy: OWNER_UID,
    source: 'test',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...overrides,
  });
  return ref.id;
}

export async function seedUser(overrides: Record<string, any> = {}): Promise<string> {
  const ref = db.collection('users').doc();
  await ref.set({
    displayName: 'Test Worker',
    email: 'worker@test.com',
    role: 'worker',
    hourlyRate: 25,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    ...overrides,
  });
  return ref.id;
}

export async function seedSite(clientId: string, overrides: Record<string, any> = {}): Promise<string> {
  const ref = db.collection('sites').doc();
  await ref.set({
    clientId,
    name: 'Test Site',
    address: '456 Site Ave',
    city: 'Austin',
    state: 'TX',
    zip: '78701',
    status: 'active',
    createdBy: OWNER_UID,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...overrides,
  });
  return ref.id;
}

// ─── Cleanup ────────────────────────────────────────────────────────

const COLLECTIONS = [
  'clients', 'gtd_tasks', 'costs', 'work_sessions', 'projects',
  'estimates', 'sites', 'users', 'contacts', 'activityLog',
  'bank_transactions', 'finance_rules', 'estimate_blackboard',
  '_cache', '_idempotency', '_rate_limits',
];

export async function clearCollection(name: string): Promise<void> {
  const snap = await db.collection(name).limit(500).get();
  if (snap.empty) return;
  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

export async function clearAll(): Promise<void> {
  await Promise.all(COLLECTIONS.map((c) => clearCollection(c)));
}

export { db, admin };
