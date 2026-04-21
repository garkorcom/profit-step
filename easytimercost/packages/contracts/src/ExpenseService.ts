import type {
  ExpenseId,
  WorkerId,
  ClientId,
  SessionId,
  ProjectId,
} from './shared-ids';
import type { Period } from './period';

export type ExpenseCategory =
  | 'materials'
  | 'fuel'
  | 'tools'
  | 'subcontractor'
  | 'meals'
  | 'lodging'
  | 'permits'
  | 'equipment_rental'
  | 'mileage'
  | 'per_diem'
  | 'other';

export type ExpenseStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'paid';

export interface Receipt {
  readonly url: string;
  readonly uploadedAt: Date;
  readonly ocrVendor?: string;
  readonly ocrAmount?: number;
  readonly ocrDate?: Date;
}

export interface Expense {
  readonly id: ExpenseId;
  readonly workerId: WorkerId;
  readonly clientId?: ClientId;
  readonly projectId?: ProjectId;
  readonly sessionId?: SessionId;
  readonly category: ExpenseCategory;
  readonly amount: number;
  readonly currency: string;
  readonly description: string;
  readonly status: ExpenseStatus;
  readonly billable: boolean;
  readonly reimbursable: boolean;
  readonly submittedAt?: Date;
  readonly approvedAt?: Date;
  readonly approvedBy?: WorkerId;
  readonly rejectedAt?: Date;
  readonly rejectedReason?: string;
  readonly paidAt?: Date;
  readonly receipt?: Receipt;
}

export interface ExpenseInput {
  readonly workerId: WorkerId;
  readonly clientId?: ClientId;
  readonly projectId?: ProjectId;
  readonly sessionId?: SessionId;
  readonly category: ExpenseCategory;
  readonly amount: number;
  readonly currency: string;
  readonly description: string;
  readonly billable: boolean;
  readonly reimbursable: boolean;
  readonly receiptUrl?: string;
}

export interface ExpenseService {
  getExpense(id: ExpenseId): Promise<Expense | null>;
  listByWorker(workerId: WorkerId, period: Period): Promise<Expense[]>;
  listByClient(clientId: ClientId, period: Period): Promise<Expense[]>;
  listBySession(sessionId: SessionId): Promise<Expense[]>;
  listPendingApproval(filter?: { approverId?: WorkerId }): Promise<Expense[]>;

  sumMaterialsCostByClient(clientId: ClientId, period: Period): Promise<number>;
  sumReimbursableByWorker(workerId: WorkerId, period: Period): Promise<number>;

  submit(input: ExpenseInput): Promise<ExpenseId>;
  approve(id: ExpenseId, approver: WorkerId): Promise<void>;
  reject(id: ExpenseId, approver: WorkerId, reason: string): Promise<void>;
  markPaid(id: ExpenseId): Promise<void>;
}
