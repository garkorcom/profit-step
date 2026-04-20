import * as functions from 'firebase-functions';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';
import {
    BlueprintInput,
    detectMimeType,
    analyzeWithGemini,
    analyzeWithClaude,
    analyzeWithOpenAI,
    compareResults,
    performTargetedReconciliation,
    extractBlueprintMetadata
} from '../../services/blueprintAIService';
import { AI_CALLABLE_SECRETS } from '../../config';

const createLog = (message: string, type: 'info' | 'gemini' | 'claude' | 'openAi' | 'error' | 'success' = 'info') => ({
    timestamp: Date.now(),
    message,
    type
});

import { BlueprintJob } from '../../types/blueprint.types';

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const storage = admin.storage();

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Timeout: ${label} took longer than ${ms}ms`));
        }, ms);
        promise
            .then(resolve)
            .catch(reject)
            .finally(() => clearTimeout(timer));
    });
}

export const onBlueprintJobCreated = functions
    .region('us-central1')
    .runWith({ timeoutSeconds: 300, memory: '1GB', secrets: [...AI_CALLABLE_SECRETS] })
    .firestore
    .document('blueprint_jobs/{jobId}')
    .onCreate(async (snap, context) => {
        const jobId = context.params.jobId;
        const job = snap.data() as BlueprintJob;

        logger.info(`🏗 Blueprint Job started: ${jobId}`, { file: job.fileName });

        if (job.status !== 'pending') {
            return null;
        }

        try {
            await snap.ref.update({
                status: 'processing',
                geminiStatus: 'processing',
                claudeStatus: 'processing',
                openAiStatus: 'processing',
                progress: 10,
                message: 'Загрузка чертежа из хранилища...',
                logs: admin.firestore.FieldValue.arrayUnion(createLog('Облако приняло документ. Скачивание...'))
            });

            // ===== STEP 1: Download file =====
            if (!job.referencePath) throw new Error('Missing referencePath');

            const bucket = storage.bucket();
            const file = bucket.file(job.referencePath);
            const [buffer] = await file.download();

            // Detect actual MIME type from file header bytes
            const mimeType = detectMimeType(buffer, job.fileName);
            const isPdf = mimeType === 'application/pdf';
            const base64 = buffer.toString('base64');
            const input: BlueprintInput = { buffer, mimeType, fileName: job.fileName, base64, isPdf };

            logger.info(`File: ${job.fileName}, MIME: ${mimeType}, Size: ${(buffer.length / 1024).toFixed(0)}KB`);

            await snap.ref.update({
                progress: 20,
                message: isPdf
                    ? 'PDF обнаружен. Gemini и Claude читают нативно, OpenAI пропускает PDF...'
                    : 'Изображение обнаружено. Отправляем всем трём ИИ...',
                logs: admin.firestore.FieldValue.arrayUnion(
                    createLog(isPdf
                        ? `PDF файл (${(buffer.length / 1024).toFixed(0)}KB). Gemini ✅ Claude ✅ OpenAI ⏭️ (не поддерживает PDF)`
                        : `Изображение ${mimeType} (${(buffer.length / 1024).toFixed(0)}KB). Все 3 ИИ получат файл.`
                    )
                )
            });

            // Fire-and-forget metadata extraction
            extractBlueprintMetadata(input).then(metadata => {
                if (Object.keys(metadata).length > 0) {
                    snap.ref.update({ metadata }).catch(e => logger.error('Metadata update failed', e));
                }
            }).catch(e => logger.error('Metadata extraction failed', e));

            // ===== STEP 2: Send to all AIs =====
            await snap.ref.update({
                progress: 30,
                message: 'Анализ чертежа ИИ параллельно...',
                logs: admin.firestore.FieldValue.arrayUnion(
                    createLog('Сканирование запущено: Gemini, Claude, OpenAI...')
                )
            });

            let geminiError: string | undefined, claudeError: string | undefined, openAiError: string | undefined;
            let geminiResult: any, claudeResult: any, openAiResult: any;

            try {
                const TIMEOUT_MS = 90000; // 90s — PDF analysis takes longer
                const RETRY_TIMEOUT_MS = 45000;

                const runAgent = async <T>(
                    analyzeFunc: () => Promise<T>,
                    timeoutMs: number,
                    agentLabel: 'gemini' | 'claude' | 'openAi'
                ) => {
                    const start = Date.now();

                    // Attempt 1
                    try {
                        const result = await withTimeout(analyzeFunc(), timeoutMs, agentLabel);
                        const timeMs = Date.now() - start;
                        await snap.ref.update({
                            [`${agentLabel}Result`]: result,
                            [`${agentLabel}Status`]: 'completed',
                            [`${agentLabel}TimeMs`]: timeMs,
                            logs: admin.firestore.FieldValue.arrayUnion(
                                createLog(`[${agentLabel.toUpperCase()}] ✅ ${(timeMs / 1000).toFixed(1)}s`, agentLabel)
                            )
                        });
                        return { status: 'fulfilled' as const, result, timeMs };
                    } catch (firstError: any) {
                        logger.warn(`${agentLabel} attempt 1 failed: ${firstError?.message}`);

                        await snap.ref.update({
                            logs: admin.firestore.FieldValue.arrayUnion(
                                createLog(`[${agentLabel.toUpperCase()}] ⚠️ Retry...`, 'error')
                            )
                        });

                        // Attempt 2
                        try {
                            const result = await withTimeout(analyzeFunc(), RETRY_TIMEOUT_MS, `${agentLabel}-retry`);
                            const timeMs = Date.now() - start;
                            await snap.ref.update({
                                [`${agentLabel}Result`]: result,
                                [`${agentLabel}Status`]: 'completed',
                                [`${agentLabel}TimeMs`]: timeMs,
                                logs: admin.firestore.FieldValue.arrayUnion(
                                    createLog(`[${agentLabel.toUpperCase()}] ✅ Retry OK ${(timeMs / 1000).toFixed(1)}s`, agentLabel)
                                )
                            });
                            return { status: 'fulfilled' as const, result, timeMs };
                        } catch (retryError: any) {
                            const timeMs = Date.now() - start;
                            const errorMsg = retryError?.message || `${agentLabel} error`;
                            logger.error(`${agentLabel} retry failed`, retryError);
                            await snap.ref.update({
                                [`${agentLabel}Status`]: 'failed',
                                [`${agentLabel}ErrorLog`]: errorMsg,
                                [`${agentLabel}TimeMs`]: timeMs,
                                logs: admin.firestore.FieldValue.arrayUnion(
                                    createLog(`[${agentLabel.toUpperCase()}] ❌ ${errorMsg}`, 'error')
                                )
                            });
                            return { status: 'rejected' as const, error: errorMsg, timeMs };
                        }
                    }
                };

                // OpenAI: skip immediately for PDF (no retry wasted)
                let oResPromise;
                if (isPdf) {
                    // Set 'skipped' status immediately
                    await snap.ref.update({
                        openAiStatus: 'skipped',
                        openAiTimeMs: 0,
                        logs: admin.firestore.FieldValue.arrayUnion(
                            createLog('[OPENAI] ⏭️ PDF — GPT-4o не поддерживает PDF, пропущен', 'openAi')
                        )
                    });
                    oResPromise = Promise.resolve({ status: 'skipped' as const, result: null, timeMs: 0 });
                } else {
                    oResPromise = runAgent(() => analyzeWithOpenAI(input), TIMEOUT_MS, 'openAi');
                }

                const [gRes, cRes, oRes] = await Promise.all([
                    runAgent(() => analyzeWithGemini(input), TIMEOUT_MS, 'gemini'),
                    runAgent(() => analyzeWithClaude(input), TIMEOUT_MS, 'claude'),
                    oResPromise
                ]);

                if (gRes.status === 'fulfilled') geminiResult = gRes.result;
                else geminiError = gRes.error;

                if (cRes.status === 'fulfilled') claudeResult = cRes.result;
                else claudeError = cRes.error;

                if (oRes.status === 'fulfilled') openAiResult = oRes.result;
                else if (oRes.status === 'skipped') { /* OpenAI skipped for PDF */ }
                else openAiError = (oRes as any).error;

            } catch (err) {
                throw new Error('Critical AI processing failure');
            }

            if (!geminiResult && !claudeResult && !openAiResult) {
                throw new Error(`All AIs failed. G: ${geminiError}, C: ${claudeError}, O: ${openAiError}`);
            }

            // ===== STEP 3: Compare Results =====
            await snap.ref.update({
                status: 'comparing',
                progress: 80,
                message: 'Consensus Engine: сравнение результатов...',
                logs: admin.firestore.FieldValue.arrayUnion(createLog('Арбитраж и сравнение результатов...'))
            });

            const { discrepancies, finalResult } = compareResults(
                geminiResult || undefined,
                claudeResult || undefined,
                openAiResult || undefined
            );

            let v3Result = { ...finalResult };
            let reconciledDiscrepancies = [...discrepancies];

            // ===== STEP 4: V3 Reconciliation =====
            if (discrepancies.length > 0) {
                await snap.ref.update({
                    status: 'reconciling',
                    progress: 90,
                    message: `V3 Loop: ${discrepancies.length} расхождений...`,
                    logs: admin.firestore.FieldValue.arrayUnion(
                        createLog(`${discrepancies.length} расхождений → V3 Arbiter...`)
                    )
                });

                try {
                    const reconciled = await performTargetedReconciliation(input, discrepancies);
                    for (const [itemId, qty] of Object.entries(reconciled)) {
                        v3Result[itemId] = qty;
                        const idx = reconciledDiscrepancies.findIndex(d => d.itemId === itemId);
                        if (idx >= 0) {
                            reconciledDiscrepancies[idx] = { ...reconciledDiscrepancies[idx], suggestedQty: qty };
                        }
                    }
                } catch (recErr) {
                    logger.error('V3 Reconciliation failed', recErr);
                }
            }

            // ===== STEP 5: Done =====
            await snap.ref.update({
                status: 'completed',
                progress: 100,
                message: 'Анализ завершен!',
                discrepancies: reconciledDiscrepancies,
                finalResult: v3Result,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                logs: admin.firestore.FieldValue.arrayUnion(createLog('✅ Смета сформирована!', 'success'))
            });

            logger.info(`✅ Blueprint Job completed: ${jobId}`);
            return null;

        } catch (error: any) {
            logger.error(`Blueprint Job ${jobId} failed:`, error);
            await snap.ref.update({
                status: 'failed',
                error: error.message || 'Unknown error',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                logs: admin.firestore.FieldValue.arrayUnion(
                    createLog(`❌ ${error.message || 'Неизвестная ошибка'}`, 'error')
                )
            });
            return null;
        }
    });
