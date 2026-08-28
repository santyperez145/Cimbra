import postgres from 'postgres';

type SqlClient = ReturnType<typeof postgres>;
type SqlExecutor = Pick<SqlClient, 'unsafe'>;
type SqlParameter = postgres.ParameterOrJSON<never>;

const globalDatabase = globalThis as typeof globalThis & { cimbraSql?: SqlClient; cimbraDatabase?: DatabaseClient };

function connectionString() {
  const value = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!value) throw new Error('DATABASE_URL is not configured. Connect a PostgreSQL database to this deployment.');
  return value;
}

function normalizeSql(source: string) {
  let parameter = 0;
  return source
    .replace(/\?/g, () => `$${++parameter}`)
    .replace(/\bAS\s+([a-z][a-z0-9]*[A-Z][A-Za-z0-9]*)\b/g, 'AS "$1"');
}

function sqlClient() {
  if (!globalDatabase.cimbraSql) {
    const url = connectionString();
    globalDatabase.cimbraSql = postgres(url, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      ssl: /localhost|127\.0\.0\.1/.test(url) ? false : 'require',
    });
  }
  return globalDatabase.cimbraSql;
}

export class PreparedStatement {
  readonly query: string;
  readonly parameters: readonly SqlParameter[];

  constructor(query: string, parameters: readonly SqlParameter[] = []) {
    this.query = normalizeSql(query);
    this.parameters = parameters;
  }

  bind(...parameters: SqlParameter[]) {
    return new PreparedStatement(this.query, parameters);
  }

  async execute(executor: SqlExecutor = sqlClient()) {
    return executor.unsafe(this.query, [...this.parameters]);
  }

  async first<T>(): Promise<T | null> {
    const rows = await this.execute();
    return (rows[0] as T | undefined) ?? null;
  }

  async all<T>() {
    const rows = await this.execute();
    return { results: rows as unknown as T[] };
  }

  async run() {
    const rows = await this.execute();
    return { success: true, rowsAffected: rows.count };
  }
}

export class DatabaseClient {
  prepare(query: string) {
    return new PreparedStatement(query);
  }

  async batch(statements: PreparedStatement[]) {
    return sqlClient().begin(async (transaction) => {
      const results = [];
      for (const statement of statements) results.push(await statement.execute(transaction));
      return results;
    });
  }
}

export function getDatabaseClient() {
  globalDatabase.cimbraDatabase ??= new DatabaseClient();
  return globalDatabase.cimbraDatabase;
}
