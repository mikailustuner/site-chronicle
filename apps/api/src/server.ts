import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import { config } from './config.js';
import { migrate, sql } from './db.js';
import { clearLoginAttempts, clearSession, consumeLoginAttempt, hasValidSession, issueSession, requireSession, requireTrustedOrigin, verifyPassword } from './security/session.js';
import { registerRoutes } from './routes.js';
import { registerIntelligenceRoutes } from './intelligence-routes.js';

const app = Fastify({
  logger: config.nodeEnv === 'development'
    ? { level: config.logLevel, transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } } }
    : { level: config.logLevel },
  bodyLimit: 1_000_000,
  requestTimeout: 30_000,
  trustProxy: config.nodeEnv === 'production' ? 1 : false,
});

await app.register(cookie);
await app.register(cors, {
  // The private application UI is same-origin; no public collector is exposed.
  origin: false,
  credentials: false,
});

app.addHook('onRequest', async (request, reply) => {
  reply.header('x-content-type-options', 'nosniff');
  reply.header('x-frame-options', 'DENY');
  reply.header('referrer-policy', 'no-referrer');
  reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  reply.header('content-security-policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if (!requireTrustedOrigin(request)) return reply.code(403).send({ error: 'untrusted_origin' });
});

app.get('/api/health', async () => {
  await sql`SELECT 1`;
  const workers=await sql<Array<{count:number}>>`SELECT count(*)::int AS count FROM worker_heartbeats WHERE last_seen_at > now() - interval '45 seconds'`;
  return { ok: true, workerOnline:Number(workers[0]?.count??0)>0, version: '0.1.0', time: new Date().toISOString() };
});
app.get('/api/readiness',async(_request,reply)=>{await sql`SELECT 1`;const workers=await sql<Array<{count:number}>>`SELECT count(*)::int AS count FROM worker_heartbeats WHERE last_seen_at > now() - interval '45 seconds'`;const ready=Number(workers[0]?.count??0)>0;return reply.code(ready?200:503).send({ready,database:true,worker:ready})});

app.get('/api/session', async (request) => ({ authenticated: hasValidSession(request) }));
app.post('/api/session', async (request, reply) => {
  const retryAfter=consumeLoginAttempt(request.ip);if(retryAfter!==null)return reply.header('retry-after',String(retryAfter)).code(429).send({error:'too_many_login_attempts',retryAfter});
  const { password } = z.object({ password: z.string().min(1).max(1024) }).parse(request.body);
  if (!verifyPassword(password)) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    return reply.code(401).send({ error: 'invalid_credentials' });
  }
  clearLoginAttempts(request.ip);
  issueSession(reply);
  return { authenticated: true };
});
app.delete('/api/session', async (_request, reply) => { clearSession(reply); return { authenticated: false }; });

app.addHook('preHandler', async (request, reply) => {
  if (!request.url.startsWith('/api/') || ['/api/health','/api/readiness','/api/session'].includes(request.url.split('?')[0]!)) return;
  await requireSession(request, reply);
});

await registerRoutes(app, sql);
await registerIntelligenceRoutes(app, sql);

// Legacy public collection paths are deliberately closed in outbound-only mode.
app.all('/t/*', async (_request, reply) => reply.code(404).send({ error: 'public_collector_disabled' }));

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(currentDir, config.webDistPath);
await app.register(fastifyStatic, { root: webRoot, prefix: '/', wildcard: false });
app.get('/*', async (_request, reply) => reply.sendFile('index.html', webRoot));

app.setErrorHandler((error, _request, reply) => {
  const current = error as Error & { statusCode?: number };
  app.log.error(current);
  if (current instanceof z.ZodError) return reply.code(400).send({ error: 'validation_error', issues: current.issues });
  const statusCode = typeof current.statusCode === 'number' ? current.statusCode : 500;
  return reply.code(statusCode).send({ error: statusCode >= 500 ? 'internal_error' : current.message });
});

await migrate();
await app.listen({ port: config.port, host: config.host });

const shutdown = async () => {
  await app.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
