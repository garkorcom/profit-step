import {
    collection,
    addDoc,
    updateDoc,
    doc,
    serverTimestamp,
    Timestamp,
    query,
    where,
    getDocs,
    limit
} from 'firebase/firestore';
import { db, storage } from '../firebase/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { calculateDistance } from '../utils/geoUtils';
import { TimeLog, TimeLogType, Task, Site } from '../types/fsm.types';

const TIME_LOGS_COLLECTION = 'time_logs';

export const timeTrackingService = {

    /**
     * Start Work or Travel timer
     */
    async startTimer(
        companyId: string,
        userId: string,
        task: Task,
        site: Site,
        type: TimeLogType,
        location: { lat: number; lng: number; accuracy: number },
        photoBlob: Blob,
        manualOverrideReason?: string
    ): Promise<string> {

        // 1. Geo Check (Logic Fork)
        let isManualOverride = false;

        if (type === 'work') {
            const distance = calculateDistance(
                location.lat,
                location.lng,
                site.geo.lat,
                site.geo.lng
            );

            const maxRadius = site.geo.radius || 150;

            if (distance > maxRadius) {
                if (!manualOverrideReason) {
                    throw new Error(`You are too far from site (${Math.round(distance)}m). Max: ${maxRadius}m.`);
                }
                isManualOverride = true;
            }
        }

        // 2. Upload Photo (Offline-first: Firebase SDK handles queueing if offline)
        // Note: In real offline mode, we might need to store blob in IndexedDB first, 
        // but Firebase Storage SDK has some resilience. For strict offline, we'd use a Service Worker.
        const photoPath = `proofs/${task.id}/${Date.now()}.jpg`;
        const storageRef = ref(storage, photoPath);

        // Optimistic upload - we don't await URL if we want speed, but for now we await
        // In a true offline-first app, we'd generate a local URL or placeholder
        let photoUrl = '';
        try {
            const snapshot = await uploadBytes(storageRef, photoBlob);
            photoUrl = await getDownloadURL(snapshot.ref);
        } catch (e) {
            console.warn('Photo upload delayed (offline?)', e);
            photoUrl = 'pending_upload';
        }

        // 3. Create TimeLog
        const timeLogData: Omit<TimeLog, 'id'> = {
            companyId,
            taskId: task.id,
            userId,
            type,
            startTime: serverTimestamp() as Timestamp, // Server timestamp will resolve when online
            startGeo: location,
            isManualOverride,
            overrideReason: manualOverrideReason,
            startPhotoUrl: photoUrl,
            closedBySystem: false
        };

        const docRef = await addDoc(collection(db, TIME_LOGS_COLLECTION), timeLogData);

        // 4. Update Task Status
        const taskRef = doc(db, 'tasks', task.id);
        await updateDoc(taskRef, {
            status: type === 'travel' ? 'traveling' : 'in_progress',
            updatedAt: serverTimestamp()
        });

        return docRef.id;
    },

    /**
     * Stop current timer
     */
    async stopTimer(timeLogId: string, taskId: string): Promise<void> {
        const timeLogRef = doc(db, TIME_LOGS_COLLECTION, timeLogId);

        await updateDoc(timeLogRef, {
            endTime: serverTimestamp(),
            // Duration will be calculated by Cloud Function trigger
        });

        // Update Task Status to 'review' or 'todo' depending on workflow
        // For now, we keep it in progress or move to review if done
        // This logic might be moved to UI
    },

    /**
     * Get active timer for user
     */
    async getActiveTimer(userId: string): Promise<TimeLog | null> {
        const q = query(
            collection(db, TIME_LOGS_COLLECTION),
            where('userId', '==', userId),
            where('endTime', '==', null),
            limit(1)
        );

        const snapshot = await getDocs(q);
        if (snapshot.empty) return null;

        return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as TimeLog;
    }
};
