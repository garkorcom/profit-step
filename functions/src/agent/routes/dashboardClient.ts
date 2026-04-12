/**
 * Client Dashboard API — aggregated endpoints for the internal
 * client dashboard page (/dashboard/client/:id).
 *
 * Endpoints:
 *   GET /api/dashboard/client/:id/summary
 *   GET /api/dashboard/client/:id/labor-log
 *   GET /api/dashboard/client/:id/timeline
 *   GET /api/dashboard/client/:id/costs-breakdown
 *
 * All endpoints require authMiddleware (Bearer token).
 * Data is aggregated server-side from Firestore collections:
 *   clients, estimates, costs, work_sessions, projects
 */

import { Router, Request, Response, NextFunction } from 'express';
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions';
import {
  ClientIdParamSchema,
  LaborLogQuerySchema,
  TimelineQuerySchema,
  computeMarginColor,
  type RedFlag,
  type ClientSummaryResponse,
  type LaborLogResponse,
  type LaborEmployee,
  type TimelineEvent,
  type TimelineResponse,
  type CostCategory,
  type CostsBreakdownResponse,
} from '../schemas/dashboardClientSchemas';
import { requireScope } from '../agentMiddleware';

const router = Router();
const db = admin.firestore();

// ─── Helpers ───────────────────────────────────────────────────────

function toIso(ts: admin.firestore.Timestamp | undefined | null): string {
  if (!ts || typeof ts.toDate !== 'function') return '';
  return ts.toDate().toISOString();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Compute how many ms ago a Timestamp was */
function msAgo(ts: admin.firestore.Timestamp | undefined | null): number {
  if (!ts || typeof ts.toDate !== 'function') return Infinity;
  return Date.now() - ts.toDate().getTime();
}

/** Map cost categories to the 4-bucket model used by the dashboard */
function mapCostCategory(cat: string): 'materials' | 'subcontractors' | 'other' {
  switch (cat) {
    case 'materials':
    case 'tools':
      return 'materials';
    // Future: if a 'subcontractor' category is added, map here
    default:
      return 'other';
  }
}

// ─── Red Flags Engine ──────────────────────────────────────────────

interface FinancialSnapshot {
  estimateTotal: number;
  totalSpent: number;
  materialsCost: number;
  laborCost: number;
  subsCost: number;
  otherCost: number;
  invoiced: number;
  received: number;
  balance: number;
  profit: number;
  marginPercent: number;
  lastSessionTime: admin.firestore.Timestamp | null;
}

function computeRedFlags(snap: FinancialSnapshot): RedFlag[] {
  const flags: RedFlag[] = [];

  // 1. low_margin (red): marginPercent < 20
  if (snap.invoiced > 0 && snap.marginPercent < 20) {
    flags.push({
      code: 'low_margin',
      severity: 'red',
      title: 'Low margin',
      description: `Margin ${snap.marginPercent.toFixed(1)}% — below 20% threshold`,
      value: snap.marginPercent,
      threshold: 20,
    });
  }

  // 2. over_budget (red): spent > estimated
  if (snap.estimateTotal > 0 && snap.totalSpent > snap.estimateTotal) {
    const over = snap.totalSpent - snap.estimateTotal;
    flags.push({
      code: 'over_budget',
      severity: 'red',
      title: 'Over budget',
      description: `Over by $${round2(over).toLocaleString()} on estimate $${round2(snap.estimateTotal).toLocaleString()}`,
      value: over,
      threshold: snap.estimateTotal,
    });
  }

  // 3. unpaid_14d (red): balance > 0 and no recent payment
  if (snap.balance > 0 && snap.invoiced > 0) {
    // We simplify: if there's outstanding balance, flag it
    flags.push({
      code: 'unpaid_14d',
      severity: 'red',
      title: 'Outstanding balance',
      description: `Balance $${round2(snap.balance).toLocaleString()} outstanding`,
      value: snap.balance,
      threshold: 0,
    });
  }

  // 4. stagnation (yellow): no work session in > 48h on a weekday
  if (snap.lastSessionTime) {
    const hoursSinceSession = msAgo(snap.lastSessionTime) / (1000 * 60 * 60);
    const now = new Date();
    const dayOfWeek = now.getDay();
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
    if (hoursSinceSession > 48 && isWeekday) {
      flags.push({
        code: 'stagnation',
        severity: 'yellow',
        title: 'Stagnation',
        description: `No activity for ${Math.round(hoursSinceSession)}h`,
        value: hoursSinceSession,
        threshold: 48,
      });
    }
  }

  // 5. unbilled_work (yellow): labor+materials > invoiced + $5000
  const workValue = snap.laborCost + snap.materialsCost;
  if (workValue > snap.invoiced + 5000) {
    flags.push({
      code: 'unbilled_work',
      severity: 'yellow',
      title: 'Unbilled work',
      description: `$${round2(workValue).toLocaleString()} in work, invoiced only $${round2(snap.invoiced).toLocaleString()}`,
      value: workValue - snap.invoiced,
      threshold: 5000,
    });
  }

  // 6. ar_high (red): balance > $10,000
  if (snap.balance > 10000) {
    flags.push({
      code: 'ar_high',
      severity: 'red',
      title: 'High AR',
      description: `Balance $${round2(snap.balance).toLocaleString()} — critical`,
      value: snap.balance,
      threshold: 10000,
    });
  }

  // Sort: red first, then yellow
  flags.sort((a, b) => {
    if (a.severity === 'red' && b.severity === 'yellow') return -1;
    if (a.severity === 'yellow' && b.severity === 'red') return 1;
    return 0;
  });

  return flags;
}

// ─── GET /api/dashboard/client/:id/summary ─────────────────────────

router.get(
  '/api/dashboard/client/:id/summary',
  requireScope('dashboard:read', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id: clientId } = ClientIdParamSchema.parse(req.params);
      logger.info(`📊 dashboard:client:summary clientId=${clientId}`);

      // 1. Load client
      const clientDoc = await db.collection('clients').doc(clientId).get();
      if (!clientDoc.exists) {
        res.status(404).json({ error: 'Client not found' });
        return;
      }
      const client = clientDoc.data()!;

      // 2. Load estimates (approved/converted for totals, all for display)
      const estimatesSnap = await db
        .collection('estimates')
        .where('clientId', '==', clientId)
        .get();
      let estimateTotal = 0;
      estimatesSnap.docs.forEach(d => {
        const est = d.data();
        if (['approved', 'converted', 'sent'].includes(est.status)) {
          estimateTotal += est.total || 0;
        }
      });

      // 3. Load costs
      const costsSnap = await db
        .collection('costs')
        .where('clientId', '==', clientId)
        .get();
      let materialsCost = 0;
      let subsCost = 0;
      let otherCost = 0;
      costsSnap.docs.forEach(d => {
        const cost = d.data();
        const amt = Math.abs(cost.amount || 0);
        const bucket = mapCostCategory(cost.category);
        if (bucket === 'materials') materialsCost += amt;
        else if (bucket === 'subcontractors') subsCost += amt;
        else otherCost += amt;
      });

      // 4. Load completed work sessions → labor cost
      const sessionsSnap = await db
        .collection('work_sessions')
        .where('clientId', '==', clientId)
        .where('status', '==', 'completed')
        .get();
      let laborCost = 0;
      let lastSessionTime: admin.firestore.Timestamp | null = null;
      sessionsSnap.docs.forEach(d => {
        const sess = d.data();
        laborCost += sess.sessionEarnings || 0;
        const st = sess.endTime || sess.startTime;
        if (st && (!lastSessionTime || st.toMillis() > lastSessionTime.toMillis())) {
          lastSessionTime = st;
        }
      });

      // 5. Load projects for invoiced/received (debit=invoiced, credit=received)
      const projectsSnap = await db
        .collection('projects')
        .where('clientId', '==', clientId)
        .get();
      let invoiced = 0;
      let received = 0;
      projectsSnap.docs.forEach(d => {
        const proj = d.data();
        invoiced += proj.totalDebit || 0;
        received += proj.totalCredit || 0;
      });

      // 6. Compute aggregates
      const totalSpent = materialsCost + laborCost + subsCost + otherCost;
      const balance = invoiced - received;
      const profit = received - totalSpent;
      const marginPercent = received > 0 ? round2((profit / received) * 100) : 0;

      const financialSnap: FinancialSnapshot = {
        estimateTotal,
        totalSpent,
        materialsCost,
        laborCost,
        subsCost,
        otherCost,
        invoiced,
        received,
        balance,
        profit,
        marginPercent,
        lastSessionTime,
      };

      const response: ClientSummaryResponse = {
        clientId,
        clientName: client.name || '',
        clientAddress: client.address || client.workLocation?.address || '',
        clientPhone: client.phone || '',
        clientType: client.type || 'residential',
        estimateTotal: round2(estimateTotal),
        materialsCost: round2(materialsCost),
        laborCost: round2(laborCost),
        subsCost: round2(subsCost),
        otherCost: round2(otherCost),
        totalSpent: round2(totalSpent),
        invoiced: round2(invoiced),
        received: round2(received),
        balance: round2(balance),
        profit: round2(profit),
        marginPercent,
        marginColor: computeMarginColor(marginPercent),
        redFlags: computeRedFlags(financialSnap),
        updatedAt: new Date().toISOString(),
      };

      res.json(response);
    } catch (e) {
      next(e);
    }
  }
);

// ─── GET /api/dashboard/client/:id/labor-log ───────────────────────

router.get(
  '/api/dashboard/client/:id/labor-log',
  requireScope('dashboard:read', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id: clientId } = ClientIdParamSchema.parse(req.params);
      const { period } = LaborLogQuerySchema.parse(req.query);
      logger.info(`📊 dashboard:client:labor-log clientId=${clientId} period=${period}`);

      // Compute date cutoff
      let cutoff: Date | null = null;
      const now = new Date();
      if (period === 'week') {
        cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else if (period === 'month') {
        cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      // Query completed sessions
      let q: admin.firestore.Query = db
        .collection('work_sessions')
        .where('clientId', '==', clientId)
        .where('status', '==', 'completed');

      if (cutoff) {
        q = q.where('startTime', '>=', admin.firestore.Timestamp.fromDate(cutoff));
      }

      const snap = await q.get();

      // Aggregate by employee
      const empMap = new Map<string, LaborEmployee>();
      snap.docs.forEach(d => {
        const sess = d.data();
        const empId = sess.employeeId || 'unknown';
        const existing = empMap.get(empId);
        const minutes = sess.durationMinutes || 0;
        const cost = sess.sessionEarnings || 0;
        const visitTime = sess.endTime || sess.startTime;

        if (existing) {
          existing.totalMinutes += minutes;
          existing.totalHours = round2(existing.totalMinutes / 60);
          existing.totalCost = round2(existing.totalCost + cost);
          existing.sessionCount += 1;
          if (visitTime && toIso(visitTime) > existing.lastVisit) {
            existing.lastVisit = toIso(visitTime);
          }
        } else {
          empMap.set(empId, {
            employeeId: empId,
            employeeName: sess.employeeName || 'Unknown',
            totalMinutes: minutes,
            totalHours: round2(minutes / 60),
            totalCost: round2(cost),
            lastVisit: toIso(visitTime),
            sessionCount: 1,
            efficiency: null, // TODO: compute if estimated hours available
          });
        }
      });

      const employees = Array.from(empMap.values()).sort(
        (a, b) => b.totalCost - a.totalCost
      );

      const totals = {
        hours: round2(employees.reduce((s, e) => s + e.totalHours, 0)),
        cost: round2(employees.reduce((s, e) => s + e.totalCost, 0)),
        sessions: employees.reduce((s, e) => s + e.sessionCount, 0),
      };

      const response: LaborLogResponse = { period, employees, totals };
      res.json(response);
    } catch (e) {
      next(e);
    }
  }
);

// ─── GET /api/dashboard/client/:id/timeline ────────────────────────

router.get(
  '/api/dashboard/client/:id/timeline',
  requireScope('dashboard:read', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id: clientId } = ClientIdParamSchema.parse(req.params);
      const { limit, offset } = TimelineQuerySchema.parse(req.query);
      logger.info(`📊 dashboard:client:timeline clientId=${clientId} limit=${limit} offset=${offset}`);

      // Collect events from multiple collections in parallel
      const [estimatesSnap, costsSnap, sessionsSnap, tasksSnap] = await Promise.all([
        db.collection('estimates').where('clientId', '==', clientId).get(),
        db.collection('costs').where('clientId', '==', clientId).get(),
        db.collection('work_sessions').where('clientId', '==', clientId).get(),
        db.collection('gtd_tasks').where('clientId', '==', clientId).get(),
      ]);

      const events: TimelineEvent[] = [];

      // Estimates
      estimatesSnap.docs.forEach(d => {
        const est = d.data();
        events.push({
          id: d.id,
          type: 'estimate_created',
          title: `Estimate ${est.number || d.id.slice(0, 8)}`,
          description: `${est.status} — $${(est.total || 0).toLocaleString()}`,
          amount: est.total || null,
          timestamp: toIso(est.createdAt),
          actorId: est.createdBy || null,
          actorName: null,
        });
      });

      // Costs
      costsSnap.docs.forEach(d => {
        const cost = d.data();
        events.push({
          id: d.id,
          type: 'cost_added',
          title: `Cost: ${cost.categoryLabel || cost.category}`,
          description: cost.description || `$${Math.abs(cost.amount || 0).toFixed(2)}`,
          amount: Math.abs(cost.amount || 0),
          timestamp: toIso(cost.createdAt),
          actorId: cost.createdBy || null,
          actorName: cost.userName || null,
        });
      });

      // Work sessions
      sessionsSnap.docs.forEach(d => {
        const sess = d.data();
        if (sess.startTime) {
          events.push({
            id: `${d.id}-start`,
            type: 'session_started',
            title: `Work session started`,
            description: sess.description || sess.relatedTaskTitle || '',
            amount: null,
            timestamp: toIso(sess.startTime),
            actorId: sess.employeeId || null,
            actorName: sess.employeeName || null,
          });
        }
        if (sess.status === 'completed' && sess.endTime) {
          events.push({
            id: `${d.id}-end`,
            type: 'session_ended',
            title: `Work session completed`,
            description: `${sess.durationMinutes || 0} min — $${(sess.sessionEarnings || 0).toFixed(2)}`,
            amount: sess.sessionEarnings || null,
            timestamp: toIso(sess.endTime),
            actorId: sess.employeeId || null,
            actorName: sess.employeeName || null,
          });
        }
      });

      // Tasks
      tasksSnap.docs.forEach(d => {
        const task = d.data();
        if (task.status === 'done' || task.status === 'completed') {
          events.push({
            id: d.id,
            type: 'task_completed',
            title: `Task completed: ${task.title || ''}`,
            description: '',
            amount: null,
            timestamp: toIso(task.completedAt || task.updatedAt),
            actorId: task.assigneeId || task.ownerId || null,
            actorName: task.assigneeName || null,
          });
        }
      });

      // Sort by timestamp descending (newest first)
      events.sort((a, b) => {
        if (!a.timestamp) return 1;
        if (!b.timestamp) return -1;
        return b.timestamp.localeCompare(a.timestamp);
      });

      const total = events.length;
      const paged = events.slice(offset, offset + limit);

      const response: TimelineResponse = {
        events: paged,
        hasMore: offset + limit < total,
        total,
      };
      res.json(response);
    } catch (e) {
      next(e);
    }
  }
);

// ─── GET /api/dashboard/client/:id/costs-breakdown ─────────────────

router.get(
  '/api/dashboard/client/:id/costs-breakdown',
  requireScope('dashboard:read', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id: clientId } = ClientIdParamSchema.parse(req.params);
      logger.info(`📊 dashboard:client:costs-breakdown clientId=${clientId}`);

      // Load costs + work sessions in parallel
      const [costsSnap, sessionsSnap] = await Promise.all([
        db.collection('costs').where('clientId', '==', clientId).get(),
        db
          .collection('work_sessions')
          .where('clientId', '==', clientId)
          .where('status', '==', 'completed')
          .get(),
      ]);

      // Build category buckets
      const buckets: Record<string, { amount: number; items: CostCategory['items'] }> = {
        materials: { amount: 0, items: [] },
        labor: { amount: 0, items: [] },
        subcontractors: { amount: 0, items: [] },
        other: { amount: 0, items: [] },
      };

      // Costs → materials/subcontractors/other
      costsSnap.docs.forEach(d => {
        const cost = d.data();
        const amt = Math.abs(cost.amount || 0);
        const bucket = mapCostCategory(cost.category);
        buckets[bucket].amount += amt;
        buckets[bucket].items.push({
          id: d.id,
          description: cost.description || cost.categoryLabel || cost.category,
          amount: round2(amt),
          date: toIso(cost.createdAt),
        });
      });

      // Work sessions → labor
      sessionsSnap.docs.forEach(d => {
        const sess = d.data();
        const earnings = sess.sessionEarnings || 0;
        if (earnings > 0) {
          buckets.labor.amount += earnings;
          buckets.labor.items.push({
            id: d.id,
            description: `${sess.employeeName || 'Unknown'} — ${sess.durationMinutes || 0} min`,
            amount: round2(earnings),
            date: toIso(sess.endTime || sess.startTime),
          });
        }
      });

      const total = Object.values(buckets).reduce((s, b) => s + b.amount, 0);

      const categories: CostCategory[] = (['materials', 'labor', 'subcontractors', 'other'] as const).map(
        cat => ({
          category: cat,
          amount: round2(buckets[cat].amount),
          percent: total > 0 ? round2((buckets[cat].amount / total) * 100) : 0,
          items: buckets[cat].items.sort(
            (a, b) => b.date.localeCompare(a.date)
          ),
        })
      );

      const response: CostsBreakdownResponse = {
        total: round2(total),
        categories: categories.filter(c => c.amount > 0),
      };
      res.json(response);
    } catch (e) {
      next(e);
    }
  }
);

export default router;
