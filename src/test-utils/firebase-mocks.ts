/**
 * @fileoverview Firebase mock utilities for testing React hooks
 * 
 * Provides mock implementations for Firestore operations
 * (onSnapshot, getDocs, addDoc, updateDoc, deleteDoc) 
 * and the Auth context.
 */

import { Timestamp } from 'firebase/firestore';

// ============================================
// FIRESTORE MOCKS
// ============================================

/** Creates a mock Firestore document snapshot */
export const createMockDocSnap = (id: string, data: Record<string, any>) => ({
    id,
    data: () => data,
    exists: () => true,
    ref: { id, update: jest.fn(), delete: jest.fn() },
});

/** Creates a mock Firestore query snapshot */
export const createMockQuerySnap = (docs: Array<{ id: string; data: Record<string, any> }>) => ({
    docs: docs.map(d => createMockDocSnap(d.id, d.data)),
    empty: docs.length === 0,
    size: docs.length,
    forEach: (cb: (doc: any) => void) => docs.map(d => createMockDocSnap(d.id, d.data)).forEach(cb),
});

/** Creates a fake Firestore Timestamp from a Date */
export const mockTimestamp = (date: Date = new Date()): Timestamp => {
    return {
        seconds: Math.floor(date.getTime() / 1000),
        nanoseconds: 0,
        toDate: () => date,
        toMillis: () => date.getTime(),
        isEqual: (other: any) => other?.seconds === Math.floor(date.getTime() / 1000),
    } as unknown as Timestamp;
};

// ============================================
// AUTH CONTEXT MOCK
// ============================================

export interface MockUserProfile {
    id: string;
    uid: string;
    displayName: string;
    email: string;
    role: 'superadmin' | 'company_admin' | 'admin' | 'manager' | 'user' | 'estimator' | 'guest';
    companyId?: string;
    telegramId?: string;
}

/** Default test user (admin role) */
export const defaultTestUser: MockUserProfile = {
    id: 'test-user-1',
    uid: 'test-user-1',
    displayName: 'Test Admin',
    email: 'admin@test.com',
    role: 'admin',
    companyId: 'company-1',
};

/** Creates a mock Auth context value */
export const createMockAuth = (overrides?: Partial<MockUserProfile>) => {
    const user = { ...defaultTestUser, ...overrides };
    return {
        currentUser: { uid: user.uid, displayName: user.displayName, email: user.email },
        userProfile: user,
        loading: false,
        logout: jest.fn(),
    };
};
