import type { FastifyInstance } from 'fastify';
import { compareAudits, hashObject, newId, normalizeUrl, parseHttpUrl, ScanProfileSchema, type AuditManifest, type CategoryScore, type Finding, type PageSnapshot } from '@sitechronicle/core';
import { z } from 'zod';
import type { Database } from './db.js';
import { enqueue } from './queue.js';
import { config } from './config.js';
import { validateTarget, verifyDomainFile, verifyDomainTxt } from './security/target.js';
import { ArtifactStore } from './artifacts.js';
import { buildAuditReport, buildComparisonReport } from './report.js';
import { CronExpressionParser } from 'cron-parser';

export async function registerRoutes(app: FastifyInstance, database: Database): Promise<void> {
  app.get('/api/dashboard', async () => {
    const domains = await database<Array<Record<string, unknown>>>`SELECT * FROM domains ORDER BY created_at DESC`;
    const audits = await database<Array<Record<string, unknown>>>`SELECT id, domain_id, status, scores, summary, error, started_at, completed_at, created_at FROM audits ORDER BY created_at DESC LIMIT 20`;
    const openFindings = await database<Array<{ severity: string; count: number }>>`SELECT severity, count(*)::int AS count FROM findings f JOIN audits a ON a.id = f.audit_id WHERE a.id IN (SELECT DISTINCT ON (domain_id) id FROM audits WHERE status = 'completed' ORDER BY domain_id, created_at DESC) GROUP BY severity`;
    return { domains, audits, findingCounts: Object.fromEntries(openFindings.map((row) => [row.severity, Number(row.count)])) };
  });

  app.get('/api/domains', async () => database`SELECT * FROM domains ORDER BY created_at DESC`);

  app.post('/api/domains', async (request, reply) => {
    const body = z.object({ name: z.string().min(1).max(120), origin: z.string().min(1), authorizationConfirmed: z.literal(true) }).parse(request.body);
    const target = await validateTarget(body.origin).catch((error: unknown) => {
      throw Object.assign(new Error(error instanceof Error ? error.message : 'Invalid audit target'), { statusCode: 400 });
    });
    const origin = target.url.origin;
    const id = newId('domain');
    const token = `sitechronicle-verification=${crypto.randomUUID()}`;
    const rows = await database<Array<Record<string, unknown>>>`
      INSERT INTO domains (id, name, origin, hostname, verification_token, authorization_confirmed)
      VALUES (${id}, ${body.name}, ${origin}, ${target.url.hostname}, ${token}, true)
      RETURNING *
    `.catch((error: unknown) => {
      if (String(error).includes('domains_origin_key')) throw Object.assign(new Error('Domain already exists'), { statusCode: 409 });
      throw error;
    });
    const profile = ScanProfileSchema.parse({});
    await database`
      INSERT INTO scan_profiles (id, domain_id, name, config, is_default)
      VALUES (${newId('profile')}, ${id}, 'Standard audit', ${database.json(profile)}, true)
    `;
    return reply.code(201).send(rows[0]);
  });

  app.post('/api/domains/:id/verify', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ method: z.enum(['dns', 'file']) }).parse(request.body);
    const rows = await database<Array<Record<string, unknown>>>`SELECT * FROM domains WHERE id = ${params.id}`;
    const domain = rows[0];
    if (!domain) return reply.code(404).send({ error: 'domain_not_found' });
    const verified = body.method === 'dns'
      ? await verifyDomainTxt(String(domain.hostname), String(domain.verification_token)).catch(() => false)
      : await verifyDomainFile(String(domain.origin), String(domain.verification_token)).catch(() => false);
    if (!verified) return reply.code(422).send({ error: 'verification_failed' });
    const updated = await database<Array<Record<string, unknown>>>`UPDATE domains SET verified_at = now(), verification_method = ${body.method}, updated_at = now() WHERE id = ${params.id} RETURNING *`;
    return updated[0];
  });

  app.get('/api/domains/:id/profiles', async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    return database`SELECT * FROM scan_profiles WHERE domain_id = ${id} ORDER BY is_default DESC, created_at`;
  });

  app.post('/api/domains/:id/profiles', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ name: z.string().min(1), config: ScanProfileSchema }).parse(request.body);
    const profileId = newId('profile');
    const rows = await database<Array<Record<string, unknown>>>`INSERT INTO scan_profiles (id, domain_id, name, config) VALUES (${profileId}, ${id}, ${body.name}, ${database.json(body.config)}) RETURNING *`;
    return reply.code(201).send(rows[0]);
  });

  app.patch('/api/profiles/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ name: z.string().min(1), config: ScanProfileSchema }).parse(request.body);
    const rows = await database<Array<Record<string, unknown>>>`UPDATE scan_profiles SET name = ${body.name}, config = ${database.json(body.config)}, updated_at = now() WHERE id = ${id} RETURNING *`;
    if (!rows[0]) return reply.code(404).send({ error: 'profile_not_found' });
    return rows[0];
  });

  app.post('/api/domains/:id/audits', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ profileId: z.string().optional() }).parse(request.body ?? {});
    const domains = await database<Array<Record<string, unknown>>>`SELECT * FROM domains WHERE id = ${id}`;
    const domain = domains[0];
    if (!domain) return reply.code(404).send({ error: 'domain_not_found' });
    if (config.requireDomainVerification && !domain.verified_at) return reply.code(403).send({ error: 'domain_verification_required' });
    if (!domain.authorization_confirmed) return reply.code(403).send({ error: 'authorization_confirmation_required' });
    const profiles = body.profileId
      ? await database<Array<Record<string, unknown>>>`SELECT * FROM scan_profiles WHERE id = ${body.profileId} AND domain_id = ${id}`
      : await database<Array<Record<string, unknown>>>`SELECT * FROM scan_profiles WHERE domain_id = ${id} ORDER BY is_default DESC LIMIT 1`;
    const profileRow = profiles[0];
    if (!profileRow) return reply.code(404).send({ error: 'profile_not_found' });
    const profile = ScanProfileSchema.parse(profileRow.config);
    if (profile.activeSecurity && !domain.verified_at) return reply.code(403).send({ error: 'active_scan_requires_verified_domain' });
    const auditId = newId('audit');
    const manifest: AuditManifest = {
      auditId, domainId: id, origin: String(domain.origin), startedAt: new Date().toISOString(),
      scannerVersions: { ruleset: '1.0.0' }, profile, profileHash: hashObject(profile), workerId: 'unassigned',
      environment: { platform: process.platform, node: process.version },
    };
    await database`INSERT INTO audits (id, domain_id, profile_id, status, manifest) VALUES (${auditId}, ${id}, ${String(profileRow.id)}, 'queued', ${database.json(manifest as never)})`;
    const jobId = await enqueue(database, 'audit', { auditId }, 50);
    return reply.code(202).send({ auditId, jobId, status: 'queued' });
  });

  app.get('/api/audits', async (request) => {
    const query = z.object({ domainId: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(request.query);
    return query.domainId
      ? database`SELECT * FROM audits WHERE domain_id = ${query.domainId} ORDER BY created_at DESC LIMIT ${query.limit}`
      : database`SELECT * FROM audits ORDER BY created_at DESC LIMIT ${query.limit}`;
  });

  app.get('/api/audits/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const audits = await database<Array<Record<string, unknown>>>`SELECT a.*, d.name AS domain_name, d.origin FROM audits a JOIN domains d ON d.id = a.domain_id WHERE a.id = ${id}`;
    if (!audits[0]) return reply.code(404).send({ error: 'audit_not_found' });
    const pages = await database`SELECT * FROM pages WHERE audit_id = ${id} ORDER BY normalized_url`;
    const findings = await database<Array<{ payload: Finding }>>`SELECT payload FROM findings WHERE audit_id = ${id} ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END`;
    const evidence = await database`SELECT * FROM evidence WHERE audit_id = ${id} ORDER BY created_at`;
    return { audit: audits[0], pages, findings: findings.map((row) => row.payload), evidence };
  });

  app.post('/api/audits/:id/cancel', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const rows = await database<Array<Record<string, unknown>>>`UPDATE audits SET status = 'cancelled', completed_at = now() WHERE id = ${id} AND status IN ('queued','running') RETURNING *`;
    if (!rows[0]) return reply.code(409).send({ error: 'audit_not_cancellable' });
    await database`UPDATE jobs SET status = 'cancelled', completed_at = now() WHERE payload->>'auditId' = ${id} AND status = 'queued'`;
    return rows[0];
  });

  app.post('/api/comparisons', async (request, reply) => {
    const body = z.object({ baselineAuditId: z.string(), currentAuditId: z.string() }).parse(request.body);
    const [baseline, current] = await Promise.all([loadComparisonAudit(database, body.baselineAuditId), loadComparisonAudit(database, body.currentAuditId)]);
    if (baseline.manifest.domainId !== current.manifest.domainId) return reply.code(422).send({ error: 'audits_must_belong_to_same_domain' });
    const comparison = compareAudits({ baseline, current });
    await database`
      INSERT INTO comparisons (id, baseline_audit_id, current_audit_id, payload)
      VALUES (${comparison.id}, ${body.baselineAuditId}, ${body.currentAuditId}, ${database.json(comparison as never)})
      ON CONFLICT (baseline_audit_id, current_audit_id) DO UPDATE SET payload = EXCLUDED.payload, created_at = now()
    `;
    return reply.code(201).send(comparison);
  });

  app.get('/api/comparisons/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const rows = await database<Array<{ payload: unknown }>>`SELECT payload FROM comparisons WHERE id = ${id}`;
    if (!rows[0]) return reply.code(404).send({ error: 'comparison_not_found' });
    return rows[0].payload;
  });

  app.post('/api/audits/:id/reports', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { format } = z.object({ format: z.enum(['html', 'pdf']) }).parse(request.body);
    return reply.code(201).send(await buildAuditReport(database, id, format));
  });

  app.post('/api/comparisons/:id/reports', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { format } = z.object({ format: z.enum(['html', 'pdf']) }).parse(request.body);
    return reply.code(201).send(await buildComparisonReport(database, id, format));
  });

  app.get('/api/evidence/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const rows = await database<Array<Record<string, unknown>>>`SELECT * FROM evidence WHERE id = ${id}`;
    const evidence = rows[0];
    if (!evidence) return reply.code(404).send({ error: 'evidence_not_found' });
    const data = await new ArtifactStore(database).read(String(evidence.relative_path));
    return reply.type(String(evidence.mime_type)).header('x-content-type-options', 'nosniff').send(Buffer.from(data));
  });

  app.get('/api/domains/:id/trends', async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    return database`SELECT id, status, scores, summary, started_at, completed_at, created_at FROM audits WHERE domain_id = ${id} AND status = 'completed' ORDER BY created_at`;
  });

  app.get('/api/domains/:id/schedules', async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    return database`SELECT s.*, p.name AS profile_name FROM schedules s JOIN scan_profiles p ON p.id=s.profile_id WHERE s.domain_id=${id} ORDER BY s.created_at`;
  });

  app.post('/api/domains/:id/schedules', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ profileId:z.string(), cron:z.string().min(5).max(120), timezone:z.string().min(1).max(100) }).parse(request.body);
    let next:Date;try{next=CronExpressionParser.parse(body.cron,{currentDate:new Date(),tz:body.timezone}).next().toDate()}catch{return reply.code(400).send({error:'invalid_cron_or_timezone'})}
    const profiles=await database<Array<{id:string}>>`SELECT id FROM scan_profiles WHERE id=${body.profileId} AND domain_id=${id}`;if(!profiles[0])return reply.code(404).send({error:'profile_not_found'});
    const scheduleId=newId('schedule');const rows=await database<Array<Record<string,unknown>>>`INSERT INTO schedules (id,domain_id,profile_id,cron,timezone,next_run_at) VALUES (${scheduleId},${id},${body.profileId},${body.cron},${body.timezone},${next}) RETURNING *`;return reply.code(201).send(rows[0]);
  });

  app.patch('/api/schedules/:id', async (request, reply) => {
    const { id }=z.object({id:z.string()}).parse(request.params);const body=z.object({enabled:z.boolean()}).parse(request.body);const rows=await database<Array<Record<string,unknown>>>`UPDATE schedules SET enabled=${body.enabled} WHERE id=${id} RETURNING *`;if(!rows[0])return reply.code(404).send({error:'schedule_not_found'});return rows[0];
  });

  app.delete('/api/schedules/:id', async (request, reply) => {
    const { id }=z.object({id:z.string()}).parse(request.params);const rows=await database<Array<{id:string}>>`DELETE FROM schedules WHERE id=${id} RETURNING id`;if(!rows[0])return reply.code(404).send({error:'schedule_not_found'});return {deleted:true};
  });

  app.get('/api/rules', async () => ({
    version:'1.0.0',principle:'No evidence, no definitive finding.',categories:[
      {category:'performance',source:'Lighthouse multi-run median',psychological:false},
      {category:'seo',source:'deterministic HTML, HTTP and sitemap rules',psychological:false},
      {category:'accessibility',source:'axe + WCAG rules; manual review still required',psychological:false},
      {category:'security',source:'passive posture checks and optional ZAP baseline',psychological:false},
      {category:'behavioral-ux',source:'observable friction proxies; not an emotion diagnosis',psychological:true},
      {category:'agent-readiness',source:'entity coverage and fact consistency',psychological:false},
    ]
  }));
}

async function loadComparisonAudit(database: Database, id: string): Promise<{ manifest: AuditManifest; scores: CategoryScore[]; findings: Finding[]; pages: PageSnapshot[] }> {
  const audits = await database<Array<Record<string, unknown>>>`SELECT * FROM audits WHERE id = ${id} AND status = 'completed'`;
  if (!audits[0]) throw new Error(`Completed audit not found: ${id}`);
  const findings = await database<Array<{ payload: Finding }>>`SELECT payload FROM findings WHERE audit_id = ${id}`;
  const pages = await database<Array<Record<string, unknown>>>`SELECT * FROM pages WHERE audit_id = ${id}`;
  return { manifest: audits[0].manifest as unknown as AuditManifest, scores: audits[0].scores as CategoryScore[], findings: findings.map((row) => row.payload), pages: pages.map(rowToPage) };
}

function rowToPage(row: Record<string, unknown>): PageSnapshot {
  return { id: String(row.id), auditId: String(row.audit_id), url: String(row.url), normalizedUrl: normalizeUrl(String(row.normalized_url)), finalUrl: String(row.final_url), statusCode: Number(row.status_code), template: row.template as PageSnapshot['template'], title: String(row.title), description: String(row.description), canonical: String(row.canonical), h1: row.h1 as string[], language: String(row.language), robots: String(row.robots), contentHash: String(row.content_hash), ...(row.dom_hash ? { domHash: String(row.dom_hash) } : {}), ...(row.screenshot_hash ? { screenshotHash: String(row.screenshot_hash) } : {}), rawHtmlBytes: Number(row.raw_html_bytes), headers: row.headers as Record<string,string>, metrics: row.metrics as Record<string,unknown>, resources: row.resources as PageSnapshot['resources'], createdAt: String(row.created_at) };
}
