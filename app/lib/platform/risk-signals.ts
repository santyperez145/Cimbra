import { sha256 } from '../auth/crypto.ts';

export type RiskSubjectType = 'counterparty' | 'device' | 'identity';
export type RiskListCategory = 'allow' | 'watch' | 'block';
export type RiskDeviceTrust = 'trusted' | 'unknown' | 'suspicious';

export type RawRiskSignals = {
  deviceReference?: string;
  identityReference?: string;
  deviceTrust?: RiskDeviceTrust;
  identityVerified?: boolean;
  ipCountry?: string;
  countryMismatch?: boolean;
};

export type ProtectedRiskSignals = {
  deviceHash?: string;
  identityHash?: string;
  deviceTrust?: RiskDeviceTrust;
  identityVerified?: boolean;
  ipCountry?: string;
  countryMismatch?: boolean;
};

export type PublicRiskSignals = Omit<ProtectedRiskSignals, 'deviceHash' | 'identityHash'> & {
  deviceReferencePresent: boolean;
  identityReferencePresent: boolean;
};

function reference(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length >= 2 && normalized.length <= 160 ? normalized : null;
}

export function normalizeRawRiskSignals(value: unknown): RawRiskSignals | null {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const deviceReference = reference(input.deviceReference);
  const identityReference = reference(input.identityReference);
  if (deviceReference === null || identityReference === null) return null;
  const deviceTrust = input.deviceTrust === undefined ? undefined
    : ['trusted', 'unknown', 'suspicious'].includes(String(input.deviceTrust)) ? input.deviceTrust as RiskDeviceTrust : null;
  if (deviceTrust === null) return null;
  const identityVerified = input.identityVerified === undefined ? undefined
    : typeof input.identityVerified === 'boolean' ? input.identityVerified : null;
  if (identityVerified === null) return null;
  const ipCountry = input.ipCountry === undefined || input.ipCountry === '' ? undefined
    : typeof input.ipCountry === 'string' && /^[a-zA-Z]{2}$/.test(input.ipCountry.trim()) ? input.ipCountry.trim().toUpperCase() : null;
  if (ipCountry === null) return null;
  const countryMismatch = input.countryMismatch === undefined ? undefined
    : typeof input.countryMismatch === 'boolean' ? input.countryMismatch : null;
  if (countryMismatch === null) return null;
  return { deviceReference, identityReference, deviceTrust, identityVerified, ipCountry, countryMismatch };
}

export async function riskSubjectHash(organizationId: string, subjectType: RiskSubjectType, value: string) {
  return sha256(`cimbra:risk-subject:${organizationId}:${subjectType}:${value.trim().toLowerCase()}`);
}

export async function protectRiskSignals(organizationId: string, signals: RawRiskSignals): Promise<ProtectedRiskSignals> {
  return {
    deviceHash: signals.deviceReference ? await riskSubjectHash(organizationId, 'device', signals.deviceReference) : undefined,
    identityHash: signals.identityReference ? await riskSubjectHash(organizationId, 'identity', signals.identityReference) : undefined,
    deviceTrust: signals.deviceTrust,
    identityVerified: signals.identityVerified,
    ipCountry: signals.ipCountry,
    countryMismatch: signals.countryMismatch,
  };
}

export function publicRiskSignals(signals: ProtectedRiskSignals = {}): PublicRiskSignals {
  return {
    deviceReferencePresent: Boolean(signals.deviceHash), identityReferencePresent: Boolean(signals.identityHash),
    deviceTrust: signals.deviceTrust, identityVerified: signals.identityVerified, ipCountry: signals.ipCountry,
    countryMismatch: signals.countryMismatch,
  };
}

export function parseProtectedRiskSignals(value: unknown): ProtectedRiskSignals | null {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const hash = (candidate: unknown) => candidate === undefined ? undefined
    : typeof candidate === 'string' && /^[A-Za-z0-9_-]{43}$/.test(candidate) ? candidate : null;
  const deviceHash = hash(input.deviceHash); const identityHash = hash(input.identityHash);
  if (deviceHash === null || identityHash === null) return null;
  const deviceTrust = input.deviceTrust === undefined ? undefined
    : ['trusted', 'unknown', 'suspicious'].includes(String(input.deviceTrust)) ? input.deviceTrust as RiskDeviceTrust : null;
  if (deviceTrust === null) return null;
  if (input.identityVerified !== undefined && typeof input.identityVerified !== 'boolean') return null;
  if (input.countryMismatch !== undefined && typeof input.countryMismatch !== 'boolean') return null;
  const ipCountry = input.ipCountry === undefined ? undefined
    : typeof input.ipCountry === 'string' && /^[A-Z]{2}$/.test(input.ipCountry) ? input.ipCountry : null;
  if (ipCountry === null) return null;
  return { deviceHash, identityHash, deviceTrust, identityVerified: input.identityVerified as boolean | undefined,
    ipCountry, countryMismatch: input.countryMismatch as boolean | undefined };
}

export function riskSubjectPreview(subjectType: RiskSubjectType, subjectHash: string) {
  return `${subjectType} •••• #${subjectHash.slice(-6)}`;
}
