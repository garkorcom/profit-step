/**
 * Route Context — shared dependencies for all route modules
 */
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

export const db = admin.firestore();
export const FieldValue = admin.firestore.FieldValue;
export const Timestamp = admin.firestore.Timestamp;
export const logger = functions.logger;

// Re-export helpers
export {
  getCachedClients,
  fuzzySearchClient,
  searchClientByAddress,
  autoCreateClientByAddress,
  logAgentActivity,
  resolveOwnerCompanyId,
  COST_CATEGORY_LABELS,
} from './agentHelpers';

// eslint-disable-next-line @typescript-eslint/no-var-requires
export const Fuse = require('fuse.js');
