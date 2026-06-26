import type { DeliveryDispatcher } from '~/lib/queue'
import { emailConnector } from './email'
import type { Connector } from './types'
import { webhookConnector } from './webhook'

/**
 * Connector registry + the dispatcher the delivery worker injects. The worker
 * already loaded the submission/destination and decrypted credentials (P-2); here
 * we just route a prepared DeliveryContext to the connector for its type.
 *
 * Registering a connector is the only wiring needed to add a destination type —
 * ingestion and the queue are untouched (NFR-MAINT-1).
 */

const registry = new Map<string, Connector>(
  [webhookConnector, emailConnector].map((c) => [c.type, c] as const),
)

export function getConnector(type: string): Connector | undefined {
  return registry.get(type)
}

export function connectorTypes(): string[] {
  return [...registry.keys()]
}

export const dispatchDelivery: DeliveryDispatcher = async (context) => {
  const connector = getConnector(context.destinationType)
  if (!connector) {
    return {
      ok: false,
      retryable: false,
      error: `No connector registered for destination type "${context.destinationType}".`,
    }
  }
  return connector.deliver({
    payload: context.payload,
    config: context.config,
    credentials: context.credentials,
  })
}
