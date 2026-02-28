import {
    collection, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
    query, where, orderBy, serverTimestamp
} from 'firebase/firestore';
import { db } from '../firebase/firebase';
import { SavedEstimate } from '../types/savedEstimate.types';

const COLLECTION = 'saved_estimates';

export const savedEstimateApi = {

    async save(data: Omit<SavedEstimate, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
        const ref = doc(collection(db, COLLECTION));
        await setDoc(ref, {
            ...data,
            id: ref.id,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });
        return ref.id;
    },

    async getAll(companyId: string): Promise<SavedEstimate[]> {
        const q = query(
            collection(db, COLLECTION),
            where('companyId', '==', companyId),
            orderBy('updatedAt', 'desc')
        );
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ ...d.data(), id: d.id } as SavedEstimate));
    },

    async getById(id: string): Promise<SavedEstimate | null> {
        const snap = await getDoc(doc(db, COLLECTION, id));
        if (!snap.exists()) return null;
        return { ...snap.data(), id: snap.id } as SavedEstimate;
    },

    async update(id: string, data: Partial<Pick<SavedEstimate, 'quantities' | 'totalMaterials' | 'totalLabor' | 'totalWire' | 'grandTotal' | 'laborRate' | 'wirePrice' | 'status' | 'notes' | 'projectName'>>): Promise<void> {
        await updateDoc(doc(db, COLLECTION, id), {
            ...data,
            updatedAt: serverTimestamp(),
        });
    },

    async remove(id: string): Promise<void> {
        await deleteDoc(doc(db, COLLECTION, id));
    },
};
