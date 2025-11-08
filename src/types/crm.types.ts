/**
 * CRM Types - Company (Client) Management
 */

import { Timestamp, DocumentSnapshot } from 'firebase/firestore';

export interface Company {
  id: string;

  // Основные данные
  name: string;
  name_lowercase: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;

  // Системные поля
  isArchived: boolean;
  createdAt: Timestamp | string;
  updatedAt: Timestamp | string;

  // Владелец
  ownerCompanyId: string;
}

export interface PaginatedCompaniesResult {
  companies: Company[];
  firstDoc: DocumentSnapshot | null;
  lastDoc: DocumentSnapshot | null;
  reads: number;
  duration?: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export type CompanyStatus = 'active' | 'archived' | 'all';
