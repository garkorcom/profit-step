import { doc, setDoc, updateDoc, serverTimestamp, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase/firebase';
import { BlueprintJob, BlueprintAgentResult, BlueprintFileEntry, BlueprintV3Session } from '../types/blueprint.types';
import { RasterizedImage } from '../hooks/usePdfRasterizer';
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
                createdAt: serverTimestamp() as unknown as BlueprintJob['createdAt'],
                updatedAt: serverTimestamp() as unknown as BlueprintJob['updatedAt'],
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
    },

    /**
     * Uploads rasterized PNGs to Firebase Storage for V3 State Resumption.
     */
    async uploadV3Images(
        companyId: string,
        projectId: string | null,
        images: RasterizedImage[],
        onProgress?: (uploaded: number, total: number) => void
    ): Promise<RasterizedImage[]> {
        const uploadedImages: RasterizedImage[] = [];
        let completed = 0;
        const subFolder = projectId || uuidv4();

        for (const img of images) {
            // Only upload selected images to save space/time
            if (!img.selected) {
                uploadedImages.push(img);
                continue;
            }

            // If it already has a storageUrl, skip
            if (img.storageUrl) {
                uploadedImages.push(img);
                completed++;
                onProgress?.(completed, images.length);
                continue;
            }

            try {
                // Convert base64 dataUrl to Blob
                const res = await fetch(img.dataUrl);
                const blob = await res.blob();

                const referencePath = `blueprints/${companyId}/v3_sessions/${subFolder}/${img.id}.png`;
                const storageRef = ref(storage, referencePath);

                await uploadBytes(storageRef, blob);
                const downloadUrl = await getDownloadURL(storageRef);

                // Return a new object that drops the massive dataUrl to save memory,
                // and instead relies on storageUrl for rendering.
                uploadedImages.push({
                    ...img,
                    dataUrl: downloadUrl, // Replace base64 with remote URL to prevent OOM
                    storageUrl: downloadUrl
                });
            } catch (error) {
                console.error(`Failed to upload image ${img.id}`, error);
                // Keep the local dataUrl as fallback
                uploadedImages.push(img);
            }
            
            completed++;
            onProgress?.(completed, images.length);
        }

        return uploadedImages;
    },

    /**
     * Saves or updates a V3 Session in Firestore.
     */
    async saveV3Session(session: BlueprintV3Session): Promise<void> {
        // Firebase setDoc rejects undefined values. Recursively strip them.
        const stripUndefined = (obj: unknown): unknown => {
            if (Array.isArray(obj)) return obj.map(stripUndefined);
            if (obj instanceof Date) return obj;
            if (obj && typeof obj === 'object' && typeof (obj as { toDate?: unknown }).toDate === 'function') {
                return obj; // Keep Firestore Timestamps intact
            }
            if (obj !== null && typeof obj === 'object') {
                return Object.fromEntries(
                    Object.entries(obj as Record<string, unknown>)
                        .filter(([, v]) => v !== undefined)
                        .map(([k, v]) => [k, stripUndefined(v)])
                );
            }
            return obj;
        };

        const cleanSession = stripUndefined(session) as Record<string, unknown>;
        const docRef = doc(db, 'blueprint_v3_sessions', session.id);
        await setDoc(docRef, {
            ...cleanSession,
            updatedAt: serverTimestamp()
        }, { merge: true });
    },

    /**
     * Retrieves an existing V3 Session from Firestore.
     */
    async getV3Session(sessionId: string): Promise<BlueprintV3Session | null> {
        const docRef = doc(db, 'blueprint_v3_sessions', sessionId);
        const snapshot = await getDoc(docRef);
        if (snapshot.exists()) {
            return snapshot.data() as BlueprintV3Session;
        }
        return null;
    },

    /**
     * Lists active (non-completed) V3 Sessions for a user
     */
    async listActiveV3Sessions(companyId: string, userId: string): Promise<BlueprintV3Session[]> {
        const q = query(
            collection(db, 'blueprint_v3_sessions'),
            where('companyId', '==', companyId),
            where('createdBy', '==', userId),
            where('status', '!=', 'completed')
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => doc.data() as BlueprintV3Session);
    }
};

