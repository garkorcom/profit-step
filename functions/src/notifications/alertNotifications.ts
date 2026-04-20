/**
 * Webhook Notifications — Budget/Deadline Alerts
 * 
 * Scheduled function that checks for:
 * 1. Projects where costs exceed budget thresholds (75%, 90%, 100%)
 * 2. Tasks approaching or past due dates
 * 3. Sends alerts to Telegram admin group
 */
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { TELEGRAM_TOKEN, ADMIN_GROUP_ID } from '../config';

const db = admin.firestore();

// ─── Telegram Messenger ─────────────────────────────────────────

async function sendTelegramAlert(message: string): Promise<void> {
  const token = TELEGRAM_TOKEN.value();
  const chatId = ADMIN_GROUP_ID;

  if (!token || !chatId) {
    console.warn('⚠️ Telegram credentials missing — skipping alert');
    return;
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_notification: false,
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      console.error('❌ Telegram send failed:', error);
    }
  } catch (err) {
    console.error('❌ Telegram send error:', err);
  }
}

// ─── Budget Alert Check ─────────────────────────────────────────

interface BudgetAlert {
  projectId: string;
  projectName: string;
  clientName: string;
  budget: number;
  spent: number;
  percent: number;
  level: 'warning' | 'critical' | 'exceeded';
}

async function checkBudgetAlerts(): Promise<BudgetAlert[]> {
  const alerts: BudgetAlert[] = [];

  // Get all active projects with budgets
  const projectsSnap = await db.collection('projects')
    .where('status', '==', 'active')
    .get();

  for (const doc of projectsSnap.docs) {
    const project = doc.data();
    const budget = project.budgetAmount || project.totalCredit || 0;
    if (budget <= 0) continue;

    // Sum confirmed costs for this project
    const costsSnap = await db.collection('costs')
      .where('projectId', '==', doc.id)
      .where('status', '==', 'confirmed')
      .get();

    const spent = costsSnap.docs.reduce((sum, d) => sum + Math.abs(d.data().amount || 0), 0);
    const percent = Math.round((spent / budget) * 100);

    // Check thresholds
    if (percent >= 100) {
      alerts.push({
        projectId: doc.id,
        projectName: project.name || 'Unknown',
        clientName: project.clientName || '',
        budget, spent, percent, level: 'exceeded',
      });
    } else if (percent >= 90) {
      alerts.push({
        projectId: doc.id,
        projectName: project.name || 'Unknown',
        clientName: project.clientName || '',
        budget, spent, percent, level: 'critical',
      });
    } else if (percent >= 75) {
      alerts.push({
        projectId: doc.id,
        projectName: project.name || 'Unknown',
        clientName: project.clientName || '',
        budget, spent, percent, level: 'warning',
      });
    }
  }

  return alerts;
}

// ─── Deadline Alert Check ───────────────────────────────────────

interface DeadlineAlert {
  taskId: string;
  title: string;
  clientName: string;
  dueDate: Date;
  daysUntil: number;
  status: 'overdue' | 'today' | 'upcoming';
}

async function checkDeadlineAlerts(): Promise<DeadlineAlert[]> {
  const alerts: DeadlineAlert[] = [];
  const now = new Date();
  const threeDaysFromNow = new Date();
  threeDaysFromNow.setDate(now.getDate() + 3);

  // Get tasks with due dates that are approaching or past
  const tasksSnap = await db.collection('gtd_tasks')
    .where('status', 'in', ['inbox', 'next_action', 'waiting', 'projects'])
    .where('dueDate', '<=', admin.firestore.Timestamp.fromDate(threeDaysFromNow))
    .orderBy('dueDate', 'asc')
    .limit(50)
    .get();

  for (const doc of tasksSnap.docs) {
    const task = doc.data();
    const dueDate = task.dueDate?.toDate?.() || null;
    if (!dueDate) continue;

    const diffMs = dueDate.getTime() - now.getTime();
    const daysUntil = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    let status: 'overdue' | 'today' | 'upcoming';
    if (daysUntil < 0) status = 'overdue';
    else if (daysUntil === 0) status = 'today';
    else status = 'upcoming';

    alerts.push({
      taskId: doc.id,
      title: task.title || 'Untitled',
      clientName: task.clientName || '',
      dueDate,
      daysUntil,
      status,
    });
  }

  return alerts;
}

// ─── Format Alerts ──────────────────────────────────────────────

function formatBudgetAlerts(alerts: BudgetAlert[]): string {
  if (alerts.length === 0) return '';

  const emoji = { warning: '🟡', critical: '🟠', exceeded: '🔴' };
  const lines = alerts.map(a =>
    `${emoji[a.level]} <b>${a.projectName}</b> (${a.clientName})\n` +
    `   Budget: $${a.budget.toLocaleString()} | Spent: $${a.spent.toLocaleString()} (${a.percent}%)`
  );

  return `💰 <b>Budget Alerts</b>\n\n${lines.join('\n\n')}`;
}

function formatDeadlineAlerts(alerts: DeadlineAlert[]): string {
  if (alerts.length === 0) return '';

  const emoji = { overdue: '🔴', today: '🟠', upcoming: '🟡' };
  const label = { overdue: 'OVERDUE', today: 'TODAY', upcoming: 'SOON' };
  const lines = alerts.map(a =>
    `${emoji[a.status]} [${label[a.status]}] <b>${a.title}</b>\n` +
    `   ${a.clientName ? a.clientName + ' | ' : ''}Due: ${a.dueDate.toLocaleDateString('en-US')}`
  );

  return `📅 <b>Deadline Alerts</b>\n\n${lines.join('\n\n')}`;
}

// ─── Scheduled Function: Every 6 hours ──────────────────────────

export const notifyAlerts = functions
  .region('us-central1')
  .runWith({ secrets: [TELEGRAM_TOKEN] })
  .pubsub.schedule('0 */6 * * *') // Every 6 hours
  .timeZone('America/New_York')
  .onRun(async () => {
    console.log('🔔 Running alert checks...');

    const [budgetAlerts, deadlineAlerts] = await Promise.all([
      checkBudgetAlerts(),
      checkDeadlineAlerts(),
    ]);

    console.log(`📊 Budget: ${budgetAlerts.length} alerts, Deadline: ${deadlineAlerts.length} alerts`);

    if (budgetAlerts.length === 0 && deadlineAlerts.length === 0) {
      console.log('✅ No alerts to send');
      return;
    }

    // Compose message
    const parts: string[] = ['🔔 <b>Profit Step Alerts</b>\n'];

    if (budgetAlerts.length > 0) {
      parts.push(formatBudgetAlerts(budgetAlerts));
    }
    if (deadlineAlerts.length > 0) {
      parts.push(formatDeadlineAlerts(deadlineAlerts));
    }

    parts.push(`\n⏰ ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}`);

    await sendTelegramAlert(parts.join('\n\n'));

    // Log to Firestore for audit
    await db.collection('alert_log').add({
      type: 'scheduled_check',
      budgetAlerts: budgetAlerts.length,
      deadlineAlerts: deadlineAlerts.length,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log('✅ Alerts sent successfully');
  });

// ─── Manual HTTP trigger (for testing) ──────────────────────────

export const triggerAlerts = functions
  .region('us-central1')
  .runWith({ secrets: [TELEGRAM_TOKEN] })
  .https.onRequest(async (req, res) => {
    console.log('🔔 Manual alert trigger...');

    const [budgetAlerts, deadlineAlerts] = await Promise.all([
      checkBudgetAlerts(),
      checkDeadlineAlerts(),
    ]);

    const parts: string[] = ['🔔 <b>Profit Step Alerts (Manual)</b>\n'];

    if (budgetAlerts.length > 0) {
      parts.push(formatBudgetAlerts(budgetAlerts));
    }
    if (deadlineAlerts.length > 0) {
      parts.push(formatDeadlineAlerts(deadlineAlerts));
    }

    if (budgetAlerts.length > 0 || deadlineAlerts.length > 0) {
      parts.push(`\n⏰ ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
      await sendTelegramAlert(parts.join('\n\n'));
    }

    res.json({
      budgetAlerts,
      deadlineAlerts,
      sent: budgetAlerts.length > 0 || deadlineAlerts.length > 0,
    });
  });
