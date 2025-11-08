/**
 * Companies API - CRUD operations for company clients
 *
 * Features:
 * - Cursor-based pagination with caching
 * - Circuit breaker integration for cost protection
 * - Search by name (case-insensitive)
 * - Status filtering (active/archived/all)
 * - Cost tracking
 */

import {
  collection,
  query,
  where,
  orderBy,
  limit,
  limitToLast,
  startAfter,
  startAt,
  endAt,
  endBefore,
  getDocs,
  getCountFromServer,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  DocumentSnapshot,
  QueryConstraint,
} from 'firebase/firestore';
import { db } from '../firebase/firebase';
import { Company, PaginatedCompaniesResult, CompanyStatus } from '../types/crm.types';
import { costProtectionBreaker } from '../utils/circuitBreaker';

const MAX_READS_PER_REQUEST = 100;

// ===== 1. ПОЛУЧЕНИЕ КОЛИЧЕСТВА =====
export async function getCompanyClientsCount(
  ownerCompanyId: string,
  statusFilter: CompanyStatus = 'active'
): Promise<{ count: number; source: 'aggregation' }> {
  return costProtectionBreaker.execute(async () => {
    try {
      let q = query(
        collection(db, 'companies'),
        where('ownerCompanyId', '==', ownerCompanyId)
      );

      if (statusFilter !== 'all') {
        q = query(q, where('isArchived', '==', statusFilter === 'archived'));
      }

      const countSnapshot = await getCountFromServer(q);
      console.log('[FIRESTORE] Companies count aggregation: 1 read');

      // Track read for cost monitoring
      costProtectionBreaker.trackReads(1);

      return {
        count: countSnapshot.data().count,
        source: 'aggregation',
      };
    } catch (error) {
      console.error('Error getting companies count:', error);
      throw error;
    }
  });
}

// ===== 2. ПАГИНИРОВАННОЕ ПОЛУЧЕНИЕ КОМПАНИЙ =====
export async function getCompanyClientsPaginated(params: {
  ownerCompanyId: string;
  pageSize: number;
  startAfterDoc?: DocumentSnapshot;
  endBeforeDoc?: DocumentSnapshot;
  orderBy: string;
  orderDirection: 'asc' | 'desc';
  searchTerm?: string;
  statusFilter: CompanyStatus;
}): Promise<PaginatedCompaniesResult> {
  return costProtectionBreaker.execute(async () => {
    const startTime = performance.now();

    try {
      // Защита от слишком больших запросов
      const effectivePageSize = Math.min(params.pageSize, MAX_READS_PER_REQUEST);

      let constraints: QueryConstraint[] = [
        where('ownerCompanyId', '==', params.ownerCompanyId),
      ];

      // Фильтр статуса
      if (params.statusFilter !== 'all') {
        constraints.push(where('isArchived', '==', params.statusFilter === 'archived'));
      }

      // Логика поиска
      if (params.searchTerm && params.searchTerm.trim()) {
        const searchLower = params.searchTerm.toLowerCase();
        constraints.push(orderBy('name_lowercase'));
        constraints.push(startAt(searchLower));
        constraints.push(endAt(searchLower + '\uf8ff'));
      } else {
        // Сортировка
        constraints.push(orderBy(params.orderBy, params.orderDirection));

        // Курсоры для пагинации
        if (params.startAfterDoc) {
          constraints.push(startAfter(params.startAfterDoc));
        } else if (params.endBeforeDoc) {
          constraints.push(endBefore(params.endBeforeDoc));
          constraints.push(limitToLast(effectivePageSize));
        }
      }

      // Лимит
      if (!params.endBeforeDoc) {
        constraints.push(limit(effectivePageSize));
      }

      const q = query(collection(db, 'companies'), ...constraints);
      const snapshot = await getDocs(q);

      const companies = snapshot.docs.map(
        (docSnap) =>
          ({
            id: docSnap.id,
            ...docSnap.data(),
          } as Company)
      );

      const duration = performance.now() - startTime;

      // Track reads for cost monitoring
      costProtectionBreaker.trackReads(snapshot.size);

      console.log(
        `[FIRESTORE] Companies paginated query: ${snapshot.size} reads, ${duration.toFixed(0)}ms`
      );

      return {
        companies,
        firstDoc: snapshot.docs[0] || null,
        lastDoc: snapshot.docs[snapshot.docs.length - 1] || null,
        reads: snapshot.size,
        duration,
        hasNextPage: snapshot.size === effectivePageSize,
        hasPrevPage: !!params.startAfterDoc || !!params.endBeforeDoc,
      };
    } catch (error) {
      console.error('Error fetching companies:', error);
      throw error;
    }
  });
}

// ===== 3. СОЗДАНИЕ КОМПАНИИ =====
export async function createCompany(
  data: Omit<Company, 'id' | 'createdAt' | 'updatedAt' | 'isArchived' | 'name_lowercase' | 'ownerCompanyId'>,
  ownerCompanyId: string
): Promise<string> {
  try {
    const docRef = await addDoc(collection(db, 'companies'), {
      ...data,
      name_lowercase: data.name.toLowerCase(),
      isArchived: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ownerCompanyId,
    });

    console.log('[FIRESTORE] Company created:', docRef.id);
    return docRef.id;
  } catch (error) {
    console.error('Error creating company:', error);
    throw error;
  }
}

// ===== 4. ОБНОВЛЕНИЕ КОМПАНИИ =====
export async function updateCompany(
  companyId: string,
  data: Partial<Omit<Company, 'id' | 'createdAt' | 'ownerCompanyId'>>
): Promise<void> {
  try {
    const updateData: any = {
      ...data,
      updatedAt: serverTimestamp(),
    };

    // Обновить name_lowercase если изменилось имя
    if (data.name) {
      updateData.name_lowercase = data.name.toLowerCase();
    }

    await updateDoc(doc(db, 'companies', companyId), updateData);
    console.log('[FIRESTORE] Company updated:', companyId);
  } catch (error) {
    console.error('Error updating company:', error);
    throw error;
  }
}

// ===== 5. АРХИВИРОВАНИЕ КОМПАНИИ =====
export async function archiveCompany(companyId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'companies', companyId), {
      isArchived: true,
      updatedAt: serverTimestamp(),
    });
    console.log('[FIRESTORE] Company archived:', companyId);
  } catch (error) {
    console.error('Error archiving company:', error);
    throw error;
  }
}

// ===== 6. ВОССТАНОВЛЕНИЕ КОМПАНИИ =====
export async function restoreCompany(companyId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'companies', companyId), {
      isArchived: false,
      updatedAt: serverTimestamp(),
    });
    console.log('[FIRESTORE] Company restored:', companyId);
  } catch (error) {
    console.error('Error restoring company:', error);
    throw error;
  }
}
