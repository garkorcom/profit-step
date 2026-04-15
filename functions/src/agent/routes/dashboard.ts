/**
 * Dashboard Route — GET /api/dashboard
 */
import { Router } from 'express';

import { db, Timestamp, logger, getCachedClients } from '../routeContext';


const router = Router();

// ─── GET /api/dashboard ────────────────────────────────────────────

router.get('/api/dashboard', async (req, res, next) => {
  try {
    logger.info('📊 dashboard:fetch');

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 24 * 3600_000);

    // ── RLS: scope queries based on role ──
    const rlsRole = req.effectiveRole || 'admin';
    const rlsUserId = req.effectiveUserId || req.agentUserId;
    const teamUids = req.effectiveTeamMemberUids || [];
    const allUids = Array.from(new Set([rlsUserId!, ...teamUids]));

    let sessionsQ: FirebaseFirestore.Query = db.collection('work_sessions').where('status', 'in', ['active', 'paused']);
    let tasksQ: FirebaseFirestore.Query = db.collection('gtd_tasks')
      .where('dueDate', '>=', Timestamp.fromDate(todayStart))
      .where('dueDate', '<=', Timestamp.fromDate(todayEnd));
    let costsQ: FirebaseFirestore.Query = db.collection('costs').where('status', '==', 'confirmed');

    if (rlsRole === 'worker' || rlsRole === 'driver') {
      sessionsQ = sessionsQ.where('userId', '==', rlsUserId);
      tasksQ = tasksQ.where('assigneeId', '==', rlsUserId);
      costsQ = costsQ.where('userId', '==', rlsUserId);
    } else if (rlsRole === 'foreman' && allUids.length <= 30) {
      sessionsQ = sessionsQ.where('userId', 'in', allUids);
      tasksQ = tasksQ.where('assigneeId', 'in', allUids);
      costsQ = costsQ.where('userId', 'in', allUids);
    }

    const [activeSessionsSnap, tasksDueTodaySnap, recentCostsSnap, openEstimatesSnap, clientsCache] = await Promise.all([
      sessionsQ.get(),
      tasksQ.limit(20).get(),
      costsQ.orderBy('createdAt', 'desc').limit(10).get(),
      (rlsRole === 'worker' || rlsRole === 'driver')
        ? Promise.resolve({ size: 0, docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] })
        : db.collection('estimates').where('status', 'in', ['draft', 'sent']).get(),
      getCachedClients(),
    ]);

    const activeSessions = activeSessionsSnap.docs.map(d => ({
      id: d.id, employeeName: d.data().employeeName,
      task: d.data().relatedTaskTitle || d.data().description,
      startTime: d.data().startTime?.toDate?.()?.toISOString() || null,
      status: d.data().status, clientName: d.data().clientName,
    }));

    const tasksDueToday = tasksDueTodaySnap.docs.map(d => ({
      id: d.id, title: d.data().title, status: d.data().status,
      priority: d.data().priority, clientName: d.data().clientName, assigneeName: d.data().assigneeName,
    }));

    const recentCosts = recentCostsSnap.docs.map(d => ({
      id: d.id, amount: d.data().amount, category: d.data().category,
      description: d.data().description, clientName: d.data().clientName,
      createdAt: d.data().createdAt?.toDate?.()?.toISOString() || null,
    }));

    let estimatesTotal = 0;
    openEstimatesSnap.docs.forEach(d => { estimatesTotal += d.data().total || 0; });

    res.json({
      activeSessions, activeSessionCount: activeSessions.length,
      tasksDueToday, tasksDueTodayCount: tasksDueToday.length,
      recentCosts,
      openEstimates: { count: openEstimatesSnap.size, totalValue: +estimatesTotal.toFixed(2) },
      totalClients: clientsCache.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    next(e);
  }
});


export default router;
