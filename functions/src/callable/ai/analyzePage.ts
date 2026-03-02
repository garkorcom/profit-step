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
    performTargetedReconciliation
} from '../../services/blueprintAIService';
import { BlueprintAgentResult, BlueprintDiscrepancy } from '../../types/blueprint.types';

if (admin.apps.length === 0) admin.initializeApp();
const storage = admin.storage();

/**
 * Callable function: Analyze a single page image (PNG/JPEG/PDF).
 * Used by V2 pipeline for per-page analysis.
 * 
 * Input: { storagePath: string, fileName: string, pageIndex: number, agents?: string[] }
 * Output: { geminiResult, claudeResult, openAiResult, mergedResult, discrepancies }
 */
export const analyzePageCallable = functions
    .region('us-central1')
    .runWith({ timeoutSeconds: 120, memory: '512MB' })
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Auth required');
        }

        const { storagePath, fileName, pageIndex, agents } = data;
        if (!storagePath) {
            throw new functions.https.HttpsError('invalid-argument', 'storagePath required');
        }

        const selectedAgents = agents || ['gemini', 'claude'];
        logger.info(`📄 Analyzing page: ${fileName} (page ${pageIndex}) with agents: ${selectedAgents.join(', ')}`, { storagePath });

        try {
            // 1. Download the image from Storage
            const bucket = storage.bucket();
            const file = bucket.file(storagePath);
            const [buffer] = await file.download();
            const base64 = buffer.toString('base64');
            const mimeType = detectMimeType(buffer, fileName || 'page.png');

            const input: BlueprintInput = {
                buffer,
                mimeType,
                fileName: fileName || `page_${pageIndex}.png`,
                base64,
                isPdf: mimeType === 'application/pdf',
            };

            // 2. Run selected agents in parallel
            const promises = [];
            if (selectedAgents.includes('gemini')) promises.push(analyzeWithGemini(input));
            else promises.push(Promise.resolve(undefined));

            if (selectedAgents.includes('claude')) promises.push(analyzeWithClaude(input));
            else promises.push(Promise.resolve(undefined));

            if (selectedAgents.includes('openai')) promises.push(analyzeWithOpenAI(input));
            else promises.push(Promise.resolve(undefined));

            const [geminiResult, claudeResult, openAiResult] = await Promise.allSettled(promises);

            const gemini = geminiResult.status === 'fulfilled' ? geminiResult.value : undefined;
            const claude = claudeResult.status === 'fulfilled' ? claudeResult.value : undefined;
            const openai = openAiResult.status === 'fulfilled' ? openAiResult.value : undefined;

            if (geminiResult.status === 'rejected') logger.warn(`Gemini failed for ${fileName} p${pageIndex}:`, geminiResult.reason);
            if (claudeResult.status === 'rejected') logger.warn(`Claude failed for ${fileName} p${pageIndex}:`, claudeResult.reason);
            if (openAiResult.status === 'rejected') logger.warn(`OpenAI failed for ${fileName} p${pageIndex}:`, openAiResult.reason);

            // 3. Compare results
            const safeGemini = (gemini || undefined) as BlueprintAgentResult | undefined;
            const safeClaude = (claude || undefined) as BlueprintAgentResult | undefined;
            const safeOpenAi = (openai || undefined) as BlueprintAgentResult | undefined;
            const { discrepancies, finalResult } = compareResults(safeGemini, safeClaude, safeOpenAi);

            logger.info(`✅ Page ${fileName} p${pageIndex}: ${Object.keys(finalResult).length} items, ${discrepancies.length} discrepancies`);

            return {
                geminiResult: gemini || {},
                claudeResult: claude || {},
                openAiResult: openai || {},
                mergedResult: finalResult,
                discrepancies,
                itemCount: Object.keys(finalResult).length,
            };

        } catch (error: any) {
            logger.error(`❌ Analysis failed for ${fileName} p${pageIndex}:`, error);
            throw new functions.https.HttpsError('internal', error.message || 'Analysis failed');
        }
    });

/**
 * Callable function: Refine analysis for specific discrepancies.
 * Used by V2 pipeline Phase 5 (iterative loop).
 */
export const refineAnalysisCallable = functions
    .region('us-central1')
    .runWith({ timeoutSeconds: 120, memory: '512MB' })
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Auth required');
        }

        const { storagePath, fileName, discrepancyItems } = data;
        if (!storagePath || !discrepancyItems?.length) {
            throw new functions.https.HttpsError('invalid-argument', 'storagePath and discrepancyItems required');
        }

        logger.info(`🔄 Refining ${discrepancyItems.length} items for ${fileName}`);

        try {
            const bucket = storage.bucket();
            const file = bucket.file(storagePath);
            const [buffer] = await file.download();
            const base64 = buffer.toString('base64');
            const mimeType = detectMimeType(buffer, fileName || 'page.png');

            const input: BlueprintInput = {
                buffer, mimeType,
                fileName: fileName || 'page.png',
                base64,
                isPdf: mimeType === 'application/pdf',
            };

            const discrepancies: BlueprintDiscrepancy[] = discrepancyItems.map((itemId: string) => ({
                itemId,
                geminiQty: null,
                claudeQty: null,
                openAiQty: null,
                match: false,
                suggestedQty: 0,
            }));

            const refinedResult = await performTargetedReconciliation(input, discrepancies);

            logger.info(`✅ Refined ${Object.keys(refinedResult).length} items`);
            return { refinedResult };

        } catch (error: any) {
            logger.error(`❌ Refinement failed:`, error);
            throw new functions.https.HttpsError('internal', error.message || 'Refinement failed');
        }
    });
