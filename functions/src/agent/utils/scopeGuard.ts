/**
 * Scope Guard — centralized permission constants and middleware helper.
 *
 * Usage in routes:
 *   import { requireScope, SCOPES } from '../utils/scopeGuard';
 *
 *   router.get('/api/foo', requireScope('finance:read'), async (req, res) => { ... });
 *   router.post('/api/bar', requireScope('costs:write', 'admin'), async (req, res) => { ... });
 */
import { Request, Response, NextFunction } from 'express';

// ─── Scope Constants ──────────────────────────────────────────────────

export const SCOPES = {
  // Admin wildcard
  ADMIN: 'admin',

  // Tasks
  TASKS_READ: 'tasks:read',
  TASKS_WRITE: 'tasks:write',

  // Time tracking
  TIME_READ: 'time:read',
  TIME_WRITE: 'time:write',

  // Costs
  COSTS_READ: 'costs:read',
  COSTS_WRITE: 'costs:write',

  // Files
  FILES_READ: 'files:read',
  FILES_WRITE: 'files:write',

  // Inventory
  INVENTORY_READ: 'inventory:read',
  INVENTORY_WRITE: 'inventory:write',

  // Finance
  FINANCE_READ: 'finance:read',
  FINANCE_WRITE: 'finance:write',

  // Payroll
  PAYROLL_READ: 'payroll:read',
  PAYROLL_WRITE: 'payroll:write',

  // Team management
  TEAM_READ: 'team:read',
  TEAM_WRITE: 'team:write',

  // User management
  USERS_READ: 'users:read',
  USERS_MANAGE: 'users:manage',

  // Webhooks
  WEBHOOKS_READ: 'webhooks:read',
  WEBHOOKS_MANAGE: 'webhooks:manage',
} as const;

export type Scope = typeof SCOPES[keyof typeof SCOPES];

// ─── Has Scope Check ──────────────────────────────────────────────────

/**
 * Check if a user's scopes include a required scope.
 * The 'admin' scope is a wildcard — grants access to everything.
 */
export function hasScope(userScopes: string[] | undefined, required: string): boolean {
  if (!userScopes || userScopes.length === 0) return false;
  if (userScopes.includes(SCOPES.ADMIN)) return true;
  return userScopes.includes(required);
}

/**
 * Check if user has ANY of the given scopes (OR logic).
 */
export function hasAnyScope(userScopes: string[] | undefined, required: string[]): boolean {
  return required.some(scope => hasScope(userScopes, scope));
}

// ─── Middleware ────────────────────────────────────────────────────────

/**
 * Express middleware that checks if the request has ANY of the required scopes.
 * Returns 403 if none match. 'admin' scope always passes.
 *
 * @param scopes One or more scope strings — user needs at least one (OR)
 *
 * Usage:
 *   router.get('/api/secret', requireScope('finance:read'), handler);
 *   router.post('/api/admin-only', requireScope('admin'), handler);
 *   router.get('/api/flexible', requireScope('finance:read', 'costs:read'), handler);
 */
export function requireScope(...scopes: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userScopes = req.effectiveScopes;

    if (hasAnyScope(userScopes, scopes)) {
      next();
      return;
    }

    const role = req.effectiveRole || 'unknown';
    res.status(403).json({
      error: `Forbidden: requires scope ${scopes.join(' or ')}`,
      code: 'INSUFFICIENT_SCOPE',
      currentRole: role,
      requiredScopes: scopes,
    });
  };
}
