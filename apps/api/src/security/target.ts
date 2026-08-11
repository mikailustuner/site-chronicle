import { BlockList, isIP } from 'node:net';
import { lookup, resolveTxt } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { parseHttpUrl, sameSite } from '@sitechronicle/core';
import { config } from '../config.js';

const blockedIpv4 = new BlockList();
const blockedIpv6 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blockedIpv4.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
  ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) blockedIpv6.addSubnet(network, prefix, 'ipv6');

export interface ValidatedTarget {
  url: URL;
  addresses: string[];
  address: string;
  family: 4 | 6;
}

export async function validateTarget(input: string, allowPrivate = config.allowPrivateTargets): Promise<ValidatedTarget> {
  const url = parseHttpUrl(input);
  if (url.port && !['80', '443', '8080', '8443'].includes(url.port)) throw new Error('Target port is not allowed');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const records = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) as 4 | 6 }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (!records.length) throw new Error('Target hostname did not resolve');
  for (const record of records) {
    const family = record.family === 6 ? 'ipv6' : 'ipv4';
    const blockList = family === 'ipv6' ? blockedIpv6 : blockedIpv4;
    if (!allowPrivate && blockList.check(record.address, family)) throw new Error(`Target resolves to a blocked ${family} range`);
  }
  const selected = records[0]!;
  return { url, addresses: records.map((record) => record.address), address: selected.address, family: selected.family === 6 ? 6 : 4 };
}

export async function safeFetch(input: string, options: { maxBytes?: number; timeoutMs?: number; headers?: Record<string, string>; allowPrivate?: boolean; allowedScope?: string } = {}): Promise<{ response: Response; body: Uint8Array; finalUrl: string }> {
  const maxBytes = options.maxBytes ?? 5_000_000;
  let current = input;
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    if (options.allowedScope && !sameSite(current, options.allowedScope)) throw new Error(`Out-of-scope request blocked: ${current}`);
    const target = await validateTarget(current, options.allowPrivate ?? config.allowPrivateTargets);
    const result = await requestPinned(target, maxBytes, options.timeoutMs ?? 20_000, options.headers);
    if ([301, 302, 303, 307, 308].includes(result.status)) {
      const location = result.headers.get('location');
      if (!location) throw new Error('Redirect response did not include Location');
      current = new URL(location, current).toString();
      continue;
    }
    return { response: new Response(result.body.buffer as ArrayBuffer, { status: result.status, statusText: result.statusText, headers: result.headers }), body: result.body, finalUrl: target.url.toString() };
  }
  throw new Error('Too many redirects');
}

export async function verifyDomainTxt(hostname: string, token: string): Promise<boolean> {
  const records = await resolveTxt(`_sitechronicle.${hostname}`);
  return records.some((record) => record.join('') === token);
}

export async function verifyDomainFile(origin: string, token: string): Promise<boolean> {
  const result = await safeFetch(new URL('/.well-known/sitechronicle-verification.txt', origin).toString(), { maxBytes: 2048, allowedScope:origin });
  return sameSite(result.finalUrl, origin) && result.response.ok && new TextDecoder().decode(result.body).trim() === token;
}

async function requestPinned(target: ValidatedTarget, maxBytes: number, timeoutMs: number, extraHeaders: Record<string,string> | undefined): Promise<{status:number;statusText:string;headers:Headers;body:Uint8Array}> {
  return new Promise((resolve, reject) => {
    const transport = target.url.protocol === 'https:' ? https : http;
    const request = transport.request({
      hostname: target.address,
      family: target.family,
      port: Number(target.url.port || (target.url.protocol === 'https:' ? 443 : 80)),
      path: `${target.url.pathname}${target.url.search}`,
      method: 'GET',
      headers: {
        'user-agent': 'SiteChronicle/0.1 (+self-hosted evidence audit)',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
        ...extraHeaders,
        host: target.url.host,
      },
      ...(target.url.protocol === 'https:' && !isIP(target.url.hostname) ? { servername: target.url.hostname } : {}),
    }, (incoming) => {
      const declared = Number(incoming.headers['content-length'] ?? 0);
      if (declared > maxBytes) { incoming.destroy(new Error(`Response exceeds ${maxBytes} byte limit`)); return; }
      const chunks: Buffer[] = [];
      let total = 0;
      incoming.on('data', (chunk: Buffer) => {
        total += chunk.byteLength;
        if (total > maxBytes) { incoming.destroy(new Error(`Response exceeds ${maxBytes} byte limit`)); return; }
        chunks.push(chunk);
      });
      incoming.on('end', () => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (value === undefined) continue;
          if (Array.isArray(value)) for (const item of value) headers.append(key, item);
          else headers.set(key, value);
        }
        resolve({ status: incoming.statusCode ?? 500, statusText: incoming.statusMessage ?? '', headers, body: new Uint8Array(Buffer.concat(chunks, total)) });
      });
      incoming.on('error', reject);
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('Verification request timed out')));
    request.on('error', reject);
    request.end();
  });
}
