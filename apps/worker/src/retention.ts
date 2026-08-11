import type { Database } from './db.js';
import { ArtifactStore } from './artifacts.js';

export async function cleanupRetention(database:Database,retentionDays:number):Promise<number>{
  if(!Number.isInteger(retentionDays)||retentionDays<1)throw new Error('Retention days must be a positive integer');
  const rows=await database<Array<{id:string}>>`SELECT id FROM audits WHERE status IN ('completed','failed','cancelled') AND completed_at < now() - (${retentionDays} * interval '1 day') ORDER BY completed_at LIMIT 100`;
  const store=new ArtifactStore(database);let removed=0;
  for(const row of rows){await database.begin(async transaction=>{await transaction`DELETE FROM jobs WHERE payload->>'auditId'=${row.id}`;await transaction`DELETE FROM audits WHERE id=${row.id} AND status IN ('completed','failed','cancelled')`});await store.removeAudit(row.id).catch(error=>console.error(`Retention artifact cleanup ${row.id}`,error));removed+=1}
  return removed;
}
