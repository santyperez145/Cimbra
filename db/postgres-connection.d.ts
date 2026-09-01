export function isLocalPostgres(url: string): boolean;
export function resolvePostgresUrl(options?: { preferDirect?: boolean }): string;
export function postgresClientOptions(url: string, options?: {
  max?: number;
  idleTimeout?: number;
  connectTimeout?: number;
}): {
  max: number;
  idle_timeout: number;
  connect_timeout: number;
  prepare: false;
  ssl: false | 'require';
};
