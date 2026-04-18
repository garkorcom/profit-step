/**
 * Provider factory — env-driven selection with safe fallback to stubs.
 *
 * Rules:
 *   - Production keys present → use production provider
 *   - Keys missing           → return in-memory stub so tests/dev don't break
 *
 * The factory never throws on missing keys. It logs a one-time notice
 * and continues with the stub, which returns empty results.
 */

import type * as admin from 'firebase-admin';
import { logger } from 'firebase-functions';

import {
  InMemoryWebSearchProvider,
  InMemoryWebSearchCache,
  type WebSearchCache,
  type WebSearchProvider,
} from '../capabilities/webSearchItem';
import { InMemoryRFQEmailProvider, type RFQEmailProvider } from '../capabilities/sendVendorRFQ';
import { SerpApiWebSearchProvider } from './serpApiProvider';
import { SendGridRFQEmailProvider } from './sendGridProvider';
import { FirestoreWebSearchCache } from './firestoreCache';

// ═══════════════════════════════════════════════════════════════════
//  Web search
// ═══════════════════════════════════════════════════════════════════

let _webSearchProvider: WebSearchProvider | null = null;

export function getWebSearchProvider(overrideApiKey?: string): WebSearchProvider {
  if (_webSearchProvider) return _webSearchProvider;
  const key = overrideApiKey ?? process.env.SERPAPI_API_KEY ?? '';
  if (key) {
    _webSearchProvider = new SerpApiWebSearchProvider({ apiKey: key });
    logger.info('warehouse/providers: SerpApi web-search provider ACTIVE');
  } else {
    _webSearchProvider = new InMemoryWebSearchProvider();
    logger.warn('warehouse/providers: SerpApi key missing → using InMemory stub (dev mode)');
  }
  return _webSearchProvider;
}

export function getWebSearchCache(
  db?: admin.firestore.Firestore,
): WebSearchCache {
  if (db) return new FirestoreWebSearchCache(db);
  return new InMemoryWebSearchCache();
}

// ═══════════════════════════════════════════════════════════════════
//  RFQ email
// ═══════════════════════════════════════════════════════════════════

let _rfqEmailProvider: RFQEmailProvider | null = null;

export function getRFQEmailProvider(overrideApiKey?: string): RFQEmailProvider {
  if (_rfqEmailProvider) return _rfqEmailProvider;
  const key = overrideApiKey ?? process.env.SENDGRID_API_KEY ?? '';
  if (key) {
    _rfqEmailProvider = new SendGridRFQEmailProvider({ apiKey: key });
    logger.info('warehouse/providers: SendGrid RFQ provider ACTIVE');
  } else {
    _rfqEmailProvider = new InMemoryRFQEmailProvider();
    logger.warn('warehouse/providers: SendGrid key missing → using InMemory stub (dev mode)');
  }
  return _rfqEmailProvider;
}

// ═══════════════════════════════════════════════════════════════════
//  Default RFQ compose options (sender domain must be SendGrid-verified)
// ═══════════════════════════════════════════════════════════════════

export function getDefaultRFQComposeOptions(): { fromAddress: string; replyToAddress: string } {
  const addr = process.env.RFQ_FROM_ADDRESS || 'rfq@profit-step.com';
  return { fromAddress: addr, replyToAddress: addr };
}

// ═══════════════════════════════════════════════════════════════════
//  Reset (tests only)
// ═══════════════════════════════════════════════════════════════════

export function __resetProvidersForTests(): void {
  _webSearchProvider = null;
  _rfqEmailProvider = null;
}
