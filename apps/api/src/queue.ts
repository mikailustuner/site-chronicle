import { newId } from '@sitechronicle/core';
import type { Database } from './db.js';

export interface Job<T = Record<string, unknown>> {
  id: string;
  type: string;
  payload: T;
  attempts: number;
  maxAttempts: number;
}

export async function enqueue(database: Database, type: string, payload: Record<string, unknown>, priority = 100): Promise<string> {
  const id = newId('job');
  await database`
    INSERT INTO jobs (id, type, payload, status, priority)
    VALUES (${id}, ${type}, ${database.json(payload as never)}, 'queued', ${priority})
  `;
  return id;
}

export async function claimJob(database: Database, workerId: string): Promise<Job | null> {
  return database.begin(async (transaction) => {
    const rows = await transaction<Array<Record<string, unknown>>>`
      SELECT * FROM jobs
      WHERE status = 'queued' AND run_after <= now()
      ORDER BY priority ASC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    await transaction`
      UPDATE jobs SET status = 'running', locked_by = ${workerId}, locked_at = now(), attempts = attempts + 1
      WHERE id = ${String(row.id)}
    `;
    return {
      id: String(row.id), type: String(row.type), payload: row.payload as Record<string, unknown>,
      attempts: Number(row.attempts) + 1, maxAttempts: Number(row.max_attempts),
    };
  });
}

export async function completeJob(database: Database, id: string): Promise<void> {
  await database`UPDATE jobs SET status = 'completed', completed_at = now(), locked_by = null, locked_at = null WHERE id = ${id}`;
}

export async function failJob(database: Database, job: Job, error: unknown): Promise<void> {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (job.attempts >= job.maxAttempts) {
    await database`UPDATE jobs SET status = 'failed', last_error = ${message}, completed_at = now(), locked_by = null, locked_at = null WHERE id = ${job.id}`;
  } else {
    const delaySeconds = Math.min(300, 5 * 2 ** (job.attempts - 1));
    await database`
      UPDATE jobs SET status = 'queued', last_error = ${message}, run_after = now() + (${delaySeconds} * interval '1 second'), locked_by = null, locked_at = null
      WHERE id = ${job.id}
    `;
  }
}

export async function recoverStaleJobs(database: Database, staleMinutes = 30): Promise<number> {
  const rows = await database<Array<{ id: string }>>`
    UPDATE jobs SET status = 'queued', locked_by = null, locked_at = null, run_after = now()
    WHERE status = 'running' AND locked_at < now() - (${staleMinutes} * interval '1 minute')
    RETURNING id
  `;
  return rows.length;
}
