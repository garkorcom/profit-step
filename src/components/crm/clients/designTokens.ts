/**
 * Shared design tokens for the clients list — aligned with Client Card V2
 * palette (ClientHeaderV2.tsx). Flat MUI-native look, no gradients.
 */

import {
    LifecycleStage,
    ClientSegment,
} from '../../../types/crm.types';
import { HealthBand } from '../../../hooks/useClientDashboard';

export const LIFECYCLE_LABELS: Record<LifecycleStage, string> = {
    lead: 'Лид',
    prospect: 'Потенциал',
    active: 'Активный',
    repeat: 'Повторный',
    vip: 'VIP',
    churned: 'Ушёл',
};

export const LIFECYCLE_CHIP_COLOR: Record<
    LifecycleStage,
    'default' | 'primary' | 'success' | 'warning' | 'error' | 'secondary'
> = {
    lead: 'default',
    prospect: 'primary',
    active: 'success',
    repeat: 'secondary',
    vip: 'warning',
    churned: 'error',
};

export const SEGMENT_COLOR: Record<ClientSegment, string> = {
    A: '#4caf50',
    B: '#2196f3',
    C: '#9e9e9e',
    VIP: '#ff9800',
};

export const HEALTH_BAND_COLOR: Record<HealthBand, string> = {
    excellent: '#4caf50',
    good: '#8bc34a',
    fair: '#ff9800',
    poor: '#f44336',
};

export const HEALTH_BAND_LABEL: Record<HealthBand, string> = {
    excellent: 'Отличный',
    good: 'Хороший',
    fair: 'Средний',
    poor: 'Плохой',
};

export const LIFECYCLE_ORDER: LifecycleStage[] = [
    'lead',
    'prospect',
    'active',
    'repeat',
    'vip',
    'churned',
];

export function formatUsd(n: number | null | undefined, short = false): string {
    if (n === null || n === undefined) return '—';
    if (short && Math.abs(n) >= 1000) {
        return `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
    }
    return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export function formatSmartDate(timestampSecs?: number): string {
    if (!timestampSecs) return '';
    const date = new Date(timestampSecs * 1000);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
        return `Сегодня ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    if (date.toDateString() === yesterday.toDateString()) {
        return `Вчера ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export function daysSinceTs(ts?: { toMillis: () => number } | null): number | null {
    if (!ts) return null;
    const DAY = 24 * 60 * 60 * 1000;
    return Math.floor((Date.now() - ts.toMillis()) / DAY);
}
