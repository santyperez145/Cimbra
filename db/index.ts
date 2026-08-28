import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export function getDb() {
  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');
  const client = postgres(connectionString, { prepare: false, max: 1 });
  return drizzle({ client, schema });
}
