/**
 * @fileoverview Tests for useFieldAccess hook
 * 
 * Verifies RBAC field-level security for sensitive fields:
 * cost, margin, discount, hourlyRate, salary
 */

import { renderHook } from '@testing-library/react';
import { useFieldAccess } from '../useFieldAccess';
import { DEFAULT_FIELD_RESTRICTIONS } from '../../types/rbac.types';
import { UserRole } from '../../types/user.types';

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
                expect(result.current.canEditMargin).toBe(true);
                expect(result.current.canViewSalary).toBe(true);
                expect(result.current.canEditSalary).toBe(true);
                expect(result.current.canViewHourlyRate).toBe(true);
                expect(result.current.canEditHourlyRate).toBe(true);
                expect(result.current.canViewDiscount).toBe(true);
                expect(result.current.canEditDiscount).toBe(true);

                // Check full structure
                expect(result.current.costAccess).toEqual({ hidden: false, readOnly: false, fullAccess: true });
            }
        );
    });

    describe('manager role', () => {
        beforeEach(() => {
            mockUseAuth.mockReturnValue({
                userProfile: { role: 'manager' },
            });
        });

        it('should hide salary completely', () => {
            const { result } = renderHook(() => useFieldAccess());
            expect(result.current.canViewSalary).toBe(false);
            expect(result.current.canEditSalary).toBe(false);
            expect(result.current.salaryAccess).toEqual({ hidden: true, readOnly: false, fullAccess: false });
        });

        it('should allow viewing AND editing all other fields', () => {
            const { result } = renderHook(() => useFieldAccess());
            expect(result.current.canViewCost).toBe(true);
            expect(result.current.canEditCost).toBe(true);
            expect(result.current.canViewMargin).toBe(true);
            expect(result.current.canEditMargin).toBe(true);
            expect(result.current.canViewHourlyRate).toBe(true);
            expect(result.current.canEditHourlyRate).toBe(true);
            expect(result.current.canViewDiscount).toBe(true);
            expect(result.current.canEditDiscount).toBe(true);
        });
    });

    describe('user role (default restrictions)', () => {
        beforeEach(() => {
            mockUseAuth.mockReturnValue({
                userProfile: { role: 'user' },
            });
        });

        it('should apply DEFAULT_FIELD_RESTRICTIONS exactly', () => {
            const { result } = renderHook(() => useFieldAccess());

            // Check against DEFAULT_FIELD_RESTRICTIONS
            const isCostHidden = DEFAULT_FIELD_RESTRICTIONS.find((r: any) => r.field === 'cost')?.hidden ?? false;
            const isCostReadOnly = DEFAULT_FIELD_RESTRICTIONS.find((r: any) => r.field === 'cost')?.readOnly ?? false;

            expect(result.current.costAccess.hidden).toBe(isCostHidden);
            expect(result.current.costAccess.readOnly).toBe(isCostReadOnly);

            const isMarginHidden = DEFAULT_FIELD_RESTRICTIONS.find((r: any) => r.field === 'margin')?.hidden ?? false;
            expect(result.current.marginAccess.hidden).toBe(isMarginHidden);
        });
    });

    describe('estimator role', () => {
        beforeEach(() => {
            mockUseAuth.mockReturnValue({
                userProfile: { role: 'estimator' },
            });
        });

        it('should have readonly access to cost', () => {
            const { result } = renderHook(() => useFieldAccess());
            expect(result.current.canViewCost).toBe(true);
            expect(result.current.canEditCost).toBe(false);
            expect(result.current.costAccess).toEqual({ hidden: false, readOnly: true, fullAccess: false });
        });

        it('should hide margin and salary completely', () => {
            const { result } = renderHook(() => useFieldAccess());
            expect(result.current.canViewMargin).toBe(false);
            expect(result.current.canEditMargin).toBe(false);
            expect(result.current.canViewSalary).toBe(false);
        });

        it('should allow full access to hourlyRate and discount', () => {
            const { result } = renderHook(() => useFieldAccess());
            expect(result.current.canViewHourlyRate).toBe(true);
            expect(result.current.canEditHourlyRate).toBe(true);
            expect(result.current.canViewDiscount).toBe(true);
            expect(result.current.canEditDiscount).toBe(true);
            expect(result.current.discountAccess).toEqual({ hidden: false, readOnly: false, fullAccess: true });
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
            expect(result.current.costAccess).toEqual({ hidden: true, readOnly: false, fullAccess: false });
            expect(result.current.marginAccess).toEqual({ hidden: true, readOnly: false, fullAccess: false });
            expect(result.current.discountAccess).toEqual({ hidden: true, readOnly: false, fullAccess: false });
            expect(result.current.hourlyRateAccess).toEqual({ hidden: true, readOnly: false, fullAccess: false });
            expect(result.current.salaryAccess).toEqual({ hidden: true, readOnly: false, fullAccess: false });
        });
    });

    describe('unknown/invalid role (Fail-Safe)', () => {
        beforeEach(() => {
            mockUseAuth.mockReturnValue({
                userProfile: { role: 'some_hacked_role' as UserRole },
            });
        });

        it('should default to restricted access (DEFAULT_FIELD_RESTRICTIONS) to avoid fail-open logic', () => {
            const { result } = renderHook(() => useFieldAccess());

            const isCostHidden = DEFAULT_FIELD_RESTRICTIONS.find((r: any) => r.field === 'cost')?.hidden ?? false;
            expect(result.current.costAccess.hidden).toBe(isCostHidden);

            // Should not have full access
            expect(result.current.costAccess.fullAccess).toBe(!isCostHidden && !(DEFAULT_FIELD_RESTRICTIONS.find((r: any) => r.field === 'cost')?.readOnly ?? false));
        });
    });

    describe('no user profile', () => {
        it('should hide all fields when userProfile is null', () => {
            mockUseAuth.mockReturnValue({ userProfile: null });

            const { result } = renderHook(() => useFieldAccess());

            ["costAccess", "marginAccess", "discountAccess", "hourlyRateAccess", "salaryAccess"].forEach(accessor => {
                expect(result.current[accessor as keyof typeof result.current]).toEqual({
                    hidden: true,
                    readOnly: true,
                    fullAccess: false
                });
            });
        });
    });
});
