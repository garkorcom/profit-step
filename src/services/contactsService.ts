import { db } from '../firebase/firebase';
import {
    collection,
    doc,
    addDoc,
    updateDoc,
    deleteDoc,
    getDocs,
    getDoc,
    query,
    where,
    orderBy,
    Timestamp
} from 'firebase/firestore';
import { Contact } from '../types/contact.types';

const COLLECTION_NAME = 'contacts';
const DEVLOGS_COLLECTION = 'dev_logs';

export const contactsService = {
    /**
     * Helper to safely remove undefined fields
     */
    cleanPayload(obj: any): any {
        return Object.entries(obj).reduce((acc, [key, val]) => {
            if (val === undefined) return acc;
            if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Timestamp)) {
                acc[key] = this.cleanPayload(val);
                return acc;
            }
            acc[key] = val;
            return acc;
        }, {} as any);
    },

    /**
     * Create a new contact
     */
    async createContact(contactData: Omit<Contact, 'id' | 'createdAt'>, userId: string, userName?: string): Promise<string> {
        try {
            const rawData = {
                ...contactData,
                createdAt: Timestamp.now(),
                createdBy: userId,
            };
            const newContactData = this.cleanPayload(rawData);

            const docRef = await addDoc(collection(db, COLLECTION_NAME), newContactData);

            // Log creation to devlogs (Daily Summary Container for AI)
            await this.logContactCreation(docRef.id, newContactData, userName || 'System');

            return docRef.id;
        } catch (error: any) {
            console.error('Error creating contact:', error);
            console.error('Payload attempted:', JSON.stringify(contactData, null, 2));
            throw error;
        }
    },

    /**
     * Get all contacts, optionally filtered by project ID
     */
    async getContacts(projectId?: string): Promise<Contact[]> {
        try {
            let q = query(collection(db, COLLECTION_NAME), orderBy('name', 'asc'));

            if (projectId) {
                q = query(
                    collection(db, COLLECTION_NAME),
                    where('linkedProjects', 'array-contains', projectId),
                    orderBy('name', 'asc')
                );
            }

            const snapshot = await getDocs(q);
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as Contact));
        } catch (error) {
            console.error('Error fetching contacts:', error);
            throw error;
        }
    },

    /**
     * Get a specific contact by ID
     */
    async getContactById(contactId: string): Promise<Contact | null> {
        try {
            const docRef = doc(db, COLLECTION_NAME, contactId);
            const snapshot = await getDoc(docRef);

            if (snapshot.exists()) {
                return { id: snapshot.id, ...snapshot.data() } as Contact;
            }
            return null;
        } catch (error) {
            console.error('Error fetching contact API:', error);
            throw error;
        }
    },

    /**
     * Update an existing contact
     */
    async updateContact(contactId: string, updates: Partial<Contact>): Promise<void> {
        try {
            const docRef = doc(db, COLLECTION_NAME, contactId);
            await updateDoc(docRef, updates);
        } catch (error) {
            console.error('Error updating contact:', error);
            throw error;
        }
    },

    /**
     * Delete a contact
     */
    async deleteContact(contactId: string): Promise<void> {
        try {
            const docRef = doc(db, COLLECTION_NAME, contactId);
            await deleteDoc(docRef);
        } catch (error) {
            console.error('Error deleting contact:', error);
            throw error;
        }
    },

    /**
     * Helper: Log contact creation for AI daily summaries
     */
    async logContactCreation(contactId: string, contactData: any, authorName: string) {
        try {
            const timeStr = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
            // For location name parsing (often linkedProjects contains names or we just put the geo coordinate)
            const locDetails = typeof contactData.createdLocation === 'string'
                ? contactData.createdLocation
                : (contactData.createdLocation ? 'геолокации' : 'в системе');

            const rolesStr = (contactData.roles || []).join(', ');
            const projectsCount = (contactData.linkedProjects || []).length;

            const message = `В ${timeStr} на объекте (${locDetails}) добавлен новый контакт: ${contactData.name} (${rolesStr}). Привязан к объектам: ${projectsCount} шт.`;

            await addDoc(collection(db, DEVLOGS_COLLECTION), {
                type: 'CONTACT_CREATED',
                message: message,
                author: authorName,
                authorId: contactData.createdBy,
                timestamp: Timestamp.now(),
                metadata: {
                    contactId: contactId,
                    contactName: contactData.name,
                    roles: contactData.roles
                }
            });
        } catch (err) {
            console.warn('Failed to write DevLog for contact creation:', err);
        }
    }
};
