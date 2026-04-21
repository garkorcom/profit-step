import type { WorkerId, PayoutId, CompanyId } from './shared-ids';
import type { Period } from './period';

export type WorkerRole =
  | 'admin'
  | 'cfo'
  | 'project_manager'
  | 'foreman'
  | 'worker'
  | 'driver'
  | 'guest';

export interface Worker {
  readonly id: WorkerId;
  readonly companyId: CompanyId;
  readonly email: string;
  readonly displayName: string;
  readonly role: WorkerRole;
  readonly hourlyRate?: number;
  readonly crewId?: WorkerId;
  readonly telegramId?: string;
  readonly active: boolean;
}

export interface WorkerBalance {
  readonly workerId: WorkerId;
  readonly period: Period;
  readonly earned: number;
  readonly adjustments: number;
  readonly payments: number;
  readonly salaryBalance: number;
  readonly reimbursableAccrued: number;
  readonly reimbursablePaid: number;
  readonly reimbursableBalance: number;
  readonly totalHours: number;
}

export interface Payout {
  readonly id: PayoutId;
  readonly workerId: WorkerId;
  readonly amount: number;
  readonly kind: 'salary' | 'reimbursement';
  readonly method: 'cash' | 'bank' | 'check';
  readonly paidAt: Date;
  readonly payPeriodStart: Date;
  readonly payPeriodEnd: Date;
  readonly notes?: string;
}

export interface WorkerFilter {
  readonly active?: boolean;
  readonly role?: WorkerRole;
  readonly crewId?: WorkerId;
}

export interface WorkerService {
  getWorker(id: WorkerId): Promise<Worker | null>;
  list(filter?: WorkerFilter): Promise<Worker[]>;
  resolveFromTelegramId(telegramId: string): Promise<Worker | null>;

  getBalance(id: WorkerId, period: Period): Promise<WorkerBalance>;
  listPayouts(id: WorkerId, period: Period): Promise<Payout[]>;

  recordPayout(input: Omit<Payout, 'id'>): Promise<PayoutId>;
}
