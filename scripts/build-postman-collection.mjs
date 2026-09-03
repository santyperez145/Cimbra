import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const root = process.cwd();
const spec = parse(readFileSync(join(root, 'public', 'openapi.yaml'), 'utf8'));
const methods = ['get', 'post', 'patch', 'put', 'delete'];
const outputDirectory = join(root, 'public', 'postman');
const outputPath = join(outputDirectory, 'cimbra-sandbox.postman_collection.json');

function folderName(path) {
  const parts = path.replace(/^\/api\/(?:v1\/)?/, '').split('/').filter(Boolean);
  if (parts.length === 0) return 'root';
  return parts[0].replace(/\{.*?\}/g, '').replace(/-+/g, ' ').trim() || 'root';
}

function postmanPath(path) {
  return path.replace(/\{([^}]+)\}/g, ':$1');
}

function hasIdempotency(operation) {
  const params = operation.parameters ?? [];
  return params.some((parameter) => {
    if (parameter.$ref === '#/components/parameters/IdempotencyKey') return true;
    if (parameter.name === 'Idempotency-Key') return true;
    return false;
  });
}

function usesBearer(operation) {
  const security = operation.security ?? spec.security ?? [];
  return security.some((entry) => Object.keys(entry).includes('bearerApiKey'));
}

const folders = new Map();
let operationCount = 0;

for (const [path, item] of Object.entries(spec.paths ?? {})) {
  for (const method of methods) {
    const operation = item?.[method];
    if (!operation?.operationId) continue;
    operationCount += 1;
    const name = folderName(path);
    if (!folders.has(name)) folders.set(name, []);
    const headers = [{ key: 'Accept', value: 'application/json' }];
    if (usesBearer(operation)) {
      headers.push({ key: 'Authorization', value: 'Bearer {{apiKey}}' });
    }
    if (hasIdempotency(operation)) {
      headers.push({ key: 'Idempotency-Key', value: '{{$guid}}' });
    }
    const hasJsonBody = Boolean(operation.requestBody?.content?.['application/json']);
    if (hasJsonBody) {
      headers.push({ key: 'Content-Type', value: 'application/json' });
    }
    const request = {
      name: operation.summary || operation.operationId,
      request: {
        method: method.toUpperCase(),
        header: headers,
        url: `{{baseUrl}}${postmanPath(path)}`,
        description: [
          operation.description ?? '',
          `operationId: ${operation.operationId}`,
          'Sandbox only. Does not move real funds or call competitor BaaS adapters.',
        ].filter(Boolean).join('\n\n'),
      },
    };
    if (hasJsonBody) {
      request.request.body = {
        mode: 'raw',
        raw: '{\n  \n}\n',
        options: { raw: { language: 'json' } },
      };
    }
    folders.get(name).push(request);
  }
}

const collection = {
  info: {
    name: 'Cimbra API sandbox',
    description: [
      'Generated from public/openapi.yaml. Import into Postman and set collection variables.',
      `OpenAPI version ${spec.info?.version ?? 'unknown'} · ${operationCount} operations.`,
      'Environment is sandbox: use cim_sk_test_ API keys. Live stays fail-closed until a production hostname and Go Live evidence exist.',
    ].join('\n\n'),
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    _postman_id: 'cimbra-sandbox-openapi',
  },
  variable: [
    { key: 'baseUrl', value: spec.servers?.[0]?.url ?? 'https://cimbra-rose.vercel.app' },
    { key: 'apiKey', value: 'cim_sk_test_replace_me' },
  ],
  item: [...folders.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, items]) => ({
      name,
      item: items.sort((left, right) => left.name.localeCompare(right.name)),
    })),
};

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(collection, null, 2)}\n`);
console.log(JSON.stringify({
  artifact: '/postman/cimbra-sandbox.postman_collection.json',
  operations: operationCount,
  folders: folders.size,
}));
