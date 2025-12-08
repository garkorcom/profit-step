import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import OpenAI from 'openai';

// const db = admin.firestore(); // Moved inside function
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || functions.config().openai?.key || 'mock-key',
});

export const generateLeadSummary = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
    }

    const db = admin.firestore();
    const { leadId } = data;
    if (!leadId) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing leadId');
    }

    try {
        // 1. Get Lead
        const leadDoc = await db.collection('leads').doc(leadId).get();
        if (!leadDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Lead not found');
        }
        const lead = leadDoc.data();

        // 2. Get Chat History (Try WA, then TG, then Email)
        // For simplicity, we aggregate messages from all linked chats
        // Or just check the most active one. Let's try to find 'wa_{phone}' first.
        let messages: any[] = [];

        if (lead?.phone) {
            const chatId = `wa_${lead.phone.replace(/\D/g, '')}`;
            const snap = await db.collection('chats').doc(chatId).collection('messages')
                .orderBy('timestamp', 'desc').limit(20).get();
            messages = snap.docs.map(d => d.data()).reverse();
        }

        if (messages.length === 0) {
            // Try TG if no WA
            // (Logic omitted for brevity, assuming WA is primary for now)
            return { success: false, message: 'No chat history found to analyze.' };
        }

        // 3. Prepare Prompt
        const conversationText = messages.map(m => `${m.role}: ${m.content}`).join('\n');
        const prompt = `
        Analyze the following conversation with a potential client.
        
        Conversation:
        ${conversationText}
        
        Provide a structured summary in JSON format with the following fields:
        - type: "Residential" or "Commercial" or "Unknown"
        - category: Service category (e.g., Painting, Electric)
        - priority: "High", "Medium", "Low"
        - recommendations: Actionable advice for the sales manager (max 2 sentences).
        `;

        // 4. Call AI
        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.3,
        });

        const aiResponse = completion.choices[0].message.content;

        // Parse JSON (simple attempt)
        let analysis = {};
        try {
            // Remove markdown code blocks if present
            const cleanJson = aiResponse?.replace(/```json/g, '').replace(/```/g, '').trim();
            analysis = JSON.parse(cleanJson || '{}');
        } catch (e) {
            console.error("Failed to parse AI JSON", e);
            analysis = { recommendations: aiResponse }; // Fallback
        }

        // 5. Update Lead
        await db.collection('leads').doc(leadId).update({
            aiAnalysis: analysis
        });

        return { success: true, analysis };

    } catch (error: any) {
        console.error('Error generating summary:', error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});
