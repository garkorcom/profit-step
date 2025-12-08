import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import OpenAI from 'openai';

// Initialize OpenAI (API Key should be in environment variables)
// Run: firebase functions:config:set openai.key="YOUR_API_KEY"
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || functions.config().openai?.key || 'mock-key',
});

const db = admin.firestore();

// System Prompt
const SYSTEM_PROMPT = `
### ROLE
You are a professional, polite, and efficient Business Assistant for **Garkor Corp**.
Your task is to handle incoming WhatsApp messages, qualify the client, and collect initial information before transferring the dialogue to a live manager.

### OBJECTIVE
Your goal in the first 2-3 messages:
1. Greet (if it's the first message).
2. Understand what the client needs (New Project / Service / Question).
3. Collect basic data: Name, Object Location, Brief Task Description.
4. Politely inform that you are transferring the information to a specialist for calculation.

### TONE & STYLE
- Tone: Business-like but friendly and lively. Avoid bureaucracy and overly complex phrases.
- Format: Short messages (this is WhatsApp). Do not write long blocks of text.
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

export const onWhatsAppMessage = functions.https.onRequest(async (req, res) => {
    // 1. Validate Request (Meta Webhook Verification)
    if (req.method === 'GET') {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        // Run: firebase functions:config:set whatsapp.verify_token="YOUR_TOKEN"
        const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || functions.config().whatsapp?.verify_token || 'profit-step-token';

        if (mode === 'subscribe' && token === verifyToken) {
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
        return;
    }

    // 2. Handle Incoming Message
    if (req.method === 'POST') {
        try {
            const body = req.body;

            // Check if this is a WhatsApp message event
            if (body.object === 'whatsapp_business_account') {
                for (const entry of body.entry) {
                    for (const change of entry.changes) {
                        if (change.value.messages) {
                            const message = change.value.messages[0];
                            const from = message.from; // User's phone number
                            const text = message.text?.body; // Message content

                            if (!text) continue; // Skip non-text messages for now

                            // 3. Get Conversation History from Firestore
                            const chatId = `wa_${from}`;
                            const chatRef = db.collection('chats').doc(chatId);
                            const messagesRef = chatRef.collection('messages');

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
                                .reverse(); // OpenAI expects chronological order

                            // 4. Call AI
                            const completion = await openai.chat.completions.create({
                                model: "gpt-3.5-turbo", // Or gpt-4o
                                messages: [
                                    { role: "system", content: SYSTEM_PROMPT },
                                    ...history as any
                                ],
                                temperature: 0.3,
                            });

                            const aiResponse = completion.choices[0].message.content;

                            // 5. Save AI Response
                            await messagesRef.add({
                                role: 'assistant',
                                content: aiResponse,
                                timestamp: admin.firestore.FieldValue.serverTimestamp()
                            });

                            // 6. Send Response via WhatsApp API (Mock/Placeholder)
                            // To implement: Axios POST to https://graph.facebook.com/v17.0/PHONE_NUMBER_ID/messages
                            console.log(`[AI Response to ${from}]: ${aiResponse}`);

                            // TODO: Implement actual sending logic here
                            // await sendWhatsAppMessage(from, aiResponse);
                        }
                    }
                }
            }

            res.sendStatus(200);
        } catch (error) {
            console.error('Error processing WhatsApp webhook:', error);
            res.sendStatus(500);
        }
    } else {
        res.sendStatus(405);
    }
});
