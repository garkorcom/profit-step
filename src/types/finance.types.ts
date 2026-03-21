import { Timestamp } from 'firebase/firestore';

// ── Cost Categories (canonical source — used by bot, CRM, reports) ──────────

export const COST_CATEGORIES = [
    { id: 'materials', label: '🧱 Materials', color: '#1976d2' },
    { id: 'tools', label: '🔧 Tools', color: '#0288d1' },
    { id: 'reimbursement', label: '💵 Reimbursement', color: '#4caf50' },
    { id: 'fuel', label: '⛽ Fuel', color: '#ff9800' },
    { id: 'housing', label: '🏠 Housing', color: '#9c27b0' },
    { id: 'food', label: '🍔 Food', color: '#795548' },
    { id: 'permit', label: '📋 Permit', color: '#f44336' },
    { id: 'other', label: '📦 Other', color: '#607d8b' },
] as const;

export type CostCategoryId = (typeof COST_CATEGORIES)[number]['id'];

// ── Cost Entry (Firestore: costs collection) ────────────────────────────────

export interface CostEntry {
    id: string;
    userId: string;
    userName: string;
    clientId: string;
    clientName: string;
    category: string;
    categoryLabel: string;
    amount: number;
    originalAmount: number;
    receiptPhotoUrl: string;
    description?: string;
    voiceNoteUrl?: string;
    createdAt: Timestamp;
    status: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export const getCategoryLabel = (categoryId: string): string => {
    const cat = COST_CATEGORIES.find(c => c.id === categoryId);
    return cat?.label || categoryId;
};

export const getCategoryColor = (
    categoryId: string,
): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' => {
    switch (categoryId) {
        case 'reimbursement': return 'success';
        case 'materials': return 'primary';
        case 'tools': return 'info';
        case 'fuel': return 'warning';
        case 'housing': return 'secondary';
        case 'food': return 'default';
        case 'permit': return 'error';
        default: return 'default';
    }
};

export const getCategoryHexColor = (categoryId: string): string => {
    const cat = COST_CATEGORIES.find(c => c.id === categoryId);
    return cat?.color || '#607d8b';
};
