import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as nodemailer from 'nodemailer';
import { TELEGRAM_TOKEN, EMAIL_PASSWORD, EMAIL_USER } from '../../config';

// Lazy nodemailer — secrets only available at invocation time in GCF v2
let _transporter: nodemailer.Transporter | null = null;
function getTransporter(): nodemailer.Transporter {
    if (!_transporter) {
        _transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: EMAIL_USER,
                pass: EMAIL_PASSWORD.value(),
            },
        });
    }
    return _transporter;
}

interface SendMessageData {
    leadId: string;
    message: string;
    channels: {
        whatsapp?: boolean;
        telegram?: boolean;
        email?: boolean;
    };
}

export const sendMessage = functions
    .runWith({ secrets: [TELEGRAM_TOKEN, EMAIL_PASSWORD] })
    .https.onCall(async (data: SendMessageData, context) => {
    // 1. Auth Check
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
    }

    const db = admin.firestore();
    const { leadId, message, channels } = data;
    if (!leadId || !message) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing leadId or message');
    }

    try {
        // 2. Get Lead Data
        const leadDoc = await db.collection('leads').doc(leadId).get();
        if (!leadDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Lead not found');
        }
        const lead = leadDoc.data();
        const phone = lead?.phone?.replace(/\D/g, ''); // Clean phone
        const email = lead?.email;

        // 3. Send via Channels
        const results: any = {};

        // --- WhatsApp ---
        if (channels.whatsapp && phone) {
            try {
                // TODO: Integrate with Meta Cloud API
                // For now, we simulate success and log
                console.log(`[WhatsApp] Sending to ${phone}: ${message}`);

                // Save to Firestore Chat
                const chatId = `wa_${phone}`; // Consistent ID convention
                await db.collection('chats').doc(chatId).collection('messages').add({
                    role: 'assistant',
                    content: message,
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    channel: 'whatsapp',
                    sentBy: context.auth.uid
                });
                results.whatsapp = { success: true, status: 'sent (mock)' };
            } catch (err: any) {
                console.error('[WhatsApp] Error:', err);
                results.whatsapp = { success: false, error: err.message };
            }
        }

        // --- Telegram ---
        if (channels.telegram) {
            try {
                // We need to find the Telegram Chat ID associated with this lead
                const telegramChatId = lead?.telegramChatId;

                if (telegramChatId) {
                    const token = TELEGRAM_TOKEN.value();
                    if (token) {
                        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                chat_id: telegramChatId,
                                text: message,
                                parse_mode: 'Markdown'
                            })
                        });

                        // Save to Firestore Chat
                        const chatId = `tg_${telegramChatId}`;
                        await db.collection('chats').doc(chatId).collection('messages').add({
                            role: 'assistant',
                            content: message,
                            timestamp: admin.firestore.FieldValue.serverTimestamp(),
                            channel: 'telegram',
                            sentBy: context.auth.uid
                        });
                        results.telegram = { success: true, status: 'sent' };
                    } else {
                        results.telegram = { success: false, error: 'Missing TELEGRAM_TOKEN' };
                    }
                } else {
                    results.telegram = { success: false, error: 'No telegramChatId for lead' };
                }
            } catch (err: any) {
                console.error('[Telegram] Error:', err);
                results.telegram = { success: false, error: err.message };
            }
        }

        // --- Email ---
        if (channels.email && email) {
            try {
                const emailUser = EMAIL_USER;
                const emailPass = EMAIL_PASSWORD.value();

                if (!emailUser || !emailPass) {
                    throw new Error('Missing email configuration (EMAIL_USER/EMAIL_PASSWORD)');
                }

                await getTransporter().sendMail({
                    from: `"Profit Step CRM" <${emailUser}>`,
                    to: email,
                    subject: 'Message from Profit Step',
                    text: message,
                });
                // Save to Firestore Chat (Virtual Email Chat)
                const chatId = `email_${email}`;
                await db.collection('chats').doc(chatId).collection('messages').add({
                    role: 'assistant',
                    content: message,
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    channel: 'email',
                    sentBy: context.auth.uid
                });
                results.email = { success: true, status: 'sent' };
            } catch (err: any) {
                console.error('[Email] Error:', err);
                results.email = { success: false, error: err.message };
            }
        }

        return { success: true, results };

    } catch (error: any) {
        console.error('Error sending message:', error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});
