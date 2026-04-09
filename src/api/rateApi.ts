import {
    collection,
    doc,
    getDocs,
    getDoc,
    addDoc,
    updateDoc,
    query,
    orderBy,
    Timestamp,
    serverTimestamp
} from 'firebase/firestore';
import { db } from '../firebase/firebase';

export interface RateHistoryEntry {
    id: string;
    rate: number;
    previousRate?: number;
    effectiveDate: Timestamp;
    setBy: string; // Admin ID
    setByName?: string; // Admin Name
    setAt: Timestamp;
}

export interface EmployeeDetails {
    id: string;
    hourlyRate?: number;
    [key: string]: unknown;
}

/**
 * Updates the hourly rate for a user or employee and logs the change to history.
 * Handles both 'users' (platform) and 'employees' (bot-only) collections.
 */
export const updateEmployeeRate = async (
    personId: string,
    newRate: number,
    adminId: string,
    isPlatformUser: boolean = false,
    adminName: string = 'Admin' // New param
): Promise<void> => {
    const collectionName = isPlatformUser ? 'users' : 'employees';
    const personRef = doc(db, collectionName, personId);

    try {
        // 1. Get current rate for history
        const docSnap = await getDoc(personRef);
        let previousRate = 0;
        if (docSnap.exists()) {
            previousRate = docSnap.data().hourlyRate || 0;
        }

        // 2. Update current rate in the main document
        await updateDoc(personRef, {
            hourlyRate: newRate,
            updatedAt: serverTimestamp()
        });

        // 3. Add entry to rate_history subcollection
        const historyRef = collection(personRef, 'rate_history');
        await addDoc(historyRef, {
            rate: newRate,
            previousRate: previousRate,
            effectiveDate: serverTimestamp(), // Effective immediately
            setBy: adminId,
            setByName: adminName,
            setAt: serverTimestamp()
        });

        console.log(`✅ Rate updated for ${personId} to ${newRate} (was ${previousRate})`);
    } catch (error) {
        console.error("Error updating employee rate:", error);
        throw error;
    }
};

/**
 * Fetches the rate history for a user or employee.
 */
export const getRateHistory = async (
    personId: string,
    isPlatformUser: boolean = false
): Promise<RateHistoryEntry[]> => {
    const collectionName = isPlatformUser ? 'users' : 'employees';
    const historyRef = collection(db, collectionName, personId, 'rate_history');

    // Order by most recent first
    const q = query(historyRef, orderBy('effectiveDate', 'desc'));

    try {
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        })) as RateHistoryEntry[];
    } catch (error) {
        console.error("Error fetching rate history:", error);
        return [];
    }
};

/**
 * Gets the current rate extended info if needed
 */
export const getEmployeeDetails = async (personId: string, isPlatformUser: boolean = false): Promise<EmployeeDetails | null> => {
    const collectionName = isPlatformUser ? 'users' : 'employees';
    const docRef = doc(db, collectionName, personId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
        return { id: snap.id, ...snap.data() } as EmployeeDetails;
    }
    return null;
}
