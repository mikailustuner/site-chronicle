import { ScanProfileSchema, newId } from '@sitechronicle/core';
import { closeDatabase, migrate, sql } from './db.js';

await migrate();
const domains = await sql<Array<{ id: string }>>`SELECT id FROM domains LIMIT 1`;
if (!domains[0]) console.log('No domain exists; use the dashboard to add one.');
else {
  const profiles = await sql<Array<{ id: string }>>`SELECT id FROM scan_profiles WHERE domain_id = ${domains[0].id} LIMIT 1`;
  if (!profiles[0]) await sql`INSERT INTO scan_profiles (id, domain_id, name, config, is_default) VALUES (${newId('profile')}, ${domains[0].id}, 'Standard audit', ${sql.json(ScanProfileSchema.parse({}))}, true)`;
}
await closeDatabase();
