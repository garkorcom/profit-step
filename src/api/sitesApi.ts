/**
 * Sites API — Firestore direct access for Sites collection
 * Sites Phase 2
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase/firebase';

export interface SiteData {
  id: string;
  clientId: string;
  name: string;
  address: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  geo?: { lat: number; lng: number } | null;
  sqft?: number | null;
  type?: 'residential' | 'commercial' | 'industrial' | null;
  permitNumber?: string | null;
  status: 'active' | 'completed' | 'on_hold';
  createdBy?: string;
  createdAt?: any;
  updatedAt?: any;
}

const SITES_COLLECTION = 'sites';

export const sitesApi = {
  async getSitesByClient(clientId: string): Promise<SiteData[]> {
    const q = query(
      collection(db, SITES_COLLECTION),
      where('clientId', '==', clientId)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as SiteData));
  },

  async getSiteById(siteId: string): Promise<SiteData | null> {
    const docRef = doc(db, SITES_COLLECTION, siteId);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) return null;
    return { id: docSnap.id, ...docSnap.data() } as SiteData;
  },

  async updateSite(siteId: string, data: Partial<Omit<SiteData, 'id' | 'clientId' | 'createdAt' | 'createdBy'>>): Promise<void> {
    const docRef = doc(db, SITES_COLLECTION, siteId);
    await updateDoc(docRef, {
      ...data,
      updatedAt: serverTimestamp(),
    });
  },
};
