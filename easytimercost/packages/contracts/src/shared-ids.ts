export type WorkerId  = string & { readonly __brand: 'WorkerId' };
export type ClientId  = string & { readonly __brand: 'ClientId' };
export type SessionId = string & { readonly __brand: 'SessionId' };
export type ExpenseId = string & { readonly __brand: 'ExpenseId' };
export type ProjectId = string & { readonly __brand: 'ProjectId' };
export type PayoutId  = string & { readonly __brand: 'PayoutId' };
export type CompanyId = string & { readonly __brand: 'CompanyId' };

export const asWorkerId  = (s: string) => s as WorkerId;
export const asClientId  = (s: string) => s as ClientId;
export const asSessionId = (s: string) => s as SessionId;
export const asExpenseId = (s: string) => s as ExpenseId;
export const asProjectId = (s: string) => s as ProjectId;
export const asPayoutId  = (s: string) => s as PayoutId;
export const asCompanyId = (s: string) => s as CompanyId;
