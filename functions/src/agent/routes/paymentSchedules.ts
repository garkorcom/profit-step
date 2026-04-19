/**
 * Payment Schedule routes (Client Journey Sprint 3.2):
 *   POST /api/projects/:id/payment-schedule   — create schedule from template
 *   GET  /api/projects/:id/payment-schedule   — fetch
 *
 * A milestone is a row like { label, percent, trigger, status, invoiceId }.
 * `trigger` values:
 *   on_estimate_approved  — fires when estimate → approved (auto-first invoice)
 *   on_stage_act:<key>    — fires when a work_act with stage=key is signed
 *   on_final_act          — fires when final work_act is signed
 *   manual                — PM generates invoice manually
 *
 * Actual invoice generation happens in triggers/firestore/
 * paymentScheduleTriggers.ts + the onWorkActSigned handler (later PR).
 * This route just manages the schedule.
 */

import { Router } from 'express';
import * as admin from 'firebase-admin';

import { db, FieldValue, logger, logAgentActivity } from '../routeContext';

const router = Router();

const TEMPLATES: Record<string, Array<{ label: string; percent: number; trigger: string }>> = {
  standard_30_40_30: [
    { label: 'Аванс', percent: 30, trigger: 'on_estimate_approved' },
    { label: 'Промежуточный', percent: 40, trigger: 'on_stage_act:roughwork' },
    { label: 'Финальный', percent: 30, trigger: 'on_final_act' },
  ],
  small_50_50: [
    { label: 'Аванс', percent: 50, trigger: 'on_estimate_approved' },
    { label: 'Финальный', percent: 50, trigger: 'on_final_act' },
  ],
  four_stage: [
    { label: 'Аванс', percent: 25, trigger: 'on_estimate_approved' },
    { label: 'Демонтаж', percent: 25, trigger: 'on_stage_act:demo' },
    { label: 'Черновой', percent: 25, trigger: 'on_stage_act:roughwork' },
    { label: 'Сдача', percent: 25, trigger: 'on_final_act' },
  ],
};

// ─── POST /api/projects/:id/payment-schedule ──────────────────────

router.post('/api/projects/:id/payment-schedule', async (req, res, next) => {
  try {
    const projectId = req.params.id;
    const template = typeof req.body?.template === 'string' ? req.body.template : 'standard_30_40_30';
    const customMilestones = Array.isArray(req.body?.milestones) ? req.body.milestones : null;

    const projectSnap = await db.collection('projects').doc(projectId).get();
    if (!projectSnap.exists) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const milestonesTemplate = customMilestones ?? TEMPLATES[template];
    if (!milestonesTemplate || milestonesTemplate.length === 0) {
      res.status(400).json({
        error: 'Unknown template; pass one of standard_30_40_30 / small_50_50 / four_stage or custom milestones',
      });
      return;
    }

    // Validate percent sum
    type MilestoneTmpl = { label: string; percent: number; trigger?: string };
    const msArr = milestonesTemplate as MilestoneTmpl[];
    const sum = msArr.reduce((s: number, m: MilestoneTmpl) => s + (typeof m.percent === 'number' ? m.percent : 0), 0);
    if (Math.abs(sum - 100) > 0.01) {
      res.status(400).json({ error: `milestones.percent must sum to 100, got ${sum}` });
      return;
    }

    const doc = {
      projectId,
      template: customMilestones ? 'custom' : template,
      milestones: msArr.map((m: MilestoneTmpl, i: number) => ({
        order: i,
        label: m.label,
        percent: m.percent,
        trigger: m.trigger ?? 'manual',
        status: 'pending',
        invoiceId: null,
        paidAt: null,
      })),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const ref = await db.collection('payment_schedules').add(doc);
    await db.collection('projects').doc(projectId).update({
      paymentScheduleId: ref.id,
      updatedAt: FieldValue.serverTimestamp(),
    });

    logger.info('💰 payment-schedule:created', { projectId, scheduleId: ref.id, template: doc.template });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'payment_schedule_created',
      endpoint: `/api/projects/${projectId}/payment-schedule`,
      metadata: { projectId, scheduleId: ref.id, template: doc.template, milestoneCount: doc.milestones.length },
    });

    res.status(201).json({ projectId, scheduleId: ref.id, milestones: doc.milestones });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/projects/:id/payment-schedule ──────────────────────

router.get('/api/projects/:id/payment-schedule', async (req, res, next) => {
  try {
    const projectId = req.params.id;
    const projSnap = await db.collection('projects').doc(projectId).get();
    if (!projSnap.exists) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const scheduleId = projSnap.data()?.paymentScheduleId;
    if (!scheduleId) {
      res.json({ projectId, schedule: null });
      return;
    }
    const schedSnap = await db.collection('payment_schedules').doc(scheduleId).get();
    if (!schedSnap.exists) {
      res.json({ projectId, schedule: null });
      return;
    }
    const s = schedSnap.data()!;
    res.json({
      projectId,
      scheduleId: schedSnap.id,
      template: s.template,
      milestones: s.milestones ?? [],
      createdAt: s.createdAt?.toDate?.()?.toISOString() ?? null,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * Helper used by trigger — generates an invoice for a specific milestone
 * and marks it invoiced. Exported for use from Firestore triggers.
 *
 * Split from route handler so backend code can call it directly without
 * going through HTTP.
 */
export async function generateMilestoneInvoice(
  db: admin.firestore.Firestore,
  projectId: string,
  milestoneOrder: number,
  triggerSource: string,
): Promise<{ invoiceId: string | null; skipped?: string }> {
  const projSnap = await db.collection('projects').doc(projectId).get();
  if (!projSnap.exists) return { invoiceId: null, skipped: 'project_not_found' };
  const project = projSnap.data()!;
  const scheduleId = project.paymentScheduleId;
  if (!scheduleId) return { invoiceId: null, skipped: 'no_payment_schedule' };

  const schedRef = db.collection('payment_schedules').doc(scheduleId);
  const schedSnap = await schedRef.get();
  if (!schedSnap.exists) return { invoiceId: null, skipped: 'schedule_missing' };
  const schedule = schedSnap.data()!;
  const milestones = (schedule.milestones ?? []) as Array<Record<string, unknown>>;
  const ms = milestones[milestoneOrder];
  if (!ms) return { invoiceId: null, skipped: 'milestone_missing' };
  if (ms.invoiceId) return { invoiceId: ms.invoiceId as string, skipped: 'already_invoiced' };

  // Calculate amount from project.totalRevenue
  const total = typeof project.totalRevenue === 'number' ? project.totalRevenue : 0;
  const percent = typeof ms.percent === 'number' ? ms.percent : 0;
  const amount = +(total * percent / 100).toFixed(2);

  const invoiceDoc = {
    projectId,
    clientId: project.clientId ?? null,
    clientName: project.clientName ?? null,
    companyId: project.companyId ?? null,
    invoiceNumber: `INV-${Date.now().toString().slice(-6)}`,
    date: admin.firestore.Timestamp.now(),
    lineItems: [
      {
        description: `${ms.label} (${percent}%)`,
        quantity: 1,
        unit: 'шт',
        unitPrice: amount,
        total: amount,
      },
    ],
    subtotal: amount,
    tax: 0,
    total: amount,
    status: 'draft',
    payments: [],
    notes: `Auto-generated from ${triggerSource}`,
    createdFrom: triggerSource,
    milestoneOrder,
    paymentScheduleId: scheduleId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const invoiceRef = await db.collection('invoices').add(invoiceDoc);

  // Mark milestone as invoiced (atomic write on schedule doc)
  milestones[milestoneOrder] = { ...ms, status: 'invoiced', invoiceId: invoiceRef.id };
  await schedRef.update({
    milestones,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { invoiceId: invoiceRef.id };
}

export default router;
