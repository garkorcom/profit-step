import type {
  WorkerId,
  ClientId,
  SessionId,
  ExpenseId,
  ProjectId,
} from './shared-ids';

export const Routes = {
  dashboard: () => '/dashboard',
  audit: () => '/audit',

  time: {
    home: () => '/time',
    sessions: () => '/time/sessions',
    session: (id: SessionId) => `/time/sessions/${id}`,
    my: () => '/time/my',
    approvals: () => '/time/approvals',
  },

  expenses: {
    home: () => '/expenses',
    submit: () => '/expenses/submit',
    my: () => '/expenses/my',
    approvals: () => '/expenses/approvals',
    detail: (id: ExpenseId) => `/expenses/${id}`,
  },

  clients: {
    home: () => '/clients',
    overview: (id: ClientId) => `/clients/${id}`,
    costs: (id: ClientId) => `/clients/${id}/costs`,
    billing: (id: ClientId) => `/clients/${id}/billing`,
  },

  projects: {
    detail: (id: ProjectId) => `/projects/${id}`,
  },

  workers: {
    home: () => '/workers',
    profile: (id: WorkerId) => `/workers/${id}`,
    payouts: (id: WorkerId) => `/workers/${id}/payouts`,
    myBalance: () => '/my-balance',
  },
} as const;
