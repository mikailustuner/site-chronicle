import { CronExpressionParser } from 'cron-parser';
import { hashObject, newId, ScanProfileSchema, type AuditManifest } from '@sitechronicle/core';
import type { Database } from './db.js';
import { config } from './config.js';

export async function processSchedules(database:Database):Promise<number>{
  const auditCount=await database.begin(async transaction=>{
    const rows=await transaction<Array<Record<string,unknown>>>`SELECT s.*,d.origin,d.authorization_confirmed,d.verified_at,p.config AS profile_config FROM schedules s JOIN domains d ON d.id=s.domain_id JOIN scan_profiles p ON p.id=s.profile_id WHERE s.enabled=true AND (s.next_run_at IS NULL OR s.next_run_at<=now()) ORDER BY s.next_run_at NULLS FIRST FOR UPDATE OF s SKIP LOCKED LIMIT 20`;
    let queued=0;
    for(const row of rows){
      const parsed=ScanProfileSchema.safeParse(row.profile_config);if(!parsed.success){await transaction`UPDATE schedules SET enabled=false,last_error='invalid_or_unsafe_profile',updated_at=now() WHERE id=${String(row.id)}`;continue}const denial=!row.authorization_confirmed?'authorization_confirmation_required':config.requireDomainVerification&&!row.verified_at?'domain_verification_required':null;
      if(denial){await transaction`UPDATE schedules SET enabled=false,last_error=${denial},updated_at=now() WHERE id=${String(row.id)}`;continue}
      let next:Date;try{next=CronExpressionParser.parse(String(row.cron),{currentDate:new Date(),tz:String(row.timezone)}).next().toDate()}catch{await transaction`UPDATE schedules SET enabled=false,last_error='invalid_cron_or_timezone',updated_at=now() WHERE id=${String(row.id)}`;continue}
      const active=await transaction<Array<{id:string}>>`SELECT id FROM audits WHERE domain_id=${String(row.domain_id)} AND profile_id=${String(row.profile_id)} AND status IN ('queued','running') LIMIT 1`;
      if(active[0]){await transaction`UPDATE schedules SET next_run_at=${next},last_error='previous_audit_still_active',updated_at=now() WHERE id=${String(row.id)}`;continue}
      const auditId=newId('audit');const profile=parsed.data;const manifest:AuditManifest={auditId,domainId:String(row.domain_id),origin:String(row.origin),startedAt:new Date().toISOString(),scannerVersions:{ruleset:'1.0.0'},profile,profileHash:hashObject(profile),workerId:'unassigned',environment:{platform:process.platform,node:process.version}};
      const inserted=await transaction<Array<{id:string}>>`INSERT INTO audits (id,domain_id,profile_id,status,trigger,manifest) VALUES (${auditId},${String(row.domain_id)},${String(row.profile_id)},'queued','schedule',${transaction.json(manifest as never)}) ON CONFLICT (domain_id,profile_id) WHERE status IN ('queued','running') DO NOTHING RETURNING id`;
      if(!inserted[0]){await transaction`UPDATE schedules SET next_run_at=${next},last_error='previous_audit_still_active',updated_at=now() WHERE id=${String(row.id)}`;continue}
      await transaction`INSERT INTO jobs (id,type,payload,status,priority) VALUES (${newId('job')},'audit',${transaction.json({auditId} as never)},'queued',50)`;
      await transaction`UPDATE schedules SET last_run_at=now(),next_run_at=${next},last_error=null,updated_at=now() WHERE id=${String(row.id)}`;queued+=1;
    }
    return queued;
  });
  const intelligenceCount=await processIntelligenceSchedules(database);
  return auditCount+intelligenceCount;
}

async function processIntelligenceSchedules(database:Database):Promise<number>{
  return database.begin(async transaction=>{
    const rows=await transaction<Array<Record<string,unknown>>>`SELECT * FROM automation_schedules WHERE enabled=true AND (next_run_at IS NULL OR next_run_at<=now()) ORDER BY priority,next_run_at NULLS FIRST FOR UPDATE SKIP LOCKED LIMIT 50`;
    let queued=0;
    for(const row of rows){
      try{
        const next=CronExpressionParser.parse(String(row.cron),{currentDate:new Date(),tz:String(row.timezone)}).next().toDate();
        const jobType=String(row.job_type);const domainId=row.domain_id?String(row.domain_id):undefined;
        const payload={...((row.config??{}) as Record<string,unknown>),...(domainId?{domainId}:{}),automationId:String(row.id)};
        const dedupeKey=`automation:${row.id}:${new Date(row.next_run_at as string??new Date()).toISOString()}`;
        await transaction`INSERT INTO jobs(id,type,payload,status,priority,domain_id,dedupe_key) VALUES(${newId('job')},${jobType==='serp_critical'||jobType==='serp_standard'?'serp_batch':jobType},${transaction.json((jobType==='serp_critical'?{...payload,tier:'critical'}:jobType==='serp_standard'?{...payload,tier:'standard'}:payload) as never)},'queued',${Number(row.priority)},${domainId??null},${dedupeKey}) ON CONFLICT DO NOTHING`;
        await transaction`UPDATE automation_schedules SET last_run_at=now(),last_error=null,next_run_at=${next},updated_at=now() WHERE id=${String(row.id)}`;queued++;
      }catch(error){await transaction`UPDATE automation_schedules SET last_error=${String(error).slice(0,2000)},updated_at=now() WHERE id=${String(row.id)}`}
    }
    return queued;
  });
}
