import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

type Operation = {
  operationId?: string;
  summary?: string;
  security?: Array<Record<string, unknown>>;
  parameters?: Array<{ $ref?: string; name?: string }>;
  responses?: Record<string, { description?: string }>;
};

type OpenApi = {
  openapi: string;
  info: { version: string };
  servers: Array<{ url: string }>;
  paths: Record<string, Record<string, Operation>>;
};

const root = process.cwd();
const spec = parse(readFileSync(join(root, 'public', 'openapi.yaml'), 'utf8')) as OpenApi;
const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;

function contractOperations() {
  return Object.entries(spec.paths).flatMap(([path, item]) => methods.flatMap((method) => item[method]
    ? [{ path, method: method.toUpperCase(), operation: item[method] }]
    : []));
}

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(path) : entry.name === 'route.ts' ? [path] : [];
  });
}

test('el OpenAPI público usa el sandbox real y operaciones identificables', () => {
  assert.equal(spec.openapi, '3.1.0');
  assert.equal(spec.info.version, '2026-08-29');
  assert.deepEqual(spec.servers, [{ url: 'https://cimbra-rose.vercel.app', description: 'Persistent sandbox. Does not move real funds.' }]);
  const operations = contractOperations();
  assert.ok(operations.length >= 61);
  const ids = operations.map(({ operation }) => operation.operationId);
  assert.equal(ids.every(Boolean), true);
  assert.equal(new Set(ids).size, ids.length);
  for (const { path, operation } of operations.filter(({ path }) => path.startsWith('/api/v1/'))) {
    assert.ok(operation.summary, `${path} no tiene summary`);
    assert.ok(Array.isArray(operation.security) && operation.security.length > 0, `${path} no declara autenticación`);
    assert.ok(operation.responses && Object.keys(operation.responses).length > 0, `${path} no declara respuestas`);
  }
});

test('cada handler público de /api/v1 está representado exactamente en OpenAPI', () => {
  const apiDirectory = join(root, 'app', 'api', 'v1');
  const runtime = new Set<string>();
  for (const file of routeFiles(apiDirectory)) {
    const source = readFileSync(file, 'utf8');
    const route = `/${relative(join(root, 'app'), dirname(file)).split(sep).join('/').replace(/\[([^\]]+)\]/g, '{$1}')}`;
    for (const match of source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PATCH|PUT|DELETE)\s*\(/g)) {
      runtime.add(`${match[1]} ${route}`);
    }
  }
  const contract = new Set(contractOperations().filter(({ path }) => path.startsWith('/api/v1/')).map(({ method, path }) => `${method} ${path}`));
  assert.deepEqual([...runtime].filter((operation) => !contract.has(operation)), []);
  assert.deepEqual([...contract].filter((operation) => !runtime.has(operation)), []);
});

test('el quickstart declara idempotencia sólo donde el contrato la soporta', () => {
  const createCustomer = spec.paths['/api/v1/customers'].post;
  assert.equal(createCustomer.parameters?.some((parameter) => parameter.$ref === '#/components/parameters/IdempotencyKey'), true);
  const webhookCreate = spec.paths['/api/v1/webhooks'].post;
  assert.equal(Boolean(webhookCreate.parameters?.some((parameter) => parameter.$ref === '#/components/parameters/IdempotencyKey')), false);
  const page = readFileSync(join(root, 'app', 'developers', 'page.tsx'), 'utf8');
  assert.match(page, /Obligatoria cuando el endpoint la declara/);
  assert.doesNotMatch(page, /Obligatoria en todas las escrituras/);
});

test('el SDK descargable coincide con su versión y checksum publicados', () => {
  const packageJson = JSON.parse(readFileSync(join(root, 'packages', 'sdk', 'package.json'), 'utf8')) as { version: string };
  const fileName = `cimbra-sdk-${packageJson.version}.tgz`;
  const artifactPath = join(root, 'public', 'sdk', fileName);
  const checksumPath = join(root, 'public', 'sdk', `cimbra-sdk-${packageJson.version}.sha256`);
  assert.equal(existsSync(artifactPath), true);
  assert.equal(existsSync(checksumPath), true);
  const checksum = createHash('sha256').update(readFileSync(artifactPath)).digest('hex');
  assert.equal(readFileSync(checksumPath, 'utf8').trim(), `${checksum}  ${fileName}`);
  assert.match(readFileSync(join(root, 'packages', 'sdk', 'README.md'), 'utf8'), new RegExp(`https://cimbra-rose\\.vercel\\.app/sdk/${fileName}`));
});

test('consola y docs consumen scopes y eventos desde fuentes canónicas', () => {
  const panel = readFileSync(join(root, 'app', 'console', 'developers-panel.tsx'), 'utf8');
  const page = readFileSync(join(root, 'app', 'developers', 'page.tsx'), 'utf8');
  assert.match(panel, /import \{ API_SCOPES \}/);
  assert.match(panel, /import \{ WEBHOOK_EVENT_TYPES \}/);
  assert.doesNotMatch(panel, /const scopes\s*=/);
  assert.doesNotMatch(panel, /const eventTypes\s*=/);
  assert.match(page, /loadApiReference/);
  assert.match(page, /WEBHOOK_EVENT_TYPES\.map/);
});

test('el tipo del SDK refleja el payload snake_case emitido por el outbox', () => {
  const types = readFileSync(join(root, 'packages', 'sdk', 'src', 'types.ts'), 'utf8');
  const outbox = readFileSync(join(root, 'db', 'platform.ts'), 'utf8');
  assert.match(outbox, /created_at: createdAt/);
  assert.match(types, /WebhookEvent<T = unknown> = \{ id: string; type: string; created_at: string;/);
});
