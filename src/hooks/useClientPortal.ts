import { useState, useEffect } from 'react';
import {
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  Unsubscribe,
} from 'firebase/firestore';
import { ref, listAll, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase/firebase';
import { slugify } from '../utils/slugify';
import type { Client } from '../types/crm.types';
import type { Estimate } from '../types/estimate.types';
import type { GTDTask } from '../types/gtd.types';
import type { Project } from '../types/project.types';
import type { LedgerEntry } from '../types/crm.types';
import type { GalleryPhoto } from '../components/client-dashboard/sections/GallerySection';

export interface ClientPortalData {
  client: Client | null;
  projects: Project[];
  estimates: Estimate[];
  tasks: GTDTask[];
  ledger: LedgerEntry[];
  photos: GalleryPhoto[];
  loading: boolean;
  notFound: boolean;
}

export function useClientPortal(slug: string | undefined): ClientPortalData {
  const [client, setClient] = useState<Client | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [tasks, setTasks] = useState<GTDTask[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Step 1: Find client by slug
  useEffect(() => {
    if (!slug) {
      setLoading(false);
      setNotFound(true);
      return;
    }

    let cancelled = false;

    const findClient = async () => {
      try {
        // Query all clients and match by slugified name
        const snap = await getDocs(collection(db, 'clients'));
        const matched = snap.docs.find((doc) => {
          const data = doc.data();
          return slugify(data.name || '') === slug;
        });

        if (cancelled) return;

        if (matched) {
          setClient({ id: matched.id, ...matched.data() } as Client);
          setNotFound(false);
        } else {
          setClient(null);
          setNotFound(true);
          setLoading(false);
        }
      } catch (err) {
        console.error('Error finding client by slug:', err);
        if (!cancelled) {
          setNotFound(true);
          setLoading(false);
        }
      }
    };

    findClient();
    return () => { cancelled = true; };
  }, [slug]);

  // Step 2: Once client is found, subscribe to related data
  useEffect(() => {
    if (!client) return;

    const unsubs: Unsubscribe[] = [];
    let photosLoaded = false;
    let collectionsLoaded = 0;
    const totalCollections = 4; // projects, estimates, tasks, ledger

    const checkDone = () => {
      if (collectionsLoaded >= totalCollections && photosLoaded) {
        setLoading(false);
      }
    };

    const markCollectionLoaded = () => {
      collectionsLoaded++;
      checkDone();
    };

    // Projects
    const projectsQ = query(
      collection(db, 'projects'),
      where('clientId', '==', client.id)
    );
    unsubs.push(
      onSnapshot(projectsQ, (snap) => {
        setProjects(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Project)));
        markCollectionLoaded();
      }, () => markCollectionLoaded())
    );

    // Estimates
    const estimatesQ = query(
      collection(db, 'estimates'),
      where('clientId', '==', client.id)
    );
    unsubs.push(
      onSnapshot(estimatesQ, (snap) => {
        setEstimates(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Estimate)));
        markCollectionLoaded();
      }, () => markCollectionLoaded())
    );

    // GTD Tasks
    const tasksQ = query(
      collection(db, 'gtd_tasks'),
      where('clientId', '==', client.id)
    );
    unsubs.push(
      onSnapshot(tasksQ, (snap) => {
        setTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() } as GTDTask)));
        markCollectionLoaded();
      }, () => markCollectionLoaded())
    );

    // Ledger entries
    const ledgerQ = query(
      collection(db, 'project_ledger'),
      where('clientId', '==', client.id)
    );
    unsubs.push(
      onSnapshot(ledgerQ, (snap) => {
        setLedger(snap.docs.map((d) => ({ id: d.id, ...d.data() } as LedgerEntry)));
        markCollectionLoaded();
      }, () => markCollectionLoaded())
    );

    // Photos from Firebase Storage
    const loadPhotos = async () => {
      try {
        const storageRef = ref(storage, `clients/${client.id}/photos`);
        const result = await listAll(storageRef);

        if (result.items.length === 0) {
          setPhotos([]);
          photosLoaded = true;
          checkDone();
          return;
        }

        const photoPromises = result.items.map(async (itemRef) => {
          const url = await getDownloadURL(itemRef);
          const name = itemRef.name;
          // Determine category from filename prefix: render_, progress_, before_
          let category: GalleryPhoto['category'] = 'progress';
          if (name.startsWith('render_') || name.startsWith('render-')) category = 'render';
          else if (name.startsWith('before_') || name.startsWith('before-')) category = 'before';

          return {
            id: name,
            url,
            title: name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
            date: '',
            category,
          } as GalleryPhoto;
        });

        const loaded = await Promise.all(photoPromises);
        setPhotos(loaded);
      } catch {
        // Storage path may not exist — that's OK
        setPhotos([]);
      } finally {
        photosLoaded = true;
        checkDone();
      }
    };

    loadPhotos();

    return () => unsubs.forEach((u) => u());
  }, [client]);

  return { client, projects, estimates, tasks, ledger, photos, loading, notFound };
}
