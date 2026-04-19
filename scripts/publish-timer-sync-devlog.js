const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

initializeApp({
    credential: applicationDefault(),
    projectId: process.env.GOOGLE_CLOUD_PROJECT || 'profit-step',
});

const db = getFirestore();

const article = {
    featureId: 'timer-sync-stability-phase16',
    featureTitle: 'Flawless Timer Sync (Web ↔ Telegram) | Идеальная синхронизация',
    authorId: 'system',
    type: 'feature',
    rawInput: {
        notes: 'Phase 16 Update: Fixed ghost sessions, implemented offline blocking, true pause state sync, and race condition guards.',
        codeDiff: '',
        images: [],
        timeSpentMinutes: 180,
    },
    content: {
        title: 'Обновление системы: Идеальная синхронизация таймера (Web ↔ Telegram Bot) / Flawless Timer Sync',
        slug: 'timer-sync-stability-phase16',
        emoji: '⏱️',
        tldr: 'Исправили рассинхрон состояния между Web-приложением и Telegram ботом. Внедрили блокировку оффлайн-стартов, отображение статуса "на паузе" в браузере и защиты от двойных запусков. / Fixed state desync between the React GTD Web App and Telegram Bot. Implemented offline start blocking, "paused" UI states in browser, and transaction guards.',
        storyMarkdown: `**[EN]**
Today, we tackled a complex challenge in our distributed Time-Tracking system: seamless state synchronization between the React GTD Web App and the Telegram Bot. Previously, having two concurrent interfaces controlling the same "Work Session" timer led to edge cases, such as ghost sessions starting offline or UI desyncs when a session was paused from the bot.

Here are the key improvements shipped today (Phase 16):
- **Offline Integrity (Ghost Session Prevention):** The Web UI now strictly blocks timer start attempts if you are offline (\`navigator.onLine\`), preventing delayed cache-writes from creating phantom sessions later.
- **True Pause State:** Pauses initiated via Telegram ("☕ Break") are now instantly reflected in the Web UI, stopping the timer and displaying a yellow ⏸ indicator. When resumed, the elapsed time correctly deducts all break durations.
- **Race Condition Guards:** We implemented idempotency checks and transaction safeguards to prevent duplicate entries if a user starts/stops a session simultaneously from both clients or during a Cron execution.
- **Smarter Background Checks:** The hourly Cron job now tags forcefully closed stale sessions with an \`autoClosed\` flag, triggering a customized Telegram warning ("⚠️ Session lasted too long and was auto-closed") instead of a false success message.

To guarantee reliability, we formulated a comprehensive QA testing protocol for our distributed architecture and successfully passed the core edge-case simulations!

---

**[RU]**
Сегодня мы решили сложную задачу в нашей системе тайм-трекинга: бесшовную синхронизацию состояния между Web-приложением и Telegram ботом. Ранее наличие двух независимых интерфейсов, управляющих одним "Таймером", периодически приводило к рассинхрону.

Ключевые улучшения встроенные сегодня (Phase 16):
- **Оффлайн-защита (Блокировка сессий-призраков):** Web-интерфейс теперь строго блокирует запуск таймера, если пропал интернет (\`navigator.onLine === false\`), предотвращая отложенную запись из кэша.
- **Синхронизация паузы:** Перерыв ("☕ Кофе-брейк"), начатый в Telegram, теперь мгновенно актуализируется в браузере — таймер останавливается и появляется желтый индикатор ⏸.
- **Защита от состояний гонки:** Настроены логические проверки, чтобы предотвратить двойные запуски и списания при одновременном клике с телефона и ПК.
- **Умные фоновые проверки:** Ежедневный Cron теперь помечает принудительно закрытые забытые сессии особым флагом, и бот присылает строгое предупреждение вместо ложного сообщения "Смена окончена".

Мы создали полный QA/Pentest план покрытия этой логики и успешно закрыли все тесты!`,
        technicalMarkdown: ``,
        keyTakeaways: [
            'Relying solely on Firestore cache for offline writes without UI-level network checks (navigator.onLine) is dangerous for time-sensitive data like starting a stopwatch.',
            'Maintaining separate \`totalBreakMinutes\` and \`lastBreakStart\` state lets the frontend calculate pure elapsed time accurately even while paused.',
            'Distributed systems with background Crons require status pre-conditions (like \`before.status === "completed"\`) to prevent race conditions during state transitions.'
        ],
    },
    seo: {
        metaDescription: 'Phase 16 System Update: Flawless Timer Sync between Web UI and Telegram Bot. Offline integrity, pause state syncing, and race condition guards.',
        keywords: ['Time Tracking', 'Firebase', 'Data Synchronization', 'Offline Sync', 'Telegram Bot'],
    },
    isPublished: true,
    publishedAt: Timestamp.now(),
    createdAt: Timestamp.now(),
};

async function publishDevLog() {
    console.log('Publishing new DevLog for Timer Sync...');
    try {
        const docRef = await db.collection('dev_logs').add(article);
        console.log("✅ Successfully published to dev_logs with ID: " + docRef.id);
    } catch (e) {
        console.error("❌ Failed to publish dev log:", e);
    }
    process.exit(0);
}

publishDevLog();
