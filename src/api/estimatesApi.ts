import {
    collection,
    doc,
    getDoc,
    getDocs,
    addDoc,
    updateDoc,
    query,
    where,
    orderBy,
    Timestamp,
    serverTimestamp,
    limit
} from 'firebase/firestore';
import { db } from '../firebase/firebase';
import { Estimate, CreateEstimateDTO, EstimateStatus } from '../types/estimate.types';

const COLLECTION = 'estimates';

export const estimatesApi = {
    // Get all estimates for a company
    getEstimates: async (companyId: string): Promise<Estimate[]> => {
        try {
            const q = query(
                collection(db, COLLECTION),
                where('companyId', '==', companyId),
                orderBy('createdAt', 'desc')
            );

            const snapshot = await getDocs(q);
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Estimate));
        } catch (error) {
            console.error('Error fetching estimates:', error);
            throw error;
        }
    },

    // Get estimates for a specific client
    getClientEstimates: async (companyId: string, clientId: string): Promise<Estimate[]> => {
        try {
            const q = query(
                collection(db, COLLECTION),
                where('companyId', '==', companyId),
                where('clientId', '==', clientId),
                orderBy('createdAt', 'desc')
            );

            const snapshot = await getDocs(q);
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Estimate));
        } catch (error) {
            console.error('Error fetching client estimates:', error);
            throw error;
        }
    },

    // Get single estimate
    getEstimateById: async (id: string): Promise<Estimate | null> => {
        try {
            const docRef = doc(db, COLLECTION, id);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                return { id: docSnap.id, ...docSnap.data() } as Estimate;
            }
            return null;
        } catch (error) {
            console.error('Error fetching estimate:', error);
            throw error;
        }
    },

    // Create new estimate
    createEstimate: async (companyId: string, userId: string, data: CreateEstimateDTO): Promise<string> => {
        try {
            // Generate a simple number (in real app, use a counter or transaction)
            const number = `EST-${Date.now().toString().slice(-6)}`;

            const subtotal = data.items.reduce((sum, item) => sum + item.total, 0);
            const taxRate = data.taxRate || 0;
            const taxAmount = subtotal * (taxRate / 100);
            const total = subtotal + taxAmount;

            const newEstimate: Omit<Estimate, 'id'> = {
                companyId,
                clientId: data.clientId,
                clientName: data.clientName,
                number,
                status: 'draft',
                items: data.items,
                subtotal,
                taxRate,
                taxAmount,
                total,
                notes: data.notes,
                terms: data.terms,
                validUntil: data.validUntil ? Timestamp.fromDate(data.validUntil) : undefined,
                createdBy: userId,
                createdAt: serverTimestamp() as Timestamp,
                updatedAt: serverTimestamp() as Timestamp,
            };

            const docRef = await addDoc(collection(db, COLLECTION), newEstimate);
            return docRef.id;
        } catch (error) {
            console.error('Error creating estimate:', error);
            throw error;
        }
    },

    // Update estimate
    updateEstimate: async (id: string, data: Partial<Estimate>): Promise<void> => {
        try {
            const docRef = doc(db, COLLECTION, id);
            await updateDoc(docRef, {
                ...data,
                updatedAt: serverTimestamp(),
            });
        } catch (error) {
            console.error('Error updating estimate:', error);
            throw error;
        }
    },

    // Update status
    updateStatus: async (id: string, status: EstimateStatus): Promise<void> => {
        try {
            const docRef = doc(db, COLLECTION, id);
            await updateDoc(docRef, {
                status,
                updatedAt: serverTimestamp(),
            });
        } catch (error) {
            console.error('Error updating estimate status:', error);
            throw error;
        }
    },

    // Convert to Job (Task) - Placeholder logic for now
    convertToTask: async (estimateId: string, companyId: string, userId: string): Promise<string> => {
        try {
            // 1. Get Estimate
            const estimateRef = doc(db, COLLECTION, estimateId);
            const estimateSnap = await getDoc(estimateRef);
            if (!estimateSnap.exists()) throw new Error('Estimate not found');

            const estimate = estimateSnap.data() as Estimate;

            // 2. Create Task based on Estimate
            // We need to import tasks collection logic or use direct firestore
            // For simplicity, direct firestore here

            const taskData = {
                companyId,
                clientId: estimate.clientId,
                title: `Job from ${estimate.number}`,
                description: `Converted from estimate. Notes: ${estimate.notes || ''}`,
                status: 'todo',
                priority: 'medium',
                salesPrice: estimate.total,
                // Copy items as materials/services if needed, or just link
                estimateId: estimateId,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                createdBy: userId
            };

            const taskRef = await addDoc(collection(db, `companies/${companyId}/tasks`), taskData);

            // 3. Update Estimate status
            await updateDoc(estimateRef, {
                status: 'converted',
                convertedToTaskId: taskRef.id,
                updatedAt: serverTimestamp()
            });

            return taskRef.id;
        } catch (error) {
            console.error('Error converting estimate:', error);
            throw error;
        }
    }
};
