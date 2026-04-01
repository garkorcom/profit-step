import * as functions from 'firebase-functions';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';
import {
    BlueprintInput,
    detectMimeType,
    classifyBlueprint,
    analyzeWithGemini,
    analyzeWithClaude,
    compareResults,
    mergeResults,
    extractBlueprintMetadata
} from '../../services/blueprintAIService';
import { BlueprintBatchJob, BlueprintFileEntry } from '../../types/blueprint.types';
import { generateBatchValidation, formatBatchValidationLog } from '../../utils/estimateValidation';

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const storage = admin.storage();

// Strip undefined values from files array — Firestore Admin rejects `undefined`
function cleanFiles(files: BlueprintFileEntry[]): any[] {
    return files.map(f => JSON.parse(JSON.stringify(f)));
}

const createLog = (message: string, type: 'info' | 'gemini' | 'claude' | 'openAi' | 'error' | 'success' | 'classify' = 'info') => ({
    timestamp: Date.now(),
    message,
    type
});

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout: ${label} > ${ms}ms`)), ms);
        promise.then(resolve).catch(reject).finally(() => clearTimeout(timer));
    });
}

// Check if user cancelled the job
async function isCancelled(snapRef: FirebaseFirestore.DocumentReference): Promise<boolean> {
    try {
        const current = await snapRef.get();
        return current.data()?.status === 'failed';
    } catch { return false; }
}

/**
 * Batch Blueprint Pipeline — processes multiple files from one project.
 *
 * 5 Stages:
 * 1. DOWNLOAD — all files from Storage
 * 2. CLASSIFY — Gemini classifies each as electrical_plan / cover / schedule / etc.
 * 3. ANALYZE — Only electrical_plan files go through Gemini + Claude
 * 4. RECONCILE — Compare results per file
 * 5. MERGE — Sum all per-file results into final
 */
export const onBlueprintBatchCreated = functions
    .region('us-central1')
    .runWith({ timeoutSeconds: 540, memory: '2GB' }) // 9 min, 2GB for multi-file
    .firestore
    .document('blueprint_batches/{batchId}')
    .onCreate(async (snap, context) => {
        const batchId = context.params.batchId;
        const batch = snap.data() as BlueprintBatchJob;

        logger.info(`🏗 Batch Job started: ${batchId}`, { totalFiles: batch.totalFiles });

        if (batch.status !== 'uploading') return null;

        const files: BlueprintFileEntry[] = [...batch.files];
        // Track timing
        const stageTimings: Record<string, number> = {};

        try {
            // ===== STAGE 1: Download all files =====
            await snap.ref.update({
                status: 'classifying',
                progress: 5,
                message: `Скачивание ${files.length} файлов...`,
                logs: admin.firestore.FieldValue.arrayUnion(
                    createLog(`📥 Начинаем обработку ${files.length} файлов...`)
                )
            });

            const bucket = storage.bucket();
            const inputs: (BlueprintInput | null)[] = [];
            const downloadStart = Date.now();

            for (let i = 0; i < files.length; i++) {
                try {
                    const file = bucket.file(files[i].referencePath);
                    const [buffer] = await file.download();
                    const mimeType = detectMimeType(buffer, files[i].fileName);
                    const base64 = buffer.toString('base64');
                    const isPdf = mimeType === 'application/pdf';

                    files[i].mimeType = mimeType;
                    files[i].sizeKb = Math.round(buffer.length / 1024);
                    files[i].status = 'classifying';

                    // Store input — buffer will be freed after classification to save memory
                    inputs.push({ buffer, mimeType, fileName: files[i].fileName, base64, isPdf });

                    logger.info(`Downloaded [${i + 1}/${files.length}]: ${files[i].fileName} (${files[i].sizeKb}KB, ${mimeType})`);

                    // Update progress per file during download
                    if (i % 3 === 0 || i === files.length - 1) {
                        await snap.ref.update({
                            progress: Math.round(5 + (i / files.length) * 10),
                            message: `Скачивание ${i + 1}/${files.length}: ${files[i].fileName}...`
                        });
                    }
                } catch (dlErr: any) {
                    logger.error(`Failed to download ${files[i].fileName}`, dlErr);
                    files[i].status = 'failed';
                    files[i].error = `Не удалось скачать: ${dlErr.message}`;
                    inputs.push(null);
                }
            }
            stageTimings.download = Date.now() - downloadStart;

            await snap.ref.update({
                files: cleanFiles(files),
                progress: 15,
                message: 'Файлы загружены. Классификация...',
                logs: admin.firestore.FieldValue.arrayUnion(
                    createLog(`📦 Все ${files.length} файлов скачаны. Начинаем классификацию...`)
                )
            });

            // ===== STAGE 2: Classify each file =====
            const classifyStart = Date.now();
            for (let i = 0; i < files.length; i++) {
                if (!inputs[i] || files[i].status === 'failed') continue;

                // Validate base64 before sending to AI
                if (!inputs[i]!.base64 || inputs[i]!.base64.length < 100) {
                    logger.warn(`${files[i].fileName}: base64 too short, skipping`);
                    files[i].classification = 'other';
                    files[i].status = 'skipped';
                    files[i].error = 'Файл повреждён или пуст';
                    continue;
                }

                try {
                    const classification = await withTimeout(
                        classifyBlueprint(inputs[i]!),
                        30000,
                        `classify-${files[i].fileName}`
                    );

                    files[i].classification = classification;

                    // Both electrical plans and panel schedules get analyzed
                    if (classification === 'electrical_plan' || classification === 'schedule') {
                        files[i].status = 'analyzing';
                    } else {
                        files[i].status = 'skipped';
                        // Free memory for skipped files
                        inputs[i] = null;
                    }

                    const classEmoji: Record<string, string> = {
                        electrical_plan: '⚡', schedule: '📋', cover: '📄', specification: '📝', other: '❓'
                    };

                    // Batch Firestore writes: update every 3 files or on last file
                    if (i % 3 === 0 || i === files.length - 1) {
                        await snap.ref.update({
                            files: cleanFiles(files),
                            logs: admin.firestore.FieldValue.arrayUnion(
                                createLog(
                                    `${classEmoji[classification] || '❓'} ${files[i].fileName} → ${classification}`,
                                    'classify'
                                )
                            )
                        });
                    }

                    logger.info(`Classified ${files[i].fileName}: ${classification}`);
                } catch (classErr: any) {
                    logger.error(`Classification failed for ${files[i].fileName}`, classErr);
                    files[i].classification = 'other';
                    files[i].status = 'skipped';
                }
            }

            const analyzableFiles = files.filter(f => f.classification === 'electrical_plan' || f.classification === 'schedule');
            const skippedFiles = files.filter(f => f.status === 'skipped');
            const failedFiles = files.filter(f => f.status === 'failed');
            stageTimings.classify = Date.now() - classifyStart;

            await snap.ref.update({
                status: 'analyzing',
                electricalCount: analyzableFiles.length,
                files: cleanFiles(files),
                progress: 30,
                message: `${analyzableFiles.length} файлов для анализа из ${files.length}. Анализ...`,
                logs: admin.firestore.FieldValue.arrayUnion(
                    createLog(`✅ Классификация завершена: ${analyzableFiles.length} для анализа, ${skippedFiles.length} пропущено, ${failedFiles.length} ошибок`)
                )
            });

            if (analyzableFiles.length === 0) {
                await snap.ref.update({
                    status: 'completed',
                    progress: 100,
                    message: 'Нет электрических планов для анализа.',
                    finalResult: {},
                    logs: admin.firestore.FieldValue.arrayUnion(
                        createLog('⚠️ Не найдено электрических планов. Загрузите файлы с электрическими чертежами.', 'error')
                    ),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                return null;
            }

            // ===== Fire-and-forget: Metadata from first electrical file =====
            const firstElecIdx = files.findIndex(f => f.classification === 'electrical_plan' || f.classification === 'schedule');
            if (firstElecIdx >= 0 && inputs[firstElecIdx]) {
                extractBlueprintMetadata(inputs[firstElecIdx]!).then(metadata => {
                    if (Object.keys(metadata).length > 0) {
                        snap.ref.update({ metadata }).catch(() => { });
                    }
                }).catch(() => { });
            }

            // ===== STAGE 3: Analyze each electrical plan =====
            const perFileResults: { index: number; result: Record<string, number> }[] = [];
            const totalElec = analyzableFiles.length;
            let analyzedCount = 0;
            const analyzeStart = Date.now();

            for (let i = 0; i < files.length; i++) {
                if ((files[i].classification !== 'electrical_plan' && files[i].classification !== 'schedule') || !inputs[i]) continue;

                // Check if user cancelled
                if (await isCancelled(snap.ref)) {
                    logger.info(`⏹ Job ${batchId} cancelled by user. Stopping at file ${i}.`);
                    await snap.ref.update({
                        logs: admin.firestore.FieldValue.arrayUnion(
                            createLog('⏹ Анализ остановлен пользователем.', 'error')
                        )
                    });
                    return null;
                }

                const progressBase = 30 + Math.round((analyzedCount / totalElec) * 50);

                await snap.ref.update({
                    progress: progressBase,
                    message: `Анализ ${analyzedCount + 1}/${totalElec}: ${files[i].fileName}...`,
                    logs: admin.firestore.FieldValue.arrayUnion(
                        createLog(`🔍 [${analyzedCount + 1}/${totalElec}] Анализ ${files[i].fileName} → Gemini + Claude...`)
                    )
                });

                try {
                    // Run Gemini and Claude in parallel
                    const TIMEOUT_MS = 90000;
                    const [geminiRes, claudeRes] = await Promise.allSettled([
                        withTimeout(analyzeWithGemini(inputs[i]!), TIMEOUT_MS, `gemini-${files[i].fileName}`),
                        withTimeout(analyzeWithClaude(inputs[i]!), TIMEOUT_MS, `claude-${files[i].fileName}`)
                    ]);

                    const geminiResult = geminiRes.status === 'fulfilled' ? geminiRes.value : undefined;
                    const claudeResult = claudeRes.status === 'fulfilled' ? claudeRes.value : undefined;

                    if (!geminiResult && !claudeResult) {
                        const gErr = geminiRes.status === 'rejected' ? geminiRes.reason?.message : '';
                        const cErr = claudeRes.status === 'rejected' ? claudeRes.reason?.message : '';
                        throw new Error(`Both AIs failed. G: ${gErr}, C: ${cErr}`);
                    }

                    // Compare results for this file
                    const { finalResult, discrepancies } = compareResults(geminiResult, claudeResult, undefined);

                    files[i].result = finalResult;
                    files[i].geminiResult = geminiResult;
                    files[i].claudeResult = claudeResult;
                    files[i].discrepancies = discrepancies;
                    files[i].status = 'completed';

                    perFileResults.push({ index: i, result: finalResult });

                    const itemCount = Object.keys(finalResult).length;
                    const totalDevices = Object.values(finalResult).reduce((s, v) => s + v, 0);

                    await snap.ref.update({
                        files: cleanFiles(files),
                        logs: admin.firestore.FieldValue.arrayUnion(
                            createLog(
                                `✅ ${files[i].fileName}: ${itemCount} типов, ${totalDevices} устройств`,
                                'success'
                            )
                        )
                    });

                } catch (analyzeErr: any) {
                    logger.error(`Analysis failed for ${files[i].fileName}`, analyzeErr);
                    files[i].status = 'failed';
                    files[i].error = analyzeErr.message;

                    await snap.ref.update({
                        files: cleanFiles(files),
                        logs: admin.firestore.FieldValue.arrayUnion(
                            createLog(`❌ ${files[i].fileName}: ${analyzeErr.message}`, 'error')
                        )
                    });
                }

                analyzedCount++;

                // Free buffer memory after analysis — keep only base64 if needed for retry
                if (inputs[i]) {
                    (inputs[i] as any).buffer = null;
                }
            }
            stageTimings.analyze = Date.now() - analyzeStart;

            // ===== STAGE 5: Merge results =====
            const completedResults = perFileResults.map(r => r.result);
            const finalMerged = mergeResults(completedResults);

            const totalDevices = Object.values(finalMerged).reduce((s, v) => s + v, 0);
            const totalTypes = Object.keys(finalMerged).length;
            const completedCount = files.filter(f => f.status === 'completed').length;
            const totalFailed = files.filter(f => f.status === 'failed').length;

            const totalTime = Math.round((Date.now() - (batch.createdAt?.toMillis?.() || Date.now())) / 1000);

            // ===== VALIDATION: Project Overview + QA Warnings =====
            const batchMetadata = (await snap.ref.get()).data()?.metadata;
            const areaSqft = batchMetadata?.areaSqft || 0;
            const validation = generateBatchValidation({
                areaSqft,
                fileCount: files.length,
                electricalCount: analyzableFiles.length,
                finalResult: finalMerged,
            });
            const validationLog = formatBatchValidationLog(validation);
            logger.info(validationLog);

            const validationLogs: any[] = [
                createLog(validationLog, 'info'),
            ];
            if (validation.hasWarnings) {
                if (validation.roomValidation.status !== 'ok') {
                    validationLogs.push(createLog(validation.roomValidation.message, 'error'));
                }
            }

            await snap.ref.update({
                status: 'completed',
                progress: 100,
                files: cleanFiles(files),
                finalResult: finalMerged,
                validation,
                stageTimings,
                message: `Готово! ${completedCount} файлов → ${totalTypes} типов, ${totalDevices} устройств (${totalTime}s)`,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                logs: admin.firestore.FieldValue.arrayUnion(
                    createLog(
                        `🏁 Итого: ${completedCount}/${files.length} файлов обработано. ${totalTypes} типов, ${totalDevices} устройств. Время: ${totalTime}s${totalFailed > 0 ? ` ⚠️ ${totalFailed} файлов с ошибками.` : ''}`,
                        'success'
                    ),
                    ...validationLogs
                )
            });

            logger.info(`✅ Batch Job completed: ${batchId}`, { totalDevices, totalTypes, validation });
            return null;

        } catch (error: any) {
            logger.error(`Batch Job ${batchId} failed:`, error);
            await snap.ref.update({
                status: 'failed',
                error: error.message || 'Unknown error',
                files: cleanFiles(files),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                logs: admin.firestore.FieldValue.arrayUnion(
                    createLog(`❌ Критическая ошибка: ${error.message || 'Неизвестная ошибка'}`, 'error')
                )
            });
            return null;
        }
    });
