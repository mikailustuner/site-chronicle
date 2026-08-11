import postgres, { type Sql } from 'postgres';
import { config } from './config.js';

export type Database = Sql<Record<string, never>>;
export const sql: Database = postgres(config.databaseUrl, { max: Math.max(4, config.concurrency * 3), idle_timeout: 20, connect_timeout: 10, transform: { undefined: null } });
