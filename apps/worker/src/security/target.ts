import { BlockList, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { parseHttpUrl } from '@sitechronicle/core';
import { config } from '../config.js';

const blockedIpv4 = new BlockList();
const blockedIpv6 = new BlockList();
for (const [network, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const) blockedIpv4.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [['::',128],['::1',128],['fc00::',7],['fe80::',10],['ff00::',8],['2001:db8::',32],['::ffff:0:0',96]] as const) blockedIpv6.addSubnet(network, prefix, 'ipv6');
const cache = new Map<string, { expires: number; addresses: string[] }>();

export async function validateTarget(input: string, allowPrivate = config.allowPrivateTargets): Promise<URL> {
  const url = parseHttpUrl(input);
  if (url.port && !['80','443','8080','8443'].includes(url.port)) throw new Error('Target port is not allowed');
  const hostname=url.hostname.replace(/^\[|\]$/g,'');
  let addresses = cache.get(hostname)?.expires && cache.get(hostname)!.expires > Date.now() ? cache.get(hostname)!.addresses : undefined;
  if (!addresses) {
    addresses = isIP(hostname) ? [hostname] : (await lookup(hostname, { all: true, verbatim: true })).map((item) => item.address);
    cache.set(hostname, { expires: Date.now() + 60_000, addresses });
  }
  if (!addresses.length) throw new Error('Target hostname did not resolve');
  if (!allowPrivate) for (const address of addresses) {
    const family = isIP(address) === 6 ? 'ipv6' : 'ipv4';
    const blockList = family === 'ipv6' ? blockedIpv6 : blockedIpv4;
    if (blockList.check(address, family)) throw new Error('Target resolves to a blocked network');
  }
  return url;
}

export async function safeFetch(input: string, options: { maxBytes?: number; timeoutMs?: number; headers?: Record<string,string> } = {}): Promise<{ response: Response; body: Uint8Array; finalUrl: string }> {
  let current = input;
  const maxBytes = options.maxBytes ?? 8_000_000;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    await validateTarget(current);
    const response = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(options.timeoutMs ?? 25_000), headers: { 'user-agent': 'SiteChronicle/0.1 (+self-hosted evidence audit)', accept: 'text/html,application/xml,text/xml,text/plain,*/*;q=.5', ...options.headers } });
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect without Location');
      current = new URL(location, current).toString();
      continue;
    }
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > maxBytes) throw new Error('Response is larger than configured limit');
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new Error('Response is larger than configured limit'); }
      chunks.push(result.value);
    }
    const body = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return { response, body, finalUrl: current };
  }
  throw new Error('Too many redirects');
}

export async function browserRequestAllowed(urlInput: string): Promise<boolean> {
  try { await validateTarget(urlInput); return true; } catch { return false; }
}
