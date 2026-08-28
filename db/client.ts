import postgres from 'postgres';

type SqlClient = ReturnType<typeof postgres>;
type SqlExecutor = Pick<SqlClient, 'unsafe'>;
type SqlParameter = postgres.ParameterOrJSON<never>;

const globalDatabase = globalThis as typeof globalThis & { cimbraSql?: SqlClient; cimbraDatabase?: DatabaseClient };

function connectionString() {
  const value = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (value) return value;
  const { DB_HOST: host, DB_PORT: port = '5432', DB_NAME: database, DB_USER: user, DB_PASSWORD: password } = process.env;
  if (host && database && user && password) {
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;
  }
  throw new Error('DATABASE_URL or the DB_HOST/DB_NAME/DB_USER/DB_PASSWORD set is not configured.');
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
