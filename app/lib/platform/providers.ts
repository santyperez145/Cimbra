export const PROVIDER_IDS = ['bindx', 'dock', 'tapi', 'pismo', 'pomelo', 'wibond'] as const;
export type ProviderId = typeof PROVIDER_IDS[number];

export const PROVIDER_CAPABILITIES = [
  'accounts', 'transfers', 'cash_in', 'cash_out', 'cards', 'bill_payments',
  'kyc_kyb', 'reconciliation', 'lending', 'acquiring', 'checks', 'webhooks',
] as const;
export type ProviderCapability = typeof PROVIDER_CAPABILITIES[number];

export const CONNECTION_TRANSPORTS = ['rest_api', 'webhook', 'batch_file', 'sftp', 'vpn', 'iso8583'] as const;
export type ConnectionTransport = typeof CONNECTION_TRANSPORTS[number];

export type ProviderDescriptor = {
  id: ProviderId;
  name: string;
  role: 'banking' | 'processing' | 'payment_network' | 'core_banking' | 'issuing' | 'embedded_finance';
  capabilities: readonly ProviderCapability[];
  transports: readonly ConnectionTransport[];
  coverage: 'argentina' | 'latam' | 'global';
  onboarding: 'commercial_contract_required';
  documentationUrl: string;
};

export const PROVIDERS: readonly ProviderDescriptor[] = [
  {
    id: 'bindx', name: 'BIND / bindX', role: 'banking', coverage: 'argentina', onboarding: 'commercial_contract_required',
    capabilities: ['accounts', 'transfers', 'cash_in', 'cash_out', 'kyc_kyb', 'reconciliation', 'checks'],
    transports: ['rest_api', 'webhook', 'batch_file'], documentationUrl: 'https://developers.bindx.com/',
  },
  {
    id: 'dock', name: 'Dock', role: 'processing', coverage: 'latam', onboarding: 'commercial_contract_required',
    capabilities: ['accounts', 'transfers', 'cash_in', 'cash_out', 'cards', 'kyc_kyb', 'reconciliation', 'acquiring', 'webhooks'],
    transports: ['rest_api', 'webhook', 'batch_file', 'sftp', 'vpn', 'iso8583'], documentationUrl: 'https://dock.tech/',
  },
  {
    id: 'tapi', name: 'tapi', role: 'payment_network', coverage: 'latam', onboarding: 'commercial_contract_required',
    capabilities: ['cash_in', 'cash_out', 'bill_payments', 'reconciliation', 'webhooks'],
    transports: ['rest_api', 'webhook'], documentationUrl: 'https://www.tapila.dev/api-reference',
  },
  {
    id: 'pismo', name: 'Pismo', role: 'core_banking', coverage: 'global', onboarding: 'commercial_contract_required',
    capabilities: ['accounts', 'transfers', 'cash_in', 'cash_out', 'cards', 'bill_payments', 'reconciliation', 'lending', 'webhooks'],
    transports: ['rest_api', 'webhook', 'batch_file', 'sftp'], documentationUrl: 'https://developers.pismo.io/pismo-docs/',
  },
  {
    id: 'pomelo', name: 'Pomelo', role: 'issuing', coverage: 'latam', onboarding: 'commercial_contract_required',
    capabilities: ['accounts', 'cards', 'kyc_kyb', 'reconciliation', 'lending', 'webhooks'],
    transports: ['rest_api', 'webhook', 'batch_file'], documentationUrl: 'https://developers.pomelo.la/api-reference',
  },
  {
    id: 'wibond', name: 'Wibond', role: 'embedded_finance', coverage: 'latam', onboarding: 'commercial_contract_required',
    capabilities: ['accounts', 'transfers', 'cash_in', 'cash_out', 'cards', 'reconciliation', 'lending'],
    transports: ['rest_api', 'webhook', 'batch_file'], documentationUrl: 'https://www.wibond.co/',
  },
] as const;

export function providerDescriptor(value: unknown) {
  return typeof value === 'string' ? PROVIDERS.find((provider) => provider.id === value) ?? null : null;
}

export function normalizeProviderCapabilities(provider: ProviderDescriptor, value: unknown): ProviderCapability[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const allowed = new Set<string>(provider.capabilities);
  const normalized = [...new Set(value.filter((item): item is ProviderCapability => typeof item === 'string' && allowed.has(item)))].sort();
  return normalized.length === value.length ? normalized : null;
}

export function normalizeConnectionTransport(provider: ProviderDescriptor, value: unknown): ConnectionTransport | null {
  return typeof value === 'string' && provider.transports.includes(value as ConnectionTransport) ? value as ConnectionTransport : null;
}

export function normalizeCredentialReference(value: unknown) {
  if (typeof value !== 'string') return null;
  const reference = value.trim();
  if (reference.length < 8 || reference.length > 500) return null;
  return /^(aws-secretsmanager|gcp-secret-manager|azure-key-vault|vault|env):\/\/[A-Za-z0-9._/@:+-]+$/.test(reference) ? reference : null;
}

const CONFIGURATION_KEYS = ['country', 'programId', 'tenantId', 'accountId', 'webhookProfile'] as const;

export function normalizeProviderConfiguration(value: unknown): Record<string, string> | null {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.some(([key]) => !CONFIGURATION_KEYS.includes(key as typeof CONFIGURATION_KEYS[number]))) return null;
  const normalized: Record<string, string> = {};
  for (const [key, raw] of entries) {
    if (typeof raw !== 'string') return null;
    const text = raw.trim();
    if (!text || text.length > 120 || (key === 'country' && !/^[A-Z]{2}$/.test(text))) return null;
    normalized[key] = text;
  }
  return normalized;
}
