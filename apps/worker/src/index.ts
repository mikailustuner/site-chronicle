import { sql } from './db.js';
import { config } from './config.js';
import { claimJob, completeJob, failJob, recoverStaleJobs, refreshJobLock, type Job } from './queue.js';
import { runAudit } from './audit-runner.js';
import { processSchedules } from './scheduler.js';
import { cleanupRetention, cleanupTelemetry } from './retention.js';
import { getAuditProxy } from './security/proxy.js';

let stopping=false;let lastSchedule=0;let lastHeartbeat=0;let lastRetention=0;let lastRecovery=Date.now();const active=new Set<Promise<void>>();
const auditProxy=await getAuditProxy();await recoverStaleJobs(sql);await heartbeat();console.log(`SiteChronicle worker ${config.workerId} started with concurrency ${config.concurrency}.`);
while(!stopping){
  if(Date.now()-lastHeartbeat>15_000){await heartbeat().catch(error=>console.error('Heartbeat',error));lastHeartbeat=Date.now()}
  if(Date.now()-lastRecovery>60_000){await recoverStaleJobs(sql).catch(error=>console.error('Stale job recovery',error));lastRecovery=Date.now()}
  if(Date.now()-lastSchedule>60_000){await processSchedules(sql).catch(error=>console.error('Scheduler',error));lastSchedule=Date.now()}
  if(Date.now()-lastRetention>86_400_000){if(config.retentionDays>0)await cleanupRetention(sql,config.retentionDays).catch(error=>console.error('Retention',error));await cleanupTelemetry(sql,config.telemetryRetentionDays).catch(error=>console.error('Telemetry retention',error));lastRetention=Date.now()}
  while(active.size<config.concurrency){const job=await claimJob(sql,config.workerId);if(!job)break;const promise=handle(job).finally(()=>active.delete(promise));active.add(promise)}
  if(active.size===0)await sleep(config.pollIntervalMs);else await Promise.race([...active,sleep(config.pollIntervalMs)]);
}
await Promise.allSettled(active);await sql`DELETE FROM worker_heartbeats WHERE worker_id=${config.workerId}`.catch(()=>undefined);await auditProxy.close();await sql.end({timeout:10});

async function handle(job:Job):Promise<void>{const timer=setInterval(()=>{void refreshJobLock(sql,job.id,config.workerId).then(ok=>{if(!ok)console.error(`Job ${job.id} lock heartbeat was rejected`)})},60_000);timer.unref();try{if(job.type==='audit')await runAudit(sql,String(job.payload.auditId));else throw new Error(`Unknown job type: ${job.type}`);await completeJob(sql,job.id,config.workerId)}catch(error){console.error(`Job ${job.id} failed`,error);await failJob(sql,job,error,config.workerId)}finally{clearInterval(timer)}}
async function heartbeat():Promise<void>{await sql`INSERT INTO worker_heartbeats (worker_id,started_at,last_seen_at,concurrency,metadata) VALUES (${config.workerId},now(),now(),${config.concurrency},${sql.json({node:process.version,platform:process.platform} as never)}) ON CONFLICT (worker_id) DO UPDATE SET last_seen_at=now(),concurrency=EXCLUDED.concurrency,metadata=EXCLUDED.metadata`;await sql`DELETE FROM worker_heartbeats WHERE last_seen_at < now() - interval '7 days'`}
function sleep(ms:number):Promise<void>{return new Promise(resolve=>setTimeout(resolve,ms))}
function stop():void{stopping=true}process.on('SIGTERM',stop);process.on('SIGINT',stop);
