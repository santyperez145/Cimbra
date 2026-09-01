import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { postgresClientOptions, resolvePostgresUrl } from './postgres-connection.mjs';
import * as schema from './schema';

export function getDb() {
  const connectionString = resolvePostgresUrl({ preferDirect: true });
  const client = postgres(connectionString, postgresClientOptions(connectionString, { max: 1 }));
  return drizzle({ client, schema });
}
