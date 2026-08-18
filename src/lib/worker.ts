/**
 * Boot activation for the in-process background work: the delivery worker and
 * the zero-retention purge pass. Imported only from the server entry
 * (src/server.ts), so it never reaches the client bundle.
 *
 * Idempotent across the process, and a no-op when DATABASE_URL is absent so the
 * dev server still boots without a database. The queue/connectors/purge modules
 * (which import the DB client + secrets) are loaded lazily, after the
 * DATABASE_URL check, so an unconfigured environment never triggers env
 * validation at import time.
 *
 * Both run on the same in-process model (D-006): no external scheduler, and a
 * purge pass is the same shape of work as the poller — cheap, idempotent, and
 * safe to skip a beat.
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
    const [
      { startDeliveryWorker },
      { dispatchDelivery },
      { startZeroRetentionPurge },
    ] = await Promise.all([
      import('~/lib/queue'),
      import('~/connectors'),
      import('~/lib/purge'),
    ])
    startDeliveryWorker({ dispatch: dispatchDelivery })
    startZeroRetentionPurge()
  } catch (err) {
    globalThis.__autoformWorkerStarted = false
    console.error('[delivery-worker] failed to start:', err)
  }
}
