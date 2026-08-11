import { sql } from './db.js';
import { config } from './config.js';
import { claimJob, completeJob, failJob, recoverStaleJobs, type Job } from './queue.js';
import { runAudit } from './audit-runner.js';
import { processSchedules } from './scheduler.js';

let stopping=false;let lastSchedule=0;const active=new Set<Promise<void>>();
await recoverStaleJobs(sql);console.log(`SiteChronicle worker ${config.workerId} started with concurrency ${config.concurrency}.`);
while(!stopping){
  if(Date.now()-lastSchedule>60_000){await processSchedules(sql).catch(error=>console.error('Scheduler',error));lastSchedule=Date.now()}
  while(active.size<config.concurrency){const job=await claimJob(sql,config.workerId);if(!job)break;const promise=handle(job).finally(()=>active.delete(promise));active.add(promise)}
  if(active.size===0)await sleep(config.pollIntervalMs);else await Promise.race([...active, sleep(config.pollIntervalMs)]);
}
await Promise.allSettled(active);await sql.end({timeout:10});

async function handle(job:Job):Promise<void>{try{if(job.type==='audit')await runAudit(sql,String(job.payload.auditId));else throw new Error(`Unknown job type: ${job.type}`);await completeJob(sql,job.id)}catch(error){console.error(`Job ${job.id} failed`,error);await failJob(sql,job,error)}}
function sleep(ms:number):Promise<void>{return new Promise(resolve=>setTimeout(resolve,ms))}
function stop():void{stopping=true}process.on('SIGTERM',stop);process.on('SIGINT',stop);
