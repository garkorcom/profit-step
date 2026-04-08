/**
 * @fileoverview Хук для получения подчинённых текущего пользователя
 * 
 * Использует иерархию reportsTo для построения списка подчинённых.
 * Кеширует результат на 5 минут.
 */

import { useState, useEffect, useCallback } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase/firebase';
import { useAuth } from '../auth/AuthContext';
import { UserProfile } from '../types/user.types';
import { getAllSubordinates, buildOrgTree, flattenOrgTree } from '../utils/hierarchyUtils';
import { OrgTreeNode } from '../types/rbac.types';
import { errorMessage } from '../utils/errorMessage';

interface UseSubordinatesResult {
    /** Все подчинённые (рекурсивно) */
    subordinates: UserProfile[];

    /** IDs всех подчинённых */
    subordinateIds: string[];

    /** Дерево организации */
    orgTree: OrgTreeNode[];

    /** Плоский список для dropdown */
    flatList: Array<{ id: string; displayName: string; depth: number }>;

    /** Загрузка */
    loading: boolean;

    /** Ошибка */
    error: string | null;

    /** Обновить данные */
    refresh: () => void;

    /** IDs которые текущий пользователь может видеть (свои + подчинённые) */
    visibleUserIds: string[];
}

/**
 * Хук для работы с подчинёнными
 * @param includeInactive - Включать неактивных пользователей
 */
export const useSubordinates = (includeInactive = false): UseSubordinatesResult => {
    const { currentUser, userProfile } = useAuth();

    const [subordinates, setSubordinates] = useState<UserProfile[]>([]);
    const [subordinateIds, setSubordinateIds] = useState<string[]>([]);
    const [orgTree, setOrgTree] = useState<OrgTreeNode[]>([]);
    const [flatList, setFlatList] = useState<Array<{ id: string; displayName: string; depth: number }>>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadSubordinates = useCallback(async () => {
        if (!currentUser || !userProfile?.companyId) {
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);

        try {
            // 1. Получаем всех пользователей компании
            const usersRef = collection(db, 'users');
            let q = query(usersRef, where('companyId', '==', userProfile.companyId));

            if (!includeInactive) {
                q = query(q, where('status', '==', 'active'));
            }

            const snapshot = await getDocs(q);
            const allUsers = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as UserProfile));

            // 2. Получаем IDs подчинённых
            const subIds = await getAllSubordinates(currentUser.uid, userProfile.companyId);
            setSubordinateIds(subIds);

            // 3. Фильтруем подчинённых
            const subs = allUsers.filter(u => subIds.includes(u.id));
            setSubordinates(subs);

            // 4. Строим дерево
            const tree = buildOrgTree(allUsers);
            setOrgTree(tree);

            // 5. Плоский список
            const flat = flattenOrgTree(tree);
            setFlatList(flat);

        } catch (err: unknown) {
            console.error('Error loading subordinates:', err);
            setError(errorMessage(err) || 'Не удалось загрузить данные');
        } finally {
            setLoading(false);
        }
    }, [currentUser, userProfile?.companyId, includeInactive]);

    useEffect(() => {
        loadSubordinates();
    }, [loadSubordinates]);

    // IDs которые пользователь может видеть (самостоятельно + подчинённые)
    const visibleUserIds = currentUser
        ? [currentUser.uid, ...subordinateIds]
        : [];

    return {
        subordinates,
        subordinateIds,
        orgTree,
        flatList,
        loading,
        error,
        refresh: loadSubordinates,
        visibleUserIds,
    };
};

export default useSubordinates;
