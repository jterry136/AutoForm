import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'
import type { Register } from '@tanstack/react-router'
import type { RequestHandler } from '@tanstack/react-start/server'
import { ensureDeliveryWorker } from '~/lib/worker'

/**
 * Custom server entry (wired via `tanstackStart({ server: { entry } })` in
 * vite.config.ts). Mirrors the framework default and additionally starts the
 * in-process delivery worker once, at server boot. Server-only — never bundled
 * into the client.
 */
void ensureDeliveryWorker()

const fetch = createStartHandler(defaultStreamHandler)

export type ServerEntry = { fetch: RequestHandler<Register> }

export function createServerEntry(entry: ServerEntry): ServerEntry {
  return {
    async fetch(...args) {
      return await entry.fetch(...args)
    },
  }
}

export default createServerEntry({ fetch })
