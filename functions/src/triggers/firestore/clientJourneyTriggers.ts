/**
 * Client Journey triggers — automation between entities (spec
 * CLIENT_JOURNEY_SPEC §2).
 *
 * All triggers follow CLAUDE.md §2.1 safety pattern:
 *   - Field-change guard (skip if irrelevant change)
 *   - Never write to the collection that fired us
 *   - Errors swallowed to logger.warn so automation failures never block
 *     user-facing writes
 *   - Idempotency via field markers (e.g. deal.projectId set → skip)
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const REGION = 'us-central1';

// ─── Sprint 2.1 — Meeting completed → advance Deal stage ───────────

/**
 * When a site-survey or estimate-review meeting is completed with a
 * non-empty outcome, bump the linked Deal one step forward in the funnel.
 * Manager can still move manually; this just removes the boring click.
 */
export const onMeetingCompletedAdvanceDeal = functions
  .region(REGION)
  .firestore.document('meetings/{meetingId}')
  .onUpdate(async (change) => {
    const before = change.before.data();
    const after = change.after.data();

    if (before.status === after.status) return null;
    if (after.status !== 'completed') return null;
    if (!after.dealId) return null;
    if (!after.outcome || String(after.outcome).trim().length === 0) {
      // Should be blocked by the server-side §5.4 gate, but double-check
      return null;
    }

    const db = admin.firestore();
    try {
      const dealRef = db.collection('deals').doc(after.dealId);
      const dealSnap = await dealRef.get();
      if (!dealSnap.exists) return null;
      const deal = dealSnap.data()!;

      // Only advance open deals — closed ones (won/lost) stay
      if (deal.status !== 'open') return null;

      const nextStage = mapMeetingTypeToNextStage(after.type, deal.stage);
      if (!nextStage || nextStage === deal.stage) return null;

      await dealRef.update({
        stage: nextStage,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      functions.logger.info('[onMeetingCompletedAdvanceDeal] advanced', {
        meetingId: change.after.id,
        dealId: after.dealId,
        from: deal.stage,
        to: nextStage,
      });
    } catch (e) {
      functions.logger.warn('[onMeetingCompletedAdvanceDeal] failed', {
        meetingId: change.after.id,
        error: String(e),
      });
    }
    return null;
  });

function mapMeetingTypeToNextStage(
  meetingType: string | undefined,
  currentStage: string,
): string | null {
  // Only advance forward — never go backward
  const progression = [
    'new', 'survey_scheduled', 'survey_done',
    'estimate_draft', 'estimate_sent', 'negotiation', 'won',
  ];
  const currentIdx = progression.indexOf(currentStage);
  if (currentIdx === -1) return null;

  let target: string | null = null;
  if (meetingType === 'site_survey') target = 'survey_done';
  else if (meetingType === 'estimate_review') target = 'negotiation';
  else if (meetingType === 'contract_signing') target = 'won';

  if (!target) return null;
  const targetIdx = progression.indexOf(target);
  return targetIdx > currentIdx ? target : null;
}

// ─── Sprint 2.3 — Deal won → auto-create Project ───────────────────

/**
 * Central automation from spec §1.1. When Deal.status flips to 'won':
 *   - Locate approved estimate (by dealId or primaryEstimateId)
 *   - Create a Project with snapshot of Client reqs (§6.1 spec)
 *   - Link deal.projectId (idempotency flag)
 *
 * ⚠️ CAREFUL — this trigger writes to `projects` and `deals`. Writing to
 * `deals` from a `deals.onUpdate` trigger is the infinite-loop risk.
 * Guard: only writes projectId field, and only when it's not already set.
 */
export const onDealWonAutoCreateProject = functions
  .region(REGION)
  .firestore.document('deals/{dealId}')
  .onUpdate(async (change) => {
    const before = change.before.data();
    const after = change.after.data();

    // Field-change guard
    if (before.status === after.status) return null;
    if (after.status !== 'won') return null;

    // Idempotency — already converted
    if (after.projectId) {
      functions.logger.info('[onDealWonAutoCreateProject] already has projectId, skip', {
        dealId: change.after.id,
        projectId: after.projectId,
      });
      return null;
    }

    const db = admin.firestore();
    try {
      // Find approved estimate for this deal
      let estimateSnap: admin.firestore.QueryDocumentSnapshot | null = null;
      if (after.primaryEstimateId) {
        const single = await db.collection('estimates').doc(after.primaryEstimateId).get();
        if (single.exists) estimateSnap = single as admin.firestore.QueryDocumentSnapshot;
      }
      if (!estimateSnap) {
        const q = await db
          .collection('estimates')
          .where('dealId', '==', change.after.id)
          .where('status', '==', 'approved')
          .orderBy('version', 'desc')
          .limit(1)
          .get();
        if (!q.empty) estimateSnap = q.docs[0];
      }
      const estimate = estimateSnap?.data() as Record<string, unknown> | undefined;

      // Fetch client snapshot
      const clientSnap = await db.collection('clients').doc(after.clientId).get();
      if (!clientSnap.exists) {
        functions.logger.warn('[onDealWonAutoCreateProject] client missing', {
          dealId: change.after.id,
          clientId: after.clientId,
        });
        return null;
      }
      const client = clientSnap.data()!;

      const projectDoc = {
        clientId: after.clientId,
        clientName: client.name ?? null,
        companyId: client.companyId ?? null,
        dealId: change.after.id,
        estimateId: estimateSnap?.id ?? null,

        name: `${client.name ?? 'Клиент'} — ${after.title ?? 'Проект'}`,
        description: after.notes ?? null,
        address: after.workAddress || client.address || null,

        // Client snapshot — copies at project create time, doesn't follow
        // later client edits (spec §6.1)
        billingInfoSnapshot: client.billingInfo ?? null,
        taxInfoSnapshot: client.taxInfo ?? null,
        contactPerson:
          (client.decisionMakers as Array<Record<string, unknown>> | undefined)?.find((d) => d.isPrimary) ??
          (client.contacts as Array<Record<string, unknown>> | undefined)?.[0] ??
          null,
        taxRate: (client.taxInfo as Record<string, unknown> | null | undefined)?.taxRate ?? null,
        paymentTerms: (client.billingInfo as Record<string, unknown> | null | undefined)?.paymentTerms ?? null,
        currency: client.currency ?? 'USD',
        preferredLanguage: client.preferredLanguage ?? null,
        timezone: client.timezone ?? null,

        type: 'work',
        status: 'active',
        projectManager: after.ownerId ?? null,
        createdFrom: 'deal_won',
        createdBy: after.ownerId ?? null,
        totalRevenue: estimate?.total ?? after.value?.amount ?? 0,
        totalCost: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      const projectRef = await db.collection('projects').add(projectDoc);

      // Write projectId back to deal — idempotent if this trigger fires
      // again (projectId check above will skip)
      await change.after.ref.update({
        projectId: projectRef.id,
        actualCloseDate: after.actualCloseDate ?? admin.firestore.FieldValue.serverTimestamp(),
      });

      // If estimate exists, link project back to estimate
      if (estimateSnap) {
        await estimateSnap.ref.update({
          projectId: projectRef.id,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }).catch(() => undefined);
      }

      functions.logger.info('[onDealWonAutoCreateProject] project created', {
        dealId: change.after.id,
        projectId: projectRef.id,
        estimateId: estimateSnap?.id ?? null,
      });
    } catch (e) {
      functions.logger.error('[onDealWonAutoCreateProject] failed', {
        dealId: change.after.id,
        error: String(e),
        stack: e instanceof Error ? e.stack : null,
      });
    }
    return null;
  });

// ─── Sprint 3.1 — Project created (from won Deal) → init folders + tasks ──

/**
 * Fires on project onCreate. Two idempotent side-effects:
 *   1. Initialize folderTree if not yet set
 *   2. Generate tasks from the approved estimate (if estimateId present)
 *
 * Both operations are no-ops if already done — they're safe on retry.
 */
export const onProjectCreatedInitAssets = functions
  .region(REGION)
  .firestore.document('projects/{projectId}')
  .onCreate(async (snap) => {
    const project = snap.data();
    const projectId = snap.id;
    const db = admin.firestore();

    try {
      // 1. Init folder tree marker (don't block on this)
      if (!project.folderTreeInitialized) {
        await snap.ref.update({
          folderTree: [
            { path: '_project-docs/', description: 'Договор, КП, акты' },
            { path: '_photos/', description: 'Фотоотчёты с объекта' },
            { path: '_invoices/', description: 'Счета клиенту' },
            { path: '_materials/', description: 'Чеки + документы поставщиков' },
            { path: 'tasks/', description: 'Папки задач' },
          ],
          folderTreeInitialized: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // 2. Generate tasks from estimate if linked + not already generated
      const estimateId = project.estimateId;
      if (estimateId && !project.tasksGeneratedFromEstimate) {
        const existing = await db
          .collection('gtd_tasks')
          .where('projectId', '==', projectId)
          .where('sourceEstimateId', '==', estimateId)
          .limit(1)
          .get();

        if (existing.empty) {
          const estSnap = await db.collection('estimates').doc(estimateId).get();
          if (estSnap.exists) {
            const estimate = estSnap.data()!;
            const items = (estimate.clientItems ?? estimate.items ?? []) as Array<Record<string, unknown>>;
            if (items.length > 0) {
              const batch = db.batch();
              for (const item of items) {
                const qty = typeof item.quantity === 'number' ? item.quantity : 1;
                const unit = typeof item.unit === 'string' ? item.unit : 'шт';
                const unitPrice = typeof item.unitPrice === 'number' ? item.unitPrice : 0;
                const total = typeof item.total === 'number' ? item.total : unitPrice * qty;
                const taskRef = db.collection('gtd_tasks').doc();
                batch.set(taskRef, {
                  title: typeof item.description === 'string' ? item.description : '(позиция сметы)',
                  status: 'inbox',
                  priority: 'medium',
                  projectId,
                  clientId: project.clientId ?? null,
                  clientName: project.clientName ?? null,
                  companyId: project.companyId ?? null,
                  sourceEstimateId: estimateId,
                  billable: true,
                  production: true,
                  unit,
                  quantity: qty,
                  rate: unitPrice,
                  estimatedPriceClient: total,
                  ownerId: project.projectManager ?? null,
                  createdBy: project.createdBy ?? 'system',
                  createdAt: admin.firestore.FieldValue.serverTimestamp(),
                  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
              }
              await batch.commit();
              await snap.ref.update({
                tasksGeneratedFromEstimate: true,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
              functions.logger.info('[onProjectCreatedInitAssets] generated tasks', {
                projectId,
                estimateId,
                count: items.length,
              });
            }
          }
        }
      }
    } catch (e) {
      functions.logger.warn('[onProjectCreatedInitAssets] failed', { projectId, error: String(e) });
    }
    return null;
  });

// ─── Sprint 3.2 — Estimate approved → auto-generate first invoice ──

/**
 * When Estimate.status flips to 'approved', and the linked project has a
 * payment_schedule with first milestone trigger='on_estimate_approved',
 * generate the first invoice automatically.
 *
 * Uses generateMilestoneInvoice helper from paymentSchedules.ts.
 */
export const onEstimateApprovedGenerateInvoice = functions
  .region(REGION)
  .firestore.document('estimates/{estimateId}')
  .onUpdate(async (change) => {
    const before = change.before.data();
    const after = change.after.data();

    if (before.status === after.status) return null;
    if (after.status !== 'approved') return null;
    if (!after.projectId) return null;

    const db = admin.firestore();
    try {
      // Lazy-require to avoid circular dep (route file ↔ trigger file)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { generateMilestoneInvoice } = require('../../agent/routes/paymentSchedules');

      // Find first milestone with trigger='on_estimate_approved'
      const projSnap = await db.collection('projects').doc(after.projectId).get();
      if (!projSnap.exists) return null;
      const scheduleId = projSnap.data()?.paymentScheduleId;
      if (!scheduleId) return null;

      const schedSnap = await db.collection('payment_schedules').doc(scheduleId).get();
      if (!schedSnap.exists) return null;
      const milestones = (schedSnap.data()?.milestones ?? []) as Array<Record<string, unknown>>;
      const firstIdx = milestones.findIndex(m => m.trigger === 'on_estimate_approved');
      if (firstIdx === -1) return null;

      const { invoiceId, skipped } = await generateMilestoneInvoice(
        db,
        after.projectId,
        firstIdx,
        'onEstimateApprovedGenerateInvoice',
      );
      functions.logger.info('[onEstimateApprovedGenerateInvoice] done', {
        estimateId: change.after.id,
        projectId: after.projectId,
        milestoneIdx: firstIdx,
        invoiceId,
        skipped,
      });
    } catch (e) {
      functions.logger.error('[onEstimateApprovedGenerateInvoice] failed', {
        estimateId: change.after.id,
        error: String(e),
      });
    }
    return null;
  });

// ─── Sprint 5.1 — work_session completed → aggregate on task ───────

/**
 * When a work_session transitions to 'completed' with a relatedTaskId,
 * increment the task's `actualDurationMinutes` and `actualLaborCost`.
 * Idempotent via session.metricsProcessedAt marker on the session itself.
 */
export const onWorkSessionCompletedAggregateTask = functions
  .region(REGION)
  .firestore.document('work_sessions/{sessionId}')
  .onUpdate(async (change) => {
    const before = change.before.data();
    const after = change.after.data();

    if (before.status === after.status) return null;
    if (after.status !== 'completed') return null;
    if (!after.relatedTaskId) return null;
    if (after.metricsProcessedAt) return null; // already counted

    const duration = typeof after.durationMinutes === 'number' ? after.durationMinutes : 0;
    const earnings = typeof after.sessionEarnings === 'number' ? after.sessionEarnings : 0;
    if (duration === 0 && earnings === 0) return null;

    const db = admin.firestore();
    try {
      await db.runTransaction(async (tx) => {
        const taskRef = db.collection('gtd_tasks').doc(after.relatedTaskId);
        const taskSnap = await tx.get(taskRef);
        if (!taskSnap.exists) return;
        const task = taskSnap.data()!;

        tx.update(taskRef, {
          actualDurationMinutes: (task.actualDurationMinutes ?? 0) + duration,
          actualLaborCost: (task.actualLaborCost ?? 0) + earnings,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        tx.update(change.after.ref, {
          metricsProcessedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
      functions.logger.info('[onWorkSessionCompletedAggregateTask] aggregated', {
        sessionId: change.after.id,
        taskId: after.relatedTaskId,
        duration,
        earnings,
      });
    } catch (e) {
      functions.logger.warn('[onWorkSessionCompletedAggregateTask] failed', {
        sessionId: change.after.id,
        error: String(e),
      });
    }
    return null;
  });
