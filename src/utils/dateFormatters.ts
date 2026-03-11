import { Timestamp } from 'firebase/firestore';
/**
 * Formats duration in minutes to human-readable string (Xh Ym)
 */
export function formatDuration(minutes?: number): string {
    if (!minutes && minutes !== 0) return '-';
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    if (hours === 0) return `${mins}m`;
    return `${hours}h ${mins}m`;
}

const TIMEZONE = 'America/New_York';

/**
 * Formats Firestore Timestamp to date string (Jan 10, 2026) in Miami Time
 */
export function formatDate(timestamp?: Timestamp): string {
    if (!timestamp) return '-';
    return new Intl.DateTimeFormat('en-US', {
        timeZone: TIMEZONE,
        month: 'short',
        day: '2-digit',
        year: 'numeric'
    }).format(timestamp.toDate());
}

/**
 * Formats Firestore Timestamp to time string (14:30) in Miami Time
 */
export function formatTime(timestamp?: Timestamp): string {
    if (!timestamp) return '-';
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: TIMEZONE,
        hour: '2-digit',
        minute: '2-digit'
    }).format(timestamp.toDate());
}

/**
 * Returns MUI color for session status
 */
export function getStatusColor(status: string, type?: string): 'success' | 'warning' | 'info' | 'error' | 'default' {
    if (type === 'correction') return 'info';
    if (type === 'manual_adjustment') return 'info';

    switch (status) {
        case 'active': return 'success';
        case 'paused': return 'warning';
        case 'completed': return 'default';
        case 'auto_closed': return 'error';
        default: return 'default';
    }
}
