/**
 * Boot activation for the in-process background work: the delivery worker, the
 * zero-retention purge pass, and the age-based retention purge pass. Imported
 * only from the server entry (src/server.ts), so it never reaches the client
 * bundle.
 *
 * All are idempotent across the process, and all are a no-op when DATABASE_URL is
 * absent so the dev server still boots without a database. The queue,
 * connectors, and purge modules (which import the DB client + secrets) are
 * loaded lazily, after the DATABASE_URL check, so an unconfigured environment
 * never triggers env validation at import time.
 *
 * They run on the same in-process model (D-006): no external scheduler, and a
 * purge pass is the same shape of work as the poller — cheap, idempotent, and
 * safe to skip a beat.
 */

declare global {
  var __autoformWorkerStarted: boolean | undefined
  var __autoformRetentionStarted: boolean | undefined
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

/**
 * Start the retention purge pass (FR-SUB-3, NFR-PRIV-1) alongside the delivery
 * worker. Same boot-safety properties: once per process, skipped without a
 * database, and never able to prevent the server from starting.
 */
export async function ensureRetentionWorker(): Promise<void> {
  if (globalThis.__autoformRetentionStarted) return

  if (!process.env.DATABASE_URL) {
    console.warn('[retention] DATABASE_URL not set — purge pass not started.')
    return
  }

  globalThis.__autoformRetentionStarted = true
  try {
    const { startRetentionWorker } = await import('~/lib/retention-purge')
    startRetentionWorker()
  } catch (err) {
    globalThis.__autoformRetentionStarted = false
    console.error('[retention] failed to start:', err)
  }
}
