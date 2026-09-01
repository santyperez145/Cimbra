import postgres from 'postgres';
import { postgresClientOptions, resolvePostgresUrl } from './postgres-connection.mjs';

type SqlClient = ReturnType<typeof postgres>;
type SqlExecutor = Pick<SqlClient, 'unsafe'>;
type SqlParameter = postgres.ParameterOrJSON<never>;

const globalDatabase = globalThis as typeof globalThis & { cimbraSql?: SqlClient; cimbraDatabase?: DatabaseClient };

function connectionString() {
  return resolvePostgresUrl();
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
    globalDatabase.cimbraSql = postgres(url, postgresClientOptions(url, { max: 5 }));
  }
  return globalDatabase.cimbraSql;
}

export class PreparedStatement {
  readonly query: string;
  readonly parameters: readonly SqlParameter[];
  readonly executor?: SqlExecutor;

  constructor(query: string, parameters: readonly SqlParameter[] = [], executor?: SqlExecutor) {
    this.query = normalizeSql(query);
    this.parameters = parameters;
    this.executor = executor;
  }

  bind(...parameters: SqlParameter[]) {
    return new PreparedStatement(this.query, parameters, this.executor);
  }

  async execute(executor: SqlExecutor = this.executor ?? sqlClient()) {
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
  constructor(private readonly executor?: SqlExecutor) {}

  prepare(query: string) {
    return new PreparedStatement(query, [], this.executor);
  }

  async batch(statements: PreparedStatement[]) {
    const execute = async (executor: SqlExecutor) => {
      const results = [];
      for (const statement of statements) results.push(await statement.execute(executor));
      return results;
    };
    if (this.executor) return execute(this.executor);
    return sqlClient().begin(execute);
  }

  async transaction<T>(callback: (database: DatabaseClient) => Promise<T>): Promise<T> {
    if (this.executor) return callback(this);
    const result = await sqlClient().begin(async (transaction) => callback(new DatabaseClient(transaction)));
    return result as T;
  }
}

export function getDatabaseClient() {
  globalDatabase.cimbraDatabase ??= new DatabaseClient();
  return globalDatabase.cimbraDatabase;
}
