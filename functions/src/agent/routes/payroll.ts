/**
 * Payroll Routes — self-service + admin endpoints (6 endpoints)
 *
 * Self-service (scoped to req.agentUserId):
 *   GET /api/payroll/my-balance   — YTD earned/paid/balance
 *   GET /api/payroll/my-hours     — This week hours by day
 *   GET /api/payroll/my-pay       — Last period pay stub
 *
 * Admin:
 *   GET /api/payroll/overtime-check        — Who's approaching/over 40h
 *   POST /api/payroll/period/:id/validate  — Pre-close anomaly detection
 */
import { Router } from 'express';
import * as admin from 'firebase-admin';

import { db, logger } from '../routeContext';
import { requireScope } from '../agentMiddleware';
import {
  MyHoursQuerySchema,
  MyPayQuerySchema,
  OvertimeCheckQuerySchema,
  PeriodValidateSchema,
} from '../schemas';

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── GET /api/payroll/my-balance ──────────────────────────────────

router.get('/api/payroll/my-balance', requireScope('time:read', 'admin'), async (req, res, next) => {
  try {
    const userId = req.agentUserId!;
    logger.info('💰 payroll:my-balance', { userId });

    // Load user profile
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }
    const user = userDoc.data()!;

    // Load advance account balance (PO)
    const advanceSnap = await db.collection('advance_accounts')
      .where('employeeId', '==', userId)
      .limit(1)
      .get();

    const pendingPO = advanceSnap.empty ? 0 : (advanceSnap.docs[0].data().balance || 0);

    const ytdEarned = user.ytdEarned || user.runningBalance || 0;
    const ytdPaid = user.ytdPaid || 0;
    const balance = round2(ytdEarned - ytdPaid);
    const netBalance = round2(balance - pendingPO);

    // Get last payment
    const lastPaymentSnap = await db.collection('payroll_ledger')
      .where('employeeId', '==', userId)
      .where('type', '==', 'payment')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();

    let lastPayment = null;
    if (!lastPaymentSnap.empty) {
      const pay = lastPaymentSnap.docs[0].data();
      lastPayment = {
        amount: Math.abs(pay.amount || 0),
        date: pay.createdAt?.toDate?.()?.toISOString() || null,
        method: pay.method || 'unknown',
      };
    }

    // Current period
    const now = new Date();
    const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    res.json({
      employeeId: userId,
      employeeName: user.displayName || user.name || 'Unknown',
      ytdEarned: round2(ytdEarned),
      ytdPaid: round2(ytdPaid),
      balance,
      pendingPO: round2(pendingPO),
      netBalance,
      lastPayment,
      currentPeriod,
    });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/payroll/my-hours ────────────────────────────────────

router.get('/api/payroll/my-hours', requireScope('time:read', 'admin'), async (req, res, next) => {
  try {
    const userId = req.agentUserId!;
    const params = MyHoursQuerySchema.parse(req.query);

    const monday = params.weekOf ? getMonday(new Date(params.weekOf)) : getMonday(new Date());
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 7);

    logger.info('⏱️ payroll:my-hours', { userId, weekOf: monday.toISOString() });

    // Query sessions for this week
    const sessionsSnap = await db.collection('work_sessions')
      .where('employeeId', '==', userId)
      .where('status', '==', 'completed')
      .where('startTime', '>=', admin.firestore.Timestamp.fromDate(monday))
      .where('startTime', '<', admin.firestore.Timestamp.fromDate(sunday))
      .get();

    // Already queried with userId — skip alternate ID variants

    // Aggregate by day
    const dayMap: Record<string, { hours: number; sessions: number; projects: Set<string>; earnings: number }> = {};
    let totalMinutes = 0;
    let totalEarnings = 0;

    sessionsSnap.docs.forEach(d => {
      const s = d.data();
      const startDate = s.startTime?.toDate?.() || new Date(s.startTime);
      const dayKey = startDate.toISOString().slice(0, 10);
      const minutes = s.durationMinutes || 0;
      const earnings = s.sessionEarnings || 0;
      const project = s.clientName || s.projectId || 'Unknown';

      if (!dayMap[dayKey]) {
        dayMap[dayKey] = { hours: 0, sessions: 0, projects: new Set(), earnings: 0 };
      }
      dayMap[dayKey].hours += minutes / 60;
      dayMap[dayKey].sessions += 1;
      dayMap[dayKey].projects.add(project);
      dayMap[dayKey].earnings += earnings;

      totalMinutes += minutes;
      totalEarnings += earnings;
    });

    const totalHours = round2(totalMinutes / 60);
    const overtimeHours = Math.max(0, round2(totalHours - 40));

    // Build days array (Mon-Sun)
    const days: Array<{ date: string; hours: number; sessions: number; projects: string[] }> = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      const dayData = dayMap[key];
      days.push({
        date: key,
        hours: dayData ? round2(dayData.hours) : 0,
        sessions: dayData ? dayData.sessions : 0,
        projects: dayData ? Array.from(dayData.projects) : [],
      });
    }

    // Warnings
    const warnings: string[] = [];
    if (totalHours > 40) {
      warnings.push(`⚠️ Overtime: ${overtimeHours}h over 40h threshold`);
    } else if (totalHours > 35) {
      warnings.push(`⚠️ Approaching 40h overtime threshold (${totalHours}h worked)`);
    }

    // Get hourly rate for earnings calculation
    const userDoc = await db.collection('users').doc(userId).get();
    const hourlyRate = userDoc.exists ? (userDoc.data()!.hourlyRate || 0) : 0;
    const regularHours = Math.min(totalHours, 40);
    const regularPay = round2(regularHours * hourlyRate);
    const overtimePay = round2(overtimeHours * hourlyRate * 1.5);

    res.json({
      weekOf: monday.toISOString().slice(0, 10),
      totalHours,
      overtimeHours,
      days,
      earnings: {
        regular: regularPay,
        overtime: overtimePay,
        total: round2(regularPay + overtimePay),
      },
      warnings,
    });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/payroll/my-pay ──────────────────────────────────────

router.get('/api/payroll/my-pay', requireScope('time:read', 'admin'), async (req, res, next) => {
  try {
    const userId = req.agentUserId!;
    const params = MyPayQuerySchema.parse(req.query);

    // Determine period
    let period = params.period;
    if (!period) {
      // Default to last month
      const now = new Date();
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      period = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;
    }

    logger.info('💰 payroll:my-pay', { userId, period });

    // Query work sessions for this period
    const [year, month] = period.split('-').map(Number);
    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 1);

    const sessionsSnap = await db.collection('work_sessions')
      .where('employeeId', '==', userId)
      .where('status', '==', 'completed')
      .where('endTime', '>=', admin.firestore.Timestamp.fromDate(periodStart))
      .where('endTime', '<', admin.firestore.Timestamp.fromDate(periodEnd))
      .get();

    let totalMinutes = 0;
    let totalEarnings = 0;
    sessionsSnap.docs.forEach(d => {
      const s = d.data();
      totalMinutes += s.durationMinutes || 0;
      totalEarnings += s.sessionEarnings || 0;
    });

    const totalHours = round2(totalMinutes / 60);
    const regularHours = Math.min(totalHours, 160); // ~40h/week × 4
    const overtimeHours = Math.max(0, round2(totalHours - 160));

    // Get hourly rate
    const userDoc = await db.collection('users').doc(userId).get();
    const hourlyRate = userDoc.exists ? (userDoc.data()!.hourlyRate || 0) : 0;
    const regularPay = round2(regularHours * hourlyRate);
    const overtimePay = round2(overtimeHours * hourlyRate * 1.5);
    const gross = round2(regularPay + overtimePay);

    // Get advances/deductions for period
    const advanceSnap = await db.collection('payroll_ledger')
      .where('employeeId', '==', userId)
      .where('type', 'in', ['advance_deduction', 'deduction'])
      .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(periodStart))
      .where('createdAt', '<', admin.firestore.Timestamp.fromDate(periodEnd))
      .get();

    let advanceDeductions = 0;
    advanceSnap.docs.forEach(d => {
      advanceDeductions += Math.abs(d.data().amount || 0);
    });

    const net = round2(gross - advanceDeductions);

    // Get payments for this period
    const paymentsSnap = await db.collection('payroll_ledger')
      .where('employeeId', '==', userId)
      .where('type', '==', 'payment')
      .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(periodStart))
      .where('createdAt', '<', admin.firestore.Timestamp.fromDate(new Date(year, month + 1, 1))) // include next month payments
      .orderBy('createdAt', 'asc')
      .get();

    const payments = paymentsSnap.docs.map(d => {
      const p = d.data();
      return {
        date: p.createdAt?.toDate?.()?.toISOString() || null,
        amount: Math.abs(p.amount || 0),
        method: p.method || 'unknown',
      };
    });

    // Check period status
    const periodDoc = await db.collection('payroll_periods').doc(period).get();
    const periodStatus = periodDoc.exists ? (periodDoc.data()!.status || 'open') : 'open';

    res.json({
      period,
      periodStatus,
      gross,
      regularHours,
      overtimeHours,
      regularPay,
      overtimePay,
      deductions: {
        advances: round2(advanceDeductions),
        other: 0,
      },
      net,
      payments,
      sessionCount: sessionsSnap.size,
    });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/payroll/overtime-check ──────────────────────────────

router.get('/api/payroll/overtime-check', requireScope('admin'), async (req, res, next) => {
  try {
    const params = OvertimeCheckQuerySchema.parse(req.query);
    const monday = params.weekOf ? getMonday(new Date(params.weekOf)) : getMonday(new Date());
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 7);

    logger.info('⏱️ payroll:overtime-check', { weekOf: monday.toISOString() });

    // Get all completed sessions for this week
    const sessionsSnap = await db.collection('work_sessions')
      .where('status', '==', 'completed')
      .where('startTime', '>=', admin.firestore.Timestamp.fromDate(monday))
      .where('startTime', '<', admin.firestore.Timestamp.fromDate(sunday))
      .get();

    // Aggregate by employee
    const empMap: Record<string, {
      name: string;
      minutes: number;
      projects: Set<string>;
      rate: number;
    }> = {};

    sessionsSnap.docs.forEach(d => {
      const s = d.data();
      const empId = String(s.employeeId);
      if (!empMap[empId]) {
        empMap[empId] = {
          name: s.employeeName || `Employee ${empId}`,
          minutes: 0,
          projects: new Set(),
          rate: s.hourlyRate || 0,
        };
      }
      empMap[empId].minutes += s.durationMinutes || 0;
      if (s.clientName) empMap[empId].projects.add(s.clientName);
      if (s.hourlyRate && s.hourlyRate > empMap[empId].rate) {
        empMap[empId].rate = s.hourlyRate;
      }
    });

    const employees = Object.entries(empMap).map(([id, data]) => {
      const hours = round2(data.minutes / 60);
      const overtimeHours = Math.max(0, round2(hours - 40));
      const overtimeCost = round2(overtimeHours * data.rate * 0.5); // OT premium only

      let status: string;
      if (hours > 40) status = 'over_threshold';
      else if (hours > 35) status = 'approaching';
      else status = 'normal';

      return {
        employeeId: id,
        name: data.name,
        hoursThisWeek: hours,
        overtimeHours,
        overtimeCost,
        hourlyRate: data.rate,
        status,
        projects: Array.from(data.projects),
      };
    })
      .filter(e => e.status !== 'normal') // Only show approaching/over
      .sort((a, b) => b.hoursThisWeek - a.hoursThisWeek);

    const totalOvertime = round2(employees.reduce((s, e) => s + e.overtimeHours, 0));
    const totalOvertimeCost = round2(employees.reduce((s, e) => s + e.overtimeCost, 0));

    res.json({
      weekOf: monday.toISOString().slice(0, 10),
      employees,
      summary: {
        totalOvertime,
        totalOvertimeCost,
        employeesOverThreshold: employees.filter(e => e.status === 'over_threshold').length,
        employeesApproaching: employees.filter(e => e.status === 'approaching').length,
      },
    });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/payroll/period/:id/validate ────────────────────────

router.post('/api/payroll/period/:id/validate', requireScope('admin'), async (req, res, next) => {
  try {
    const period = req.params.id; // "YYYY-MM"
    const params = PeriodValidateSchema.parse(req.body);

    logger.info('🔍 payroll:validate', { period, checks: params.checks });

    const [year, month] = period.split('-').map(Number);
    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 1);

    // Get all sessions in period
    const sessionsSnap = await db.collection('work_sessions')
      .where('status', '==', 'completed')
      .where('endTime', '>=', admin.firestore.Timestamp.fromDate(periodStart))
      .where('endTime', '<', admin.firestore.Timestamp.fromDate(periodEnd))
      .get();

    const allChecks = params.checks || [
      'hours_over_60', 'session_over_12h', 'rate_changes',
      'zero_hours', 'duplicate_sessions', 'unsigned_sessions',
    ];

    const anomalies: Array<{
      type: string;
      severity: 'error' | 'warning';
      employeeId: string;
      employeeName: string;
      details: string;
      entityId?: string;
    }> = [];

    // Group sessions by employee and week
    const empSessions: Record<string, Array<{ id: string; data: any }>> = {};
    sessionsSnap.docs.forEach(d => {
      const empId = String(d.data().employeeId);
      if (!empSessions[empId]) empSessions[empId] = [];
      empSessions[empId].push({ id: d.id, data: d.data() });
    });

    for (const [empId, sessions] of Object.entries(empSessions)) {
      const empName = sessions[0]?.data.employeeName || `Employee ${empId}`;

      // Check: session_over_12h
      if (allChecks.includes('session_over_12h')) {
        for (const sess of sessions) {
          const minutes = sess.data.durationMinutes || 0;
          if (minutes > 720) { // 12h
            anomalies.push({
              type: 'session_over_12h',
              severity: 'warning',
              employeeId: empId,
              employeeName: empName,
              details: `Session ${sess.id}: ${round2(minutes / 60)}h on ${sess.data.startTime?.toDate?.()?.toISOString()?.slice(0, 10) || 'unknown'}`,
              entityId: sess.id,
            });
          }
        }
      }

      // Check: hours_over_60 per week
      if (allChecks.includes('hours_over_60')) {
        const weekMap: Record<string, number> = {};
        for (const sess of sessions) {
          const start = sess.data.startTime?.toDate?.() || new Date();
          const weekKey = getMonday(start).toISOString().slice(0, 10);
          weekMap[weekKey] = (weekMap[weekKey] || 0) + (sess.data.durationMinutes || 0);
        }
        for (const [weekOf, minutes] of Object.entries(weekMap)) {
          const hours = round2(minutes / 60);
          if (hours > 60) {
            anomalies.push({
              type: 'hours_over_60',
              severity: 'error',
              employeeId: empId,
              employeeName: empName,
              details: `Week of ${weekOf}: ${hours} hours`,
            });
          }
        }
      }

      // Check: zero_hours
      if (allChecks.includes('zero_hours')) {
        for (const sess of sessions) {
          if ((sess.data.durationMinutes || 0) === 0) {
            anomalies.push({
              type: 'zero_hours',
              severity: 'warning',
              employeeId: empId,
              employeeName: empName,
              details: `Session ${sess.id} has 0 minutes`,
              entityId: sess.id,
            });
          }
        }
      }

      // Check: unsigned_sessions (draft finalizationStatus)
      if (allChecks.includes('unsigned_sessions')) {
        for (const sess of sessions) {
          if (sess.data.finalizationStatus === 'draft' || !sess.data.finalizationStatus) {
            anomalies.push({
              type: 'unsigned_sessions',
              severity: 'warning',
              employeeId: empId,
              employeeName: empName,
              details: `Session ${sess.id} not finalized (status: ${sess.data.finalizationStatus || 'none'})`,
              entityId: sess.id,
            });
          }
        }
      }
    }

    res.json({
      period,
      valid: anomalies.filter(a => a.severity === 'error').length === 0,
      anomalies,
      stats: {
        totalSessions: sessionsSnap.size,
        totalHours: round2(sessionsSnap.docs.reduce((s, d) => s + (d.data().durationMinutes || 0), 0) / 60),
        employees: Object.keys(empSessions).length,
        anomalyCount: anomalies.length,
      },
    });
  } catch (e) {
    next(e);
  }
});


export default router;
