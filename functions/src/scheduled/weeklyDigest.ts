/**
 * @fileoverview Weekly Digest - Automated Analytics Report
 * 
 * v1 scheduled function (pubsub.schedule) - more stable than v2 for scheduled tasks.
 * Runs every Sunday at 22:00 EST.
 * 
 * @module scheduled/weeklyDigest
 */

import * as functions from 'firebase-functions';
import { BigQuery } from '@google-cloud/bigquery';
import * as admin from 'firebase-admin';

const DATASET_ID = 'profit_step_dwh';
const OWNER_TELEGRAM_ID = '460498245';

interface WeeklyStats {
    expenses: number;
    revenue: number;
    total_minutes: number;
    deadline_shifts: number;
    manual_edits: number;
    last_week_expenses: number;
    expense_change_pct: number;
}

/**
 * Weekly Digest - Sunday 22:00 EST (v1 format)
 * NEW NAME to avoid v2 conflict
 */
export const sendWeeklyDigest = functions.pubsub
    .schedule('0 22 * * 0') // Sunday 22:00
    .timeZone('America/New_York')
    .onRun(async () => {
        console.log('📊 Running weekly digest...');

        const bigquery = new BigQuery();

        const query = `
            WITH this_week AS (
                SELECT
                    COALESCE(SUM(CASE WHEN financial_impact < 0 THEN ABS(financial_impact) ELSE 0 END), 0) as expenses,
                    COALESCE(SUM(CASE WHEN financial_impact > 0 THEN financial_impact ELSE 0 END), 0) as revenue,
                    COALESCE(SUM(time_impact), 0) as total_minutes,
                    COUNT(CASE WHEN event_code = 'DEADLINE_SHIFT' THEN 1 END) as deadline_shifts,
                    COUNT(CASE WHEN event_code = 'MANUAL_TIME_EDIT' THEN 1 END) as manual_edits
                FROM \`profit-step.${DATASET_ID}.audit_events_log\`
                WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
            ),
            last_week AS (
                SELECT
                    COALESCE(SUM(CASE WHEN financial_impact < 0 THEN ABS(financial_impact) ELSE 0 END), 0) as expenses
                FROM \`profit-step.${DATASET_ID}.audit_events_log\`
                WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 14 DAY)
                  AND timestamp < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
            )
            SELECT 
                t.expenses, t.revenue, t.total_minutes, t.deadline_shifts, t.manual_edits,
                l.expenses as last_week_expenses,
                CASE WHEN l.expenses > 0 THEN ROUND((t.expenses - l.expenses) / l.expenses * 100, 1) ELSE 0 END as expense_change_pct
            FROM this_week t, last_week l
        `;

        try {
            const [rows] = await bigquery.query(query);

            if (!rows || rows.length === 0) {
                console.log('📊 No data found for weekly digest');
                return null;
            }

            const data = rows[0] as WeeklyStats;
            const expenseArrow = data.expense_change_pct > 0 ? '⬆️' : '⬇️';
            const balance = (data.revenue || 0) - (data.expenses || 0);
            const balanceEmoji = balance >= 0 ? '✅' : '🔴';
            const hoursWorked = Math.round((data.total_minutes || 0) / 60);

            const anomalies: string[] = [];
            if (data.manual_edits > 0) anomalies.push(`• ⚠️ Ручных правок: ${data.manual_edits}`);
            if (data.deadline_shifts > 3) anomalies.push(`• ⚠️ Сдвигов дедлайнов: ${data.deadline_shifts}`);
            if (data.expense_change_pct > 20) anomalies.push(`• ⚠️ Рост расходов: ${data.expense_change_pct}%`);

            const report = `📊 *Еженедельный отчёт*
_Неделя ${getWeekNumber(new Date())}_

💰 *Деньги:*
• Расходы: $${data.expenses?.toFixed(2) || '0'} ${expenseArrow} ${Math.abs(data.expense_change_pct || 0)}%
• Выручка: $${data.revenue?.toFixed(2) || '0'}
• Баланс: ${balanceEmoji} $${balance.toFixed(2)}

⏱️ *Время:* ${hoursWorked}ч | Сдвигов: ${data.deadline_shifts || 0}

🚨 *Аномалии:*
${anomalies.length ? anomalies.join('\n') : '• ✅ Всё в норме'}`;

            await sendTelegramMessage(OWNER_TELEGRAM_ID, report);
            console.log('📊 Weekly digest sent!');

        } catch (error) {
            console.error('❌ Weekly digest failed:', error);
        }

        return null;
    });

function getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
    const configDoc = await admin.firestore().collection('config').doc('telegram').get();
    const token = configDoc.data()?.workerBotToken;

    if (!token) {
        console.error('❌ No Telegram token');
        return;
    }

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });
}
