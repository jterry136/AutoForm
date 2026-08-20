import { BlockList, isIP } from 'node:net'
import { lookup as dnsLookup } from 'node:dns/promises'

/**
 * Blocks outbound connector requests from reaching private, loopback,
 * link-local, or other non-public network ranges — including cloud metadata
 * endpoints (169.254.169.254) — so a user-supplied destination URL (the
 * webhook connector's `config.url`) cannot turn the server into a proxy into
 * its own network (SSRF).
 *
 * Every resolved IP is checked, not just the hostname string: `assertPublicHttpUrl`
 * re-resolves DNS on every call, so callers must invoke it again immediately
 * before each network attempt — including after every redirect hop — rather
 * than caching one "validated at config time" result. DNS can change between
 * checks (DNS rebinding), and a redirect can point anywhere regardless of
 * what the original URL resolved to.
 *
 * This closes the gap between config time and delivery time, not the much
 * narrower one between this check and `fetch`'s own DNS resolution a moment
 * later — a sub-second rebind timed exactly between the two could still slip
 * through. Defending that fully would mean resolving once and connecting to
 * the pinned IP directly (bypassing `fetch`'s resolver), which is more than
 * this guard does today.
 */

export interface UrlGuardResult {
  ok: boolean
  error?: string
}

export interface GuardOptions {
  /** Override DNS resolution. Test-only seam — production code uses the default. */
  lookup?: typeof dnsLookup
  /** Override the blocked-range list. Test-only seam — production code uses the default. */
  blockList?: BlockList
}

// IPv4 ranges that must never be reached by a connector: unspecified,
// private (RFC1918), loopback, link-local (includes the 169.254.169.254
// cloud metadata address shared by AWS/GCP/Azure/DigitalOcean), carrier-grade
// NAT, IETF protocol assignments, documentation/benchmark ranges, the 6to4
// relay anycast prefix, multicast, and reserved/broadcast.
const BLOCKED_IPV4_SUBNETS: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]

// IPv6 ranges: unspecified, loopback, unique-local, link-local, multicast,
// documentation, and 6to4/Teredo — the latter two embed an arbitrary IPv4
// address inside an IPv6 literal, so the whole prefix is blocked outright
// rather than trying to unwrap it. IPv4-mapped addresses (`::ffff:a.b.c.d`)
// are handled separately below: Node's `BlockList` treats a subnet rule on
// `::ffff:0:0/96` as matching *every* plain IPv4 address too (it uses that
// prefix internally to compare across families), so adding it here would
// blanket-block all IPv4 traffic — instead `isBlockedAddress` unwraps the
// embedded IPv4 and re-checks it against the IPv4 rules.
const BLOCKED_IPV6_SUBNETS: ReadonlyArray<readonly [string, number]> = [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['2001::', 32],
]

function buildDefaultBlockList(): BlockList {
  const blockList = new BlockList()
  for (const [address, prefix] of BLOCKED_IPV4_SUBNETS) {
    blockList.addSubnet(address, prefix, 'ipv4')
  }
  blockList.addAddress('255.255.255.255', 'ipv4')
  for (const [address, prefix] of BLOCKED_IPV6_SUBNETS) {
    blockList.addSubnet(address, prefix, 'ipv6')
  }
  return blockList
}

const defaultBlockList = buildDefaultBlockList()

// Matches an IPv4-mapped IPv6 literal in either the dotted-quad form
// (`::ffff:127.0.0.1`) or the hex-group form `new URL()` normalizes it to
// (`::ffff:7f00:1`), and extracts the embedded IPv4 address.
const IPV4_MAPPED_DOTTED = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i
const IPV4_MAPPED_HEX = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i

function unwrapIpv4Mapped(address: string): string | null {
  const dotted = IPV4_MAPPED_DOTTED.exec(address)
  if (dotted) return dotted[1]!
  const hex = IPV4_MAPPED_HEX.exec(address)
  if (!hex) return null
  const hi = parseInt(hex[1]!, 16)
  const lo = parseInt(hex[2]!, 16)
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
}

/** Test-only: matches the classification `assertPublicHttpUrl` uses internally. */
export function isBlockedAddress(
  address: string,
  family: 4 | 6,
  blockList: BlockList = defaultBlockList,
): boolean {
  if (family === 6) {
    const mapped = unwrapIpv4Mapped(address)
    if (mapped) return isBlockedAddress(mapped, 4, blockList)
  }
  return blockList.check(address, family === 6 ? 'ipv6' : 'ipv4')
}

/**
 * Validate that `url` is http(s) and that every address its hostname
 * currently resolves to is a public, routable address. An IP-literal
 * hostname (`http://169.254.169.254/`, `http://[::1]/`) is checked directly,
 * with no DNS lookup involved.
 */
export async function assertPublicHttpUrl(
  url: string,
  options: GuardOptions = {},
): Promise<UrlGuardResult> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, error: 'is not a valid URL' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'must be http(s)' }
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '')
  const literalFamily = isIP(hostname)
  const blockList = options.blockList ?? defaultBlockList
  const lookup = options.lookup ?? dnsLookup

  let addresses: { address: string; family: number }[]
  if (literalFamily) {
    addresses = [{ address: hostname, family: literalFamily }]
  } else {
    try {
      addresses = await lookup(hostname, { all: true, verbatim: true })
    } catch {
      return { ok: false, error: 'could not be resolved' }
    }
  }

  if (addresses.length === 0) {
    return { ok: false, error: 'could not be resolved' }
  }

  for (const { address, family } of addresses) {
    if (isBlockedAddress(address, family === 6 ? 6 : 4, blockList)) {
      return {
        ok: false,
        error: 'resolves to a private or reserved network address',
      }
    }
  }

  return { ok: true }
}

const MAX_REDIRECTS = 5

export class SsrfBlockedError extends Error {}

export interface GuardedFetchInit extends RequestInit {
  /** Passed to `AbortSignal.timeout()` for each hop. */
  timeoutMs?: number
}

/**
 * `fetch`, but every hop — the initial URL and every redirect target — is
 * re-validated with {@link assertPublicHttpUrl} before the request is made.
 * Redirects are followed manually (rather than via `redirect: 'follow'`) so
 * each `Location` can be checked before the client ever connects to it;
 * without this, a destination that returns clean on first check could redirect
 * straight to an internal address on delivery.
 */
export async function fetchPublicOnly(
  initialUrl: string,
  init: GuardedFetchInit = {},
  guardOptions: GuardOptions = {},
): Promise<Response> {
  const { timeoutMs = 10_000, ...requestInit } = init
  let currentUrl = initialUrl

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const check = await assertPublicHttpUrl(currentUrl, guardOptions)
    if (!check.ok) {
      throw new SsrfBlockedError(
        `Request to "${currentUrl}" blocked: ${check.error}.`,
      )
    }

    const res = await fetch(currentUrl, {
      ...requestInit,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })

    const location = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && location) {
      currentUrl = new URL(location, currentUrl).toString()
      continue
    }

    return res
  }

  throw new SsrfBlockedError(
    `Too many redirects (max ${MAX_REDIRECTS}) delivering to "${initialUrl}".`,
  )
}
