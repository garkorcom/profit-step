import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';

const db = admin.firestore();

// Config (Same as main bot)
const WORKER_BOT_TOKEN = process.env.WORKER_BOT_TOKEN || functions.config().worker_bot?.token;

export const checkOpenSessions = functions.pubsub.schedule('every 30 minutes').onRun(async (context) => {
    const now = new Date();
    const currentHour = now.getHours(); // Server time (UTC usually)

    // TODO: Ideally we should use user's timezone.
    // Assuming server is UTC, specific target timezone logic might be needed.
    // For now we assume a fixed "End of Day" check.
    // If we want to target 18:00 local time, and assuming UTC+2/3, lets trigger loosely.
    // The user requirement is "start reminding if session is open after 18:00".
    // We will check simply if the session duration is very long OR if it's continuously open in the evening.

    // Simplification for MVP:
    // If it is 'late' (e.g. > 18:00 server time or just simply duration based check?)
    // User requirement explicitly meant "After 18:00".
    // We'll define "Check Time" window. Let's assume we run this ALWAYS but only act on conditions.

    // Better Approach for robust shift limit:
    // Check if session duration > 10 hours?
    // OR Check if time is > 18:00 and session is active.

    // Let's implement the specific logic:
    // "If 18:00 session not closed -> remind every 30 min"
    // We will assume 18:00 is the trigger.

    // To respect timezones, we might need to store timezone or assume a project defaults.
    // Let's assume UTC for now matching server. If server is UTC, 18:00 UTC is late.

    console.log(`🔍 Checking open sessions at ${now.toISOString()}`);

    // Find active sessions
    const snapshot = await db.collection('work_sessions')
        .where('status', '==', 'active')
        .get();

    if (snapshot.empty) return null;

    for (const doc of snapshot.docs) {
        const session = doc.data();
        const reminderCount = session.reminderCount || 0;

        // 1. Is it "Late" or "Long"?
        // Condition: Time is past 18:00 (simple) OR Duration > 10 hours
        // Let's use the 18:00 rule strictly requested for the "Reminder Loop".
        // Adjust hour based on project timezone if known. defaulting to 18 for now.

        const isLate = currentHour >= 18;

        if (!isLate) continue;

        // 2. Logic Flow
        // If first time encountering this late session (reminderCount == 0) -> Send "Forgot to close?"
        // If reminderCount > 0 -> Check last reminder time.

        const lastReminder = session.lastReminderTime ? session.lastReminderTime.toDate() : null;

        // Anti-spam: Ensure 30 mins passed since last reminder
        if (lastReminder) {
            const diffMins = (now.getTime() - lastReminder.getTime()) / 60000;
            if (diffMins < 25) continue; // Skip if handled recently
        }

        // 3. Reminder or Penalty
        if (reminderCount >= 4) {
            // --- AUTO CLOSE PENALTY ---
            // 4 reminders (0, 1, 2, 3) sent -> ~2 hours passed.
            await applyAutoClosePenalty(doc);
        } else {
            // --- SEND REMINDER ---
            await sendReminder(doc, reminderCount);
        }
    }

    return null;
});

async function sendReminder(doc: FirebaseFirestore.QueryDocumentSnapshot, count: number) {
    const session = doc.data();
    const chatId = session.employeeId; // Assuming employeeId is telegramId

    const message = count === 0
        ? "🚧 **Shift Check**\n\nIt's past 18:00. Did you forget to close your session?"
        : `⏳ **Reminder ${count}/4**\n\nPlease close your session or extend it.`;

    const keyboard = {
        inline_keyboard: [
            [
                { text: "✅ Finish Work Now", callback_data: "force_finish_work" } // Trigger finish flow
            ],
            [
                { text: "clock +1h", callback_data: "extend_1h" },
                { text: "clock +2h", callback_data: "extend_2h" }
            ],
            [
                { text: "still working", callback_data: "still_working" }
            ]
        ]
    };

    await sendMessage(chatId, message, { reply_markup: keyboard });

    await doc.ref.update({
        reminderCount: (session.reminderCount || 0) + 1,
        lastReminderTime: admin.firestore.Timestamp.now()
    });
}

async function applyAutoClosePenalty(doc: FirebaseFirestore.QueryDocumentSnapshot) {
    const session = doc.data();
    const startTime = session.startTime.toDate();
    const chatId = session.employeeId;

    // RULE: End Time = Start + 2 Hours
    const penaltyEndTime = new Date(startTime.getTime() + (2 * 60 * 60 * 1000));
    const durationMinutes = 120; // 2 hours fixed

    const hourlyRate = session.hourlyRate || 0;
    const sessionEarnings = parseFloat(((durationMinutes / 60) * hourlyRate).toFixed(2));

    await doc.ref.update({
        status: 'completed',
        endTime: admin.firestore.Timestamp.fromDate(penaltyEndTime),
        durationMinutes: durationMinutes,
        sessionEarnings: sessionEarnings,
        description: 'Auto-closed due to inactivity (Penalty Rule)',
        autoClosed: true,
        reminderCount: admin.firestore.FieldValue.delete(), // Cleanup
        lastReminderTime: admin.firestore.FieldValue.delete()
    });

    await sendMessage(chatId, `⛔ **Session Auto-Closed**\n\nDue to lack of response, your session was closed with a penalty rule.\n\n⏱ Credited Time: 2h 00m\n💰 Credited: $${sessionEarnings}`);
}

async function sendMessage(chatId: number, text: string, options: any = {}) {
    if (!WORKER_BOT_TOKEN) return;
    try {
        await axios.post(`https://api.telegram.org/bot${WORKER_BOT_TOKEN}/sendMessage`, {
            chat_id: chatId,
            text: text,
            parse_mode: 'Markdown',
            ...options
        });
    } catch (error) {
        console.error('Error sending reminder:', error);
    }
}
