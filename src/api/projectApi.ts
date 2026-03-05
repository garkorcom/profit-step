import {
    collection, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
    query, where, orderBy, serverTimestamp, arrayUnion, arrayRemove
} from 'firebase/firestore';
import { db } from '../firebase/firebase';
import { Project, ProjectFile } from '../types/project.types';

const COLLECTION = 'projects';

export const projectApi = {

    async create(data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
        const ref = doc(collection(db, COLLECTION));
        await setDoc(ref, {
            ...data,
            id: ref.id,
            files: data.files || [],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });
        return ref.id;
    },

    async getAll(companyId: string): Promise<Project[]> {
        const q = query(
            collection(db, COLLECTION),
            where('companyId', '==', companyId),
            orderBy('updatedAt', 'desc')
        );
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ ...d.data(), id: d.id } as Project));
    },

    async getById(id: string): Promise<Project | null> {
        const snap = await getDoc(doc(db, COLLECTION, id));
        if (!snap.exists()) return null;
        return { ...snap.data(), id: snap.id } as Project;
    },

    async update(id: string, data: Partial<Omit<Project, 'id' | 'createdAt' | 'updatedAt' | 'companyId' | 'createdBy'>>): Promise<void> {
        await updateDoc(doc(db, COLLECTION, id), {
            ...data,
            updatedAt: serverTimestamp(),
        });
    },

    async remove(id: string): Promise<void> {
        await deleteDoc(doc(db, COLLECTION, id));
    },

    // File Management
    async addFile(projectId: string, file: ProjectFile): Promise<void> {
        await updateDoc(doc(db, COLLECTION, projectId), {
            files: arrayUnion(file),
            updatedAt: serverTimestamp()
        });
    },

    async removeFile(projectId: string, file: ProjectFile): Promise<void> {
        await updateDoc(doc(db, COLLECTION, projectId), {
            files: arrayRemove(file),
            updatedAt: serverTimestamp()
        });
    }
};
