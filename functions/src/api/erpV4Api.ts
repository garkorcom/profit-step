/**
 * @fileoverview ERP V4.0 — Phase 2 API Endpoints
 *
 * Punch List, Work Acts, Payment Schedule, Warranty Tasks, NPS, Plan vs Fact
 *
 * @module api/erpV4Api
 */

import * as functions from 'firebase-functions';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const region = 'us-central1';

// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════

function requireAuth(context: functions.https.CallableContext): string {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');
  }
  return context.auth.uid;
}

async function getCompanyId(uid: string): Promise<string> {
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) throw new functions.https.HttpsError('not-found', 'User not found');
  return userSnap.data()!.companyId;
}

// ═══════════════════════════════════════
// PUNCH LIST
// ═══════════════════════════════════════

/**
 * POST /api/punch-list — create punch list
 */
export const createPunchList = functions
  .region(region)
  .https.onCall(async (data, context) => {
    const uid = requireAuth(context);
    const companyId = await getCompanyId(uid);

    const {
      projectId, projectName, clientId, clientName,
      workActId, title, items = [],
    } = data;

    if (!projectId || !clientId || !title) {
      throw new functions.https.HttpsError('invalid-argument', 'projectId, clientId, and title are required');
    }

    const punchListRef = db.collection(`companies/${companyId}/punch_lists`).doc();

    const punchItems = (items as any[]).map((item: any, idx: number) => ({
      id: `PI-${Date.now()}-${idx}`,
      description: item.description || '',
      photoUrls: item.photoUrls || [],
      fixedPhotoUrls: [],
      status: 'open',
      location: item.location || '',
      priority: item.priority || 'minor',
      assigneeId: item.assigneeId || null,
      assigneeName: item.assigneeName || null,
      reportedAt: admin.firestore.FieldValue.serverTimestamp(),
      notes: item.notes || '',
    }));

    const openItems = punchItems.length;

    const punchList = {
      id: punchListRef.id,
      companyId,
      projectId,
      projectName: projectName || '',
      clientId,
      clientName: clientName || '',
      workActId: workActId || null,
      title,
      items: punchItems,
      totalItems: openItems,
      openItems,
      fixedItems: 0,
      verifiedItems: 0,
      isResolved: false,
      createdBy: uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await punchListRef.set(punchList);

    // If linked to work act, update blockedByPunchList
    if (workActId) {
      const actRef = db.collection(`companies/${companyId}/work_acts`).doc(workActId);
      const actSnap = await actRef.get();
      if (actSnap.exists) {
        await actRef.update({
          punchListId: punchListRef.id,
          blockedByPunchList: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    logger.info(`✅ Punch list created: ${punchListRef.id} for project ${projectId}`);
    return { success: true, id: punchListRef.id, data: punchList };
  });

/**
 * GET /api/punch-list?projectId=X
 */
export const getPunchLists = functions
  .region(region)
  .https.onCall(async (data, context) => {
    const uid = requireAuth(context);
    const companyId = await getCompanyId(uid);
    const { projectId } = data;

    if (!projectId) {
      throw new functions.https.HttpsError('invalid-argument', 'projectId is required');
    }

    const snap = await db
      .collection(`companies/${companyId}/punch_lists`)
      .where('projectId', '==', projectId)
      .orderBy('createdAt', 'desc')
      .get();

    const lists = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return { success: true, data: lists };
  });

/**
 * PATCH /api/punch-list/:id — update item status
 */
export const updatePunchListItem = functions
  .region(region)
  .https.onCall(async (data, context) => {
    const uid = requireAuth(context);
    const companyId = await getCompanyId(uid);

    const { punchListId, itemId, status, fixedPhotoUrls, notes } = data;

    if (!punchListId || !itemId || !status) {
      throw new functions.https.HttpsError('invalid-argument', 'punchListId, itemId, and status are required');
    }

    const validStatuses = ['open', 'in_progress', 'fixed', 'verified', 'wont_fix'];
    if (!validStatuses.includes(status)) {
      throw new functions.https.HttpsError('invalid-argument', `status must be one of: ${validStatuses.join(', ')}`);
    }

    const ref = db.collection(`companies/${companyId}/punch_lists`).doc(punchListId);
    const snap = await ref.get();
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Punch list not found');

    const punchList = snap.data()!;
    const items = punchList.items as any[];
    const itemIdx = items.findIndex((i: any) => i.id === itemId);
    if (itemIdx === -1) throw new functions.https.HttpsError('not-found', 'Item not found');

    // Update item
    items[itemIdx].status = status;
    if (status === 'fixed') items[itemIdx].fixedAt = new Date();
    if (status === 'verified') {
      items[itemIdx].verifiedAt = new Date();
      items[itemIdx].verifiedBy = uid;
    }
    if (fixedPhotoUrls) items[itemIdx].fixedPhotoUrls = fixedPhotoUrls;
    if (notes !== undefined) items[itemIdx].notes = notes;

    // Recalculate counts
    const openItems = items.filter((i: any) => ['open', 'in_progress'].includes(i.status)).length;
    const fixedItems = items.filter((i: any) => i.status === 'fixed').length;
    const verifiedItems = items.filter((i: any) => i.status === 'verified').length;
    const isResolved = openItems === 0 && fixedItems === 0;

    await ref.update({
      items,
      openItems,
      fixedItems,
      verifiedItems,
      isResolved,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(isResolved ? { resolvedAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
    });

    // If resolved and linked to work act, unblock it
    if (isResolved && punchList.workActId) {
      const actRef = db.collection(`companies/${companyId}/work_acts`).doc(punchList.workActId);
      const actSnap = await actRef.get();
      if (actSnap.exists) {
        await actRef.update({
          blockedByPunchList: false,
          status: 'ready_to_sign',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    logger.info(`✅ Punch list item ${itemId} updated to ${status}`);
    return { success: true, isResolved };
  });

// ═══════════════════════════════════════
// WORK ACTS
// ═══════════════════════════════════════

/**
 * POST /api/work-acts — create work act
 */
export const createWorkAct = functions
  .region(region)
  .https.onCall(async (data, context) => {
    const uid = requireAuth(context);
    const companyId = await getCompanyId(uid);

    const {
      projectId, projectName, clientId, clientName,
      estimateId, phaseName, phaseDescription, plannedAmount,
    } = data;

    if (!projectId || !clientId || !phaseName || plannedAmount === undefined) {
      throw new functions.https.HttpsError('invalid-argument', 'projectId, clientId, phaseName, and plannedAmount are required');
    }

    // Auto-generate number
    const existingSnap = await db
      .collection(`companies/${companyId}/work_acts`)
      .where('projectId', '==', projectId)
      .get();
    const number = `ACT-${String(existingSnap.size + 1).padStart(3, '0')}`;

    const actRef = db.collection(`companies/${companyId}/work_acts`).doc();

    const workAct = {
      id: actRef.id,
      companyId,
      projectId,
      projectName: projectName || '',
      clientId,
      clientName: clientName || '',
      estimateId: estimateId || null,
      number,
      phaseName,
      phaseDescription: phaseDescription || '',
      plannedAmount: Number(plannedAmount),
      actualAmount: 0,
      completionPercent: 0,
      status: 'draft',
      punchListId: null,
      blockedByPunchList: false,
      createdBy: uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await actRef.set(workAct);
    logger.info(`✅ Work act ${number} created for project ${projectId}`);
    return { success: true, id: actRef.id, data: workAct };
  });

/**
 * GET /api/work-acts?projectId=X
 */
export const getWorkActs = functions
  .region(region)
  .https.onCall(async (data, context) => {
    const uid = requireAuth(context);
    const companyId = await getCompanyId(uid);
    const { projectId } = data;

    if (!projectId) {
      throw new functions.https.HttpsError('invalid-argument', 'projectId is required');
    }

    const snap = await db
      .collection(`companies/${companyId}/work_acts`)
      .where('projectId', '==', projectId)
      .orderBy('createdAt', 'asc')
      .get();

    return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
  });

/**
 * PATCH /api/work-acts/:id — update status
 * Work Act CANNOT be signed while punch_list is not empty!
 */
export const updateWorkAct = functions
  .region(region)
  .https.onCall(async (data, context) => {
    const uid = requireAuth(context);
    const companyId = await getCompanyId(uid);

    const { workActId, status, actualAmount, completionPercent } = data;

    if (!workActId) {
      throw new functions.https.HttpsError('invalid-argument', 'workActId is required');
    }

    const ref = db.collection(`companies/${companyId}/work_acts`).doc(workActId);
    const snap = await ref.get();
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Work act not found');

    const act = snap.data()!;
    const updates: any = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };

    if (status) {
      const validStatuses = ['draft', 'pending_review', 'punch_list', 'ready_to_sign', 'signed', 'disputed'];
      if (!validStatuses.includes(status)) {
        throw new functions.https.HttpsError('invalid-argument', `status must be one of: ${validStatuses.join(', ')}`);
      }

      // CRITICAL: Cannot sign if punch list is not resolved
      if (status === 'signed' && act.blockedByPunchList) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Cannot sign work act while punch list items are unresolved'
        );
      }

      // Also check if there's an active punch list
      if (status === 'signed' && act.punchListId) {
        const plSnap = await db
          .collection(`companies/${companyId}/punch_lists`)
          .doc(act.punchListId)
          .get();
        if (plSnap.exists && !plSnap.data()!.isResolved) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            'Cannot sign work act while punch list is not fully resolved'
          );
        }
      }

      updates.status = status;
      if (status === 'signed') {
        updates.signedAt = admin.firestore.FieldValue.serverTimestamp();
        updates.signedByCompany = uid;
        updates.completionPercent = 100;
      }
    }

    if (actualAmount !== undefined) updates.actualAmount = Number(actualAmount);
    if (completionPercent !== undefined) updates.completionPercent = Number(completionPercent);

    await ref.update(updates);
    logger.info(`✅ Work act ${workActId} updated: ${JSON.stringify(updates)}`);
    return { success: true };
  });

// ═══════════════════════════════════════
// PAYMENT SCHEDULE
// ═══════════════════════════════════════

/**
 * POST /api/payment-schedule
 */
export const createPaymentSchedule = functions
  .region(region)
  .https.onCall(async (data, context) => {
    const uid = requireAuth(context);
    const companyId = await getCompanyId(uid);

    const {
      projectId, projectName, clientId, clientName,
      estimateId, totalAmount, milestones = [],
    } = data;

    if (!projectId || !clientId || !estimateId) {
      throw new functions.https.HttpsError('invalid-argument', 'projectId, clientId, and estimateId are required');
    }

    const ref = db.collection(`companies/${companyId}/payment_schedules`).doc();

    const parsedMilestones = (milestones as any[]).map((m: any, idx: number) => ({
      id: `MS-${Date.now()}-${idx}`,
      milestoneName: m.milestoneName || `Milestone ${idx + 1}`,
      workActId: m.workActId || null,
      amount: Number(m.amount || 0),
      percentOfTotal: Number(m.percentOfTotal || 0),
      dueDate: m.dueDate || null,
      status: 'upcoming',
      invoiceId: null,
      paidAmount: 0,
    }));

    const total = Number(totalAmount || parsedMilestones.reduce((s: number, m: any) => s + m.amount, 0));

    const schedule = {
      id: ref.id,
      companyId,
      projectId,
      projectName: projectName || '',
      clientId,
      clientName: clientName || '',
      estimateId,
      totalAmount: total,
      milestones: parsedMilestones,
      totalPaid: 0,
      totalPending: total,
      totalOverdue: 0,
      createdBy: uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await ref.set(schedule);
    logger.info(`✅ Payment schedule created: ${ref.id}`);
    return { success: true, id: ref.id, data: schedule };
  });

/**
 * GET /api/payment-schedule?estimateId=X
 */
export const getPaymentSchedule = functions
  .region(region)
  .https.onCall(async (data, context) => {
    const uid = requireAuth(context);
    const companyId = await getCompanyId(uid);
    const { estimateId, projectId } = data;

    if (!estimateId && !projectId) {
      throw new functions.https.HttpsError('invalid-argument', 'estimateId or projectId is required');
    }

    let q = db.collection(`companies/${companyId}/payment_schedules`) as FirebaseFirestore.Query;
    if (estimateId) q = q.where('estimateId', '==', estimateId);
    else if (projectId) q = q.where('projectId', '==', projectId);

    const snap = await q.get();
    return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
  });

/**
 * PATCH /api/payment-schedule/:id/milestone/:idx
 */
export const updatePaymentMilestone = functions
  .region(region)
  .https.onCall(async (data, context) => {
    const uid = requireAuth(context);
    const companyId = await getCompanyId(uid);

    const { scheduleId, milestoneId, status, paidAmount, invoiceId } = data;

    if (!scheduleId || !milestoneId) {
      throw new functions.https.HttpsError('invalid-argument', 'scheduleId and milestoneId are required');
    }

    const ref = db.collection(`companies/${companyId}/payment_schedules`).doc(scheduleId);
    const snap = await ref.get();
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Payment schedule not found');

    const schedule = snap.data()!;
    const milestones = schedule.milestones as any[];
    const idx = milestones.findIndex((m: any) => m.id === milestoneId);
    if (idx === -1) throw new functions.https.HttpsError('not-found', 'Milestone not found');

    if (status) {
      const validStatuses = ['upcoming', 'pending', 'invoiced', 'partially_paid', 'paid', 'overdue'];
      if (!validStatuses.includes(status)) {
        throw new functions.https.HttpsError('invalid-argument', `Invalid milestone status: ${status}`);
      }
      milestones[idx].status = status;
    }
    if (paidAmount !== undefined) {
      milestones[idx].paidAmount = Number(paidAmount);
      if (Number(paidAmount) >= milestones[idx].amount) {
        milestones[idx].status = 'paid';
        milestones[idx].paidAt = new Date();
      } else if (Number(paidAmount) > 0) {
        milestones[idx].status = 'partially_paid';
      }
    }
    if (invoiceId) milestones[idx].invoiceId = invoiceId;

    // Recalculate totals
    const totalPaid = milestones.reduce((s: number, m: any) => s + (m.paidAmount || 0), 0);
    const totalPending = schedule.totalAmount - totalPaid;
    const totalOverdue = milestones
      .filter((m: any) => m.status === 'overdue')
      .reduce((s: number, m: any) => s + (m.amount - (m.paidAmount || 0)), 0);

    await ref.update({
      milestones,
      totalPaid,
      totalPending,
      totalOverdue,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info(`✅ Milestone ${milestoneId} updated in schedule ${scheduleId}`);
    return { success: true };
  });

// ═══════════════════════════════════════
// WARRANTY TASKS
// ═══════════════════════════════════════

/**
 * POST /api/warranty
 */
export const createWarrantyTask = functions
  .region(region)
  .https.onCall(async (data, context) => {
    const uid = requireAuth(context);
    const companyId = await getCompanyId(uid);

    const {
      projectId, projectName, clientId, clientName,
      description, photoUrls, priority, warrantyExpiresAt,
    } = data;

    if (!projectId || !clientId || !description) {
      throw new functions.https.HttpsError('invalid-argument', 'projectId, clientId, and description are required');
    }

    const ref = db.collection(`companies/${companyId}/warranty_tasks`).doc();

    const task = {
      id: ref.id,
      companyId,
      projectId,
      projectName: projectName || '',
      clientId,
      clientName: clientName || '',
      description,
      photoUrls: photoUrls || [],
      resolvedPhotoUrls: [],
      status: 'reported',
      cost: 0,
      priority: priority || 'medium',
      reportedAt: admin.firestore.FieldValue.serverTimestamp(),
      warrantyExpiresAt: warrantyExpiresAt || null,
      createdBy: uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await ref.set(task);
    logger.info(`✅ Warranty task created: ${ref.id}`);
    return { success: true, id: ref.id, data: task };
  });

/**
 * GET /api/warranty?projectId=X
 */
export const getWarrantyTasks = functions
  .region(region)
  .https.onCall(async (data, context) => {
    const uid = requireAuth(context);
    const companyId = await getCompanyId(uid);
    const { projectId } = data;

    if (!projectId) {
      throw new functions.https.HttpsError('invalid-argument', 'projectId is required');
    }

    const snap = await db
      .collection(`companies/${companyId}/warranty_tasks`)
      .where('projectId', '==', projectId)
      .orderBy('createdAt', 'desc')
      .get();

    return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
  });

// ═══════════════════════════════════════
// NPS
// ═══════════════════════════════════════

/**
 * POST /api/nps/trigger — auto-trigger on project close
 */
export const triggerNps = functions
  .region(region)
  .https.onCall(async (data, context) => {
    const uid = requireAuth(context);
    const companyId = await getCompanyId(uid);

    const {
      projectId, projectName, clientId, clientName,
      contactEmail, contactPhone, channel,
    } = data;

    if (!projectId || !clientId) {
      throw new functions.https.HttpsError('invalid-argument', 'projectId and clientId are required');
    }

    // Check if NPS already triggered for this project
    const existingSnap = await db
      .collection(`companies/${companyId}/nps_requests`)
      .where('projectId', '==', projectId)
      .get();

    if (!existingSnap.empty) {
      return { success: false, message: 'NPS already triggered for this project', existing: existingSnap.docs[0].data() };
    }

    const ref = db.collection(`companies/${companyId}/nps_requests`).doc();

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // 14 days

    const npsRequest = {
      id: ref.id,
      companyId,
      projectId,
      projectName: projectName || '',
      clientId,
      clientName: clientName || '',
      contactEmail: contactEmail || null,
      contactPhone: contactPhone || null,
      channel: channel || 'email',
      status: 'scheduled',
      autoTriggered: true,
      scheduledAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      createdBy: uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await ref.set(npsRequest);
    logger.info(`✅ NPS request scheduled for project ${projectId}`);
    return { success: true, id: ref.id, data: npsRequest };
  });

/**
 * GET /api/nps?projectId=X
 */
export const getNpsStatus = functions
  .region(region)
  .https.onCall(async (data, context) => {
    const uid = requireAuth(context);
    const companyId = await getCompanyId(uid);
    const { projectId } = data;

    if (!projectId) {
      throw new functions.https.HttpsError('invalid-argument', 'projectId is required');
    }

    const snap = await db
      .collection(`companies/${companyId}/nps_requests`)
      .where('projectId', '==', projectId)
      .get();

    return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
  });

// ═══════════════════════════════════════
// PLAN vs FACT
// ═══════════════════════════════════════

/**
 * GET /api/plan-vs-fact?projectId=X
 */
export const getPlanVsFact = functions
  .region(region)
  .https.onCall(async (data, context) => {
    const uid = requireAuth(context);
    const companyId = await getCompanyId(uid);
    const { projectId, clientId } = data;

    if (!projectId && !clientId) {
      throw new functions.https.HttpsError('invalid-argument', 'projectId or clientId is required');
    }

    const filterValue = projectId || clientId;

    // Get estimates (planned)
    const estimatesSnap = await db
      .collection('estimates')
      .where('companyId', '==', companyId)
      .where('clientId', '==', filterValue)
      .where('status', '==', 'approved')
      .get();

    let plannedTotal = 0;
    estimatesSnap.docs.forEach(d => {
      plannedTotal += d.data().total || 0;
    });

    // Get costs (actual)
    const costsSnap = await db
      .collection('costs')
      .where('clientId', '==', filterValue)
      .get();

    let actualTotal = 0;
    const actualByCategory: Record<string, number> = {
      materials: 0,
      labor: 0,
      subcontract: 0,
    };

    costsSnap.docs.forEach(d => {
      const cost = d.data();
      const amount = cost.amount || 0;
      actualTotal += amount;
      const cat = (cost.category || 'other').toLowerCase();
      if (cat.includes('material')) actualByCategory.materials += amount;
      else if (cat.includes('labor') || cat.includes('payroll')) actualByCategory.labor += amount;
      else if (cat.includes('sub')) actualByCategory.subcontract += amount;
    });

    // Get purchase orders
    const poSnap = await db
      .collection(`companies/${companyId}/purchase_orders`)
      .where('projectId', '==', filterValue)
      .get();

    let poTotal = 0;
    poSnap.docs.forEach(d => {
      poTotal += d.data().total || 0;
    });

    const variance = plannedTotal - actualTotal;
    const alerts: string[] = [];

    if (actualTotal > plannedTotal * 0.9 && actualTotal <= plannedTotal) {
      alerts.push('⚠️ Actual costs approaching planned budget (>90%)');
    }
    if (actualTotal > plannedTotal) {
      alerts.push('🚨 Budget overrun! Actual costs exceed planned budget');
    }

    return {
      success: true,
      data: {
        clientId: filterValue,
        planned: {
          materials: 0,
          labor: 0,
          subcontract: 0,
          total: plannedTotal,
        },
        actual: {
          materials: actualByCategory.materials,
          labor: actualByCategory.labor,
          subcontract: actualByCategory.subcontract,
          total: actualTotal,
        },
        variance: {
          materials: 0,
          labor: 0,
          subcontract: 0,
          total: variance,
        },
        purchaseOrdersTotal: poTotal,
        margin: {
          planned: plannedTotal > 0 ? Math.round(((plannedTotal - actualTotal) / plannedTotal) * 100) : 0,
          actual: plannedTotal > 0 ? Math.round((actualTotal / plannedTotal) * 100) : 0,
        },
        alerts,
      },
    };
  });
