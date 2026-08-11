import http from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import { once } from 'node:events';
import { resolveTarget } from './target.js';
import { config } from '../config.js';

export interface AuditProxy {
  url: string;
  port: number;
  close(): Promise<void>;
}

let singleton: Promise<AuditProxy> | undefined;

/**
 * All browser and optional ZAP traffic is sent through this proxy. Each
 * destination is resolved, checked and pinned before a socket is opened, so a
 * page cannot use redirects, subresources or DNS rebinding to reach private
 * infrastructure.
 */
export function getAuditProxy(): Promise<AuditProxy> {
  singleton ??= startAuditProxy();
  return singleton;
}

async function startAuditProxy(): Promise<AuditProxy> {
  const server = http.createServer((request, response) => { void forwardHttp(request, response); });
  server.on('connect', (request, clientSocket, head) => { void forwardConnect(request, clientSocket, head); });
  server.on('clientError', (_error, socket) => socket.destroy());
  server.listen(config.auditProxyPort, config.auditProxyBindHost);
  await once(server, 'listening');
  server.unref();
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Audit proxy did not bind a TCP port');
  return {
    url: `http://127.0.0.1:${address.port}`,
    port: address.port,
    close: async () => {
      if (!server.listening) return;
      const closed = once(server, 'close');
      server.close();
      await closed;
      singleton = undefined;
    },
  };
}

async function forwardHttp(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
  try {
    if (!request.url) throw new Error('Proxy request URL is empty');
    if (!isSafeMethod(request.method)) throw new Error('State-changing HTTP method is blocked');
    const target = await resolveTarget(request.url);
    const headers:http.OutgoingHttpHeaders = { ...request.headers, host: target.url.host };
    delete headers['proxy-authorization'];
    delete headers['proxy-connection'];
    const upstream = http.request({
      hostname: target.address,
      family: target.family,
      port: Number(target.url.port || 80),
      method: request.method,
      path: `${target.url.pathname}${target.url.search}`,
      headers,
    }, (incoming) => {
      response.writeHead(incoming.statusCode ?? 502, incoming.statusMessage, incoming.headers);
      incoming.pipe(response);
    });
    upstream.setTimeout(45_000, () => upstream.destroy(new Error('Proxy upstream timeout')));
    upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    request.pipe(upstream);
  } catch {
    response.writeHead(403, { 'content-type': 'text/plain', connection: 'close' });
    response.end('Destination blocked by SiteChronicle');
  }
}

function isSafeMethod(method: string | undefined): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

async function forwardConnect(request: http.IncomingMessage, clientSocket: Duplex, head: Buffer): Promise<void> {
  try {
    const authority = request.url ?? '';
    const parsed = parseAuthority(authority);
    const target = await resolveTarget(`https://${parsed.host}:${parsed.port}`);
    const upstream = net.connect({ host: target.address, family: target.family, port: parsed.port });
    upstream.setTimeout(45_000, () => upstream.destroy(new Error('Proxy tunnel timeout')));
    upstream.once('connect', () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
  } catch {
    clientSocket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  }
}

function parseAuthority(value: string): { host:string;port:number } {
  const match = value.match(/^\[([^\]]+)](?::(\d+))$|^([^:]+):(\d+)$/);
  const host = match?.[1] ?? match?.[3];
  const port = Number(match?.[2] ?? match?.[4]);
  if (!host || !Number.isInteger(port)) throw new Error('Invalid CONNECT authority');
  return { host, port };
}
