/**
 * PubSubPort — fire-and-forget publishing to a topic.
 *
 * Used by `onTaskUpdate` to debounce-schedule a critical-path recompute
 * via the `recomputeCriticalPath` topic. The actual subscriber lives as a
 * Cloud Function (Pub/Sub triggered) and runs `handleRecomputeCriticalPath`.
 *
 * Conventions:
 *   - **Fire-and-forget.** Failure to publish MUST NOT block the trigger
 *     that called us. Implementations log warn and return without throwing.
 *   - The payload is JSON-serialisable. Adapters convert to bytes.
 *   - No DLQ contract here — that's the adapter's concern.
 */

export interface PubSubMessage {
  /** JSON-serialisable payload. */
  data: Record<string, unknown>;
  /** Optional attributes — used for filtering / routing on the subscriber. */
  attributes?: Record<string, string>;
  /** Optional ordering key (Pub/Sub ordered delivery). */
  orderingKey?: string;
}

export interface PubSubPort {
  /**
   * Publish to a topic. MUST NOT throw — fire-and-forget. Returns the
   * provider's messageId on success, or `null` if the publish was skipped
   * (e.g. adapter mocked / network unreachable).
   */
  publish(topic: string, message: PubSubMessage): Promise<string | null>;
}
