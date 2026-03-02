import { Timestamp } from 'firebase/firestore';

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';

export interface InvoiceLineItem {
    id: string; // Unique ID for the line item to help in React rendering
    description: string;
    quantity: number;
    rate: number;
    amount: number;
}

export interface InvoicePayment {
    id: string;
    amount: number;
    date: Timestamp;
    method: 'cash' | 'check' | 'card' | 'bank_transfer' | 'other';
    notes?: string;
}

export interface Invoice {
    id: string;
    invoiceNumber: string; // e.g. "INV-2026-001"
    clientId: string;
    clientName: string;

    date: Timestamp; // issue date
    dueDate: Timestamp; // deadline for payment

    lineItems: InvoiceLineItem[];
    subtotal: number;
    taxRate: number; // percentage
    taxAmount: number;
    total: number;

    status: InvoiceStatus;
    payments: InvoicePayment[];

    notes?: string;

    // Tracking Metadata
    createdAt: Timestamp;
    updatedAt: Timestamp;
    createdBy: string; // User ID who created the invoice
}

// Analytics output type
export interface InvoiceAnalytics {
    totalRevenue: number; // Sum of ALL non-cancelled invoice totals
    outstanding: number; // Sum of unpaid amounts for sent/overdue invoices
    paidThisMonth: number; // Sum of payments made in the current calendar month
    overdue: number; // Sum of unpaid amounts for overdue invoices
    averageDaysToPayment: number; // Average days between issue and full payment
    collectionRate: number; // (Paid invoices count / Total non-cancelled invoices count) * 100
}
