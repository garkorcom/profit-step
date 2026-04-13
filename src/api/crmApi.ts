import {
    collection,
    doc,
    getDocs,
    getDoc,
    addDoc,
    updateDoc,
    query,
    where,
    serverTimestamp
} from 'firebase/firestore';
import { db, functions } from '../firebase/firebase';
import { httpsCallable } from 'firebase/functions';
import { Client } from '../types/crm.types';
import { normalizePhone } from '../utils/phone';

// Normalize phone fields in client data before writing to Firestore
function normalizeClientPhones<T extends Record<string, unknown>>(data: T): T {
    const result = { ...data };
    if ('phone' in result && typeof result.phone === 'string') {
        (result as Record<string, unknown>).phone = normalizePhone(result.phone as string);
    }
    if ('contacts' in result && Array.isArray(result.contacts)) {
        (result as Record<string, unknown>).contacts = (result.contacts as Array<Record<string, unknown>>).map(c => ({
            ...c,
            phone: typeof c.phone === 'string' ? normalizePhone(c.phone) : c.phone,
        }));
    }
    return result;
}

export interface ParseClientWebsiteRequest {
    url: string;
}

export interface ParseClientWebsiteResponse {
    name?: string;
    type?: string;
    phone?: string;
    email?: string;
    address?: string;
    website?: string;
}

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
            const normalized = normalizeClientPhones(clientData);
            const docRef = await addDoc(collection(db, CLIENTS_COLLECTION), {
                ...normalized,
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
            const normalized = normalizeClientPhones(data);
            const docRef = doc(db, CLIENTS_COLLECTION, clientId);
            await updateDoc(docRef, {
                ...normalized,
                updatedAt: serverTimestamp()
            });
        } catch (error) {
            console.error('Error updating client:', error);
            throw error;
        }
    },

    // --- AI ---

    async parseClientWebsite(url: string): Promise<ParseClientWebsiteResponse> {
        try {
            const callable = httpsCallable<ParseClientWebsiteRequest, ParseClientWebsiteResponse>(
                functions,
                'parseClientWebsite'
            );
            const result = await callable({ url });
            return result.data;
        } catch (error) {
            console.error('Error parsing client website:', error);
            throw error;
        }
    }
};
