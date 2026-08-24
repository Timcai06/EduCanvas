import { describe, expect, it, vi } from 'vitest';
import { resolveHostnameWithDohFallback } from './web-page-dns';

function dnsResponse(addresses: readonly string[]) {
  return new Response(
    JSON.stringify({
      Status: 0,
      Answer: addresses.map((data) => ({ data })),
    }),
    { headers: { 'content-type': 'application/dns-json' } },
  );
}

const fakeIpOnly = (addresses: readonly string[]) =>
  addresses.length > 0 &&
  addresses.every((address) => address.startsWith('198.'));

describe('resolveHostnameWithDohFallback', () => {
  it('keeps ordinary system DNS and does not contact DoH', async () => {
    const request = vi.fn();

    await expect(
      resolveHostnameWithDohFallback('example.com', {
        lookupHostname: vi.fn().mockResolvedValue(['93.184.216.34']),
        request,
        shouldUseFallback: fakeIpOnly,
      }),
    ).resolves.toEqual(['93.184.216.34']);
    expect(request).not.toHaveBeenCalled();
  });

  it('replaces Fake-IP answers with strictly parsed DoH addresses', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(dnsResponse(['93.184.216.34', 'alias.example']))
      .mockResolvedValueOnce(
        dnsResponse(['2606:2800:220:1:248:1893:25c8:1946']),
      );

    await expect(
      resolveHostnameWithDohFallback('example.com', {
        lookupHostname: vi.fn().mockResolvedValue(['198.18.0.42']),
        request,
        shouldUseFallback: fakeIpOnly,
      }),
    ).resolves.toEqual(['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946']);
  });

  it('uses DoH after a system resolver failure', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(dnsResponse(['93.184.216.34']))
      .mockResolvedValueOnce(dnsResponse([]));

    await expect(
      resolveHostnameWithDohFallback('example.com', {
        lookupHostname: vi.fn().mockRejectedValue(new Error('dns failed')),
        request,
        shouldUseFallback: fakeIpOnly,
      }),
    ).resolves.toEqual(['93.184.216.34']);
  });

  it('keeps Fake-IP evidence when DoH cannot provide an address', async () => {
    const request = vi.fn().mockResolvedValue(dnsResponse([]));

    await expect(
      resolveHostnameWithDohFallback('example.com', {
        lookupHostname: vi.fn().mockResolvedValue(['198.18.0.42']),
        request,
        shouldUseFallback: fakeIpOnly,
      }),
    ).resolves.toEqual(['198.18.0.42']);
  });
});
