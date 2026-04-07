/**
 * Share API — wrapper around the agent API for client portal share tokens.
 *
 * Backend routes (see functions/src/agent/routes/sharing.ts):
 *   POST   /api/clients/:id/share-tokens
 *   GET    /api/clients/:id/share-tokens
 *   DELETE /api/clients/:id/share-tokens/:tokenId
 *
 * All routes require Firebase Auth (Bearer token). Only the POST
 * response contains the raw token — subsequent GET calls return only
 * a preview for safety.
 */

import { getAuth } from 'firebase/auth';

// ─── Config ──────────────────────────────────────────────────────────

const getApiUrl = (): string =>
  import.meta.env.VITE_FIREBASE_FUNCTIONS_URL ||
  'https://us-central1-profit-step.cloudfunctions.net/agentApi';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getAuth().currentUser?.getIdToken();
  if (!token) {
    throw new Error('Not authenticated. Please sign in again.');
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

// ─── Types ───────────────────────────────────────────────────────────

export interface CreateShareTokenRequest {
  /** Expiry in days (1–365, default 30) */
  expiresInDays?: number;
}

export interface CreateShareTokenResponse {
  tokenId: string;
  slug: string;
  /** Raw token — only returned here, never again */
  token: string;
  /** Relative URL: /portal/{slug}?token=... */
  url: string;
  /** ISO timestamp */
  expiresAt: string;
  expiresInDays: number;
}

export interface ShareTokenSummary {
  id: string;
  slug: string;
  createdBy: string;
  createdAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  useCount: number;
  /** First 6 chars of token + ellipsis, for UI reference only */
  tokenPreview: string;
  active: boolean;
}

export interface ListShareTokensResponse {
  tokens: ShareTokenSummary[];
  count: number;
}

// ─── API methods ─────────────────────────────────────────────────────

export const shareApi = {
  /**
   * Create a new share token for the given client.
   * The raw token is only returned once — display it immediately
   * and prompt the user to copy it.
   */
  async createToken(
    clientId: string,
    request: CreateShareTokenRequest = {}
  ): Promise<CreateShareTokenResponse> {
    const headers = await getAuthHeaders();
    const res = await fetch(`${getApiUrl()}/api/clients/${encodeURIComponent(clientId)}/share-tokens`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Failed to create share token: HTTP ${res.status}${body ? ` — ${body}` : ''}`);
    }
    return res.json() as Promise<CreateShareTokenResponse>;
  },

  /** List all (active + revoked + expired) tokens for a client. */
  async listTokens(clientId: string): Promise<ListShareTokensResponse> {
    const headers = await getAuthHeaders();
    const res = await fetch(`${getApiUrl()}/api/clients/${encodeURIComponent(clientId)}/share-tokens`, {
      method: 'GET',
      headers,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Failed to list share tokens: HTTP ${res.status}${body ? ` — ${body}` : ''}`);
    }
    return res.json() as Promise<ListShareTokensResponse>;
  },

  /** Revoke a token immediately (sets revokedAt timestamp). */
  async revokeToken(clientId: string, tokenId: string): Promise<{ ok: boolean; alreadyRevoked?: boolean }> {
    const headers = await getAuthHeaders();
    const res = await fetch(
      `${getApiUrl()}/api/clients/${encodeURIComponent(clientId)}/share-tokens/${encodeURIComponent(tokenId)}`,
      {
        method: 'DELETE',
        headers,
      }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Failed to revoke share token: HTTP ${res.status}${body ? ` — ${body}` : ''}`);
    }
    return res.json() as Promise<{ ok: boolean; alreadyRevoked?: boolean }>;
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Build an absolute portal URL from a slug + token. Uses window.origin
 * so it works in dev (localhost) and prod (profit-step.web.app).
 */
export function buildPortalUrl(slug: string, token: string): string {
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  return `${base}/portal/${encodeURIComponent(slug)}?token=${encodeURIComponent(token)}`;
}
