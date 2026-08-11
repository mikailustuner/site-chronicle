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

export async function completeJob(database: Database, id: string): Promise<void> {
  await database`UPDATE jobs SET status='completed', completed_at=now(), locked_by=null, locked_at=null WHERE id=${id}`;
}

export async function failJob(database: Database, job: Job, error: unknown): Promise<void> {
  const message = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}`.slice(0, 10_000) : String(error);
  if (job.attempts >= job.maxAttempts) await database`UPDATE jobs SET status='failed', last_error=${message}, completed_at=now(), locked_by=null, locked_at=null WHERE id=${job.id}`;
  else await database`UPDATE jobs SET status='queued', last_error=${message}, run_after=now() + (${Math.min(300, 5 * 2 ** (job.attempts - 1))} * interval '1 second'), locked_by=null, locked_at=null WHERE id=${job.id}`;
}

export async function recoverStaleJobs(database: Database): Promise<void> {
  await database`UPDATE jobs SET status='queued', locked_by=null, locked_at=null WHERE status='running' AND locked_at < now() - interval '45 minutes'`;
}
