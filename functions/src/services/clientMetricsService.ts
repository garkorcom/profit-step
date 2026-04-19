/**
 * ClientMetricsService — computes and materializes Client Card V2 metrics.
 *
 * Spec: docs/tasks/CLIENT_CARD_V2_SPEC.md §2.3 + §5.4 + §7.1.
 *
 * Source of truth for materialized fields on `clients` documents:
 *   - ltv, totalMargin, avgPaymentDelayDays
 *   - lastContactAt
 *   - activeDealsCount, activeProjectsCount, openOverdueTasks
 *   - healthScore (0-100), churnRisk (low/medium/high)
 *   - computedAt
 *
 * Callers:
 *   - scheduled cron (recomputeClientMetrics) — daily full rebuild
 *   - Firestore triggers (onInvoicePaid/onMeetingCompleted/onDealStatusChange)
 *     — partial on-write refresh
 *   - POST /api/clients/:id/recompute-metrics — admin on-demand
 */

import * as admin from 'firebase-admin';

export type ChurnRisk = 'low' | 'medium' | 'high';

export interface ClientMetrics {
  ltv: number;
  totalMargin: number;
  avgPaymentDelayDays: number | null;
  lastContactAt: admin.firestore.Timestamp | null;
  activeDealsCount: number;
  activeProjectsCount: number;
  openOverdueTasks: number;
  healthScore: number;
  churnRisk: ChurnRisk;
  computedAt: admin.firestore.Timestamp;
}

interface MetricsInputs {
  clientCreatedAt: admin.firestore.Timestamp | null;
  invoices: InvoiceLike[];
  deals: DealLike[];
  projects: ProjectLike[];
  meetings: MeetingLike[];
  tasks: TaskLike[];
  messagesLastContactAt: admin.firestore.Timestamp | null;
}

interface InvoiceLike {
  status?: string;
  total?: number;
  paidAt?: admin.firestore.Timestamp | null;
  dueDate?: admin.firestore.Timestamp | null;
}

interface DealLike {
  status?: string;
  stage?: string;
}

interface ProjectLike {
  status?: string;
}

interface MeetingLike {
  status?: string;
  endAt?: admin.firestore.Timestamp | null;
  startAt?: admin.firestore.Timestamp | null;
}

interface TaskLike {
  status?: string;
  dueDate?: admin.firestore.Timestamp | null;
  completedAt?: admin.firestore.Timestamp | null;
}

export class ClientMetricsService {
  constructor(
    private readonly db: admin.firestore.Firestore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Fetch inputs for a client and compute fresh metrics. Does NOT write back
   * — caller decides when to persist (via `writeMetricsToClient`).
   */
  async recomputeClientMetrics(clientId: string): Promise<ClientMetrics> {
    const clientSnap = await this.db.collection('clients').doc(clientId).get();
    if (!clientSnap.exists) {
      throw new Error(`client ${clientId} not found`);
    }
    const client = clientSnap.data() as { createdAt?: admin.firestore.Timestamp };

    const [invoicesSnap, dealsSnap, projectsSnap, meetingsSnap, tasksSnap] = await Promise.all([
      this.db.collection('invoices').where('clientId', '==', clientId).limit(500).get(),
      this.db.collection('deals').where('clientId', '==', clientId).limit(200).get(),
      this.db.collection('projects').where('clientId', '==', clientId).limit(200).get(),
      this.db.collection('meetings').where('clientId', '==', clientId).limit(200).get(),
      this.db.collection('gtd_tasks').where('clientId', '==', clientId).limit(500).get(),
    ]);

    return this.computeFromInputs({
      clientCreatedAt: client.createdAt ?? null,
      invoices: invoicesSnap.docs.map(d => d.data() as InvoiceLike),
      deals: dealsSnap.docs.map(d => d.data() as DealLike),
      projects: projectsSnap.docs.map(d => d.data() as ProjectLike),
      meetings: meetingsSnap.docs.map(d => d.data() as MeetingLike),
      tasks: tasksSnap.docs.map(d => d.data() as TaskLike),
      messagesLastContactAt: null,
    });
  }

  /**
   * Pure compute — takes pre-fetched inputs, returns metrics.
   * Exposed separately so unit tests can exercise algorithm without Firestore.
   */
  computeFromInputs(inputs: MetricsInputs): ClientMetrics {
    const nowMs = this.now().getTime();

    // ── LTV + margin from invoices ─────────────────────────────────
    const paidInvoices = inputs.invoices.filter(i => i.status === 'paid');
    const ltv = paidInvoices.reduce((s, i) => s + (i.total ?? 0), 0);
    const totalMargin = 0; // placeholder — estimates.internalMargin aggregation in Phase 1.3

    // ── Payment reliability ────────────────────────────────────────
    const paymentDelays: number[] = [];
    for (const inv of paidInvoices) {
      if (inv.dueDate && inv.paidAt) {
        const delayMs = inv.paidAt.toMillis() - inv.dueDate.toMillis();
        paymentDelays.push(delayMs / (1000 * 60 * 60 * 24));
      }
    }
    const avgPaymentDelayDays = paymentDelays.length > 0
      ? paymentDelays.reduce((s, d) => s + d, 0) / paymentDelays.length
      : null;
    const paymentReliability = avgPaymentDelayDays === null
      ? 0.5  // unknown — middle ground
      : clamp01(1 - avgPaymentDelayDays / 30); // 0 delay = 1.0, 30 days delay = 0.0

    // ── Last contact ───────────────────────────────────────────────
    const meetingTimes = inputs.meetings
      .filter(m => m.status === 'completed')
      .map(m => m.endAt?.toMillis() ?? m.startAt?.toMillis() ?? 0)
      .filter(t => t > 0);
    const lastMeetingMs = meetingTimes.length > 0 ? Math.max(...meetingTimes) : 0;
    const lastMessageMs = inputs.messagesLastContactAt?.toMillis() ?? 0;
    const lastContactMs = Math.max(lastMeetingMs, lastMessageMs);
    const lastContactAt = lastContactMs > 0
      ? admin.firestore.Timestamp.fromMillis(lastContactMs)
      : null;
    const daysSinceLastContact = lastContactMs > 0
      ? (nowMs - lastContactMs) / (1000 * 60 * 60 * 24)
      : 365;

    // ── Active counts ──────────────────────────────────────────────
    const activeDealsCount = inputs.deals.filter(d => d.status === 'open').length;
    const activeProjectsCount = inputs.projects.filter(p =>
      p.status === 'in_progress' || p.status === 'active',
    ).length;
    const openOverdueTasks = inputs.tasks.filter(t => {
      if (t.status === 'done' || t.completedAt) return false;
      return t.dueDate && t.dueDate.toMillis() < nowMs;
    }).length;

    // ── Deal health (ratio of open-progressing vs open-stalled) ────
    const openDeals = inputs.deals.filter(d => d.status === 'open');
    const stuckStages = ['прозвон', 'переговоры']; // deals stuck in talks
    const stuckCount = openDeals.filter(d =>
      stuckStages.includes((d.stage ?? '').toLowerCase()),
    ).length;
    const dealHealthScore = openDeals.length === 0
      ? 0.5 // no deals = neutral
      : clamp01(1 - stuckCount / openDeals.length);

    // ── Tenure weight ──────────────────────────────────────────────
    const tenureDays = inputs.clientCreatedAt
      ? (nowMs - inputs.clientCreatedAt.toMillis()) / (1000 * 60 * 60 * 24)
      : 0;
    const tenureWeight = clamp01(tenureDays / 365); // 1 year = full weight

    // ── LTV weight (normalize $0-$50k range) ───────────────────────
    const ltvWeight = clamp01(ltv / 50_000);

    // ── Contact freshness (log-decay) ──────────────────────────────
    // 0 days = 1.0, 7 days = 0.85, 30 days = 0.5, 90 days = 0.15, 180+ = 0
    const contactFreshness = clamp01(1 - Math.log1p(daysSinceLastContact) / Math.log1p(180));

    // ── Health score (weighted sum, 0-100) ─────────────────────────
    const healthScore = Math.round(
      clamp01(
        0.30 * contactFreshness +
        0.25 * dealHealthScore +
        0.20 * paymentReliability +
        0.15 * ltvWeight +
        0.10 * tenureWeight,
      ) * 100,
    );

    // ── Churn risk ─────────────────────────────────────────────────
    let churnRisk: ChurnRisk;
    if (daysSinceLastContact > 90 && activeDealsCount === 0) {
      churnRisk = 'high';
    } else if (paymentReliability < 0.5 || healthScore < 40) {
      churnRisk = 'medium';
    } else {
      churnRisk = 'low';
    }

    return {
      ltv,
      totalMargin,
      avgPaymentDelayDays,
      lastContactAt,
      activeDealsCount,
      activeProjectsCount,
      openOverdueTasks,
      healthScore,
      churnRisk,
      computedAt: admin.firestore.Timestamp.fromMillis(nowMs),
    };
  }

  async writeMetricsToClient(clientId: string, metrics: ClientMetrics): Promise<void> {
    await this.db
      .collection('clients')
      .doc(clientId)
      .update({
        ltv: metrics.ltv,
        totalMargin: metrics.totalMargin,
        avgPaymentDelayDays: metrics.avgPaymentDelayDays,
        lastContactAt: metrics.lastContactAt,
        activeDealsCount: metrics.activeDealsCount,
        activeProjectsCount: metrics.activeProjectsCount,
        openOverdueTasks: metrics.openOverdueTasks,
        healthScore: metrics.healthScore,
        churnRisk: metrics.churnRisk,
        computedAt: metrics.computedAt,
      });
  }
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
