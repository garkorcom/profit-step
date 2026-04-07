/**
 * @fileoverview Types and constants for UnifiedCockpitPage sub-components.
 * @module components/cockpit/cockpit.types
 */

import { GTDStatus, GTDPriority } from '../../types/gtd.types';

// ─── Helper Types ─────────────────────────────────────────

export interface CockpitUser {
  id: string;
  displayName: string;
  avatarUrl?: string;
}

export interface CockpitClient {
  id: string;
  name: string;
}

export interface CoAssignee {
  id: string;
  name: string;
  role: 'executor' | 'reviewer' | 'observer';
}

// ─── Blueprint Types ──────────────────────────────────────

export const BLUEPRINT_SECTIONS = [
  { key: 'electrical', label: 'Electrical', icon: '⚡' },
  { key: 'plumbing', label: 'Plumbing', icon: '🔧' },
  { key: 'mechanical', label: 'Mechanical', icon: '⚙️' },
  { key: 'architectural', label: 'Architectural', icon: '🏗️' },
  { key: 'fire', label: 'Fire', icon: '🔥' },
  { key: 'general', label: 'General', icon: '📄' },
] as const;

export type BlueprintSection = typeof BLUEPRINT_SECTIONS[number]['key'];

export interface BlueprintFile {
  id: string;
  name: string;
  path: string;
  url: string;
  size: number;
  contentType: string;
  description: string;
  version: number;
  uploadedBy: string;
  uploadedAt: string | null;
  section?: string;
}

// ─── Status / Priority Constants ──────────────────────────

export const STATUS_OPTIONS: { value: GTDStatus; label: string; color: string }[] = [
  { value: 'inbox', label: 'Inbox', color: '#9e9e9e' },
  { value: 'next_action', label: 'Next Actions', color: '#2196f3' },
  { value: 'projects', label: 'Projects', color: '#ff9800' },
  { value: 'waiting', label: 'Waiting', color: '#9c27b0' },
  { value: 'estimate', label: 'Estimate', color: '#00bcd4' },
  { value: 'done', label: 'Done', color: '#00c853' },
];

export const PRIORITY_OPTIONS: { value: GTDPriority; label: string; color: string }[] = [
  { value: 'none', label: 'None', color: '#9e9e9e' },
  { value: 'low', label: 'Low', color: '#3b82f6' },
  { value: 'medium', label: 'Medium', color: '#f59e0b' },
  { value: 'high', label: 'High', color: '#ef4444' },
];

// ─── Estimate Status Maps ─────────────────────────────────

export const ESTIMATE_STATUS_COLORS: Record<string, string> = {
  draft: '#9e9e9e',
  sent: '#2196f3',
  approved: '#4caf50',
  rejected: '#f44336',
  converted: '#ff9800',
  locked: '#795548',
};

export const ESTIMATE_STATUS_LABELS: Record<string, string> = {
  draft: 'Черновик',
  sent: 'Отправлено',
  approved: 'Одобрено',
  rejected: 'Отклонено',
  converted: 'Конвертировано',
  locked: 'Заблокировано',
};
