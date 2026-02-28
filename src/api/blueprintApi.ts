import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase/firebase';
import { BlueprintJob, BlueprintAgentResult, BlueprintFileEntry } from '../types/blueprint.types';
import { v4 as uuidv4 } from 'uuid';

export const blueprintApi = {
    /**
     * Uploads the PDF blueprint to Firebase Storage and creates a job document in Firestore
     * which triggers the backend AI analysis. (Single file — legacy)
     */
    async createBlueprintJob(
        companyId: string,
        userId: string,
        file: File
    ): Promise<string> {
        try {
            const jobId = uuidv4();
            const fileExtension = file.name.split('.').pop() || 'pdf';
            const referencePath = `blueprints/${companyId}/${jobId}.${fileExtension}`;
            const storageRef = ref(storage, referencePath);

            await uploadBytes(storageRef, file);
            const fileUrl = await getDownloadURL(storageRef);

            const jobRef = doc(db, 'blueprint_jobs', jobId);

            const jobData: BlueprintJob = {
                id: jobId,
                companyId,
                createdBy: userId,
                fileName: file.name,
                fileUrl,
                referencePath,
                status: 'pending',
                progress: 0,
                message: 'Загрузка документа...',
                logs: [{ timestamp: Date.now(), message: 'Инициализация загрузки чертежа...', type: 'info' }],
                createdAt: serverTimestamp() as any,
                updatedAt: serverTimestamp() as any,
            };

            await setDoc(jobRef, jobData);
            return jobId;
        } catch (error) {
            console.error('Error creating blueprint job:', error);
            throw error;
        }
    },

    /**
     * Uploads multiple files and creates a batch job.
     * Each file is uploaded to Storage, then a single batch doc is created
     * which triggers the multi-file pipeline (onBlueprintBatchCreated).
     */
    async createBlueprintBatchJob(
        companyId: string,
        userId: string,
        files: File[],
        onProgress?: (uploaded: number, total: number) => void
    ): Promise<string> {
        try {
            const batchId = uuidv4();
            const fileEntries: BlueprintFileEntry[] = [];

            // Upload in chunks of 3 to avoid browser memory overflow
            const CHUNK_SIZE = 3;
            for (let start = 0; start < files.length; start += CHUNK_SIZE) {
                const chunk = files.slice(start, start + CHUNK_SIZE);
                const chunkPromises = chunk.map(async (file, chunkIdx) => {
                    const idx = start + chunkIdx;
                    const referencePath = `blueprints/${companyId}/${batchId}/${idx}_${file.name}`;
                    const storageRef = ref(storage, referencePath);
                    await uploadBytes(storageRef, file);

                    const entry: BlueprintFileEntry = {
                        fileName: file.name,
                        referencePath,
                        mimeType: file.type || 'application/octet-stream',
                        sizeKb: Math.round(file.size / 1024),
                        classification: 'pending',
                        status: 'uploading',
                    };
                    return entry;
                });

                const chunkResults = await Promise.all(chunkPromises);
                fileEntries.push(...chunkResults);
                onProgress?.(fileEntries.length, files.length);
            }

            // Create the batch document → triggers onBlueprintBatchCreated
            const batchRef = doc(db, 'blueprint_batches', batchId);
            await setDoc(batchRef, {
                id: batchId,
                companyId,
                createdBy: userId,
                status: 'uploading',
                totalFiles: fileEntries.length,
                files: fileEntries,
                progress: 0,
                message: `${fileEntries.length} файлов загружено. Обработка...`,
                logs: [{ timestamp: Date.now(), message: `📁 Загружено ${fileEntries.length} файлов. Начинаем обработку...`, type: 'info' }],
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });

            return batchId;
        } catch (error) {
            console.error('Error creating blueprint batch job:', error);
            throw error;
        }
    },

    /**
     * Manually override the discrepancy with user's selection
     * or AI arbiter's suggestion.
     */
    async resolveDiscrepancy(
        jobId: string,
        discrepancies: BlueprintJob['discrepancies'],
        finalResult: BlueprintAgentResult
    ): Promise<void> {
        const jobRef = doc(db, 'blueprint_jobs', jobId);
        await updateDoc(jobRef, {
            discrepancies,
            finalResult,
            updatedAt: serverTimestamp()
        });
    }
};
