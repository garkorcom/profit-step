/**
 * Warehouse providers — production wiring for external services.
 */

export {
  SerpApiWebSearchProvider,
  toCandidate as serpApiToCandidate,
  scoreTitleAgainstQuery,
  type SerpApiOptions,
} from './serpApiProvider';

export {
  SendGridRFQEmailProvider,
  buildSendGridPayload,
  type SendGridOptions,
} from './sendGridProvider';

export { FirestoreWebSearchCache } from './firestoreCache';

export {
  getWebSearchProvider,
  getWebSearchCache,
  getRFQEmailProvider,
  getDefaultRFQComposeOptions,
  __resetProvidersForTests,
} from './factory';
