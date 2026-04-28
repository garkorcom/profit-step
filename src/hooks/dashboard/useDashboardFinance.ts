import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase/firebase';

export interface DashboardFinanceData {
    balance: number;
    income: number;
    expenses: number;
    labor: number;
    profit: number;
    trend: {
        balance: number;
        income: number;
        expenses: number;
        labor: number;
        profit: number;
    };
    loading: boolean;
}

export const useDashboardFinance = (companyId: string | undefined): DashboardFinanceData => {
    const [data, setData] = useState<DashboardFinanceData>({
        balance: 0,
        income: 0,
        expenses: 0,
        labor: 0,
        profit: 0,
        trend: { balance: 0, income: 0, expenses: 0, labor: 0, profit: 0 },
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

        let costsIncome = { current: 0, prev: 0 };
        let costsExpense = { current: 0, prev: 0 };
        let laborTotal = { current: 0, prev: 0 };

        let costsLoaded = false;
        let sessionsLoaded = false;

        const recalculate = () => {
            if (!costsLoaded || !sessionsLoaded) return;

            const currentIncome = costsIncome.current;
            const currentExpenses = costsExpense.current;
            const currentLabor = laborTotal.current;
            const currentProfit = currentIncome - currentExpenses - currentLabor;

            const prevIncome = costsIncome.prev;
            const prevExpenses = costsExpense.prev;
            const prevLabor = laborTotal.prev;
            const prevProfit = prevIncome - prevExpenses - prevLabor;

            const calcTrend = (curr: number, prev: number) => {
                if (prev === 0) return curr > 0 ? 100 : 0;
                return ((curr - prev) / Math.abs(prev)) * 100;
            };

            setData({
                balance: currentProfit,
                income: currentIncome,
                expenses: currentExpenses,
                labor: currentLabor,
                profit: currentProfit,
                trend: {
                    balance: calcTrend(currentProfit, prevProfit),
                    income: calcTrend(currentIncome, prevIncome),
                    expenses: calcTrend(currentExpenses, prevExpenses),
                    labor: calcTrend(currentLabor, prevLabor),
                    profit: calcTrend(currentProfit, prevProfit)
                },
                loading: false
            });
        };

        // --- Listen to costs collection (income + expense) ---
        const costsRef = collection(db, 'costs');
        const costsQuery = query(
            costsRef,
            where('createdAt', '>=', Timestamp.fromDate(startOfPreviousMonth))
        );

        const unsubCosts = onSnapshot(costsQuery, (snapshot) => {
            let curIncome = 0, curExpense = 0;
            let prvIncome = 0, prvExpense = 0;

            snapshot.forEach((doc) => {
                const d = doc.data();
                const ts = d.createdAt?.seconds ? d.createdAt.seconds * 1000 : 0;
                const amount = Math.abs(d.amount || 0);
                const isCurrentMonth = ts >= startOfCurrentMonth.getTime();
                const isPrevMonth = ts >= startOfPreviousMonth.getTime() && ts <= endOfPreviousMonth.getTime();

                if (d.type === 'income') {
                    if (isCurrentMonth) curIncome += amount;
                    else if (isPrevMonth) prvIncome += amount;
                } else if (d.type === 'expense') {
                    if (isCurrentMonth) curExpense += amount;
                    else if (isPrevMonth) prvExpense += amount;
                }
            });

            costsIncome = { current: curIncome, prev: prvIncome };
            costsExpense = { current: curExpense, prev: prvExpense };
            costsLoaded = true;
            recalculate();
        }, (error) => {
            // QA 2026-04-27 P1-4: tightened RLS — silent on permission-denied.
            if ((error as { code?: string })?.code !== 'permission-denied') {
                console.error('Error fetching costs for dashboard:', error);
            }
            costsLoaded = true;
            recalculate();
        });

        // --- Listen to work_sessions (status=closed) for labor ---
        const sessionsRef = collection(db, 'work_sessions');
        const sessionsQuery = query(
            sessionsRef,
            where('status', '==', 'closed'),
            where('startTime', '>=', Timestamp.fromDate(startOfPreviousMonth))
        );

        const unsubSessions = onSnapshot(sessionsQuery, (snapshot) => {
            let curLabor = 0;
            let prvLabor = 0;

            snapshot.forEach((doc) => {
                const d = doc.data();
                const ts = d.startTime?.seconds ? d.startTime.seconds * 1000 : 0;
                const minutes = d.durationMinutes || 0;
                const rate = d.hourlyRate || 0;
                const earnings = (minutes * rate) / 60;
                const isCurrentMonth = ts >= startOfCurrentMonth.getTime();
                const isPrevMonth = ts >= startOfPreviousMonth.getTime() && ts <= endOfPreviousMonth.getTime();

                if (isCurrentMonth) curLabor += earnings;
                else if (isPrevMonth) prvLabor += earnings;
            });

            laborTotal = { current: curLabor, prev: prvLabor };
            sessionsLoaded = true;
            recalculate();
        }, (error) => {
            // QA 2026-04-27 P1-4: tightened RLS — silent on permission-denied.
            if ((error as { code?: string })?.code !== 'permission-denied') {
                console.error('Error fetching work_sessions for dashboard:', error);
            }
            sessionsLoaded = true;
            recalculate();
        });

        return () => {
            unsubCosts();
            unsubSessions();
        };
    }, [companyId]);

    return data;
};
