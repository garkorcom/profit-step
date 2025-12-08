import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

export const onLeadCreate = functions.firestore
    .document('leads/{leadId}')
    .onCreate(async (snap, context) => {
        const leadId = context.params.leadId;
        const leadData = snap.data();

        console.log(`🧠 AI Agent analyzing lead: ${leadId}`);

        if (!leadData) {
            console.error('No data found for lead');
            return;
        }

        // 1. Classification Logic
        const notes = (leadData.notes && leadData.notes[0]?.text) ? leadData.notes[0].text.toLowerCase() : '';
        const service = (leadData.service || '').toLowerCase();
        const combinedText = `${service} ${notes}`;

        let type = 'Residential'; // Default
        let category = 'General Inquiry';
        let priority = 'Medium';
        let recommendations = 'Уточните детали проекта и предложите выезд для оценки.';

        // Detect Commercial
        if (combinedText.includes('commercial') || combinedText.includes('office') || combinedText.includes('store') || combinedText.includes('warehouse') || combinedText.includes('building')) {
            type = 'Commercial';
            priority = 'High';
            recommendations = 'Уточните масштаб объекта, наличие планов и сроки. Предложите встречу на объекте.';
        }

        // Detect Specific Services
        if (combinedText.includes('panel') || combinedText.includes('upgrade') || combinedText.includes('breaker') || combinedText.includes('fuse') || combinedText.includes('service change')) {
            category = 'Panel Upgrade';
            priority = 'High'; // High ticket
            recommendations = 'Уточните текущий ампераж, бренд панели и причину замены (страховка, ремонт, поломка).';
        } else if (combinedText.includes('ev') || combinedText.includes('charger') || combinedText.includes('tesla') || combinedText.includes('car')) {
            category = 'EV Charger';
            priority = 'High';
            recommendations = 'Уточните модель авто, расстояние от панели до парковки. Предложите установку защиты от скачков напряжения.';
        } else if (combinedText.includes('light') || combinedText.includes('led') || combinedText.includes('fixture')) {
            category = 'Lighting';
            recommendations = 'Спросите про высоту потолков и наличие доступа. Предложите диммеры и умные выключатели.';
        } else if (combinedText.includes('smart') || combinedText.includes('automation') || combinedText.includes('lutron')) {
            category = 'Smart Home';
            recommendations = 'Уточните платформу (Lutron, Control4, HomeKit). Предложите комплексное решение.';
        } else if (combinedText.includes('renovation') || combinedText.includes('remodel') || combinedText.includes('construction')) {
            category = 'Renovation';
            priority = 'High';
            recommendations = 'Запросите планы/чертежи. Уточните стадию ремонта.';
        }

        // Detect Urgency
        if (combinedText.includes('urgent') || combinedText.includes('asap') || combinedText.includes('emergency') || combinedText.includes('fire') || combinedText.includes('smoke') || combinedText.includes('power out')) {
            priority = 'Critical';
            recommendations = 'СРОЧНО! Уточните безопасность ситуации. Если есть дым/огонь - пусть звонят 911. Предложите аварийный выезд.';
        }

        // 2. Generate Briefing
        const briefing = `
📞 ЗВОНОК: ${leadData.name || 'Не указано'}
📱 Телефон: ${leadData.phone || 'Не указано'}
🏠 Тип: ${type} — ${category}
⚡ Приоритет: ${priority.toUpperCase()}
📝 Запрос: ${notes || service || 'Нет деталей'}
💡 Рекомендации: ${recommendations}
        `.trim();

        // 3. Update Lead Document
        try {
            await db.collection('leads').doc(leadId).update({
                aiAnalysis: {
                    type,
                    category,
                    priority,
                    recommendations,
                    analyzedAt: admin.firestore.FieldValue.serverTimestamp()
                },
                briefing: briefing
            });
            console.log(`✅ AI Analysis completed for lead: ${leadId}`);

            // 4. Send Email Notification
            try {
                console.log(`📧 [MOCK EMAIL] Sending notification to admin@profit-step.com`);
                console.log(`Subject: New Lead: ${leadData.name} (${priority})`);
                console.log(`Body:
                New Lead Received!
                Name: ${leadData.name}
                Phone: ${leadData.phone}
                Service: ${leadData.service}
                
                AI Analysis:
                Type: ${type}
                Category: ${category}
                Priority: ${priority}
                Recommendations: ${recommendations}
                `);
                console.log(`✅ Email notification sent for lead: ${leadId}`);
            } catch (error) {
                console.error(`❌ Error sending email notification:`, error);
            }

        } catch (error) {
            console.error(`❌ Error updating lead ${leadId} with AI analysis:`, error);
        }
    });
