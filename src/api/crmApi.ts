import {
    collection,
    doc,
    getDocs,
    getDoc,
    addDoc,
    updateDoc,
    query,
    where,
    orderBy,
    serverTimestamp,
    Timestamp,
    limit
} from 'firebase/firestore';
import { db } from '../firebase/firebase';
import { Client, ClientStatus, ClientType } from '../types/crm.types';

const CLIENTS_COLLECTION = 'clients';

export const crmApi = {
    // --- Clients ---

    async getClients(companyId: string): Promise<Client[]> {
        try {
            const q = query(
                collection(db, CLIENTS_COLLECTION),
                where('companyId', '==', companyId)
            );

            const snapshot = await getDocs(q);
            return snapshot.docs
                .map(doc => ({
                    id: doc.id,
                    ...doc.data()
                } as Client))
                .sort((a, b) => {
                    const dateA = a.createdAt?.seconds || 0;
                    const dateB = b.createdAt?.seconds || 0;
                    return dateB - dateA;
                });
        } catch (error) {
            console.error('Error fetching clients:', error);
            throw error;
        }
    },

    async getClientById(clientId: string): Promise<Client | null> {
        try {
            const docRef = doc(db, CLIENTS_COLLECTION, clientId);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                return { id: docSnap.id, ...docSnap.data() } as Client;
            }
            return null;
        } catch (error) {
            console.error('Error fetching client:', error);
            throw error;
        }
    },

    async createClient(clientData: Omit<Client, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
        try {
            const docRef = await addDoc(collection(db, CLIENTS_COLLECTION), {
                ...clientData,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
            return docRef.id;
        } catch (error) {
            console.error('Error creating client:', error);
            throw error;
        }
    },

    async updateClient(clientId: string, data: Partial<Client>): Promise<void> {
        try {
            const docRef = doc(db, CLIENTS_COLLECTION, clientId);
            await updateDoc(docRef, {
                ...data,
                updatedAt: serverTimestamp()
            });
        } catch (error) {
            console.error('Error updating client:', error);
            throw error;
        }
    }
};
