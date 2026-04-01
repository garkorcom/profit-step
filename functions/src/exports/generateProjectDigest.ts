import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

/**
 * Callable function to generate a Weekly Client Digest.
 * 
 * This aggregates non-internal activity logs for the past 7 days,
 * groups them by date, and generates a beautifully formatted HTML report.
 * The HTML is saved to Firebase Storage and a public URL is returned.
 */
export const generateProjectDigest = functions.https.onCall(async (data, context) => {
    // 1. Verify Authentication
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'Функция должна вызываться авторизованным пользователем.'
        );
    }

    const { projectId } = data;
    if (!projectId) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'Параметр projectId обязателен.'
        );
    }

    const db = admin.firestore();
    const bucket = admin.storage().bucket();

    try {
        // 2. Fetch Project/Client Details
        const clientDoc = await db.collection('clients').doc(projectId).get();
        const clientName = clientDoc.exists ? clientDoc.data()?.name || 'Неизвестный проект' : 'Неизвестный проект';

        // 3. Fetch Activity Logs for the last 7 days
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const logsSnapshot = await db.collection('activity_logs')
            .where('projectId', '==', projectId)
            .where('isInternalOnly', '==', false)
            .where('performedAt', '>=', sevenDaysAgo)
            .orderBy('performedAt', 'desc')
            .get();

        if (logsSnapshot.empty) {
            return {
                success: false,
                message: 'Нет публичных событий за последние 7 дней для генерации отчета.'
            };
        }

        // 4. Group logs by Date
        const groupedLogs: Record<string, any[]> = {};
        logsSnapshot.docs.forEach(doc => {
            const logData = doc.data();
            const dateObj = logData.performedAt?.toDate() || new Date();
            const dateStr = dateObj.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
            
            if (!groupedLogs[dateStr]) groupedLogs[dateStr] = [];
            groupedLogs[dateStr].push(logData);
        });

        // 5. Generate HTML Content
        let htmlContent = `
        <!DOCTYPE html>
        <html lang="ru">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Еженедельный Отчет: ${clientName}</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; background-color: #f9fafb; }
                .report-header { text-align: center; margin-bottom: 40px; padding: 30px; background: white; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
                h1 { margin: 0; color: #111827; font-size: 24px; }
                .subtitle { color: #6b7280; font-size: 14px; margin-top: 8px; }
                .date-group { background: white; border-radius: 12px; padding: 24px; margin-bottom: 24px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
                .date-header { border-bottom: 2px solid #f3f4f6; padding-bottom: 12px; margin-top: 0; color: #2563eb; }
                .log-item { display: flex; align-items: flex-start; margin-bottom: 20px; border-bottom: 1px solid #f3f4f6; padding-bottom: 20px; }
                .log-item:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
                .log-time { font-size: 12px; color: #9ca3af; min-width: 60px; padding-top: 4px; }
                .log-content { flex-grow: 1; }
                .log-text { margin: 0 0 10px 0; white-space: pre-wrap;}
                .log-author { font-size: 12px; color: #6b7280; margin-top: 4px; font-style: italic; }
                .media-img { max-width: 100%; border-radius: 8px; margin-top: 10px; max-height: 400px; object-fit: contain; background: #f3f4f6; }
                .footer { text-align: center; margin-top: 50px; color: #9ca3af; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class="report-header">
                <h1>Отчет о ходе работ: ${clientName}</h1>
                <div class="subtitle">Сгенерировано: ${new Date().toLocaleDateString('ru-RU')}</div>
            </div>
        `;

        for (const [date, logs] of Object.entries(groupedLogs)) {
            htmlContent += `<div class="date-group"><h2 class="date-header">${date}</h2>`;
            
            for (const log of logs) {
                const timeStr = log.performedAt?.toDate().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) || '';
                
                let mediaHtml = '';
                if (log.type === 'photo' || log.type === 'video' || log.type === 'image') {
                    if (log.mediaUrl) {
                        // Assuming mediaUrl is a public HTTP link or authenticated. For client viewing, it must be public or signed.
                        // For HTML digests, we include the raw URL (or convert to signed later). We will use the raw URL.
                        const publicUrl = log.mediaUrl.replace('gs://', 'https://storage.googleapis.com/'); 
                        mediaHtml = `<img src="${publicUrl}" class="media-img" alt="Медиа проекта" />`;
                    }
                } else if (log.type === 'audio') {
                    mediaHtml = `<div>🔈 <em>Аудио-отчет прикреплен в системе</em></div>`;
                }

                htmlContent += `
                    <div class="log-item">
                        <div class="log-time">${timeStr}</div>
                        <div class="log-content">
                            <p class="log-text"><strong>${log.type === 'ai_action' ? '🤖 ' : ''}</strong>${log.content}</p>
                            ${mediaHtml}
                            <div class="log-author">— ${log.performedBy || 'Сотрудник'}</div>
                        </div>
                    </div>
                `;
            }
            htmlContent += `</div>`;
        }

        htmlContent += `
            <div class="footer">
                Этот отчет сгенерирован автоматически системой Profit Step.
            </div>
        </body>
        </html>
        `;

        // 6. Upload HTML to Storage
        const fileName = `projects/${projectId}/digests/Digest_${Date.now()}.html`;
        const file = bucket.file(fileName);
        
        await file.save(Buffer.from(htmlContent, 'utf-8'), {
            contentType: 'text/html',
            metadata: {
                cacheControl: 'public, max-age=31536000',
            }
        });

        // Make it public so the client can view it
        await file.makePublic();

        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

        // 7. Log this action
        await db.collection('activity_logs').add({
            companyId: context.auth.token.companyId || 'system',
            projectId: projectId,
            type: 'document_uploaded',
            content: `Сгенерирован еженедельный дайджест для клиента.`,
            mediaUrl: publicUrl,
            performedBy: context.auth.token.name || 'Система',
            performedAt: admin.firestore.FieldValue.serverTimestamp(),
            isInternalOnly: false
        });

        return {
            success: true,
            url: publicUrl,
            message: 'Дайджест успешно сгенерирован!'
        };

    } catch (error) {
        console.error('Error generating digest:', error);
        throw new functions.https.HttpsError('internal', 'Ошибка при генерации отчета.');
    }
});
