const POOLED_KEYS = ['DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_PRISMA_URL'];
const DIRECT_KEYS = [
  'DATABASE_URL_UNPOOLED',
  'DATABASE_URL_NON_POOLING',
  'POSTGRES_URL_NON_POOLING',
  'DATABASE_URL_UNPOOLED_DIRECT',
];

function firstEnv(keys) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return '';
}

function composedUrl() {
  const { DB_HOST: host, DB_PORT: port = '5432', DB_NAME: database, DB_USER: user, DB_PASSWORD: password } = process.env;
  if (host && database && user && password) {
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;
  }
  return '';
}

export function isLocalPostgres(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return /localhost|127\.0\.0\.1/.test(url);
  }
}

export function resolvePostgresUrl({ preferDirect = false } = {}) {
  const pooled = firstEnv(POOLED_KEYS);
  const direct = firstEnv(DIRECT_KEYS);
  const selected = preferDirect ? (direct || pooled) : (pooled || direct);
  if (selected) return selected;
  const composed = composedUrl();
  if (composed) return composed;
  throw new Error('DATABASE_URL, POSTGRES_URL or the DB_HOST/DB_NAME/DB_USER/DB_PASSWORD set is not configured.');
}

/**
 * @param {string} url
 * @param {{ max?: number, idleTimeout?: number, connectTimeout?: number }} [options]
 * @returns {{ max: number, idle_timeout: number, connect_timeout: number, prepare: false, ssl: false | 'require' }}
 */
export function postgresClientOptions(url, { max = 5, idleTimeout = 20, connectTimeout } = {}) {
  const local = isLocalPostgres(url);
  /** @type {false | 'require'} */
  const ssl = local ? false : 'require';
  return {
    max,
    idle_timeout: idleTimeout,
    connect_timeout: connectTimeout ?? (local ? 10 : 30),
    prepare: /** @type {const} */ (false),
    ssl,
  };
}
