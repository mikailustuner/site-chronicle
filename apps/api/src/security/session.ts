import { createHmac, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';

const COOKIE_NAME = 'sitechronicle_session';
const MAX_AGE_SECONDS = 12 * 60 * 60;

interface SessionPayload {
  sub: 'admin';
  exp: number;
  nonce: string;
}

export function verifyPassword(candidate: string): boolean {
  const salt = Buffer.from(config.sessionSecret.slice(0, 32));
  const expected = scryptSync(config.adminPassword, salt, 32);
  const actual = scryptSync(candidate, salt, 32);
  return timingSafeEqual(expected, actual);
}

export function issueSession(reply: FastifyReply): void {
  const payload: SessionPayload = {
    sub: 'admin',
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS,
    nonce: crypto.randomUUID(),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign(encoded);
  reply.setCookie(COOKIE_NAME, `${encoded}.${signature}`, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export function clearSession(reply: FastifyReply): void {
  reply.clearCookie(COOKIE_NAME, { path: '/' });
}

export function hasValidSession(request: FastifyRequest): boolean {
  const value = request.cookies[COOKIE_NAME];
  if (!value) return false;
  const [encoded, signature] = value.split('.');
  if (!encoded || !signature) return false;
  const expected = sign(encoded);
  const given = Buffer.from(signature);
  const correct = Buffer.from(expected);
  if (given.length !== correct.length || !timingSafeEqual(given, correct)) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    return payload.sub === 'admin' && payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export async function requireSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!hasValidSession(request)) await reply.code(401).send({ error: 'authentication_required' });
}

export function requireTrustedOrigin(request: FastifyRequest): boolean {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return true;
  const origin = request.headers.origin;
  if (!origin) return config.nodeEnv !== 'production';
  try {
    return new URL(origin).origin === new URL(config.publicBaseUrl).origin;
  } catch {
    return false;
  }
}

function sign(value: string): string {
  return createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
}
