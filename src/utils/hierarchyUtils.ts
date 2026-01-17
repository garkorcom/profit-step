/**
 * @fileoverview Утилиты для работы с организационной иерархией
 * 
 * Поддерживает:
 * - Построение дерева организации
 * - Получение всех подчинённых (рекурсивно)
 * - Проверка является ли пользователь руководителем другого
 */

import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase/firebase';
import { UserProfile } from '../types/user.types';
import { OrgTreeNode } from '../types/rbac.types';

// ================================
// CACHE
// ================================

/** Кеш подчинённых для избежания повторных запросов */
const subordinatesCache = new Map<string, { data: string[]; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 минут

/**
 * Очистить кеш (например, при изменении reportsTo)
 */
export const clearHierarchyCache = () => {
    subordinatesCache.clear();
};

// ================================
// SUBORDINATES
// ================================

/**
 * Получить список прямых подчинённых (1 уровень)
 * @param managerId - UID руководителя
 * @param companyId - ID компании
 */
export const getDirectSubordinates = async (
    managerId: string,
    companyId: string
): Promise<UserProfile[]> => {
    const usersRef = collection(db, 'users');
    const q = query(
        usersRef,
        where('companyId', '==', companyId),
        where('reportsTo', '==', managerId),
        where('status', '==', 'active')
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    } as UserProfile));
};

/**
 * Получить всех подчинённых рекурсивно (все уровни)
 * @param managerId - UID руководителя
 * @param companyId - ID компании
 * @returns Массив UID всех подчинённых
 */
export const getAllSubordinates = async (
    managerId: string,
    companyId: string
): Promise<string[]> => {
    // Проверяем кеш
    const cached = subordinatesCache.get(managerId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.data;
    }

    const result: string[] = [];
    const queue: string[] = [managerId];
    const visited = new Set<string>();

    while (queue.length > 0) {
        const currentId = queue.shift()!;
        if (visited.has(currentId)) continue;
        visited.add(currentId);

        const directSubs = await getDirectSubordinates(currentId, companyId);
        for (const sub of directSubs) {
            if (!visited.has(sub.id)) {
                result.push(sub.id);
                queue.push(sub.id);
            }
        }
    }

    // Сохраняем в кеш
    subordinatesCache.set(managerId, { data: result, timestamp: Date.now() });

    return result;
};

/**
 * Проверить, является ли пользователь руководителем другого
 * (прямым или через цепочку)
 */
export const isManagerOf = async (
    potentialManagerId: string,
    userId: string,
    companyId: string
): Promise<boolean> => {
    const subordinates = await getAllSubordinates(potentialManagerId, companyId);
    return subordinates.includes(userId);
};

// ================================
// ORG TREE
// ================================

/**
 * Построить дерево организации
 * @param users - Массив всех пользователей компании
 * @returns Массив корневых узлов (топ-менеджеры)
 */
export const buildOrgTree = (users: UserProfile[]): OrgTreeNode[] => {
    const userMap = new Map<string, UserProfile>();
    const childrenMap = new Map<string, UserProfile[]>();

    // Индексируем пользователей
    for (const user of users) {
        userMap.set(user.id, user);

        const managerId = user.reportsTo || 'root';
        if (!childrenMap.has(managerId)) {
            childrenMap.set(managerId, []);
        }
        childrenMap.get(managerId)!.push(user);
    }

    // Рекурсивная функция построения узла
    const buildNode = (user: UserProfile): OrgTreeNode => {
        const children = childrenMap.get(user.id) || [];
        return {
            id: user.id,
            displayName: user.displayName,
            role: user.role,
            photoURL: user.photoURL,
            children: children
                .sort((a, b) => a.displayName.localeCompare(b.displayName))
                .map(buildNode),
        };
    };

    // Находим корневых пользователей (без руководителя)
    const roots = childrenMap.get('root') || [];

    // Также добавляем пользователей чей руководитель не в списке
    for (const user of users) {
        if (user.reportsTo && !userMap.has(user.reportsTo)) {
            roots.push(user);
        }
    }

    return roots
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
        .map(buildNode);
};

/**
 * Получить плоский список для dropdown с иерархическим отступом
 */
export const flattenOrgTree = (
    nodes: OrgTreeNode[],
    depth: number = 0
): Array<{ id: string; displayName: string; depth: number }> => {
    const result: Array<{ id: string; displayName: string; depth: number }> = [];

    for (const node of nodes) {
        result.push({
            id: node.id,
            displayName: node.displayName,
            depth,
        });
        result.push(...flattenOrgTree(node.children, depth + 1));
    }

    return result;
};

// ================================
// HIERARCHY PATH
// ================================

/**
 * Построить hierarchyPath для пользователя
 * @param userId - UID пользователя
 * @param usersMap - Map всех пользователей (id -> UserProfile)
 * @returns Массив UID от пользователя до топ-менеджера
 */
export const buildHierarchyPath = (
    userId: string,
    usersMap: Map<string, UserProfile>
): string[] => {
    const path: string[] = [userId];
    const visited = new Set<string>([userId]);

    let currentId = userId;
    let maxDepth = 10; // Защита от циклов

    while (maxDepth-- > 0) {
        const user = usersMap.get(currentId);
        if (!user || !user.reportsTo) break;

        if (visited.has(user.reportsTo)) {
            console.warn(`Cycle detected in hierarchy: ${user.reportsTo}`);
            break;
        }

        visited.add(user.reportsTo);
        path.push(user.reportsTo);
        currentId = user.reportsTo;
    }

    return path;
};

// ================================
// VALIDATION
// ================================

/**
 * Проверить, создаст ли изменение reportsTo цикл в иерархии
 * 
 * @example
 * // A → B → C. Если C.reportsTo = A, получится цикл A → B → C → A
 * detectHierarchyCycle('C', 'A', users) // true - цикл!
 * 
 * @param userId - Пользователь, которому меняем руководителя
 * @param newReportsTo - Новый руководитель
 * @param users - Все пользователи компании
 * @returns true если будет цикл
 */
export const detectHierarchyCycle = (
    userId: string,
    newReportsTo: string | undefined,
    users: UserProfile[]
): boolean => {
    if (!newReportsTo) return false;
    if (newReportsTo === userId) return true; // L-04: self-reference

    const usersMap = new Map(users.map(u => [u.id, u]));

    // Проверяем: не является ли newReportsTo подчинённым userId?
    // Если userId является начальником newReportsTo (прямо или через цепочку),
    // то назначение newReportsTo начальником userId создаст цикл

    const visited = new Set<string>();
    let currentId = newReportsTo;
    let maxDepth = 20; // Защита от бесконечного цикла

    while (maxDepth-- > 0 && currentId) {
        if (currentId === userId) {
            return true; // Цикл найден!
        }
        if (visited.has(currentId)) {
            return true; // Уже есть цикл в существующих данных
        }
        visited.add(currentId);

        const user = usersMap.get(currentId);
        currentId = user?.reportsTo || '';
    }

    return false;
};

/**
 * Полная валидация reportsTo перед сохранением
 */
export interface ReportsToValidationResult {
    valid: boolean;
    error?: string;
}

export const validateReportsTo = (
    userId: string,
    newReportsTo: string | undefined,
    users: UserProfile[]
): ReportsToValidationResult => {
    // L-04: Self-reference
    if (newReportsTo === userId) {
        return { valid: false, error: 'Нельзя назначить себя руководителем' };
    }

    // L-05: Cycle detection
    if (newReportsTo && detectHierarchyCycle(userId, newReportsTo, users)) {
        return { valid: false, error: 'Это изменение создаст цикл в иерархии' };
    }

    return { valid: true };
};
