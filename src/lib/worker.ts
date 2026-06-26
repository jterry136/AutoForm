/**
 * Boot activation for the in-process delivery worker. Imported only from the
 * server entry (src/server.ts), so it never reaches the client bundle.
 *
 * Idempotent across the process, and a no-op when DATABASE_URL is absent so the
 * dev server still boots without a database. The queue/connectors (which import
 * the DB client + secrets) are loaded lazily, after the DATABASE_URL check, so an
 * unconfigured environment never triggers env validation at import time.
 */

declare global {
  var __autoformWorkerStarted: boolean | undefined
}

export async function ensureDeliveryWorker(): Promise<void> {
  if (globalThis.__autoformWorkerStarted) return

  if (!process.env.DATABASE_URL) {
    console.warn('[delivery-worker] DATABASE_URL not set — worker not started.')
    return
  }

  globalThis.__autoformWorkerStarted = true
  try {
    const [{ startDeliveryWorker }, { dispatchDelivery }] = await Promise.all([
      import('~/lib/queue'),
      import('~/connectors'),
    ])
    startDeliveryWorker({ dispatch: dispatchDelivery })
  } catch (err) {
    globalThis.__autoformWorkerStarted = false
    console.error('[delivery-worker] failed to start:', err)
  }
}
