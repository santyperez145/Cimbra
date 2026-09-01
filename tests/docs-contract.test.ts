import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import { API_SCOPES } from '../app/lib/platform/scopes.ts';

type Schema = {
  enum?: string[];
  items?: Schema;
  properties?: Record<string, Schema>;
};

type Operation = {
  operationId?: string;
  summary?: string;
  security?: Array<Record<string, unknown>>;
  parameters?: Array<{ $ref?: string; name?: string }>;
  requestBody?: { content?: { 'application/json'?: { schema?: Schema } } };
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
  assert.equal(spec.info.version, '2026-09-01');
  assert.deepEqual(spec.servers, [{ url: 'https://cimbra-rose.vercel.app', description: 'Current environment is sandbox (BIND APIBANK, Pismo sandbox.pismolabs.io, Pomelo sandbox.api.pomelo.la). Production hostname is not provisioned.' }]);
  const operations = contractOperations();
  assert.equal(operations.length, 164);
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
  const declaredScopes = spec.paths['/api/platform/api-keys'].post.requestBody?.content?.['application/json']
    ?.schema?.properties?.scopes?.items?.enum;
  assert.deepEqual(declaredScopes, [...API_SCOPES]);
});

test('OpenAPI publica book transfers y statements como contratos completos', () => {
  assert.equal(spec.paths['/api/v1/book-transfers'].get.operationId, 'listBookTransfers');
  assert.equal(spec.paths['/api/v1/book-transfers'].post.operationId, 'createBookTransfer');
  assert.equal(spec.paths['/api/v1/book-transfers/{id}'].get.operationId, 'retrieveBookTransfer');
  assert.equal(spec.paths['/api/v1/book-transfers/{id}/reverse'].post.operationId, 'reverseBookTransfer');
  assert.equal(spec.paths['/api/v1/accounts/{id}/statement'].get.operationId, 'getAccountStatement');
  assert.equal(spec.paths['/api/v1/book-transfers'].post.parameters?.some((parameter) => parameter.$ref === '#/components/parameters/IdempotencyKey'), true);
  const reference = readFileSync(join(root, 'app', 'lib', 'platform', 'openapi-reference.ts'), 'utf8');
  assert.match(reference, /path\.includes\('\/book-transfers'\)\) return 'Book transfers'/);
  assert.match(reference, /path\.includes\('\/book-transfers'\)\) return `transfers:\$\{access\}`/);
  assert.match(reference, /path\.includes\('\/payout-'\)\) return 'Payouts'/);
  assert.match(reference, /path\.includes\('\/payout-'\)\) return `payouts:\$\{access\}`/);
  assert.equal(spec.paths['/api/v1/wallet-programs'].get.operationId, 'listWalletPrograms');
  assert.equal(spec.paths['/api/v1/wallet-programs'].post.operationId, 'createWalletProgram');
  assert.equal(spec.paths['/api/v1/wallets'].post.operationId, 'createWallet');
  assert.equal(spec.paths['/api/v1/wallets/{id}/transfers'].post.operationId, 'createWalletPocketTransfer');
  assert.equal(spec.paths['/api/v1/wallets/{id}/lifecycle'].post.operationId, 'transitionWallet');
  assert.match(reference, /path\.includes\('\/wallets'\) \|\| path\.includes\('\/wallet-programs'\)\) return 'Wallets'/);
  assert.match(reference, /path\.includes\('\/wallets'\) \|\| path\.includes\('\/wallet-programs'\)\) return `wallets:\$\{access\}`/);
  assert.equal(spec.paths['/api/v1/rail-instruments'].post.operationId, 'issueRailInstruments');
  assert.equal(spec.paths['/api/v1/rail-instruments/{id}'].get.operationId, 'retrieveRailInstrument');
  assert.equal(spec.paths['/api/v1/rail-instruments/{id}'].delete.operationId, 'revokeRailInstrument');
  assert.equal(spec.paths['/api/v1/rail-instruments/{id}/alias'].patch.operationId, 'assignRailAlias');
  assert.equal(spec.paths['/api/v1/rail-directory'].get.operationId, 'lookupRailDirectory');
  assert.equal(spec.paths['/api/v1/instant-transfers'].post.operationId, 'createInstantTransfer');
  assert.equal(spec.paths['/api/v1/instant-transfers/{id}/return'].post.operationId, 'returnInstantTransfer');
  assert.equal(spec.paths['/api/v1/debit-requests/{id}/respond'].post.operationId, 'respondDebitRequest');
  assert.equal(spec.paths['/api/v1/payment-qrs/{id}/pay'].post.operationId, 'payPaymentQr');
  assert.equal(spec.paths['/api/v1/payment-qrs/{id}/cancel'].post.operationId, 'cancelPaymentQr');
  assert.equal(spec.paths['/api/v1/payment-links'].post.operationId, 'createPaymentLink');
  assert.equal(spec.paths['/api/v1/payment-links/{id}'].get.operationId, 'retrievePaymentLink');
  assert.equal(spec.paths['/api/v1/payment-links/{id}/pay'].post.operationId, 'payPaymentLink');
  assert.equal(spec.paths['/api/v1/payment-links/{id}/refund'].post.operationId, 'refundPaymentLink');
  assert.equal(spec.paths['/api/v1/echeqs'].post.operationId, 'issueEcheq');
  assert.equal(spec.paths['/api/v1/echeqs/{id}'].get.operationId, 'retrieveEcheq');
  assert.equal(spec.paths['/api/v1/echeqs/{id}/accept'].post.operationId, 'acceptEcheq');
  assert.equal(spec.paths['/api/v1/echeqs/{id}/endorse'].post.operationId, 'endorseEcheq');
  assert.equal(spec.paths['/api/v1/echeqs/{id}/deposit'].post.operationId, 'depositEcheq');
  assert.equal(spec.paths['/api/v1/echeqs/{id}/return'].post.operationId, 'returnEcheq');
  assert.equal(spec.paths['/api/v1/live-readiness'].get.operationId, 'getLiveReadiness');
  assert.match(reference, /path\.includes\('\/instant-transfers'\) \|\| path\.includes\('\/rail-instruments'\)/);
  assert.match(reference, /return 'Instant payments'/);
  assert.match(reference, /path\.includes\('\/echeqs'\)\) return 'ECHEQ'/);
  assert.match(reference, /path\.includes\('\/echeqs'\)\) return `transfers:\$\{access\}`/);
});

test('el sistema de diseño declara el token navy usado por formularios y autenticación', () => {
  const styles = readFileSync(join(root, 'app', 'globals.css'), 'utf8');
  assert.match(styles, /:root\s*\{[^}]*--navy:\s*#101b2f;/s);
  assert.match(styles, /\.integration-form>button\{[^}]*background:var\(--navy\)/);
  assert.match(styles, /\.auth-submit\{[^}]*background:var\(--navy\)/);
});

test('el tipo del SDK refleja el payload snake_case emitido por el outbox', () => {
  const types = readFileSync(join(root, 'packages', 'sdk', 'src', 'types.ts'), 'utf8');
  const outbox = readFileSync(join(root, 'db', 'platform.ts'), 'utf8');
  assert.match(outbox, /created_at: createdAt/);
  assert.match(types, /WebhookEvent<T = unknown> = \{ id: string; type: string; created_at: string;/);
});
