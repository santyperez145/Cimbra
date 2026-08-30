import { majorToMinor, normalizeCurrency, type Currency } from '../ledger/money.ts';
import type { RiskOperation, RiskRuleAction, RiskRuleKind } from '../../../db/risk.ts';

export type NormalizedRiskRuleInput = {
  name: string;
  kind: RiskRuleKind;
  operationType: 'any' | RiskOperation;
  scoreDelta: number;
  action: RiskRuleAction;
  configuration: Record<string, unknown>;
  priority: number;
};

export type RiskSimulationSample = {
  operationType: RiskOperation;
  amountMinor: bigint;
  currency: Currency;
  counterparty: string;
};

function normalizeConfiguration(kind: RiskRuleKind, value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const configuration = value as Record<string, unknown>;
  if (kind === 'amount_threshold') {
    const currency = normalizeCurrency(configuration.currency);
    if (!currency) return null;
    try {
      const thresholdMinor = majorToMinor(configuration.threshold, currency);
      return thresholdMinor > 0n ? { currency, thresholdMinor: thresholdMinor.toString() } : null;
    } catch { return null; }
  }
  if (kind === 'counterparty_match') {
    const pattern = typeof configuration.pattern === 'string' ? configuration.pattern.trim().toLowerCase() : '';
    return pattern.length >= 2 && pattern.length <= 80 ? { pattern } : null;
  }
  const count = Number(configuration.count);
  const windowMinutes = Number(configuration.windowMinutes);
  return Number.isInteger(count) && count >= 2 && count <= 1000 && Number.isInteger(windowMinutes) && windowMinutes >= 1 && windowMinutes <= 10080
    ? { count, windowMinutes } : null;
}

export function normalizeRiskRuleInput(value: unknown): NormalizedRiskRuleInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
  const kind = ['amount_threshold', 'velocity_count', 'counterparty_match'].includes(String(body.kind)) ? body.kind as RiskRuleKind : null;
  const operationType = ['any', 'transfer', 'cash_in', 'cash_out'].includes(String(body.operationType)) ? body.operationType as 'any' | RiskOperation : null;
  const action = ['score', 'review', 'decline'].includes(String(body.action)) ? body.action as RiskRuleAction : null;
  const scoreDelta = Number(body.scoreDelta);
  const priority = Number(body.priority ?? 100);
  const configuration = kind ? normalizeConfiguration(kind, body.configuration) : null;
  if (name.length < 2 || !kind || !operationType || !action || !Number.isInteger(scoreDelta) || scoreDelta < 0 || scoreDelta > 100 ||
      !Number.isInteger(priority) || priority < 1 || priority > 1000 || !configuration) return null;
  return { name, kind, operationType, scoreDelta, action, configuration, priority };
}

export function normalizeRiskSimulationSamples(value: unknown): RiskSimulationSample[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) return null;
  const samples: RiskSimulationSample[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const sample = item as Record<string, unknown>;
    const operationType = ['transfer', 'cash_in', 'cash_out'].includes(String(sample.operationType)) ? sample.operationType as RiskOperation : null;
    const currency = normalizeCurrency(sample.currency);
    const counterparty = typeof sample.counterparty === 'string' ? sample.counterparty.trim().slice(0, 120) : '';
    if (!operationType || !currency || counterparty.length < 2) return null;
    try {
      const amountMinor = majorToMinor(sample.amount, currency);
      if (amountMinor <= 0n) return null;
      samples.push({ operationType, amountMinor, currency, counterparty });
    } catch { return null; }
  }
  return samples;
}

export function normalizeRiskStepUpInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const method = body.method ?? 'otp';
  const delivery = body.delivery ?? 'client_managed';
  const expiresInSeconds = Number(body.expiresInSeconds ?? 300);
  const maxAttempts = Number(body.maxAttempts ?? 5);
  if (method !== 'otp' || delivery !== 'client_managed' || !Number.isInteger(expiresInSeconds) ||
      expiresInSeconds < 60 || expiresInSeconds > 900 || !Number.isInteger(maxAttempts) ||
      maxAttempts < 1 || maxAttempts > 10) return null;
  return { expiresInSeconds, maxAttempts };
}

export function normalizeRiskStepUpCredential(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const credential = typeof (value as Record<string, unknown>).credential === 'string'
    ? String((value as Record<string, unknown>).credential).trim() : '';
  return /^\d{6}$/.test(credential) ? credential : null;
}
