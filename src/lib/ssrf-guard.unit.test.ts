import { BlockList } from 'node:net'
import { type Server, createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  SsrfBlockedError,
  assertPublicHttpUrl,
  fetchPublicOnly,
  isBlockedAddress,
} from '~/lib/ssrf-guard'

describe('isBlockedAddress (IPv4)', () => {
  it.each([
    ['0.0.0.0', 'unspecified'],
    ['127.0.0.1', 'loopback'],
    ['10.1.2.3', 'RFC1918 10/8'],
    ['172.16.5.5', 'RFC1918 172.16/12'],
    ['192.168.1.1', 'RFC1918 192.168/16'],
    ['169.254.169.254', 'link-local / cloud metadata'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['192.0.2.1', 'TEST-NET-1 documentation'],
    ['198.51.100.1', 'TEST-NET-2 documentation'],
    ['203.0.113.1', 'TEST-NET-3 documentation'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast'],
    ['240.0.0.1', 'reserved'],
  ])('blocks %s (%s)', (ip) => {
    expect(isBlockedAddress(ip, 4)).toBe(true)
  })

  it.each([
    ['8.8.8.8', 'public DNS'],
    ['1.1.1.1', 'public DNS'],
    ['93.184.216.34', 'a real public host'],
  ])('allows %s (%s)', (ip) => {
    expect(isBlockedAddress(ip, 4)).toBe(false)
  })
})

describe('isBlockedAddress (IPv6)', () => {
  it.each([
    ['::1', 'loopback'],
    ['::', 'unspecified'],
    ['fc00::1', 'unique-local'],
    ['fe80::1', 'link-local'],
    ['ff02::1', 'multicast'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['::ffff:169.254.169.254', 'IPv4-mapped cloud metadata'],
    ['2002::1', '6to4 (embeds arbitrary IPv4)'],
  ])('blocks %s (%s)', (ip) => {
    expect(isBlockedAddress(ip, 6)).toBe(true)
  })

  it('allows a public IPv6 address', () => {
    expect(isBlockedAddress('2606:4700:4700::1111', 6)).toBe(false)
  })
})

describe('assertPublicHttpUrl', () => {
  it('rejects a non-http(s) protocol', async () => {
    expect(await assertPublicHttpUrl('ftp://example.com')).toMatchObject({
      ok: false,
    })
    expect(await assertPublicHttpUrl('file:///etc/passwd')).toMatchObject({
      ok: false,
    })
  })

  it('rejects an unparseable URL', async () => {
    expect(await assertPublicHttpUrl('not a url')).toMatchObject({ ok: false })
  })

  it('rejects an IP-literal loopback URL with no DNS lookup involved', async () => {
    const result = await assertPublicHttpUrl('http://127.0.0.1/webhook', {
      lookup: () => {
        throw new Error('should not be called for an IP literal')
      },
    })
    expect(result).toMatchObject({ ok: false })
  })

  it('rejects a bracketed IPv6-literal loopback URL', async () => {
    expect(await assertPublicHttpUrl('http://[::1]/webhook')).toMatchObject({
      ok: false,
    })
  })

  it('rejects the cloud metadata IP literal', async () => {
    expect(
      await assertPublicHttpUrl('http://169.254.169.254/latest/meta-data/'),
    ).toMatchObject({ ok: false })
  })

  it('allows a public IP literal', async () => {
    expect(await assertPublicHttpUrl('https://8.8.8.8/webhook')).toEqual({
      ok: true,
    })
  })

  it('rejects a hostname whose DNS resolution lands on a private address', async () => {
    const fakeLookup = (async () => [
      { address: '10.0.0.5', family: 4 },
    ]) as unknown as typeof import('node:dns/promises').lookup

    const result = await assertPublicHttpUrl('http://internal.example.test/', {
      lookup: fakeLookup,
    })
    expect(result).toMatchObject({ ok: false })
  })

  it('allows a hostname whose DNS resolution is entirely public', async () => {
    const publicLookup = (async () => [
      { address: '8.8.4.4', family: 4 },
    ]) as unknown as typeof import('node:dns/promises').lookup

    expect(
      await assertPublicHttpUrl('http://public.example.test/', {
        lookup: publicLookup,
      }),
    ).toEqual({ ok: true })
  })

  it('rejects when only one of several resolved addresses is private', async () => {
    const mixedLookup = (async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]) as unknown as typeof import('node:dns/promises').lookup

    expect(
      await assertPublicHttpUrl('http://multi-a-record.example.test/', {
        lookup: mixedLookup,
      }),
    ).toMatchObject({ ok: false })
  })

  it('rejects when DNS resolution fails', async () => {
    const failingLookup = (async () => {
      throw new Error('ENOTFOUND')
    }) as unknown as typeof import('node:dns/promises').lookup

    expect(
      await assertPublicHttpUrl('http://does-not-exist.invalid/', {
        lookup: failingLookup,
      }),
    ).toMatchObject({ ok: false })
  })
})

describe('fetchPublicOnly', () => {
  let server: Server
  let baseUrl: string
  let hits = 0
  // An empty block list isolates the redirect-following mechanics under test
  // here from the real default range list, which is already covered above
  // and would otherwise block every loopback address this local test server
  // uses.
  const permissiveGuard = { blockList: new BlockList() }

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits += 1
      if (req.url === '/redirect-once') {
        res.writeHead(302, { Location: '/final' })
        res.end()
        return
      }
      if (req.url === '/redirect-loop') {
        res.writeHead(302, { Location: '/redirect-loop' })
        res.end()
        return
      }
      res.statusCode = 200
      res.end('ok')
    })
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve()),
    )
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('performs the request when the target is allowed', async () => {
    hits = 0
    const res = await fetchPublicOnly(baseUrl, {}, permissiveGuard)
    expect(res.status).toBe(200)
    expect(hits).toBe(1)
  })

  it('follows a redirect after re-validating the new target', async () => {
    hits = 0
    const res = await fetchPublicOnly(
      `${baseUrl}/redirect-once`,
      {},
      permissiveGuard,
    )
    expect(res.status).toBe(200)
    expect(hits).toBe(2)
  })

  it('blocks the initial target when it is not public', async () => {
    await expect(fetchPublicOnly(baseUrl, {})).rejects.toThrow(SsrfBlockedError)
  })

  it('blocks a redirect that lands on a disallowed address', async () => {
    // A blocklist scoped to just the metadata range: permissive enough to let
    // the first hop reach this test's own loopback server (unlike the real
    // default, which blocks loopback), but still strict enough to prove the
    // redirect target gets checked — not just the initial URL.
    const metadataOnlyBlockList = new BlockList()
    metadataOnlyBlockList.addSubnet('169.254.0.0', 16, 'ipv4')

    const redirectingServer = createServer((req, res) => {
      res.writeHead(302, {
        Location: 'http://169.254.169.254/latest/meta-data/',
      })
      res.end()
    })
    await new Promise<void>((resolve) =>
      redirectingServer.listen(0, '127.0.0.1', () => resolve()),
    )
    const addr = redirectingServer.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0

    await expect(
      fetchPublicOnly(
        `http://127.0.0.1:${port}/`,
        {},
        { blockList: metadataOnlyBlockList },
      ),
    ).rejects.toThrow(SsrfBlockedError)

    await new Promise<void>((resolve) =>
      redirectingServer.close(() => resolve()),
    )
  })

  it('gives up after too many redirect hops', async () => {
    await expect(
      fetchPublicOnly(`${baseUrl}/redirect-loop`, {}, permissiveGuard),
    ).rejects.toThrow(/too many redirects/i)
  })
})
