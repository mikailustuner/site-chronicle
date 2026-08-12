import type { FastifyInstance } from 'fastify';
import { newId } from '@sitechronicle/core';
import { CronExpressionParser } from 'cron-parser';
import { z } from 'zod';
import type { Database } from './db.js';
import { enqueue } from './queue.js';
import { credentialHint, encryptCredentials } from './connectors/secrets.js';

const Provider = z.enum(['dataforseo', 'serpapi', 'crux', 'commoncrawl']);
const Intent = z.enum(['commercial', 'informational', 'local', 'navigational', 'transactional', 'unknown']);
const Tier = z.enum(['critical', 'standard', 'discovery', 'paused']);
const JobType = z.enum(['availability_probe','serp_critical','serp_standard','light_crawl','deep_crawl','lighthouse_sample','crux_refresh','competitor_refresh','common_crawl_refresh','opportunity_rebuild','experiment_evaluate','portfolio_digest']);

function normalizeQuery(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ').trim();
}

export async function registerIntelligenceRoutes(app: FastifyInstance, database: Database): Promise<void> {
  app.get('/api/connectors', async () => database`
    SELECT id,provider,display_name,enabled,credential_hint,config,daily_budget,monthly_budget,
      last_test_status,last_test_message,last_tested_at,circuit_open_until,failure_count,created_at,updated_at,
      COALESCE((SELECT sum(actual_cost)::double precision FROM connector_runs r WHERE r.connector_id=c.id AND r.started_at>=date_trunc('day',now())),0) AS spent_today,
      COALESCE((SELECT sum(actual_cost)::double precision FROM connector_runs r WHERE r.connector_id=c.id AND r.started_at>=date_trunc('month',now())),0) AS spent_month
    FROM connector_configs c ORDER BY provider
  `);

  app.put('/api/connectors/:provider', async (request, reply) => {
    const { provider } = z.object({ provider: Provider }).parse(request.params);
    const body = z.object({
      displayName: z.string().min(1).max(100).optional(), enabled: z.boolean().default(true),
      credentials: z.record(z.string(), z.string().max(4000)).optional(),
      config: z.record(z.string(), z.unknown()).default({}),
      dailyBudget: z.number().min(0).max(1_000_000).default(0), monthlyBudget: z.number().min(0).max(10_000_000).default(0),
    }).parse(request.body);
    validateCredentialShape(provider, body.credentials);
    const existing = await database<Array<{ id:string; encrypted_credentials:string|null; credential_hint:string|null }>>`SELECT id,encrypted_credentials,credential_hint FROM connector_configs WHERE provider=${provider}`;
    const encrypted = body.credentials ? encryptCredentials(body.credentials) : existing[0]?.encrypted_credentials ?? null;
    const hint = body.credentials ? credentialHint(body.credentials) : existing[0]?.credential_hint ?? null;
    const id = existing[0]?.id ?? newId('connector');
    const rows = await database<Array<Record<string,unknown>>>`
      INSERT INTO connector_configs(id,provider,display_name,enabled,encrypted_credentials,credential_hint,config,daily_budget,monthly_budget)
      VALUES (${id},${provider},${body.displayName ?? providerLabel(provider)},${body.enabled},${encrypted},${hint},${database.json(body.config as never)},${body.dailyBudget},${body.monthlyBudget})
      ON CONFLICT(provider) DO UPDATE SET display_name=EXCLUDED.display_name,enabled=EXCLUDED.enabled,
        encrypted_credentials=EXCLUDED.encrypted_credentials,credential_hint=EXCLUDED.credential_hint,config=EXCLUDED.config,
        daily_budget=EXCLUDED.daily_budget,monthly_budget=EXCLUDED.monthly_budget,updated_at=now()
      RETURNING id,provider,display_name,enabled,credential_hint,config,daily_budget,monthly_budget,last_test_status,last_test_message,last_tested_at
    `;
    return reply.send(rows[0]);
  });

  app.post('/api/connectors/:provider/test', async (request, reply) => {
    const { provider } = z.object({ provider: Provider }).parse(request.params);
    const rows = await database<Array<{ id:string }>>`SELECT id FROM connector_configs WHERE provider=${provider} AND enabled=true`;
    if (!rows[0]) return reply.code(404).send({ error: 'enabled_connector_not_found' });
    const jobId = await enqueue(database, 'connector_test', { connectorId: rows[0].id }, 5, { connectorId: rows[0].id, dedupeKey: `connector-test:${rows[0].id}` });
    return reply.code(202).send({ jobId });
  });

  app.delete('/api/connectors/:provider', async (request, reply) => {
    const { provider } = z.object({ provider: Provider }).parse(request.params);
    const rows = await database<Array<{id:string}>>`DELETE FROM connector_configs WHERE provider=${provider} RETURNING id`;
    if (!rows[0]) return reply.code(404).send({error:'connector_not_found'});
    return { deleted:true };
  });

  app.get('/api/visibility', async (request) => {
    const query = z.object({domainId:z.string().optional(),days:z.coerce.number().int().min(1).max(365).default(30)}).parse(request.query);
    const domains = await database`SELECT id,name,origin FROM domains WHERE archived_at IS NULL ORDER BY name`;
    const summary = await database`
      WITH latest AS (
        SELECT DISTINCT ON (sr.keyword_id,sr.location,sr.language,sr.device)
          sr.*,k.search_project_id,k.query,k.target_url,sp.domain_id
        FROM serp_runs sr JOIN keywords k ON k.id=sr.keyword_id JOIN search_projects sp ON sp.id=k.search_project_id
        WHERE sr.status IN ('success','partial') AND sr.observed_at>=now()-(${query.days}*interval '1 day')
          AND (${query.domainId??null}::text IS NULL OR sp.domain_id=${query.domainId??null})
        ORDER BY sr.keyword_id,sr.location,sr.language,sr.device,sr.observed_at DESC
      )
      SELECT l.domain_id,d.name AS domain_name,count(*)::int AS tracked_contexts,
        count(*) FILTER(WHERE target.rank_absolute<=3)::int AS top3,
        count(*) FILTER(WHERE target.rank_absolute<=10)::int AS top10,
        count(*) FILTER(WHERE target.rank_absolute<=20)::int AS top20,
        count(*) FILTER(WHERE target.rank_absolute IS NULL)::int AS not_visible,
        avg(CASE WHEN target.rank_absolute IS NOT NULL THEN 1.0/target.rank_absolute ELSE 0 END)::double precision AS visibility_score,
        max(l.observed_at) AS last_observed_at
      FROM latest l JOIN domains d ON d.id=l.domain_id
      LEFT JOIN LATERAL (SELECT min(rank_absolute)::integer AS rank_absolute FROM serp_results WHERE serp_run_id=l.id AND is_target=true AND result_type='organic') target ON true
      GROUP BY l.domain_id,d.name ORDER BY visibility_score DESC NULLS LAST
    `;
    const trend = await database`
      SELECT sp.domain_id,date_trunc('day',sr.observed_at) AS day,
        avg(CASE WHEN r.rank_absolute IS NOT NULL THEN 1.0/r.rank_absolute ELSE 0 END)::double precision AS visibility,
        percentile_cont(.5) WITHIN GROUP(ORDER BY r.rank_absolute)::double precision AS median_rank,
        count(*)::int AS samples
      FROM serp_runs sr JOIN keywords k ON k.id=sr.keyword_id JOIN search_projects sp ON sp.id=k.search_project_id
      LEFT JOIN LATERAL(SELECT min(rank_absolute)::integer AS rank_absolute FROM serp_results WHERE serp_run_id=sr.id AND is_target=true AND result_type='organic') r ON true
      WHERE sr.status IN ('success','partial') AND sr.observed_at>=now()-(${query.days}*interval '1 day')
        AND (${query.domainId??null}::text IS NULL OR sp.domain_id=${query.domainId??null})
      GROUP BY sp.domain_id,date_trunc('day',sr.observed_at) ORDER BY day
    `;
    const changes = await database`
      WITH ranked AS (
        SELECT k.id,k.query,sp.domain_id,sr.id AS run_id,sr.location,sr.language,sr.device,sr.observed_at,
          (SELECT min(rank_absolute) FROM serp_results WHERE serp_run_id=sr.id AND is_target=true AND result_type='organic') AS rank,
          row_number() OVER(PARTITION BY k.id,sr.location,sr.language,sr.device ORDER BY sr.observed_at DESC) AS n
        FROM serp_runs sr JOIN keywords k ON k.id=sr.keyword_id JOIN search_projects sp ON sp.id=k.search_project_id
        WHERE sr.status IN ('success','partial') AND (${query.domainId??null}::text IS NULL OR sp.domain_id=${query.domainId??null})
      ) SELECT a.domain_id,a.id AS keyword_id,a.query,a.location,a.language,a.device,a.rank AS current_rank,b.rank AS previous_rank,
        CASE WHEN a.rank IS NULL THEN NULL WHEN b.rank IS NULL THEN NULL ELSE b.rank-a.rank END AS improvement,a.observed_at
      FROM ranked a LEFT JOIN ranked b ON b.id=a.id AND b.location=a.location AND b.language=a.language AND b.device=a.device AND b.n=2
      WHERE a.n=1 ORDER BY abs(COALESCE(b.rank,101)-COALESCE(a.rank,101)) DESC LIMIT 100
    `;
    const configured = await database<Array<{count:number}>>`SELECT count(*)::int AS count FROM connector_configs WHERE provider IN ('dataforseo','serpapi') AND enabled=true`;
    return {domains,summary,trend,changes,serpStatus:Number(configured[0]?.count??0)>0?'configured':'not-configured',contextNotice:'Positions are provider observations scoped to time, location, language and device; they are not a universal Google rank.'};
  });

  app.get('/api/keywords', async (request) => {
    const query = z.object({domainId:z.string().optional(),status:z.enum(['candidate','approved','paused','all']).default('all')}).parse(request.query);
    return database`
      SELECT k.*,kc.name AS cluster_name,sp.domain_id,d.name AS domain_name,sp.country,sp.language,sp.location,sp.devices,
        last_run.observed_at,last_run.provider,last_run.device AS observed_device,last_rank.rank_absolute AS current_rank,last_rank.url AS ranking_url
      FROM keywords k JOIN search_projects sp ON sp.id=k.search_project_id JOIN domains d ON d.id=sp.domain_id
      LEFT JOIN keyword_clusters kc ON kc.id=k.cluster_id
      LEFT JOIN LATERAL(SELECT * FROM serp_runs WHERE keyword_id=k.id AND status IN ('success','partial') ORDER BY observed_at DESC LIMIT 1) last_run ON true
      LEFT JOIN LATERAL(SELECT rank_absolute,url FROM serp_results WHERE serp_run_id=last_run.id AND is_target=true AND result_type='organic' ORDER BY rank_absolute LIMIT 1) last_rank ON true
      WHERE d.archived_at IS NULL AND (${query.domainId??null}::text IS NULL OR sp.domain_id=${query.domainId??null}) AND (${query.status}='all' OR k.status=${query.status})
      ORDER BY k.business_priority DESC,k.updated_at DESC
    `;
  });

  app.post('/api/domains/:id/keywords', async (request, reply) => {
    const { id } = z.object({id:z.string()}).parse(request.params);
    const body = z.object({query:z.string().min(1).max(300),targetUrl:z.string().url().optional(),intent:Intent.default('unknown'),trackingTier:Tier.default('standard'),businessPriority:z.number().int().min(0).max(5).default(3),status:z.enum(['candidate','approved','paused']).default('approved')}).parse(request.body);
    const projects = await database<Array<{id:string}>>`SELECT id FROM search_projects WHERE domain_id=${id}`;
    if (!projects[0]) return reply.code(404).send({error:'search_project_not_found'});
    const keywordId = newId('keyword');
    const rows = await database<Array<Record<string,unknown>>>`
      INSERT INTO keywords(id,search_project_id,query,normalized_query,source,target_url,intent,tracking_tier,status,business_priority)
      VALUES(${keywordId},${projects[0].id},${body.query.trim()},${normalizeQuery(body.query)},'manual',${body.targetUrl??null},${body.intent},${body.trackingTier},${body.status},${body.businessPriority})
      ON CONFLICT(search_project_id,normalized_query) DO UPDATE SET target_url=COALESCE(EXCLUDED.target_url,keywords.target_url),intent=EXCLUDED.intent,tracking_tier=EXCLUDED.tracking_tier,status=EXCLUDED.status,business_priority=EXCLUDED.business_priority,updated_at=now()
      RETURNING *
    `;
    return reply.code(201).send(rows[0]);
  });

  app.post('/api/domains/:id/keywords/discover', async (request, reply) => {
    const { id } = z.object({id:z.string()}).parse(request.params);
    const jobId = await enqueue(database,'keyword_discovery',{domainId:id},50,{domainId:id,dedupeKey:`keyword-discovery:${id}`});
    return reply.code(202).send({jobId});
  });

  app.patch('/api/keywords/:id', async (request, reply) => {
    const {id}=z.object({id:z.string()}).parse(request.params);
    const body=z.object({targetUrl:z.string().url().nullable().optional(),intent:Intent.optional(),trackingTier:Tier.optional(),status:z.enum(['candidate','approved','paused']).optional(),businessPriority:z.number().int().min(0).max(5).optional()}).parse(request.body);
    const rows=await database<Array<Record<string,unknown>>>`UPDATE keywords SET target_url=COALESCE(${body.targetUrl??null},target_url),intent=COALESCE(${body.intent??null},intent),tracking_tier=COALESCE(${body.trackingTier??null},tracking_tier),status=COALESCE(${body.status??null},status),business_priority=COALESCE(${body.businessPriority??null},business_priority),updated_at=now() WHERE id=${id} RETURNING *`;
    if(!rows[0])return reply.code(404).send({error:'keyword_not_found'});return rows[0];
  });

  app.delete('/api/keywords/:id',async(request,reply)=>{const{id}=z.object({id:z.string()}).parse(request.params);const rows=await database<Array<{id:string}>>`DELETE FROM keywords WHERE id=${id} RETURNING id`;if(!rows[0])return reply.code(404).send({error:'keyword_not_found'});return{deleted:true}});

  app.post('/api/domains/:id/serp/run', async (request, reply) => {
    const {id}=z.object({id:z.string()}).parse(request.params);
    const body=z.object({tier:z.enum(['critical','standard','discovery','all']).default('all'),keywordIds:z.array(z.string()).max(1000).optional()}).parse(request.body??{});
    const connector=await database<Array<{id:string}>>`SELECT id FROM connector_configs WHERE provider IN ('dataforseo','serpapi') AND enabled=true AND (circuit_open_until IS NULL OR circuit_open_until<now()) ORDER BY CASE provider WHEN 'dataforseo' THEN 1 ELSE 2 END LIMIT 1`;
    if(!connector[0])return reply.code(409).send({error:'serp_connector_not_configured'});
    const jobId=await enqueue(database,'serp_batch',{domainId:id,tier:body.tier,keywordIds:body.keywordIds??[]},20,{domainId:id,connectorId:connector[0].id,dedupeKey:`serp:${id}:${body.tier}:${new Date().toISOString().slice(0,13)}`});
    return reply.code(202).send({jobId});
  });

  app.get('/api/keywords/:id/history',async(request,reply)=>{const{id}=z.object({id:z.string()}).parse(request.params);const keywords=await database`SELECT k.*,sp.domain_id,sp.country,sp.language,sp.location FROM keywords k JOIN search_projects sp ON sp.id=k.search_project_id WHERE k.id=${id}`;if(!keywords[0])return reply.code(404).send({error:'keyword_not_found'});const runs=await database`SELECT sr.*,(SELECT min(rank_absolute) FROM serp_results WHERE serp_run_id=sr.id AND is_target=true AND result_type='organic') AS target_rank,(SELECT url FROM serp_results WHERE serp_run_id=sr.id AND is_target=true AND result_type='organic' ORDER BY rank_absolute LIMIT 1) AS ranking_url FROM serp_runs sr WHERE keyword_id=${id} ORDER BY observed_at`;return{keyword:keywords[0],runs,notice:'Each value is a contextual provider observation, not a universal rank.'}});

  app.get('/api/competitors',async(request)=>{const query=z.object({domainId:z.string().optional()}).parse(request.query);return database`SELECT c.*,d.name AS domain_name,(SELECT count(*)::int FROM competitor_snapshots s WHERE s.competitor_id=c.id) AS snapshots FROM competitors c JOIN domains d ON d.id=c.domain_id WHERE d.archived_at IS NULL AND (${query.domainId??null}::text IS NULL OR c.domain_id=${query.domainId??null}) ORDER BY c.status,c.overlap_keywords DESC,c.last_seen_at DESC`});

  app.post('/api/domains/:id/competitors',async(request,reply)=>{const{id}=z.object({id:z.string()}).parse(request.params);const body=z.object({hostname:z.string().min(1).max(253),origin:z.string().url().optional(),status:z.enum(['candidate','approved','ignored']).default('approved')}).parse(request.body);const hostname=body.hostname.toLowerCase().replace(/^www\./,'');const rows=await database<Array<Record<string,unknown>>>`INSERT INTO competitors(id,domain_id,hostname,origin,source,status) VALUES(${newId('competitor')},${id},${hostname},${body.origin??`https://${hostname}`},'manual',${body.status}) ON CONFLICT(domain_id,hostname) DO UPDATE SET status=EXCLUDED.status,origin=EXCLUDED.origin,updated_at=now() RETURNING *`;return reply.code(201).send(rows[0])});
  app.patch('/api/competitors/:id',async(request,reply)=>{const{id}=z.object({id:z.string()}).parse(request.params);const{status}=z.object({status:z.enum(['candidate','approved','ignored'])}).parse(request.body);const rows=await database<Array<Record<string,unknown>>>`UPDATE competitors SET status=${status},updated_at=now() WHERE id=${id} RETURNING *`;if(!rows[0])return reply.code(404).send({error:'competitor_not_found'});return rows[0]});
  app.delete('/api/competitors/:id',async(request,reply)=>{const{id}=z.object({id:z.string()}).parse(request.params);const rows=await database<Array<{id:string}>>`DELETE FROM competitors WHERE id=${id} RETURNING id`;if(!rows[0])return reply.code(404).send({error:'competitor_not_found'});return{deleted:true}});
  app.post('/api/domains/:id/competitors/refresh',async(request,reply)=>{const{id}=z.object({id:z.string()}).parse(request.params);const jobId=await enqueue(database,'competitor_refresh',{domainId:id},60,{domainId:id,dedupeKey:`competitor-refresh:${id}:${new Date().toISOString().slice(0,10)}`});return reply.code(202).send({jobId})});

  app.get('/api/ranking-gaps',async(request)=>{const query=z.object({domainId:z.string().optional()}).parse(request.query);return database`SELECT g.*,k.query,d.name AS domain_name FROM ranking_gap_candidates g LEFT JOIN keywords k ON k.id=g.keyword_id JOIN domains d ON d.id=g.domain_id WHERE d.archived_at IS NULL AND (${query.domainId??null}::text IS NULL OR g.domain_id=${query.domainId??null}) ORDER BY CASE g.confidence WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,g.observed_at DESC LIMIT 500`});

  app.get('/api/technical-health',async(request)=>{const query=z.object({domainId:z.string().optional(),limit:z.coerce.number().int().min(1).max(1000).default(500)}).parse(request.query);const findings=await database`SELECT f.id,f.audit_id,f.rule_id,f.category,f.severity,f.title,f.payload,f.created_at,a.domain_id,d.name AS domain_name,d.origin FROM findings f JOIN audits a ON a.id=f.audit_id JOIN domains d ON d.id=a.domain_id WHERE a.id IN(SELECT DISTINCT ON(domain_id) id FROM audits WHERE status='completed' ORDER BY domain_id,completed_at DESC) AND d.archived_at IS NULL AND (${query.domainId??null}::text IS NULL OR a.domain_id=${query.domainId??null}) ORDER BY CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END,f.created_at DESC LIMIT ${query.limit}`;const coverage=await database`SELECT d.id AS domain_id,d.name,max(a.completed_at) FILTER(WHERE a.status='completed') AS last_audit_at,count(a.id) FILTER(WHERE a.status='completed')::int AS audits FROM domains d LEFT JOIN audits a ON a.domain_id=d.id WHERE d.archived_at IS NULL GROUP BY d.id,d.name ORDER BY d.name`;return{findings,coverage,notice:'Findings come from the latest completed audit per site; missing audit data is unavailable, not healthy.'}});

  app.get('/api/public-performance',async(request)=>{const query=z.object({domainId:z.string().optional(),days:z.coerce.number().int().min(1).max(730).default(90)}).parse(request.query);const metrics=await database`SELECT p.*,d.name AS domain_name,d.origin FROM public_metric_series p JOIN domains d ON d.id=p.domain_id WHERE d.archived_at IS NULL AND (${query.domainId??null}::text IS NULL OR p.domain_id=${query.domainId??null}) AND p.observed_at>=now()-(${query.days}*interval '1 day') ORDER BY p.observed_at`;const coverage=await database`SELECT d.id AS domain_id,d.name,CASE WHEN EXISTS(SELECT 1 FROM public_metric_series p WHERE p.domain_id=d.id AND p.status='measured') THEN 'measured' WHEN EXISTS(SELECT 1 FROM public_metric_series p WHERE p.domain_id=d.id AND p.status='no-public-data') THEN 'no-public-data' ELSE 'not-configured' END AS status,max(p.observed_at) AS last_observed_at FROM domains d LEFT JOIN public_metric_series p ON p.domain_id=d.id WHERE d.archived_at IS NULL AND (${query.domainId??null}::text IS NULL OR d.id=${query.domainId??null}) GROUP BY d.id,d.name ORDER BY d.name`;return{metrics,coverage,notice:'CrUX field data and Lighthouse lab data are separate. Missing public data is not zero.'}});
  app.post('/api/domains/:id/public-performance/refresh',async(request,reply)=>{const{id}=z.object({id:z.string()}).parse(request.params);const jobId=await enqueue(database,'public_performance',{domainId:id},40,{domainId:id,dedupeKey:`public-performance:${id}:${new Date().toISOString().slice(0,10)}`});return reply.code(202).send({jobId})});

  app.get('/api/changes',async(request)=>{const query=z.object({domainId:z.string().optional()}).parse(request.query);const changes=await database`SELECT c.*,d.name AS domain_name FROM change_events c JOIN domains d ON d.id=c.domain_id WHERE (${query.domainId??null}::text IS NULL OR c.domain_id=${query.domainId??null}) ORDER BY deployed_at DESC`;const experiments=await database`SELECT e.*,d.name AS domain_name,c.title AS change_title FROM experiments e JOIN domains d ON d.id=e.domain_id LEFT JOIN change_events c ON c.id=e.change_event_id WHERE (${query.domainId??null}::text IS NULL OR e.domain_id=${query.domainId??null}) ORDER BY e.created_at DESC`;return{changes,experiments}});
  app.post('/api/domains/:id/changes',async(request,reply)=>{const{id}=z.object({id:z.string()}).parse(request.params);const body=z.object({title:z.string().min(1).max(200),description:z.string().max(5000).default(''),pageUrls:z.array(z.string().url()).max(100).default([]),keywordIds:z.array(z.string()).max(1000).default([]),deployedAt:z.coerce.date(),externalReference:z.string().max(500).optional()}).parse(request.body);const rows=await database<Array<Record<string,unknown>>>`INSERT INTO change_events(id,domain_id,title,description,page_urls,keyword_ids,deployed_at,external_reference) VALUES(${newId('change')},${id},${body.title},${body.description},${database.json(body.pageUrls as never)},${database.json(body.keywordIds as never)},${body.deployedAt},${body.externalReference??null}) RETURNING *`;return reply.code(201).send(rows[0])});
  app.post('/api/domains/:id/experiments',async(request,reply)=>{const{id}=z.object({id:z.string()}).parse(request.params);const body=z.object({changeEventId:z.string().optional(),title:z.string().min(1).max(200),hypothesis:z.string().min(1).max(5000),targetMetric:z.string().min(1).max(100),targetKeywordIds:z.array(z.string()).max(1000).default([]),controlKeywordIds:z.array(z.string()).max(1000).default([]),baselineStart:z.coerce.date(),baselineEnd:z.coerce.date(),evaluationStart:z.coerce.date(),evaluationEnd:z.coerce.date(),guardrails:z.array(z.string()).max(30).default([])}).parse(request.body);if(body.baselineStart>=body.baselineEnd||body.evaluationStart>=body.evaluationEnd)return reply.code(400).send({error:'invalid_experiment_window'});const rows=await database<Array<Record<string,unknown>>>`INSERT INTO experiments(id,domain_id,change_event_id,title,hypothesis,target_metric,target_keyword_ids,control_keyword_ids,baseline_start,baseline_end,evaluation_start,evaluation_end,guardrails) VALUES(${newId('experiment')},${id},${body.changeEventId??null},${body.title},${body.hypothesis},${body.targetMetric},${database.json(body.targetKeywordIds as never)},${database.json(body.controlKeywordIds as never)},${body.baselineStart},${body.baselineEnd},${body.evaluationStart},${body.evaluationEnd},${database.json(body.guardrails as never)}) RETURNING *`;return reply.code(201).send(rows[0])});
  app.post('/api/experiments/:id/evaluate',async(request,reply)=>{const{id}=z.object({id:z.string()}).parse(request.params);const rows=await database<Array<{domain_id:string}>>`SELECT domain_id FROM experiments WHERE id=${id}`;if(!rows[0])return reply.code(404).send({error:'experiment_not_found'});const jobId=await enqueue(database,'experiment_evaluate',{experimentId:id,domainId:rows[0].domain_id},30,{domainId:rows[0].domain_id,dedupeKey:`experiment:${id}:${new Date().toISOString().slice(0,10)}`});return reply.code(202).send({jobId})});

  app.get('/api/intelligence-automations',async()=>database`SELECT a.*,d.name AS domain_name FROM automation_schedules a LEFT JOIN domains d ON d.id=a.domain_id ORDER BY a.enabled DESC,a.next_run_at`);
  app.post('/api/intelligence-automations',async(request,reply)=>{const body=z.object({domainId:z.string().optional(),jobType:JobType,cron:z.string().min(5).max(120),timezone:z.string().min(1).max(100),priority:z.number().int().min(1).max(1000).default(100),config:z.record(z.string(),z.unknown()).default({})}).parse(request.body);let next:Date;try{next=CronExpressionParser.parse(body.cron,{currentDate:new Date(),tz:body.timezone}).next().toDate()}catch{return reply.code(400).send({error:'invalid_cron_or_timezone'})}const rows=await database<Array<Record<string,unknown>>>`INSERT INTO automation_schedules(id,domain_id,job_type,cron,timezone,priority,config,next_run_at) VALUES(${newId('automation')},${body.domainId??null},${body.jobType},${body.cron},${body.timezone},${body.priority},${database.json(body.config as never)},${next}) RETURNING *`;return reply.code(201).send(rows[0])});
  app.patch('/api/intelligence-automations/:id',async(request,reply)=>{const{id}=z.object({id:z.string()}).parse(request.params);const{enabled}=z.object({enabled:z.boolean()}).parse(request.body);const rows=await database<Array<Record<string,unknown>>>`UPDATE automation_schedules SET enabled=${enabled},last_error=null,updated_at=now() WHERE id=${id} RETURNING *`;if(!rows[0])return reply.code(404).send({error:'automation_not_found'});return rows[0]});
  app.delete('/api/intelligence-automations/:id',async(request,reply)=>{const{id}=z.object({id:z.string()}).parse(request.params);const rows=await database<Array<{id:string}>>`DELETE FROM automation_schedules WHERE id=${id} RETURNING id`;if(!rows[0])return reply.code(404).send({error:'automation_not_found'});return{deleted:true}});

  app.get('/api/evidence-archive',async(request)=>{const query=z.object({domainId:z.string().optional(),limit:z.coerce.number().int().min(1).max(500).default(200)}).parse(request.query);const audit=await database`SELECT e.id,e.kind,e.sha256,e.mime_type,e.page_url,e.metadata,e.created_at,a.domain_id,d.name AS domain_name,'audit' AS source FROM evidence e JOIN audits a ON a.id=e.audit_id JOIN domains d ON d.id=a.domain_id WHERE (${query.domainId??null}::text IS NULL OR a.domain_id=${query.domainId??null}) ORDER BY e.created_at DESC LIMIT ${query.limit}`;const external=await database`SELECT e.id,e.kind,e.sha256,e.mime_type,NULL AS page_url,e.metadata,e.observed_at AS created_at,e.domain_id,d.name AS domain_name,'external' AS source FROM external_artifacts e LEFT JOIN domains d ON d.id=e.domain_id WHERE (${query.domainId??null}::text IS NULL OR e.domain_id=${query.domainId??null}) ORDER BY e.observed_at DESC LIMIT ${query.limit}`;return[...audit,...external].sort((a,b)=>Date.parse(String(b.created_at))-Date.parse(String(a.created_at))).slice(0,query.limit)});

  app.get('/api/intelligence-status',async()=>{const [jobs,connectors,sources]=await Promise.all([database`SELECT type,status,count(*)::int AS count,min(created_at) AS oldest FROM jobs WHERE created_at>now()-interval '7 days' GROUP BY type,status ORDER BY type,status`,database`SELECT provider,enabled,last_test_status,last_tested_at,failure_count,circuit_open_until FROM connector_configs ORDER BY provider`,database`SELECT d.id,d.name,max(a.completed_at) AS last_audit,max(sr.observed_at) AS last_serp,max(p.observed_at) AS last_public_metric FROM domains d LEFT JOIN audits a ON a.domain_id=d.id AND a.status='completed' LEFT JOIN search_projects sp ON sp.domain_id=d.id LEFT JOIN keywords k ON k.search_project_id=sp.id LEFT JOIN serp_runs sr ON sr.keyword_id=k.id AND sr.status IN ('success','partial') LEFT JOIN public_metric_series p ON p.domain_id=d.id WHERE d.archived_at IS NULL GROUP BY d.id,d.name ORDER BY d.name`]);return{jobs,connectors,sources}});
}

function providerLabel(provider:z.infer<typeof Provider>):string{return({dataforseo:'DataForSEO SERP',serpapi:'SerpApi',crux:'Chrome UX Report',commoncrawl:'Common Crawl'} as const)[provider]}
function validateCredentialShape(provider:z.infer<typeof Provider>,credentials?:Record<string,string>):void{
  if(provider==='commoncrawl')return;
  if(!credentials)return;
  if(provider==='dataforseo'&&(!credentials.login||!credentials.password))throw Object.assign(new Error('DataForSEO login and password are required'),{statusCode:400});
  if((provider==='serpapi'||provider==='crux')&&!credentials.apiKey)throw Object.assign(new Error(`${provider} apiKey is required`),{statusCode:400});
}
