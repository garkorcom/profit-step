/**
 * PubSubAdapter — `PubSubPort` implementation backed by Google Cloud Pub/Sub.
 *
 * Adapter mapping: spec/05-api/triggers.md §recomputeCriticalPath. Used by
 * `onTaskUpdate` to debounce-schedule a critical-path recompute when the
 * graph topology or timing fields change.
 *
 * Conventions (per port contract):
 *   - **Fire-and-forget. MUST NEVER throw.** A publish failure cannot
 *     block the trigger that called us.
 *   - On error: log warn and return `null`. The cron / next change will
 *     produce another publish — eventual consistency.
 *
 * The `@google-cloud/pubsub` SDK is not a dep of the root workspace
 * (it lives in `functions/`), so this adapter takes a structural
 * `PubSubLike` interface. The composition root in `functions/` passes a
 * real `PubSub` instance — its public API is wider but structurally
 * compatible.
 */

import type { PubSubPort, PubSubMessage } from '../../ports/infra/PubSubPort';
import { type AdapterLogger, noopLogger } from '../firestore/_shared';

/**
 * Structural subset of `@google-cloud/pubsub#PubSub` used by this adapter.
 * The real client returns more from `publishMessage`, but `messageId` is
 * all we need.
 */
export interface PubSubLike {
  topic(name: string): {
    publishMessage(input: {
      data: Buffer;
      attributes?: Record<string, string>;
      orderingKey?: string;
    }): Promise<string>;
  };
}

export interface PubSubAdapterDeps {
  pubsub: PubSubLike;
  logger?: AdapterLogger;
}

export class GooglePubSubAdapter implements PubSubPort {
  private readonly pubsub: PubSubLike;
  private readonly logger: AdapterLogger;

  constructor(deps: PubSubAdapterDeps) {
    this.pubsub = deps.pubsub;
    this.logger = deps.logger ?? noopLogger;
  }

  async publish(topic: string, message: PubSubMessage): Promise<string | null> {
    try {
      const data = Buffer.from(JSON.stringify(message.data), 'utf-8');
      const messageId = await this.pubsub.topic(topic).publishMessage({
        data,
        attributes: message.attributes,
        orderingKey: message.orderingKey,
      });
      return messageId;
    } catch (err) {
      this.logger.warn?.(
        'GooglePubSubAdapter.publish failed (non-blocking)',
        {
          topic,
          err: err instanceof Error ? err.message : String(err),
        },
      );
      return null;
    }
  }
}
