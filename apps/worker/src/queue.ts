import type { Database } from './db.js';

export interface Job { id: string; type: string; payload: Record<string, unknown>; attempts: number; maxAttempts: number }

export async function claimJob(database: Database, workerId: string): Promise<Job | null> {
  return database.begin(async (transaction) => {
    const rows = await transaction<Array<Record<string, unknown>>>`
      SELECT * FROM jobs WHERE status = 'queued' AND run_after <= now()
      ORDER BY priority, created_at FOR UPDATE SKIP LOCKED LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    await transaction`UPDATE jobs SET status='running', locked_by=${workerId}, locked_at=now(), attempts=attempts+1 WHERE id=${String(row.id)}`;
    return { id: String(row.id), type: String(row.type), payload: row.payload as Record<string, unknown>, attempts: Number(row.attempts) + 1, maxAttempts: Number(row.max_attempts) };
  });
}

export async function completeJob(database: Database, id: string, workerId:string): Promise<void> {
  const rows=await database<Array<{id:string}>>`UPDATE jobs SET status='completed',completed_at=now(),locked_by=null,locked_at=null WHERE id=${id} AND status='running' AND locked_by=${workerId} RETURNING id`;if(!rows[0])throw new Error(`Job ${id} lock was lost before completion`);
}

export async function failJob(database: Database, job: Job, error: unknown, workerId:string): Promise<void> {
  const message = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}`.slice(0, 10_000) : String(error);
  if (job.attempts >= job.maxAttempts) await database`UPDATE jobs SET status='failed', last_error=${message}, completed_at=now(), locked_by=null, locked_at=null WHERE id=${job.id} AND locked_by=${workerId}`;
  else await database`UPDATE jobs SET status='queued', last_error=${message}, run_after=now() + (${Math.min(300, 5 * 2 ** (job.attempts - 1))} * interval '1 second'), locked_by=null, locked_at=null WHERE id=${job.id} AND locked_by=${workerId}`;
}

export async function recoverStaleJobs(database: Database): Promise<void> {
  await database.begin(async transaction=>{const rows=await transaction<Array<{payload:Record<string,unknown>}>>`UPDATE jobs SET status='queued',locked_by=null,locked_at=null,run_after=now(),last_error='Worker heartbeat expired; job recovered' WHERE status='running' AND locked_at < now() - interval '5 minutes' RETURNING payload`;for(const row of rows){const auditId=String(row.payload.auditId??'');if(auditId)await transaction`UPDATE audits SET status='failed',completed_at=now(),error='Worker heartbeat expired; audit will be retried' WHERE id=${auditId} AND status='running'`}});
}

export async function refreshJobLock(database:Database,id:string,workerId:string):Promise<boolean>{const rows=await database<Array<{id:string}>>`UPDATE jobs SET locked_at=now() WHERE id=${id} AND status='running' AND locked_by=${workerId} RETURNING id`;return Boolean(rows[0])}
