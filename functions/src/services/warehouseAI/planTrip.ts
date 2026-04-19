/**
 * Warehouse AI — planTrip orchestrator
 *
 * Flow:
 *   1. parseIntent() via Gemini
 *   2. matchNorms() against inventory_norms
 *   3. resolveStock() via inventory_catalog
 *   4. buildPlan() → ProposedItem[] with delta (needed − onHand = toBuy)
 *   5. persistSession() — save plan to warehouse_ai_sessions/{userId}
 *   6. logEvent() — warehouse_ai_events
 *
 * Every sub-step is exported so tests can exercise them independently.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions';
import { parseIntent } from './gemini';
import type {
  CatalogItemSnapshot,
  NormRecord,
  ParsedIntent,
  ParsedTask,
  PlanTripInput,
  ProposedItem,
  TripPlan,
  WarehouseAIEvent,
  WarehouseAIEventType,
} from './types';

// ═══════════════════════════════════════════════════════════════════
//  NORM MATCHING
// ═══════════════════════════════════════════════════════════════════

/**
 * Look up norms for a list of parsed task types.
 * Returns a map: taskType -> NormRecord (or undefined if no norm).
 *
 * Reads from `inventory_norms` collection. Silently returns an empty
 * map if the collection doesn't exist — the caller falls back to AI
 * suggestions.
 */
export async function matchNorms(
  db: admin.firestore.Firestore,
  taskTypes: string[]
): Promise<Map<string, NormRecord>> {
  const result = new Map<string, NormRecord>();
  if (taskTypes.length === 0) return result;

  // Firestore `in` supports up to 30 values; chunk defensively
  const uniqueTypes = Array.from(new Set(taskTypes));
  const chunks: string[][] = [];
  for (let i = 0; i < uniqueTypes.length; i += 30) {
    chunks.push(uniqueTypes.slice(i, i + 30));
  }

  for (const chunk of chunks) {
    try {
      const snap = await db
        .collection('inventory_norms')
        .where('taskType', 'in', chunk)
        .get();
      for (const doc of snap.docs) {
        const data = doc.data() as any;
        if (!data || typeof data.taskType !== 'string') continue;
        const items = Array.isArray(data.items)
          ? data.items
              .filter((it: any) => it && typeof it.catalogItemId === 'string' && typeof it.qtyPerUnit === 'number')
              .map((it: any) => ({
                catalogItemId: it.catalogItemId,
                qtyPerUnit: Number(it.qtyPerUnit),
              }))
          : [];
        if (items.length === 0) continue;
        result.set(data.taskType, { id: doc.id, taskType: data.taskType, items });
      }
    } catch (e: any) {
      logger.warn('WarehouseAI: matchNorms chunk failed', { error: e.message, chunk });
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════
//  STOCK RESOLUTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Fetch catalog items by id. Returns a map id -> snapshot.
 * Items not found are simply missing from the map.
 */
export async function resolveStock(
  db: admin.firestore.Firestore,
  catalogItemIds: string[]
): Promise<Map<string, CatalogItemSnapshot>> {
  const result = new Map<string, CatalogItemSnapshot>();
  if (catalogItemIds.length === 0) return result;

  const uniqueIds = Array.from(new Set(catalogItemIds));

  // Read by document reference in parallel (up to a sensible limit).
  // Using individual gets avoids the Firestore "in" 30-item cap and
  // keeps the code symmetric regardless of id count.
  const reads = uniqueIds.map(async (id) => {
    try {
      const doc = await db.collection('inventory_catalog').doc(id).get();
      if (!doc.exists) return null;
      const data = doc.data() as any;
      const stockByLocation: Record<string, number> =
        data?.stockByLocation && typeof data.stockByLocation === 'object' ? data.stockByLocation : {};
      const snapshot: CatalogItemSnapshot = {
        id: doc.id,
        name: typeof data?.name === 'string' ? data.name : '(unnamed)',
        unit: typeof data?.unit === 'string' ? data.unit : 'шт',
        avgPrice: typeof data?.avgPrice === 'number' ? data.avgPrice : 0,
        stockByLocation,
        totalStock:
          typeof data?.totalStock === 'number'
            ? data.totalStock
            : Object.values(stockByLocation).reduce((a: number, b: any) => a + (Number(b) || 0), 0),
      };
      return snapshot;
    } catch (e: any) {
      logger.warn('WarehouseAI: resolveStock item failed', { id, error: e.message });
      return null;
    }
  });

  const snapshots = await Promise.all(reads);
  for (const snap of snapshots) {
    if (snap) result.set(snap.id, snap);
  }
  return result;
}

/**
 * Return on-hand qty at a specific location, or totalStock if no location
 * specified. Defaults to 0 if the item or location is missing.
 */
export function qtyAtLocation(item: CatalogItemSnapshot, locationId?: string): number {
  if (!locationId) return item.totalStock || 0;
  return item.stockByLocation[locationId] || 0;
}

// ═══════════════════════════════════════════════════════════════════
//  PLAN BUILDING
// ═══════════════════════════════════════════════════════════════════

/**
 * Combine tasks × norms × stock into ProposedItem[].
 * Items without a matched norm contribute a warning (no default qty
 * guess — we don't want to make up numbers).
 */
export function buildProposedItems(
  tasks: ParsedTask[],
  norms: Map<string, NormRecord>,
  catalog: Map<string, CatalogItemSnapshot>,
  currentLocationId?: string
): { proposed: ProposedItem[]; warnings: string[] } {
  const warnings: string[] = [];
  // Aggregate qty-needed per catalogItemId across all tasks
  const neededByItem = new Map<string, number>();

  for (const task of tasks) {
    const norm = norms.get(task.type);
    if (!norm) {
      warnings.push(`Нет норматива для "${task.type}" — пропущено (задай норму вручную)`);
      continue;
    }
    task.normId = norm.id;
    for (const ni of norm.items) {
      const required = ni.qtyPerUnit * task.qty;
      neededByItem.set(ni.catalogItemId, (neededByItem.get(ni.catalogItemId) || 0) + required);
    }
  }

  const proposed: ProposedItem[] = [];
  for (const [itemId, qtyNeeded] of neededByItem) {
    const snapshot = catalog.get(itemId);
    if (!snapshot) {
      proposed.push({
        catalogItemId: itemId,
        name: `(unknown item ${itemId})`,
        unit: 'шт',
        qtyNeeded,
        qtyOnHand: 0,
        qtyToBuy: qtyNeeded,
        source: 'norm',
        warning: 'Позиция не найдена в каталоге — проверь inventory_catalog',
      });
      warnings.push(`Каталог не содержит item ${itemId}`);
      continue;
    }
    const onHand = qtyAtLocation(snapshot, currentLocationId);
    const toBuy = Math.max(0, qtyNeeded - onHand);
    const proposedItem: ProposedItem = {
      catalogItemId: snapshot.id,
      name: snapshot.name,
      unit: snapshot.unit,
      qtyNeeded,
      qtyOnHand: onHand,
      qtyToBuy: toBuy,
      source: 'norm',
    };
    if (toBuy > 0) {
      proposedItem.estimatedPrice = Math.round(toBuy * snapshot.avgPrice * 100) / 100;
    }
    proposed.push(proposedItem);
  }

  // Stable ordering: items to buy first, then "already have" (qtyToBuy=0)
  proposed.sort((a, b) => {
    if (a.qtyToBuy === 0 && b.qtyToBuy > 0) return 1;
    if (a.qtyToBuy > 0 && b.qtyToBuy === 0) return -1;
    return a.name.localeCompare(b.name);
  });

  return { proposed, warnings };
}

/**
 * Compute the total estimated cost across items that need buying.
 */
export function sumEstimatedTotal(proposed: ProposedItem[]): number {
  const total = proposed.reduce((acc, p) => acc + (p.estimatedPrice || 0), 0);
  return Math.round(total * 100) / 100;
}

// ═══════════════════════════════════════════════════════════════════
//  CLIENT FUZZY MATCH (minimal — no Fuse dependency at service layer)
// ═══════════════════════════════════════════════════════════════════

/**
 * Best-effort client resolution. Returns {clientId, clientName} if one
 * clear match; otherwise {clientName: hint} so the UI can ask the user
 * to pick.
 *
 * Keeps it simple: exact+case-insensitive substring match on `name`.
 * Fuzzy (Fuse.js) lives in route layer via agentHelpers — this service
 * only needs deterministic lookup for tests.
 */
export async function resolveClient(
  db: admin.firestore.Firestore,
  hint: string | null
): Promise<{ clientId?: string; clientName?: string }> {
  if (!hint) return {};
  const normalized = hint.toLowerCase().trim();
  try {
    const snap = await db.collection('clients').limit(500).get();
    const matches = snap.docs
      .map((d) => ({ id: d.id, name: String((d.data() as any)?.name || '') }))
      .filter((c) => c.name && c.name.toLowerCase().includes(normalized));
    if (matches.length === 1) {
      return { clientId: matches[0].id, clientName: matches[0].name };
    }
  } catch (e: any) {
    logger.warn('WarehouseAI: resolveClient failed', { error: e.message });
  }
  return { clientName: hint };
}

// ═══════════════════════════════════════════════════════════════════
//  SESSION + EVENTS
// ═══════════════════════════════════════════════════════════════════

function generateTripId(): string {
  // Short sortable id — avoids extra deps. `Date.now` + random suffix.
  return `trip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function persistSession(
  db: admin.firestore.Firestore,
  userId: string,
  plan: TripPlan
): Promise<void> {
  const now = Date.now();
  const ref = db.collection('warehouse_ai_sessions').doc(userId);
  await ref.set(
    {
      activeTrip: { ...plan, updatedAtMs: now },
      recentTripIds: admin.firestore.FieldValue.arrayUnion(plan.tripId),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

export async function logWarehouseAIEvent(
  db: admin.firestore.Firestore,
  userId: string,
  type: WarehouseAIEventType,
  payload: Record<string, unknown>,
  tripId?: string
): Promise<void> {
  const now = Date.now();
  const eventId = `${type}_${now}_${Math.random().toString(36).slice(2, 6)}`;
  const event: WarehouseAIEvent = {
    eventId,
    userId,
    type,
    tripId,
    payload,
    createdAtMs: now,
  };
  try {
    await db.collection('warehouse_ai_events').doc(eventId).set({
      ...event,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e: any) {
    logger.warn('WarehouseAI: logEvent failed (non-fatal)', { error: e.message, type });
  }
}

// ═══════════════════════════════════════════════════════════════════
//  ENTRY POINT
// ═══════════════════════════════════════════════════════════════════

export async function planTrip(
  db: admin.firestore.Firestore,
  input: PlanTripInput
): Promise<TripPlan> {
  const originalText = (input.text || '').trim();

  const parseResult = await parseIntent(originalText);
  if (!parseResult.ok) {
    const plan: TripPlan = {
      tripId: generateTripId(),
      originalText,
      destination: {},
      plannedDate: null,
      parsedTasks: [],
      proposedItems: [],
      status: 'draft',
      warnings: [failureReasonToMessage(parseResult.reason)],
      createdAtMs: Date.now(),
    };
    await logWarehouseAIEvent(
      db,
      input.userId,
      'parse_failed',
      { reason: parseResult.reason, raw: parseResult.raw },
      plan.tripId
    );
    return plan;
  }

  return await buildPlanFromIntent(db, input, parseResult.intent, originalText);
}

/**
 * Second half of planTrip — exported so tests can feed in a known
 * ParsedIntent without involving Gemini.
 */
export async function buildPlanFromIntent(
  db: admin.firestore.Firestore,
  input: PlanTripInput,
  intent: ParsedIntent,
  originalText: string
): Promise<TripPlan> {
  const tripId = generateTripId();
  const warnings: string[] = [];

  // Resolve client
  const clientRes = await resolveClient(db, intent.destination.clientHint);

  // Norm + stock resolution
  const taskTypes = intent.tasks.map((t) => t.type);
  const norms = await matchNorms(db, taskTypes);
  const allItemIds = Array.from(norms.values()).flatMap((n) => n.items.map((i) => i.catalogItemId));
  const catalog = await resolveStock(db, allItemIds);
  const { proposed, warnings: buildWarnings } = buildProposedItems(
    intent.tasks,
    norms,
    catalog,
    input.currentLocationId
  );
  warnings.push(...buildWarnings);

  const estimatedTotal = sumEstimatedTotal(proposed);
  const toBuy = proposed.filter((p) => p.qtyToBuy > 0);
  const allInStock = proposed.length > 0 && toBuy.length === 0;

  const plan: TripPlan = {
    tripId,
    originalText,
    destination: {
      clientId: clientRes.clientId,
      clientName: clientRes.clientName,
      address: intent.destination.addressHint || undefined,
    },
    plannedDate: intent.plannedDate,
    parsedTasks: intent.tasks,
    proposedItems: proposed,
    estimatedTotal: toBuy.length > 0 ? estimatedTotal : undefined,
    status: 'draft',
    warnings,
    createdAtMs: Date.now(),
  };

  await persistSession(db, input.userId, plan);
  await logWarehouseAIEvent(
    db,
    input.userId,
    'trip_planned',
    {
      taskCount: intent.tasks.length,
      itemCount: proposed.length,
      toBuyCount: toBuy.length,
      estimatedTotal,
      allInStock,
    },
    tripId
  );

  if (norms.size === 0) {
    await logWarehouseAIEvent(db, input.userId, 'no_norm_found', { taskTypes }, tripId);
  }
  if (allInStock) {
    await logWarehouseAIEvent(db, input.userId, 'all_in_stock', { itemCount: proposed.length }, tripId);
  }

  return plan;
}

function failureReasonToMessage(reason: string): string {
  switch (reason) {
    case 'not_a_trip':
      return 'Это не похоже на план поездки. Опиши что и у кого делаешь.';
    case 'too_vague':
      return 'Слишком общо. Уточни: что за работа и сколько единиц.';
    case 'ai_unavailable':
      return 'AI временно недоступен, попробуй через минуту.';
    case 'parse_error':
      return 'Не смог разобрать ответ AI. Попробуй переформулировать.';
    default:
      return 'Не получилось распарсить запрос.';
  }
}

// ═══════════════════════════════════════════════════════════════════
//  SESSION MUTATIONS
// ═══════════════════════════════════════════════════════════════════

export async function confirmTrip(
  db: admin.firestore.Firestore,
  userId: string,
  tripId: string
): Promise<{ status: 'confirmed' | 'not_found' }> {
  const ref = db.collection('warehouse_ai_sessions').doc(userId);
  const snap = await ref.get();
  const data = snap.data() as any;
  if (!data?.activeTrip || data.activeTrip.tripId !== tripId) {
    return { status: 'not_found' };
  }
  await ref.set(
    {
      activeTrip: {
        ...data.activeTrip,
        status: 'confirmed' as const,
        updatedAtMs: Date.now(),
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  await logWarehouseAIEvent(db, userId, 'trip_confirmed', {}, tripId);
  return { status: 'confirmed' };
}

export async function cancelTrip(
  db: admin.firestore.Firestore,
  userId: string,
  tripId: string
): Promise<{ status: 'cancelled' | 'not_found' }> {
  const ref = db.collection('warehouse_ai_sessions').doc(userId);
  const snap = await ref.get();
  const data = snap.data() as any;
  if (!data?.activeTrip || data.activeTrip.tripId !== tripId) {
    return { status: 'not_found' };
  }
  await ref.set(
    {
      activeTrip: {
        ...data.activeTrip,
        status: 'cancelled' as const,
        updatedAtMs: Date.now(),
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  await logWarehouseAIEvent(db, userId, 'trip_cancelled', {}, tripId);
  return { status: 'cancelled' };
}
