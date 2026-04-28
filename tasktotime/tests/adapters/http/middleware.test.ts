/**
 * `attachAuthContext` middleware tests — pin the JWT header-spoof guard.
 *
 * Cross-tenant read leak (QA 2026-04-27 P0): a browser user could pass
 * `x-company-id: <victim-uid>` and get LIST results scoped to the victim
 * company. The fix: ignore the header for JWT tokens, honour it only for
 * master/employee tokens (server-to-server impersonation paths).
 */

import type { Request, Response, NextFunction } from 'express';

import { attachAuthContext } from '../../../adapters/http/middleware';

function makeReq(opts: {
  agentUserId?: string;
  agentUserName?: string;
  agentTokenType?: 'master' | 'employee' | 'jwt';
  effectiveUserId?: string;
  effectiveTeamId?: string | null;
  headers?: Record<string, string>;
}): Request {
  const headers = opts.headers ?? {};
  return {
    agentUserId: opts.agentUserId,
    agentUserName: opts.agentUserName,
    agentTokenType: opts.agentTokenType,
    effectiveUserId: opts.effectiveUserId,
    effectiveTeamId: opts.effectiveTeamId,
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

const noopRes = {} as Response;

describe('attachAuthContext — companyId resolution by tokenType', () => {
  test('JWT token: x-company-id header IGNORED (P0 fix — spoof guard)', () => {
    const req = makeReq({
      agentUserId: 'attacker_uid',
      agentUserName: 'Attacker',
      agentTokenType: 'jwt',
      effectiveUserId: 'attacker_uid',
      effectiveTeamId: null,
      headers: { 'x-company-id': 'victim_uid' },
    });
    const next = jest.fn();
    attachAuthContext(req, noopRes, next as NextFunction);
    expect(next).toHaveBeenCalledWith();
    expect(req.auth?.companyId).toBe('attacker_uid');
    expect(req.auth?.companyId).not.toBe('victim_uid');
  });

  test('JWT token: effectiveTeamId used over agentUserId when set (team membership flow)', () => {
    const req = makeReq({
      agentUserId: 'user_uid',
      agentUserName: 'User',
      agentTokenType: 'jwt',
      effectiveUserId: 'user_uid',
      effectiveTeamId: 'team_alpha',
      headers: { 'x-company-id': 'victim_uid' },
    });
    const next = jest.fn();
    attachAuthContext(req, noopRes, next as NextFunction);
    expect(req.auth?.companyId).toBe('team_alpha');
    expect(req.auth?.companyId).not.toBe('victim_uid');
  });

  test('JWT token: no header → companyId = agentUserId (default single-user tenant)', () => {
    const req = makeReq({
      agentUserId: 'user_uid',
      agentUserName: 'User',
      agentTokenType: 'jwt',
      effectiveUserId: 'user_uid',
      effectiveTeamId: null,
    });
    const next = jest.fn();
    attachAuthContext(req, noopRes, next as NextFunction);
    expect(req.auth?.companyId).toBe('user_uid');
  });

  test('master token: x-company-id header IS HONOURED (impersonation path)', () => {
    const req = makeReq({
      agentUserId: 'agent_owner_uid',
      agentUserName: 'Agent',
      agentTokenType: 'master',
      effectiveUserId: 'impersonated_uid',
      effectiveTeamId: null,
      headers: { 'x-company-id': 'company_xyz' },
    });
    const next = jest.fn();
    attachAuthContext(req, noopRes, next as NextFunction);
    expect(req.auth?.companyId).toBe('company_xyz');
    expect(req.auth?.tokenType).toBe('master');
  });

  test('employee token: x-company-id header IS HONOURED', () => {
    const req = makeReq({
      agentUserId: 'employee_uid',
      agentUserName: 'Employee',
      agentTokenType: 'employee',
      effectiveUserId: 'employee_uid',
      effectiveTeamId: null,
      headers: { 'x-company-id': 'employer_company' },
    });
    const next = jest.fn();
    attachAuthContext(req, noopRes, next as NextFunction);
    expect(req.auth?.companyId).toBe('employer_company');
  });

  test('master token: no header → falls back to effectiveTeamId then agentUserId', () => {
    const req = makeReq({
      agentUserId: 'agent_owner_uid',
      agentUserName: 'Agent',
      agentTokenType: 'master',
      effectiveUserId: 'agent_owner_uid',
      effectiveTeamId: null,
    });
    const next = jest.fn();
    attachAuthContext(req, noopRes, next as NextFunction);
    expect(req.auth?.companyId).toBe('agent_owner_uid');
  });

  test('missing userId → next(error) (express error path)', () => {
    const req = makeReq({
      agentTokenType: 'jwt',
      headers: { 'x-company-id': 'victim_uid' },
    });
    const next = jest.fn();
    attachAuthContext(req, noopRes, next as NextFunction);
    // Either: no userId derivable → AdapterError forwarded to next
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(req.auth).toBeUndefined();
  });
});
