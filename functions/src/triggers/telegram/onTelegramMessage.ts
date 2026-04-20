import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import OpenAI from 'openai';
import { OPENAI_API_KEY, TELEGRAM_TOKEN } from '../../config';
// Lazy — resolve secret at invocation, not module load.
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
    if (!_openai) {
        _openai = new OpenAI({ apiKey: OPENAI_API_KEY.value() || 'mock-key' });
    }
    return _openai;
}

// const db = admin.firestore(); // Moved inside function

// System Prompt (Same as WhatsApp)
const SYSTEM_PROMPT = `
### ROLE
You are a professional, polite, and efficient Business Assistant for **Garkor Corp**.
Your task is to handle incoming Telegram messages, qualify the client, and collect initial information before transferring the dialogue to a live manager.

### OBJECTIVE
Your goal in the first 2-3 messages:
1. Greet (if it's the first message).
2. Understand what the client needs (New Project / Service / Question).
3. Collect basic data: Name, Object Location, Brief Task Description.
4. Politely inform that you are transferring the information to a specialist for calculation.

### TONE & STYLE
- Tone: Business-like but friendly and lively. Avoid bureaucracy and overly complex phrases.
- Format: Short messages. Do not write long blocks of text.
- Language: Respond in the language the client writes in (Russian or English). If unclear, respond in English (or Russian, depending on the region).

### RULES (STRICT)
1. NEVER give an exact price (numbers). If asked "how much?", answer: "The cost depends on the project details/volume. I will clarify the details, and the manager will prepare a preliminary estimate for you."
2. NEVER promise a specific visit time if you don't have access to the calendar. Write: "We will agree on a convenient time shortly."
3. Ask ONE question at a time. Do not overload the client with a questionnaire.
4. If the client writes nonsense or spam, respond neutrally or end the dialogue.

### KNOWLEDGE BASE
- Services: House Painting, Electric Services, Home Security Camera Installation, Commercial Services, Remodeling.
- Working Hours: Mon-Fri from 9 AM to 6 PM.
`;

export const onTelegramMessage = functions.https.onRequest(async (req, res) => {
    // 1. Handle Telegram Webhook
    if (req.method === 'POST') {
        const db = admin.firestore();
        try {
            const update = req.body;

            // Check if it's a message
            if (update.message && update.message.text) {
                const chatId = update.message.chat.id;
                const text = update.message.text;
                const fromName = update.message.from.first_name || 'User';
                const fromUsername = update.message.from.username;

                // 2. Find or Create Lead
                const leadsRef = db.collection('leads');
                let leadId;

                // Check for Deep Linking (e.g., /start <leadId>)
                if (text.startsWith('/start ') && text.length > 7) {
                    const potentialLeadId = text.split(' ')[1].trim();
                    const leadDoc = await leadsRef.doc(potentialLeadId).get();
                    if (leadDoc.exists) {
                        leadId = potentialLeadId;
                        await leadsRef.doc(leadId).update({
                            telegramChatId: chatId,
                            telegramUsername: fromUsername || null,
                            source: 'telegram_linked' // Optional: mark as linked
                        });
                        console.log(`[Telegram] Linked chat ${chatId} to existing lead ${leadId}`);

                        // Send confirmation to user
                        const telegramToken = TELEGRAM_TOKEN.value();
                        if (telegramToken) {
                            await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    chat_id: chatId,
                                    text: `Successfully linked to lead: ${leadDoc.data()?.name}`,
                                })
                            });
                        }
                    }
                }

                if (!leadId) {
                    // Normal flow: Check if linked by ID
                    const q = leadsRef.where('telegramChatId', '==', chatId).limit(1);
                    const querySnapshot = await q.get();

                    if (!querySnapshot.empty) {
                        // Lead exists
                        const leadDoc = querySnapshot.docs[0];
                        leadId = leadDoc.id;
                    } else {
                        // Create new Lead
                        const newLeadRef = await leadsRef.add({
                            name: fromName,
                            source: 'telegram_bot',
                            status: 'new',
                            telegramChatId: chatId,
                            telegramUsername: fromUsername || null,
                            createdAt: admin.firestore.FieldValue.serverTimestamp(),
                            phone: '', // Unknown initially
                            email: '',
                            service: 'Unknown'
                        });
                        leadId = newLeadRef.id;
                        console.log(`[Telegram] Created new lead: ${leadId}`);
                    }
                }

                // 3. Get Conversation History from Firestore
                // We use the same chat ID convention
                const chatDocId = `tg_${chatId}`;
                const chatRef = db.collection('chats').doc(chatDocId);
                const messagesRef = chatRef.collection('messages');

                // Ensure chat is linked to lead (optional, but good for query)
                await chatRef.set({ leadId, type: 'telegram', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

                // Save user message
                await messagesRef.add({
                    role: 'user',
                    content: text,
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });

                // Get last 10 messages for context
                const historySnapshot = await messagesRef
                    .orderBy('timestamp', 'desc')
                    .limit(10)
                    .get();

                const history = historySnapshot.docs
                    .map(doc => ({ role: doc.data().role, content: doc.data().content }))
                    .reverse();

                // 3. Call AI
                const completion = await getOpenAI().chat.completions.create({
                    model: "gpt-3.5-turbo",
                    messages: [
                        { role: "system", content: SYSTEM_PROMPT },
                        ...history as any
                    ],
                    temperature: 0.3,
                });

                const aiResponse = completion.choices[0].message.content;

                // 4. Save AI Response
                await messagesRef.add({
                    role: 'assistant',
                    content: aiResponse,
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });

                // 5. Send Response via Telegram API
                const telegramToken = TELEGRAM_TOKEN.value();

                if (telegramToken) {
                    await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: chatId,
                            text: aiResponse,
                            parse_mode: 'Markdown'
                        })
                    });
                    console.log(`[AI Response to ${chatId}]: ${aiResponse}`);
                } else {
                    console.error('Telegram Token not configured!');
                }
            }

            res.sendStatus(200);
        } catch (error) {
            console.error('Error processing Telegram webhook:', error);
            res.sendStatus(500);
        }
    } else {
        res.sendStatus(405);
    }
});
