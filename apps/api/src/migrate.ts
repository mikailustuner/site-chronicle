import { closeDatabase, migrate } from './db.js';

await migrate();
await closeDatabase();
console.log('SiteChronicle database is up to date.');
