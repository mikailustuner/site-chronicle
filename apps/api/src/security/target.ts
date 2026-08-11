import { BlockList, isIP } from 'node:net';
import { lookup, resolveTxt } from 'node:dns/promises';
import { parseHttpUrl } from '@sitechronicle/core';
import { config } from '../config.js';

const blockedIpv4 = new BlockList();
const blockedIpv6 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blockedIpv4.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32], ['::ffff:0:0', 96],
] as const) blockedIpv6.addSubnet(network, prefix, 'ipv6');

export interface ValidatedTarget {
  url: URL;
  addresses: string[];
}

export async function validateTarget(input: string, allowPrivate = config.allowPrivateTargets): Promise<ValidatedTarget> {
  const url = parseHttpUrl(input);
  if (url.port && !['80', '443', '8080', '8443'].includes(url.port)) throw new Error('Target port is not allowed');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname)
    ? [hostname]
    : (await lookup(hostname, { all: true, verbatim: true })).map((item) => item.address);
  if (!addresses.length) throw new Error('Target hostname did not resolve');
  if (!allowPrivate) {
    for (const address of addresses) {
      const family = isIP(address) === 6 ? 'ipv6' : 'ipv4';
      const blockList = family === 'ipv6' ? blockedIpv6 : blockedIpv4;
      if (blockList.check(address, family)) throw new Error(`Target resolves to a blocked ${family} range`);
    }
  }
  return { url, addresses };
}

export async function safeFetch(input: string, options: { maxBytes?: number; timeoutMs?: number; headers?: Record<string, string>; allowPrivate?: boolean } = {}): Promise<{ response: Response; body: Uint8Array; finalUrl: string }> {
  const maxBytes = options.maxBytes ?? 5_000_000;
  const timeoutMs = options.timeoutMs ?? 20_000;
  let current = input;
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    await validateTarget(current, options.allowPrivate ?? config.allowPrivateTargets);
    const response = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'user-agent': 'SiteChronicle/0.1 (+self-hosted evidence audit)',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
        ...options.headers,
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect response did not include Location');
      current = new URL(location, current).toString();
      continue;
    }
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > maxBytes) throw new Error(`Response exceeds ${maxBytes} byte limit`);
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new Error(`Response exceeds ${maxBytes} byte limit`);
        }
        chunks.push(value);
      }
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return { response, body, finalUrl: current };
  }
  throw new Error('Too many redirects');
}

export async function verifyDomainTxt(hostname: string, token: string): Promise<boolean> {
  const records = await resolveTxt(`_sitechronicle.${hostname}`);
  return records.some((record) => record.join('') === token);
}

export async function verifyDomainFile(origin: string, token: string): Promise<boolean> {
  const result = await safeFetch(new URL('/.well-known/sitechronicle-verification.txt', origin).toString(), { maxBytes: 2048 });
  return result.response.ok && new TextDecoder().decode(result.body).trim() === token;
}
