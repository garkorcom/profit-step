/**
 * @fileoverview Unified Projects API
 * 
 * Single API layer for all project operations.
 * Handles CRUD for projects (work, estimate, financial), file management, and ledger entries.
 */

import {
    collection,
    doc,
    setDoc,
    getDocs,
    getDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    serverTimestamp,
    Timestamp,
    writeBatch,
    runTransaction,
    arrayUnion,
    arrayRemove
} from 'firebase/firestore';
import { db } from '../firebase/firebase';
import { Project, ProjectFile } from '../types/project.types';
import { LedgerEntry, LedgerEntryType, LedgerCategory, LedgerSourceType } from '../types/crm.types';

const PROJECTS_COLLECTION = 'projects';
const LEDGER_COLLECTION = 'project_ledger';

export const projectsApi = {
    // ==================== CORE CRUD ====================

    /**
     * Create a new project (any type)
     */
    async create(data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
        const ref = doc(collection(db, PROJECTS_COLLECTION));
        await setDoc(ref, {
            ...data,
            id: ref.id,
            type: data.type || 'other',
            files: data.files || [],
            totalDebit: data.totalDebit ?? 0,
            totalCredit: data.totalCredit ?? 0,
            balance: data.balance ?? 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });
        return ref.id;
    },

    /**
     * Get all projects for a company
     */
    async getAll(companyId: string): Promise<Project[]> {
        const q = query(
            collection(db, PROJECTS_COLLECTION),
            where('companyId', '==', companyId),
            orderBy('updatedAt', 'desc')
        );
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ ...d.data(), id: d.id } as Project));
    },

    /**
     * Get a single project by ID
     */
    async getById(id: string): Promise<Project | null> {
        const snap = await getDoc(doc(db, PROJECTS_COLLECTION, id));
        if (!snap.exists()) return null;
        return { ...snap.data(), id: snap.id } as Project;
    },

    /**
     * Update a project
     */
    async update(id: string, data: Partial<Omit<Project, 'id' | 'createdAt' | 'updatedAt' | 'companyId' | 'createdBy'>>): Promise<void> {
        await updateDoc(doc(db, PROJECTS_COLLECTION, id), {
            ...data,
            updatedAt: serverTimestamp(),
        });
    },

    /**
     * Delete a project
     */
    async remove(id: string): Promise<void> {
        await deleteDoc(doc(db, PROJECTS_COLLECTION, id));
    },

    // ==================== FILE MANAGEMENT ====================

    /**
     * Add a file to a project
     */
    async addFile(projectId: string, file: ProjectFile): Promise<void> {
        await updateDoc(doc(db, PROJECTS_COLLECTION, projectId), {
            files: arrayUnion(file),
            updatedAt: serverTimestamp()
        });
    },

    /**
     * Remove a file from a project
     */
    async removeFile(projectId: string, file: ProjectFile): Promise<void> {
        await updateDoc(doc(db, PROJECTS_COLLECTION, projectId), {
            files: arrayRemove(file),
            updatedAt: serverTimestamp()
        });
    },

    // ==================== CLIENT-SCOPED QUERIES ====================

    /**
     * Get all projects for a client
     */
    async getProjectsByClient(clientId: string): Promise<Project[]> {
        try {
            const q = query(
                collection(db, PROJECTS_COLLECTION),
                where('clientId', '==', clientId),
                orderBy('createdAt', 'desc')
            );

            const snapshot = await getDocs(q);
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as Project));
        } catch (error) {
            console.error('Error fetching projects:', error);
            throw error;
        }
    },

    /**
     * Get all projects for a company
     */
    async getProjectsByCompany(companyId: string): Promise<Project[]> {
        try {
            const q = query(
                collection(db, PROJECTS_COLLECTION),
                where('companyId', '==', companyId),
                orderBy('createdAt', 'desc')
            );

            const snapshot = await getDocs(q);
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as Project));
        } catch (error) {
            console.error('Error fetching projects:', error);
            throw error;
        }
    },

    /**
     * Get a single project by ID
     */
    async getProjectById(projectId: string): Promise<Project | null> {
        try {
            const docRef = doc(db, PROJECTS_COLLECTION, projectId);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                return { id: docSnap.id, ...docSnap.data() } as Project;
            }
            return null;
        } catch (error) {
            console.error('Error fetching project:', error);
            throw error;
        }
    },

    /**
     * Create a new project
     */
    async createProject(data: {
        clientId: string;
        clientName: string;
        companyId: string;
        name: string;
        description?: string;
        createdBy: string;
    }): Promise<string> {
        try {
            const docRef = await addDoc(collection(db, PROJECTS_COLLECTION), {
                ...data,
                status: 'active',
                totalDebit: 0,
                totalCredit: 0,
                balance: 0,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
            return docRef.id;
        } catch (error) {
            console.error('Error creating project:', error);
            throw error;
        }
    },

    /**
     * Update a project
     */
    async updateProject(projectId: string, data: Partial<Project>): Promise<void> {
        try {
            const docRef = doc(db, PROJECTS_COLLECTION, projectId);
            await updateDoc(docRef, {
                ...data,
                updatedAt: serverTimestamp()
            });
        } catch (error) {
            console.error('Error updating project:', error);
            throw error;
        }
    },

    /**
     * Get or create default project for a client
     * Used when auto-creating ledger entries from sessions/receipts
     */
    async getOrCreateDefaultProject(
        clientId: string,
        clientName: string,
        companyId: string,
        createdBy: string
    ): Promise<string> {
        try {
            // Check for existing active project
            const q = query(
                collection(db, PROJECTS_COLLECTION),
                where('clientId', '==', clientId),
                where('status', '==', 'active')
            );

            const snapshot = await getDocs(q);
            if (!snapshot.empty) {
                return snapshot.docs[0].id;
            }

            // Create default project using unified create
            return await this.create({
                clientId,
                clientName,
                companyId,
                name: 'Основной проект',
                type: 'work',
                status: 'active',
                createdBy
            });
        } catch (error) {
            console.error('Error getting/creating default project:', error);
            throw error;
        }
    },

    // ==================== LEDGER ====================

    /**
     * Get all ledger entries for a project
     */
    async getLedgerByProject(projectId: string): Promise<LedgerEntry[]> {
        try {
            const q = query(
                collection(db, LEDGER_COLLECTION),
                where('projectId', '==', projectId),
                orderBy('date', 'desc')
            );

            const snapshot = await getDocs(q);
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as LedgerEntry));
        } catch (error) {
            console.error('Error fetching ledger entries:', error);
            throw error;
        }
    },

    /**
     * Create a ledger entry and update project totals
     */
    async createLedgerEntry(data: {
        projectId: string;
        clientId: string;
        companyId: string;
        type: LedgerEntryType;
        category: LedgerCategory;
        amount: number;
        description: string;
        sourceType: LedgerSourceType;
        sourceId?: string;
        linkedContactId?: string;
        linkedContactName?: string;
        date: Date;
        createdBy: string;
    }): Promise<string> {
        try {
            const batch = writeBatch(db);

            // 1. Create ledger entry
            const ledgerRef = doc(collection(db, LEDGER_COLLECTION));
            batch.set(ledgerRef, {
                ...data,
                date: Timestamp.fromDate(data.date),
                createdAt: serverTimestamp()
            });

            // 2. Update project totals
            const projectRef = doc(db, PROJECTS_COLLECTION, data.projectId);
            const projectSnap = await getDoc(projectRef);

            if (projectSnap.exists()) {
                const project = projectSnap.data();
                const newDebit = data.type === 'debit'
                    ? (project.totalDebit || 0) + data.amount
                    : project.totalDebit || 0;
                const newCredit = data.type === 'credit'
                    ? (project.totalCredit || 0) + data.amount
                    : project.totalCredit || 0;

                batch.update(projectRef, {
                    totalDebit: newDebit,
                    totalCredit: newCredit,
                    balance: newDebit - newCredit,
                    updatedAt: serverTimestamp()
                });
            }

            await batch.commit();
            return ledgerRef.id;
        } catch (error) {
            console.error('Error creating ledger entry:', error);
            throw error;
        }
    },

    /**
     * Delete a ledger entry and update project totals
     */
    async deleteLedgerEntry(entryId: string): Promise<void> {
        try {
            await runTransaction(db, async (transaction) => {
                const entryRef = doc(db, LEDGER_COLLECTION, entryId);
                const entrySnap = await transaction.get(entryRef);

                if (!entrySnap.exists()) {
                    throw new Error('Ledger entry not found');
                }

                const entry = entrySnap.data() as LedgerEntry;
                const projectRef = doc(db, PROJECTS_COLLECTION, entry.projectId);
                const projectSnap = await transaction.get(projectRef);

                if (projectSnap.exists()) {
                    const project = projectSnap.data();
                    const newDebit = entry.type === 'debit'
                        ? (project.totalDebit || 0) - entry.amount
                        : project.totalDebit || 0;
                    const newCredit = entry.type === 'credit'
                        ? (project.totalCredit || 0) - entry.amount
                        : project.totalCredit || 0;

                    transaction.update(projectRef, {
                        totalDebit: newDebit,
                        totalCredit: newCredit,
                        balance: newDebit - newCredit,
                        updatedAt: serverTimestamp()
                    });
                }

                transaction.delete(entryRef);
            });
        } catch (error) {
            console.error('Error deleting ledger entry:', error);
            throw error;
        }
    },

    /**
     * Recalculate project totals from all ledger entries
     * Used for data integrity checks
     */
    async recalculateProjectTotals(projectId: string): Promise<void> {
        try {
            const entries = await this.getLedgerByProject(projectId);

            let totalDebit = 0;
            let totalCredit = 0;

            for (const entry of entries) {
                if (entry.type === 'debit') {
                    totalDebit += entry.amount;
                } else {
                    totalCredit += entry.amount;
                }
            }

            const projectRef = doc(db, PROJECTS_COLLECTION, projectId);
            await updateDoc(projectRef, {
                totalDebit,
                totalCredit,
                balance: totalDebit - totalCredit,
                updatedAt: serverTimestamp()
            });
        } catch (error) {
            console.error('Error recalculating project totals:', error);
            throw error;
        }
    },

    // ==================== SUMMARY ====================

    /**
     * Get summary of all clients with balances
     */
    async getClientBalancesSummary(companyId: string): Promise<{
        clientId: string;
        clientName: string;
        totalDebit: number;
        totalCredit: number;
        balance: number;
    }[]> {
        try {
            const projects = await this.getProjectsByCompany(companyId);

            // Aggregate by client
            const clientMap = new Map<string, {
                clientId: string;
                clientName: string;
                totalDebit: number;
                totalCredit: number;
                balance: number;
            }>();

            for (const project of projects) {
                const existing = clientMap.get(project.clientId);
                if (existing) {
                    existing.totalDebit += project.totalDebit || 0;
                    existing.totalCredit += project.totalCredit || 0;
                    existing.balance += project.balance || 0;
                } else {
                    clientMap.set(project.clientId, {
                        clientId: project.clientId,
                        clientName: project.clientName,
                        totalDebit: project.totalDebit || 0,
                        totalCredit: project.totalCredit || 0,
                        balance: project.balance || 0
                    });
                }
            }

            return Array.from(clientMap.values())
                .sort((a, b) => b.balance - a.balance);
        } catch (error) {
            console.error('Error getting client balances summary:', error);
            throw error;
        }
    }
};
