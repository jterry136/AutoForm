import type { DeliveryContext, DeliveryOutcome } from '~/lib/queue'

/**
 * The narrow connector contract (REQUIREMENTS.md §9, NFR-MAINT-1). The delivery
 * core treats connectors as opaque: it hands over a prepared input and gets back
 * a structured {@link DeliveryOutcome}. Each connector owns its own config shape,
 * auth, and payload formatting; adding one never touches ingestion or the queue.
 */

/** What a connector receives for one delivery. */
export type ConnectorInput = Pick<
  DeliveryContext,
  'payload' | 'config' | 'credentials'
>

/** Result of an optional setup-time config/credential check (FR-CON-6). */
export interface ConfigCheckResult {
  ok: boolean
  error?: string
}

export interface Connector {
  /** Destination type key this connector handles (e.g. 'webhook', 'email'). */
  readonly type: string
  /** Perform the destination-specific call. Must not throw for normal failures. */
  deliver(input: ConnectorInput): Promise<DeliveryOutcome>
  /** Optional setup-time validation (FR-CON-6), used by the dashboard later. */
  validateConfig?(config: Record<string, unknown>): ConfigCheckResult
}
