/**
 * @fileoverview Tests for useFieldAccess hook
 * 
 * Verifies RBAC field-level security for sensitive fields:
 * cost, margin, discount, hourlyRate, salary
 */

import { renderHook } from '@testing-library/react';
import { useFieldAccess } from '../useFieldAccess';

// Mock AuthContext
const mockUseAuth = jest.fn();
jest.mock('../../auth/AuthContext', () => ({
    useAuth: () => mockUseAuth(),
}));

describe('useFieldAccess', () => {
    afterEach(() => jest.clearAllMocks());

    describe('admin roles (full access)', () => {
        it.each(['superadmin', 'company_admin', 'admin'] as const)(
            '%s should have full access to all fields',
            (role) => {
                mockUseAuth.mockReturnValue({
                    userProfile: { role },
                });

                const { result } = renderHook(() => useFieldAccess());

                expect(result.current.canViewCost).toBe(true);
                expect(result.current.canEditCost).toBe(true);
                expect(result.current.canViewMargin).toBe(true);
                expect(result.current.canViewSalary).toBe(true);
                expect(result.current.canViewHourlyRate).toBe(true);
                expect(result.current.canViewDiscount).toBe(true);
            }
        );
    });

    describe('manager role', () => {
        beforeEach(() => {
            mockUseAuth.mockReturnValue({
                userProfile: { role: 'manager' },
            });
        });

        it('should hide salary', () => {
            const { result } = renderHook(() => useFieldAccess());
            expect(result.current.canViewSalary).toBe(false);
            expect(result.current.salaryAccess.hidden).toBe(true);
        });

        it('should allow viewing cost and margin', () => {
            const { result } = renderHook(() => useFieldAccess());
            expect(result.current.canViewCost).toBe(true);
            expect(result.current.canViewMargin).toBe(true);
        });
    });

    describe('user role (default restrictions)', () => {
        beforeEach(() => {
            mockUseAuth.mockReturnValue({
                userProfile: { role: 'user' },
            });
        });

        it('should apply DEFAULT_FIELD_RESTRICTIONS', () => {
            const { result } = renderHook(() => useFieldAccess());
            // Users have restricted access per DEFAULT_FIELD_RESTRICTIONS
            expect(result.current.currentRole).toBe('user');
        });
    });

    describe('estimator role', () => {
        beforeEach(() => {
            mockUseAuth.mockReturnValue({
                userProfile: { role: 'estimator' },
            });
        });

        it('should have readonly cost access', () => {
            const { result } = renderHook(() => useFieldAccess());
            expect(result.current.canViewCost).toBe(true);
            expect(result.current.costAccess.readOnly).toBe(true);
            expect(result.current.canEditCost).toBe(false);
        });

        it('should hide margin and salary', () => {
            const { result } = renderHook(() => useFieldAccess());
            expect(result.current.canViewMargin).toBe(false);
            expect(result.current.canViewSalary).toBe(false);
        });
    });

    describe('guest role (most restrictive)', () => {
        beforeEach(() => {
            mockUseAuth.mockReturnValue({
                userProfile: { role: 'guest' },
            });
        });

        it('should hide all sensitive fields', () => {
            const { result } = renderHook(() => useFieldAccess());
            expect(result.current.canViewCost).toBe(false);
            expect(result.current.canViewMargin).toBe(false);
            expect(result.current.canViewDiscount).toBe(false);
            expect(result.current.canViewHourlyRate).toBe(false);
            expect(result.current.canViewSalary).toBe(false);
        });
    });

    describe('no user profile', () => {
        it('should hide all fields when userProfile is null', () => {
            mockUseAuth.mockReturnValue({ userProfile: null });

            const { result } = renderHook(() => useFieldAccess());
            expect(result.current.canViewCost).toBe(false);
            expect(result.current.canEditCost).toBe(false);
            expect(result.current.canViewSalary).toBe(false);
        });
    });

    describe('checkFieldAccess function', () => {
        it('should return correct structure for any field', () => {
            mockUseAuth.mockReturnValue({
                userProfile: { role: 'admin' },
            });

            const { result } = renderHook(() => useFieldAccess());
            const access = result.current.checkFieldAccess('cost');

            expect(access).toHaveProperty('hidden');
            expect(access).toHaveProperty('readOnly');
            expect(access).toHaveProperty('fullAccess');
        });
    });
});
