import { useState } from 'react';
import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { useAuth } from '../../auth/AuthContext';
import { WorkSession } from '../../types/timeTracking.types';
import { InvoiceLineItem } from '../../types/invoice.types';

export const useInvoiceGenerator = () => {
    const [generating, setGenerating] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const { userProfile } = useAuth();

    const generateFromTimeTracking = async (
        clientId: string,
        clientName: string,
        startDate: Date,
        endDate: Date,
        applyClientRate: boolean = true,
        defaultRate: number = 0
    ) => {
        setGenerating(true);
        setError(null);

        try {
            if (!userProfile?.companyId) {
                throw new Error('Cannot generate invoice: missing company. Please re-login.');
            }

            const startTimestamp = Timestamp.fromDate(startDate);
            // End date should include the full day
            const endOfDay = new Date(endDate);
            endOfDay.setHours(23, 59, 59, 999);
            const endTimestamp = Timestamp.fromDate(endOfDay);

            const sessionsRef = collection(db, 'work_sessions');
            // companyId filter REQUIRED — RLS read rule (PR #95).
            const q = query(
                sessionsRef,
                where('companyId', '==', userProfile.companyId),
                where('clientId', '==', clientId),
                where('status', '==', 'completed')
                // Note: Firestore requires a composite index if we combine == and >=/<= on different fields.
                // We will fetch by clientId and completed status, then filter by date in memory
                // since the dataset per client is usually manageable.
            );

            const snapshot = await getDocs(q);
            const sessions: WorkSession[] = [];

            snapshot.forEach(doc => {
                const data = doc.data() as WorkSession;
                if (!data.startTime) return;

                const sessionTime = data.startTime.toMillis();
                if (sessionTime >= startTimestamp.toMillis() && sessionTime <= endTimestamp.toMillis()) {
                    sessions.push({ ...data, id: doc.id });
                }
            });

            if (sessions.length === 0) {
                throw new Error("No completed work sessions found for this client in the selected date range.");
            }

            // Aggregate hours
            // We can group by task description or just create one big line item.
            // Let's create one combined line item for all time tracking, or group by Employee
            // Given typical invoices, grouping by Employee or Task is best. We'll group by Task/Employee.
            // For simplicity in generating a clean invoice, we'll group by Employee Name and Task Summary.

            const lineItemMap = new Map<string, InvoiceLineItem>();

            sessions.forEach(session => {
                const durationHours = (session.durationMinutes || 0) / 60;
                if (durationHours <= 0) return;

                const rate = applyClientRate
                    ? (session.hourlyRate || defaultRate)
                    : defaultRate;

                // Group key: "Employee: Task"
                const taskDesc = session.plannedTaskSummary || session.description || "General Labor";
                const description = `${session.employeeName} - ${taskDesc}`;

                const existing = lineItemMap.get(description);

                if (existing) {
                    existing.quantity += durationHours;
                    existing.amount = existing.quantity * existing.rate;
                } else {
                    lineItemMap.set(description, {
                        id: Math.random().toString(36).substring(2, 9),
                        description,
                        quantity: durationHours,
                        rate: rate,
                        amount: durationHours * rate
                    });
                }
            });

            const lineItems = Array.from(lineItemMap.values()).map(item => ({
                ...item,
                // Round to 2 decimal places carefully
                quantity: Math.round(item.quantity * 100) / 100,
                amount: Math.round(item.amount * 100) / 100
            }));

            const subtotal = lineItems.reduce((acc, curr) => acc + curr.amount, 0);

            setGenerating(false);

            return {
                clientId,
                clientName,
                lineItems,
                subtotal,
                taxRate: 0,
                taxAmount: 0,
                total: subtotal
            };

        } catch (err: unknown) {
            console.error("Error generating invoice from time tracking:", err);
            setError(err instanceof Error ? err : new Error(String(err)));
            setGenerating(false);
            throw err;
        }
    };

    return {
        generateFromTimeTracking,
        generating,
        error
    };
};
