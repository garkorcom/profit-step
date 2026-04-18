/**
 * Warehouse AI — demo runner (dogfood without Gemini/Firestore)
 *
 * Seeds a realistic FakeDb with clients + norms + catalog, then feeds
 * three distinct ParsedIntent inputs through buildPlanFromIntent and
 * pretty-prints what a Telegram message would look like.
 *
 * Run: npx ts-node scripts/warehouse-ai-demo.ts
 */

import { buildPlanFromIntent } from '../src/services/warehouseAI';
import type { ParsedIntent, TripPlan } from '../src/services/warehouseAI/types';

// ═══════════════════════════════════════════════════════════════════
//  Minimal FakeDb (copy of test harness, trimmed)
// ═══════════════════════════════════════════════════════════════════

type DocData = Record<string, any>;

class FakeDocRef {
  constructor(private collection: FakeCollection, private id: string) {}
  async get() {
    const data = this.collection.docs.get(this.id);
    return { exists: data !== undefined, id: this.id, data: () => data };
  }
  async set(data: DocData, options?: { merge?: boolean }) {
    const prev = options?.merge ? this.collection.docs.get(this.id) || {} : {};
    const sanitized: DocData = {};
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === 'object' && 'constructor' in v) {
        const cn = (v as any).constructor?.name || '';
        if (cn.endsWith('Transform')) continue;
      }
      if (v !== undefined) sanitized[k] = v;
    }
    this.collection.docs.set(this.id, { ...prev, ...sanitized });
  }
}

class FakeQuery {
  constructor(private collection: FakeCollection, private filters: Array<{ field: string; op: string; value: any }>, private limitN?: number) {}
  where(field: string, op: string, value: any) { return new FakeQuery(this.collection, [...this.filters, { field, op, value }], this.limitN); }
  limit(n: number) { return new FakeQuery(this.collection, this.filters, n); }
  async get() {
    let docs = Array.from(this.collection.docs.entries()).map(([id, data]) => ({ id, data }));
    for (const f of this.filters) {
      docs = docs.filter((d) => {
        const v = (d.data as any)?.[f.field];
        if (f.op === '==') return v === f.value;
        if (f.op === 'in') return Array.isArray(f.value) && f.value.includes(v);
        return true;
      });
    }
    if (this.limitN !== undefined) docs = docs.slice(0, this.limitN);
    return { docs: docs.map(({ id, data }) => ({ id, data: () => data })) };
  }
}

class FakeCollection {
  docs = new Map<string, DocData>();
  doc(id: string) { return new FakeDocRef(this, id); }
  where(field: string, op: string, value: any) { return new FakeQuery(this, [{ field, op, value }]); }
  limit(n: number) { return new FakeQuery(this, [], n); }
}

class FakeDb {
  private collections = new Map<string, FakeCollection>();
  collection(name: string) {
    if (!this.collections.has(name)) this.collections.set(name, new FakeCollection());
    return this.collections.get(name)!;
  }
  seed(name: string, id: string, data: DocData) { this.collection(name).docs.set(id, data); }
}

// ═══════════════════════════════════════════════════════════════════
//  Realistic seed data
// ═══════════════════════════════════════════════════════════════════

function seed(db: FakeDb): void {
  // Clients
  db.seed('clients', 'client_dvorkin', { name: 'Jim Dvorkin' });
  db.seed('clients', 'client_sarah', { name: 'Sarah Connors' });
  db.seed('clients', 'client_mike', { name: 'Mike Ramirez' });

  // Norms — typical electrical/plumbing work
  db.seed('inventory_norms', 'n_install_outlet', {
    taskType: 'install_outlet',
    items: [
      { catalogItemId: 'cat_outlet_15a', qtyPerUnit: 1 },
      { catalogItemId: 'cat_wire_12', qtyPerUnit: 5 },
      { catalogItemId: 'cat_box_single', qtyPerUnit: 1 },
      { catalogItemId: 'cat_wirenut', qtyPerUnit: 3 },
    ],
  });
  db.seed('inventory_norms', 'n_replace_switch', {
    taskType: 'replace_switch',
    items: [
      { catalogItemId: 'cat_switch_spst', qtyPerUnit: 1 },
      { catalogItemId: 'cat_wirenut', qtyPerUnit: 2 },
    ],
  });
  db.seed('inventory_norms', 'n_install_gfci', {
    taskType: 'install_gfci',
    items: [
      { catalogItemId: 'cat_gfci_15a', qtyPerUnit: 1 },
      { catalogItemId: 'cat_wire_12', qtyPerUnit: 6 },
      { catalogItemId: 'cat_box_single', qtyPerUnit: 1 },
      { catalogItemId: 'cat_wirenut', qtyPerUnit: 4 },
    ],
  });
  db.seed('inventory_norms', 'n_install_fan', {
    taskType: 'install_fan',
    items: [
      { catalogItemId: 'cat_ceiling_fan', qtyPerUnit: 1 },
      { catalogItemId: 'cat_wire_12', qtyPerUnit: 3 },
      { catalogItemId: 'cat_fan_box', qtyPerUnit: 1 },
    ],
  });
  db.seed('inventory_norms', 'n_fix_leak', {
    taskType: 'fix_leak',
    items: [
      { catalogItemId: 'cat_teflon_tape', qtyPerUnit: 1 },
      { catalogItemId: 'cat_pipe_wrench_note', qtyPerUnit: 0 }, // tool — no buy
    ],
  });

  // Catalog — with Денис's van stock levels
  // Scenario: some items stocked, some empty in van
  db.seed('inventory_catalog', 'cat_outlet_15a', {
    name: 'Outlet 15A Duplex (white)',
    unit: 'шт',
    avgPrice: 2.8,
    stockByLocation: { 'van-denis': 1, 'warehouse-miami': 40 },
    totalStock: 41,
  });
  db.seed('inventory_catalog', 'cat_switch_spst', {
    name: 'Switch SPST (white)',
    unit: 'шт',
    avgPrice: 1.9,
    stockByLocation: { 'van-denis': 5, 'warehouse-miami': 30 },
    totalStock: 35,
  });
  db.seed('inventory_catalog', 'cat_gfci_15a', {
    name: 'GFCI Outlet 15A',
    unit: 'шт',
    avgPrice: 14.5,
    stockByLocation: { 'van-denis': 0, 'warehouse-miami': 3 },
    totalStock: 3,
  });
  db.seed('inventory_catalog', 'cat_wire_12', {
    name: 'Wire 12 AWG THHN',
    unit: 'м',
    avgPrice: 0.75,
    stockByLocation: { 'van-denis': 12, 'warehouse-miami': 250 },
    totalStock: 262,
  });
  db.seed('inventory_catalog', 'cat_box_single', {
    name: 'Electrical box (single gang, plastic)',
    unit: 'шт',
    avgPrice: 0.95,
    stockByLocation: { 'van-denis': 2, 'warehouse-miami': 25 },
    totalStock: 27,
  });
  db.seed('inventory_catalog', 'cat_wirenut', {
    name: 'Wire nut (yellow, 12-10 AWG)',
    unit: 'шт',
    avgPrice: 0.12,
    stockByLocation: { 'van-denis': 30, 'warehouse-miami': 500 },
    totalStock: 530,
  });
  db.seed('inventory_catalog', 'cat_ceiling_fan', {
    name: 'Ceiling Fan 52" w/light',
    unit: 'шт',
    avgPrice: 89,
    stockByLocation: { 'van-denis': 0, 'warehouse-miami': 0 },
    totalStock: 0,
  });
  db.seed('inventory_catalog', 'cat_fan_box', {
    name: 'Fan support box (ceiling)',
    unit: 'шт',
    avgPrice: 6.5,
    stockByLocation: { 'van-denis': 1, 'warehouse-miami': 4 },
    totalStock: 5,
  });
  db.seed('inventory_catalog', 'cat_teflon_tape', {
    name: 'Teflon tape 1/2"',
    unit: 'рул',
    avgPrice: 1.5,
    stockByLocation: { 'van-denis': 3, 'warehouse-miami': 10 },
    totalStock: 13,
  });
}

// ═══════════════════════════════════════════════════════════════════
//  Telegram-style formatter (what user would actually see)
// ═══════════════════════════════════════════════════════════════════

function formatPlanForTelegram(userInput: string, plan: TripPlan): string {
  const lines: string[] = [];
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`📲 USER INPUT: "${userInput}"`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');

  const dest = plan.destination.clientName || plan.destination.address || '—';
  const when = plan.plannedDate || '—';
  lines.push(`📋 *План поездки к ${dest}* (${when})`);
  lines.push('');

  if (plan.parsedTasks.length > 0) {
    lines.push('*Работы:*');
    for (const t of plan.parsedTasks) {
      lines.push(`  • ${t.description} (${t.type} × ${t.qty})`);
    }
    lines.push('');
  }

  const toBuy = plan.proposedItems.filter((p) => p.qtyToBuy > 0);
  const inStock = plan.proposedItems.filter((p) => p.qtyToBuy === 0 && p.qtyNeeded > 0);

  if (inStock.length > 0) {
    lines.push('✅ *Есть в van:*');
    for (const p of inStock) {
      lines.push(`  • ${p.name}: нужно ${p.qtyNeeded} ${p.unit}, в van ${p.qtyOnHand}`);
    }
    lines.push('');
  }

  if (toBuy.length > 0) {
    lines.push('🛒 *Купить:*');
    for (const p of toBuy) {
      const price = p.estimatedPrice ? ` ≈ $${p.estimatedPrice.toFixed(2)}` : '';
      lines.push(`  • ${p.name}: ${p.qtyToBuy} ${p.unit}${price}`);
    }
    lines.push('');
    if (plan.estimatedTotal) {
      lines.push(`💵 *Примерный чек: $${plan.estimatedTotal.toFixed(2)}*`);
      lines.push('');
    }
  } else if (plan.proposedItems.length > 0) {
    lines.push('🎉 *Всё есть в van — покупать нечего.*');
    lines.push('');
  }

  if (plan.warnings.length > 0) {
    lines.push('⚠️  *Предупреждения:*');
    for (const w of plan.warnings) lines.push(`  • ${w}`);
    lines.push('');
  }

  lines.push('[ ✅ Собрать список ]  [ ✏️ Изменить ]  [ ❌ Отмена ]');
  lines.push('');
  lines.push(`(tripId: ${plan.tripId}, status: ${plan.status})`);
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════
//  Test scenarios (what Gemini would parse user text into)
// ═══════════════════════════════════════════════════════════════════

const SCENARIOS: Array<{
  label: string;
  userInput: string;
  intent: ParsedIntent;
  currentLocationId: string;
}> = [
  {
    label: 'Сценарий 1 — многозадачный визит с нехваткой',
    userInput: 'завтра еду к Dvorkin — поставить 3 розетки и заменить выключатель в холле',
    currentLocationId: 'van-denis',
    intent: {
      destination: { clientHint: 'Dvorkin', addressHint: null },
      plannedDate: 'tomorrow',
      tasks: [
        { type: 'install_outlet', qty: 3, description: 'поставить 3 розетки' },
        { type: 'replace_switch', qty: 1, description: 'заменить выключатель в холле' },
      ],
    },
  },
  {
    label: 'Сценарий 2 — большая задача, всё надо купить',
    userInput: 'через 2 дня у Sarah — повесить 2 потолочных вентилятора на кухне и в гостиной',
    currentLocationId: 'van-denis',
    intent: {
      destination: { clientHint: 'Sarah', addressHint: null },
      plannedDate: '2026-04-20',
      tasks: [
        { type: 'install_fan', qty: 2, description: 'повесить 2 потолочных вентилятора' },
      ],
    },
  },
  {
    label: 'Сценарий 3 — всё есть в van + неизвестная задача',
    userInput: 'сегодня к Mike фикс течи под раковиной и поменять 1 выключатель + посмотреть кондиционер',
    currentLocationId: 'van-denis',
    intent: {
      destination: { clientHint: 'Mike', addressHint: null },
      plannedDate: 'today',
      tasks: [
        { type: 'fix_leak', qty: 1, description: 'фикс течи под раковиной' },
        { type: 'replace_switch', qty: 1, description: 'поменять 1 выключатель' },
        { type: 'inspect_hvac', qty: 1, description: 'посмотреть кондиционер' }, // no norm
      ],
    },
  },
];

// ═══════════════════════════════════════════════════════════════════
//  Run
// ═══════════════════════════════════════════════════════════════════

async function run() {
  const db = new FakeDb();
  seed(db);

  for (const scenario of SCENARIOS) {
    console.log('\n\n');
    console.log('┌─────────────────────────────────────────────────────────────┐');
    console.log(`│  ${scenario.label.padEnd(59)}│`);
    console.log('└─────────────────────────────────────────────────────────────┘');

    const plan = await buildPlanFromIntent(
      db as any,
      { userId: 'denis', text: scenario.userInput, currentLocationId: scenario.currentLocationId },
      scenario.intent,
      scenario.userInput
    );

    console.log(formatPlanForTelegram(scenario.userInput, plan));
  }

  console.log('\n\n✓ Demo complete.\n');
}

run().catch((e) => {
  console.error('Demo failed:', e);
  process.exit(1);
});
