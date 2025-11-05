import { Timestamp } from 'firebase/firestore';
import { UserRole } from './user.types';

/**
 * System-level collections (Super Admin)
 */

export interface SystemError {
  errorId: string;
  functionName: string;
  errorMessage: string;
  stackTrace: string;
  userId?: string;
  timestamp: Timestamp;
}

export interface EmailEvent {
  eventId: string;
  email: string;
  eventType: 'sent' | 'delivered' | 'opened' | 'bounced' | 'spam' | 'unsubscribed';
  messageId: string;
  reason?: string;
  timestamp: Timestamp;
}

export interface CostReport {
  date: string; // YYYY-MM-DD
  totalCost: number;
  breakdown: {
    functions: number;
    firestore: number;
    storage: number;
    auth: number;
  };
}

export interface GrowthMetrics {
  date: string; // YYYY-MM-DD
  newUsers: number;
  newCompanies: number;
  totalUsers: number;
  totalCompanies: number;
}

export interface EngagementMetrics {
  date: string; // YYYY-MM-DD
  dau: number; // Daily Active Users
  wau: number; // Weekly Active Users
  mau: number; // Monthly Active Users
  stickiness: number; // DAU/MAU ratio (0-1)
}

/**
 * Company-level collections
 */

export type InvitationStatus = 'pending' | 'delivered' | 'opened' | 'accepted' | 'failed' | 'expired';

export interface Invitation {
  inviteId: string;
  companyId: string;
  email: string;
  role: UserRole;
  invitedBy: string; // userId
  sentAt: Timestamp;
  status: InvitationStatus;
  deliveryStatus?: string;
  acceptedAt?: Timestamp;
  expiresAt: Timestamp;
}

export type ActivityAction =
  | 'user_joined'
  | 'user_left'
  | 'role_changed'
  | 'profile_updated'
  | 'avatar_uploaded'
  | 'user_deactivated'
  | 'user_activated'
  | 'user_deleted'
  | 'invitation_sent'
  | 'invitation_accepted'
  | 'project_created'
  | 'project_updated'
  | 'document_uploaded';

export interface ActivityLog {
  activityId: string;
  companyId: string;
  userId: string; // user affected by the action
  actorId: string; // user who performed the action
  action: ActivityAction;
  metadata: Record<string, any>;
  timestamp: Timestamp;
}

export interface UserActivation {
  userId: string;
  signupCompleted: Timestamp;
  profileCompleted?: Timestamp;
  avatarUploaded?: Timestamp;
  firstInviteSent?: Timestamp;
  firstProjectCreated?: Timestamp;
  activatedAt?: Timestamp; // when all steps completed
}

export interface FeatureUsage {
  userId: string;
  feature: string;
  firstUsedAt: Timestamp;
  lastUsedAt: Timestamp;
  usageCount: number;
}

/**
 * Dashboard Metrics (aggregated data for frontend)
 */

export interface SystemHealthMetrics {
  errorRate24h: number;
  errorRate7d: number;
  errorRate30d: number;
  recentErrors: SystemError[];
  emailDeliveryRate: number;
  emailBounceRate: number;
  emailOpenRate: number;
  avgEmailLatency: number; // in seconds
  firestoreReadsPerSecond: number;
  firestoreWritesPerSecond: number;
  storageUsageGB: number;
}

export interface CostMetrics {
  dailyCosts: CostReport[];
  totalCostThisMonth: number;
  projectedMonthlyCost: number;
  costByCompany: Array<{
    companyId: string;
    companyName: string;
    cost: number;
  }>;
}

export interface GrowthData {
  newUsers: Array<{ date: string; count: number }>;
  newCompanies: Array<{ date: string; count: number }>;
  signupSources: Array<{ source: string; count: number }>;
  activationFunnel: Array<{ stage: string; count: number; percentage: number }>;
  avgTimeToActivation: number; // in hours
}

export interface EngagementData {
  currentDAU: number;
  currentWAU: number;
  currentMAU: number;
  stickiness: number;
  dauHistory: Array<{ date: string; dau: number }>;
  sessionFrequency: Array<{ bucket: string; count: number }>;
  profileCompletionRate: number;
  featureAdoption: Array<{ feature: string; adoptionRate: number }>;
}

export interface TeamOverviewMetrics {
  totalMembers: number;
  activeToday: number;
  pendingInvites: number;
  seatLimit?: number;
  roleDistribution: Array<{ role: UserRole; count: number }>;
  teamGrowth: Array<{ date: string; memberCount: number }>;
}

export interface ActivityFeedData {
  activities: ActivityLog[];
  topContributors: Array<{
    userId: string;
    displayName: string;
    photoURL?: string;
    actionCount: number;
  }>;
  activityHeatmap: Array<{
    day: number; // 0-6 (Sun-Sat)
    hour: number; // 0-23
    count: number;
  }>;
}
