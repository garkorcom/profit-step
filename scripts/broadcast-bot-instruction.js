const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp({
    credential: applicationDefault(),
    projectId: process.env.GOOGLE_CLOUD_PROJECT || 'profit-step',
});

const db = getFirestore();
const WORKER_BOT_TOKEN = '8595653822:AAEmkbJ8Qpbn7jfUnPs64jRnB-fW_xgvBXM';

const INSTRUCTION_TEXT = `🚨 ОБНОВЛЕНИЕ СИСТЕМЫ (Версия 2.0) 🚨

Мы обновили бота! Теперь процесс начала и завершения смены работает через геолокацию.

▶️ КАК НАЧАТЬ РАБОТУ:
1. Нажми 📎 (скрепка) -> Location (Геопозиция) -> Отправь текущее гео.
2. Бот найдет объект. Подтверди кнопкой «✅ Да, начать».
3. Отправь Фото начала работ.
4. Запиши Голосовое сообщение с планом на день.

⏹️ КАК ЗАВЕРШИТЬ РАБОТУ:
1. Снова отправь Location (Геопозиция).
2. Подтверди завершение кнопкой «✅ Да, завершить».
3. Отправь итоговое Фото.
4. Запиши итоги Голосовым сообщением.

☕ ПЕРЕРЫВЫ:
- Жми «☕ Break» для начала. 
- Жми «▶️ Resume Work» для возврата.
⚠️ Перерывы более 1 часа автоматически ограничиваются.

❓ ЕСЛИ ЧТО-ТО ПОШЛО НЕ ТАК:
- Завис бот? Нажми /start чтобы сбросить все зависшие шаги!
- Нет интернета для голосового? Просто напиши текст в чат.
- Забыл закрыть смену? Бот закроет сам через 14 часов, но запишет ошибку.

Полная справка всегда доступна по команде /help`;

async function broadcast() {
    console.log('Fetching employees...');
    const snapshot = await db.collection('employees').get();

    let users = [];
    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.telegramId) {
            users.push(data.telegramId);
        }
    });

    const userSnapshot = await db.collection('users').get();
    userSnapshot.forEach(doc => {
        const data = doc.data();
        if (data.telegramId && !users.includes(data.telegramId)) {
            users.push(data.telegramId);
        }
    });

    // Remove duplicates properly just in case
    users = [...new Set(users.map(id => String(id)))];

    console.log(`Found ${users.length} unique telegram users.`);

    let successCount = 0;
    let failCount = 0;

    const delay = ms => new Promise(res => setTimeout(res, ms));

    for (const chatId of users) {
        try {
            const response = await fetch(`https://api.telegram.org/bot${WORKER_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: INSTRUCTION_TEXT
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(JSON.stringify(errorData));
            }

            console.log(`Sent to ${chatId}`);
            successCount++;
        } catch (error) {
            console.error(`Failed to send to ${chatId}:`, error.message);
            failCount++;
        }
        await delay(100);
    }

    console.log(`\nBroadcast complete!\nSuccess: ${successCount}\nFailed: ${failCount}`);
    process.exit(0);
}

broadcast();
