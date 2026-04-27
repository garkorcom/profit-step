/**
 * Barrel for `tasktotime/adapters/external/*`.
 *
 * External-service adapters — one per non-Firestore port. Composition root
 * imports from this module. Mirrors the firestore-side barrel layout: one
 * named export per adapter, no default exports.
 *
 * Mapping → spec/04-storage/adapter-mapping.md:
 *   §18 TelegramNotifyPort      → TelegramNotifyAdapter
 *   §19 EmailNotifyPort         → BrevoEmailNotifyAdapter
 *   §20 PushNotifyPort          → FCMPushNotifyAdapter
 *   §21 BigQueryAuditPort       → BigQueryAuditAdapter
 *   §22 StorageUploadPort       → FirebaseStorageUploadAdapter
 *   §23 WeatherForecastPort     → MockWeatherForecastAdapter (placeholder, real NOAA in PR-B)
 */

export { TelegramNotifyAdapter, escapeHTML } from './TelegramNotifyAdapter';
export { BrevoEmailNotifyAdapter } from './BrevoEmailNotifyAdapter';
export { FCMPushNotifyAdapter } from './FCMPushNotifyAdapter';
export {
  BigQueryAuditAdapter,
  DEFAULT_DATASET_ID,
  DEFAULT_TABLE_ID,
} from './BigQueryAuditAdapter';
export type {
  BigQueryLike,
  BigQueryAuditAdapterDeps,
} from './BigQueryAuditAdapter';
export { FirebaseStorageUploadAdapter } from './FirebaseStorageUploadAdapter';
export { MockWeatherForecastAdapter } from './MockWeatherForecastAdapter';

export { GooglePubSubAdapter } from './PubSubAdapter';
export type { PubSubLike, PubSubAdapterDeps } from './PubSubAdapter';
