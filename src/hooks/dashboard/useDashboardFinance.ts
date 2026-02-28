import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { BankTransaction, INCOME_CATEGORIES, EXPENSE_CATEGORIES } from '../../types/expensesBoard.types';

export interface DashboardFinanceData {
    balance: number;
    income: number;
    expenses: number;
    profit: number;
    trend: {
        balance: number;
        income: number;
        expenses: number;
        profit: number;
    };
    loading: boolean;
}

export const useDashboardFinance = (companyId: string | undefined): DashboardFinanceData => {
    const [data, setData] = useState<DashboardFinanceData>({
        balance: 0,
        income: 0,
        expenses: 0,
        profit: 0,
        trend: { balance: 0, income: 0, expenses: 0, profit: 0 },
        loading: true
    });

    useEffect(() => {
        if (!companyId) return;

        // Current month bounds
        const now = new Date();
        const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        // Previous month bounds
        const startOfPreviousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const endOfPreviousMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

        const transactionsRef = collection(db, 'bank_transactions');
        // We only care about transactions from the start of the previous month onwards to calculate current vs prev
        const q = query(
            transactionsRef,
            where('companyId', '==', companyId),
            where('date', '>=', Timestamp.fromDate(startOfPreviousMonth))
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            let currentIncome = 0;
            let currentExpenses = 0;

            let prevIncome = 0;
            let prevExpenses = 0;

            snapshot.forEach((doc) => {
                const tx = doc.data() as BankTransaction;
                const txDate = tx.date.seconds * 1000;

                const isCurrentMonth = txDate >= startOfCurrentMonth.getTime();
                const isIncome = INCOME_CATEGORIES.includes(tx.category);
                const isExpense = EXPENSE_CATEGORIES.includes(tx.category);

                // Note: isRefund logic usually reduces expenses, but for simple dashboard we can aggregate mathematically
                const amount = tx.isRefund ? -tx.amount : tx.amount;

                if (isCurrentMonth) {
                    if (isIncome) currentIncome += amount;
                    if (isExpense) currentExpenses += amount;
                } else if (txDate <= endOfPreviousMonth.getTime()) {
                    if (isIncome) prevIncome += amount;
                    if (isExpense) prevExpenses += amount;
                }
            });

            const currentProfit = currentIncome - currentExpenses;
            const prevProfit = prevIncome - prevExpenses;

            // Trend calculation: (Current - Prev) / Prev * 100
            const calcTrend = (curr: number, prev: number) => {
                if (prev === 0) return curr > 0 ? 100 : 0;
                return ((curr - prev) / Math.abs(prev)) * 100;
            };

            // Calculate overall balance: this requires fetching all transactions, which is heavy. 
            // For dashboard real-time purposes, total Balance might be approximated or require a standalone aggregation.
            // As a fallback to avoid massive read costs, we can set balance = current profit or fetch a static aggregate doc if one exists.
            // For now, let's represent balance as total profit over the fetched period to save reads, OR we could fetch a single aggregate doc.
            // Assuming balance = sum of all income - all expenses. Since we only fetched 2 months, we can't show ALL TIME balance accurately without a huge query.
            // We'll leave balance as 0 for a moment, or use currentProfit as a placeholder if there's no pre-aggregated balance field in company doc.

            setData({
                balance: currentProfit, // Placeholder 
                income: currentIncome,
                expenses: currentExpenses,
                profit: currentProfit,
                trend: {
                    balance: calcTrend(currentProfit, prevProfit),
                    income: calcTrend(currentIncome, prevIncome),
                    expenses: calcTrend(currentExpenses, prevExpenses),
                    profit: calcTrend(currentProfit, prevProfit)
                },
                loading: false
            });
        }, (error) => {
            console.error('Error fetching finance dashboard stats:', error);
            setData(prev => ({ ...prev, loading: false }));
        });

        return () => unsubscribe();
    }, [companyId]);

    return data;
};
