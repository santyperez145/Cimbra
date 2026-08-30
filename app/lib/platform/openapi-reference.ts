import 'server-only';

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';

type JsonObject = Record<string, unknown>;

export type ApiReferenceField = {
  name: string;
  location: 'body' | 'header' | 'path' | 'query';
  required: boolean;
  type: string;
  description: string | null;
};

export type ApiReferenceOperation = {
  id: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  path: string;
  summary: string;
  description: string | null;
  group: string;
  authentication: 'Pública' | 'Sesión' | 'API key' | 'Sesión o API key';
  scope: string | null;
  contentType: string | null;
  fields: ApiReferenceField[];
  responses: Array<{ status: string; description: string }>;
};

export type ApiReference = {
  title: string;
  version: string;
  baseUrl: string;
  operations: ApiReferenceOperation[];
};

export type SdkRelease = {
  name: string;
  version: string;
  downloadPath: string;
  sha256: string;
  sizeBytes: number;
};

const HTTP_METHODS = ['get', 'post', 'patch', 'delete', 'put'] as const;
const GROUP_ORDER = [
  'Identidad y estado',
  'Customers',
  'Accounts',
  'Cards',
  'Servicios y pagos recurrentes',
  'Payments y transfers',
  'Ledger y holds',
  'Risk',
  'Disputas',
  'Conciliación y settlement',
  'Operaciones',
  'Aprobaciones',
  'Eventos y webhooks',
  'Compliance',
  'Organización y credenciales',
] as const;

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function stringValue(value: unknown, fallback = '') {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
}

function resolveReference(document: JsonObject, value: unknown): JsonObject {
  const object = asObject(value);
  const reference = stringValue(object.$ref);
  if (!reference.startsWith('#/')) return object;
  return reference.slice(2).split('/').reduce<JsonObject>((current, segment) => asObject(current[segment]), document);
}

function schemaLabel(document: JsonObject, value: unknown): string {
  const schema = resolveReference(document, value);
  const alternatives = Array.isArray(schema.oneOf) ? schema.oneOf : Array.isArray(schema.anyOf) ? schema.anyOf : [];
  if (alternatives.length) return alternatives.map((item) => schemaLabel(document, item)).join(' | ');
  const type = stringValue(schema.type, 'object');
  const format = stringValue(schema.format);
  const values = Array.isArray(schema.enum) ? schema.enum.map((item) => String(item)) : [];
  if (values.length) return values.join(' | ');
  if (type === 'array') return `${schemaLabel(document, schema.items)}[]`;
  return format ? `${type} (${format})` : type;
}

function parameterField(document: JsonObject, value: unknown): ApiReferenceField | null {
  const parameter = resolveReference(document, value);
  const name = stringValue(parameter.name);
  const location = stringValue(parameter.in);
  if (!name || !['header', 'path', 'query'].includes(location)) return null;
  return {
    name,
    location: location as ApiReferenceField['location'],
    required: parameter.required === true,
    type: schemaLabel(document, parameter.schema),
    description: stringValue(parameter.description) || null,
  };
}

function requestBodyFields(document: JsonObject, operation: JsonObject) {
  const requestBody = resolveReference(document, operation.requestBody);
  const content = asObject(requestBody.content);
  const contentType = ['application/json', 'multipart/form-data', 'application/x-www-form-urlencoded']
    .find((candidate) => content[candidate]) ?? Object.keys(content)[0] ?? null;
  if (!contentType) return { contentType: null, fields: [] as ApiReferenceField[] };
  const media = asObject(content[contentType]);
  const schema = resolveReference(document, media.schema);
  const properties = asObject(schema.properties);
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  return {
    contentType,
    fields: Object.entries(properties).map(([name, value]) => {
      const field = resolveReference(document, value);
      return {
        name,
        location: 'body' as const,
        required: required.has(name),
        type: schemaLabel(document, field),
        description: stringValue(field.description) || null,
      };
    }),
  };
}

function authenticationLabel(value: unknown): ApiReferenceOperation['authentication'] {
  const security = Array.isArray(value) ? value.map(asObject) : [];
  if (security.length === 0) return 'Pública';
  const session = security.some((item) => 'session' in item);
  const apiKey = security.some((item) => 'bearerApiKey' in item);
  if (session && apiKey) return 'Sesión o API key';
  return apiKey ? 'API key' : 'Sesión';
}

function operationGroup(path: string) {
  if (path.startsWith('/api/auth/') || path === '/api/health' || path.endsWith('/capabilities')) return 'Identidad y estado';
  if (path.includes('/due-diligence')) return 'Compliance';
  if (path.includes('/customers')) return 'Customers';
  if (path.includes('/accounts')) return 'Accounts';
  if (path.includes('/cards') || path.includes('/card-programs')) return 'Cards';
  if (path.includes('/billers') || path.includes('/bill-payments') || path.includes('/recurring-mandates')) return 'Servicios y pagos recurrentes';
  if (path.includes('/payments') || path.includes('/transfers')) return 'Payments y transfers';
  if (path.includes('/ledger') || path.includes('/holds')) return 'Ledger y holds';
  if (path.includes('/risk')) return 'Risk';
  if (path.includes('/disputes')) return 'Disputas';
  if (path.includes('/reconciliation') || path.includes('/settlements')) return 'Conciliación y settlement';
  if (path.includes('/operations')) return 'Operaciones';
  if (path.includes('/approvals') || path.includes('/approval-policy')) return 'Aprobaciones';
  if (path.includes('/events') || path.includes('/webhooks')) return 'Eventos y webhooks';
  if (path.includes('/compliance')) return 'Compliance';
  return 'Organización y credenciales';
}

function operationScope(path: string, method: string) {
  const access = method === 'get' ? 'read' : 'write';
  if (!path.startsWith('/api/v1/')) return null;
  if (path.includes('/due-diligence')) return path.endsWith('/decide') ? null : `compliance:${access}`;
  if (path.includes('/customers')) return `customers:${access}`;
  if (path.includes('/accounts')) return `accounts:${access}`;
  if (path.includes('/cards') || path.includes('/card-programs')) return `cards:${access}`;
  if (path.includes('/billers')) return `billers:${access}`;
  if (path.includes('/bill-payments') || path.includes('/recurring-mandates')) return `payments:${access}`;
  if (path.includes('/payments')) return `payments:${access}`;
  if (path.includes('/transfers')) return `transfers:${access}`;
  if (path.includes('/holds')) return 'transfers:write';
  if (path.includes('/ledger')) return 'ledger:read';
  if (path.includes('/risk')) return `risk:${access}`;
  if (path.includes('/disputes')) return `disputes:${access}`;
  if (path.includes('/reconciliation')) return `reconciliation:${access}`;
  if (path.includes('/settlements')) return `settlements:${access}`;
  if (path.includes('/approvals')) return method === 'get' ? 'approvals:read' : null;
  if (path.includes('/events')) return 'events:read';
  if (path.includes('/compliance')) return 'compliance:write';
  if (path.includes('/webhooks')) return 'webhooks:manage';
  if (path.includes('/capabilities')) return 'platform:read';
  if (path.includes('/operations')) return `operations:${access}`;
  return null;
}

function operationSort(left: ApiReferenceOperation, right: ApiReferenceOperation) {
  const group = GROUP_ORDER.indexOf(left.group as typeof GROUP_ORDER[number]) - GROUP_ORDER.indexOf(right.group as typeof GROUP_ORDER[number]);
  if (group) return group;
  return left.path.localeCompare(right.path) || HTTP_METHODS.indexOf(left.method.toLowerCase() as typeof HTTP_METHODS[number]) - HTTP_METHODS.indexOf(right.method.toLowerCase() as typeof HTTP_METHODS[number]);
}

export function loadApiReference(): ApiReference {
  const document = asObject(parse(readFileSync(join(process.cwd(), 'public', 'openapi.yaml'), 'utf8')));
  const info = asObject(document.info);
  const paths = asObject(document.paths);
  const servers = Array.isArray(document.servers) ? document.servers.map(asObject) : [];
  const operations: ApiReferenceOperation[] = [];

  for (const [path, rawPathItem] of Object.entries(paths)) {
    const pathItem = asObject(rawPathItem);
    const sharedParameters = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];
    for (const method of HTTP_METHODS) {
      if (!pathItem[method]) continue;
      const operation = asObject(pathItem[method]);
      const requestBody = requestBodyFields(document, operation);
      const parameters = [...sharedParameters, ...(Array.isArray(operation.parameters) ? operation.parameters : [])]
        .map((parameter) => parameterField(document, parameter))
        .filter((parameter): parameter is ApiReferenceField => Boolean(parameter));
      const responses = Object.entries(asObject(operation.responses)).map(([status, value]) => ({
        status,
        description: stringValue(resolveReference(document, value).description, 'Respuesta documentada'),
      }));
      operations.push({
        id: stringValue(operation.operationId, `${method}-${path.replace(/[^a-z0-9]+/gi, '-')}`),
        method: method.toUpperCase() as ApiReferenceOperation['method'],
        path,
        summary: stringValue(operation.summary, `${method.toUpperCase()} ${path}`),
        description: stringValue(operation.description) || null,
        group: operationGroup(path),
        authentication: authenticationLabel(operation.security),
        scope: operationScope(path, method),
        contentType: requestBody.contentType,
        fields: [...parameters, ...requestBody.fields],
        responses,
      });
    }
  }

  return {
    title: stringValue(info.title, 'Cimbra API'),
    version: stringValue(info.version),
    baseUrl: stringValue(servers[0]?.url, 'https://cimbra-rose.vercel.app'),
    operations: operations.sort(operationSort),
  };
}

export function loadSdkRelease(): SdkRelease {
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'packages', 'sdk', 'package.json'), 'utf8')) as { name: string; version: string };
  const fileName = `cimbra-sdk-${packageJson.version}.tgz`;
  const artifactPath = join(process.cwd(), 'public', 'sdk', fileName);
  const artifact = readFileSync(artifactPath);
  return {
    name: packageJson.name,
    version: packageJson.version,
    downloadPath: `/sdk/${fileName}`,
    sha256: createHash('sha256').update(artifact).digest('hex'),
    sizeBytes: statSync(artifactPath).size,
  };
}
