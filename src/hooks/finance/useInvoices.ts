import { useState, useEffect, useMemo } from 'react';
import {
    collection,
    query,
    onSnapshot,
    addDoc,
    updateDoc,
    deleteDoc,
    doc,
    serverTimestamp,
    getDocs,
    orderBy,
    limit
} from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { Invoice, InvoiceStatus, InvoicePayment, InvoiceAnalytics } from '../../types/invoice.types';
import { useAuth } from '../../auth/AuthContext';

export const useInvoices = () => {
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const { currentUser } = useAuth();

    useEffect(() => {
        if (!currentUser) {
            setLoading(false);
            return;
        }

        const q = query(
            collection(db, 'invoices'),
            orderBy('createdAt', 'desc')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as Invoice[];
            setInvoices(data);
            setLoading(false);
            setError(null);
        }, (err) => {
            console.error("Error fetching invoices:", err);
            setError(err);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [currentUser]);

    // Derived Analytics from local state
    const analytics = useMemo<InvoiceAnalytics>(() => {
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        let totalRevenue = 0;
        let outstanding = 0;
        let paidThisMonth = 0;
        let overdue = 0;
        let fullyPaidCount = 0;
        let totalDaysToPayment = 0;
        let validInvoicesForCollectionRate = 0;

        invoices.forEach(inv => {
            if (inv.status === 'cancelled') return;

            // Revenue includes all sent/paid/overdue
            if (inv.status !== 'draft') {
                totalRevenue += inv.total;
                validInvoicesForCollectionRate++;

                // Outstanding
                const totalPaid = inv.payments?.reduce((sum, p) => sum + p.amount, 0) || 0;
                const remaining = inv.total - totalPaid;

                if (inv.status !== 'paid') {
                    outstanding += remaining;
                }

                if (inv.status === 'overdue') {
                    overdue += remaining;
                }
            }

            // Payments this month
            inv.payments?.forEach(payment => {
                const pDate = payment.date.toDate();
                if (pDate.getMonth() === currentMonth && pDate.getFullYear() === currentYear) {
                    paidThisMonth += payment.amount;
                }
            });

            // Collection rate & average days logic
            if (inv.status === 'paid') {
                fullyPaidCount++;

                // Calculate days to payment (from issue date to last payment date)
                if (inv.payments && inv.payments.length > 0) {
                    // Sort payments by date to find the final payment
                    const sortedPayments = [...inv.payments].sort((a, b) => b.date.toMillis() - a.date.toMillis());
                    const lastPaymentDate = sortedPayments[0].date.toDate();
                    const issueDate = inv.date.toDate();

                    const diffTime = Math.abs(lastPaymentDate.getTime() - issueDate.getTime());
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    totalDaysToPayment += diffDays;
                }
            }
        });

        const collectionRate = validInvoicesForCollectionRate > 0
            ? (fullyPaidCount / validInvoicesForCollectionRate) * 100
            : 0;

        const averageDaysToPayment = fullyPaidCount > 0
            ? Math.round(totalDaysToPayment / fullyPaidCount)
            : 0;

        return {
            totalRevenue,
            outstanding,
            paidThisMonth,
            overdue,
            averageDaysToPayment,
            collectionRate
        };
    }, [invoices]);

    // Generate Invoice Number (Format: INV-YYYY-MM-XXXX)
    const generateInvoiceNumber = async (): Promise<string> => {
        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const prefix = `INV-${year}-${month}-`;

        // Query to find the latest invoice matching this prefix
        const q = query(
            collection(db, 'invoices'),
            orderBy('invoiceNumber', 'desc'),
            limit(1)
        );

        try {
            const snapshot = await getDocs(q);
            if (!snapshot.empty) {
                const latestDoc = snapshot.docs[0].data();
                if (latestDoc.invoiceNumber && latestDoc.invoiceNumber.startsWith(prefix)) {
                    const lastNumStr = latestDoc.invoiceNumber.split('-').pop();
                    const lastNum = parseInt(lastNumStr || '0', 10);
                    const nextNum = String(lastNum + 1).padStart(4, '0');
                    return `${prefix}${nextNum}`;
                }
            }
        } catch (e) {
            console.warn("Could not fetch latest invoice number, falling back to random.", e);
        }

        // Fallback or first invoice of the month
        const randomStr = Math.floor(1000 + Math.random() * 9000).toString();
        return `${prefix}${randomStr}`;
    };

    const createInvoice = async (invoiceData: Omit<Invoice, 'id' | 'createdAt' | 'updatedAt' | 'invoiceNumber'>) => {
        if (!currentUser) throw new Error("Must be logged in to create invoice");

        try {
            const invoiceNumber = await generateInvoiceNumber();

            const newInvoice = {
                ...invoiceData,
                invoiceNumber,
                createdBy: currentUser.uid,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            };

            const docRef = await addDoc(collection(db, 'invoices'), newInvoice);
            return docRef.id;
        } catch (err: any) {
            console.error("Error creating invoice:", err);
            throw err;
        }
    };

    const updateInvoiceStatus = async (id: string, status: InvoiceStatus) => {
        try {
            const docRef = doc(db, 'invoices', id);
            await updateDoc(docRef, {
                status,
                updatedAt: serverTimestamp()
            });
        } catch (err: any) {
            console.error("Error updating invoice status:", err);
            throw err;
        }
    };

    const addPayment = async (id: string, paymentData: Omit<InvoicePayment, 'id'>) => {
        const invoice = invoices.find(inv => inv.id === id);
        if (!invoice) throw new Error("Invoice not found");

        try {
            const newPaymentId = Math.random().toString(36).substring(2, 9);
            const payment: InvoicePayment = {
                ...paymentData,
                id: newPaymentId
            };

            const updatedPayments = [...(invoice.payments || []), payment];
            const totalPaid = updatedPayments.reduce((sum, p) => sum + p.amount, 0);

            // Auto-update status if fully paid
            let newStatus = invoice.status;
            // Provide a small buffer for precision errors in floats
            if (totalPaid >= invoice.total - 0.01 && invoice.status !== 'paid') {
                newStatus = 'paid';
            }

            const docRef = doc(db, 'invoices', id);
            await updateDoc(docRef, {
                payments: updatedPayments,
                status: newStatus,
                updatedAt: serverTimestamp()
            });
        } catch (err: any) {
            console.error("Error adding payment:", err);
            throw err;
        }
    };

    const deleteInvoice = async (id: string) => {
        try {
            await deleteDoc(doc(db, 'invoices', id));
        } catch (err: any) {
            console.error("Error deleting invoice:", err);
            throw err;
        }
    };

    return {
        invoices,
        loading,
        error,
        analytics,
        createInvoice,
        updateInvoiceStatus,
        addPayment,
        deleteInvoice
    };
};
