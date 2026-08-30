export const DUE_DILIGENCE_CHECK_TYPES = [
  'identity_document', 'address', 'sanctions', 'pep', 'business_registry', 'beneficial_ownership',
] as const;

export type DueDiligenceCheckType = typeof DUE_DILIGENCE_CHECK_TYPES[number];
export type DueDiligenceRiskRating = 'low' | 'medium' | 'high' | 'prohibited';

function identifier(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length >= 8 && normalized.length <= 100 ? normalized : null;
}

export function normalizeDueDiligenceCaseInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const customerId = identifier(body.customerId);
  const expiresInDays = Number(body.expiresInDays ?? 90);
  if (!customerId || !Number.isInteger(expiresInDays) || expiresInDays < 7 || expiresInDays > 365) return null;
  return { customerId, expiresInDays };
}

export function normalizeDueDiligencePartyInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const role = body.role;
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ').slice(0, 160) : '';
  const taxId = typeof body.taxId === 'string' ? body.taxId.replace(/[^A-Za-z0-9]/g, '').slice(0, 80) : '';
  const ownershipBps = body.ownershipPercentage === undefined || body.ownershipPercentage === null || body.ownershipPercentage === ''
    ? null : Math.round(Number(body.ownershipPercentage) * 100);
  const pepDeclared = body.pepDeclared === true;
  if (!['subject', 'legal_representative', 'beneficial_owner', 'director'].includes(String(role)) || name.length < 2 || taxId.length < 4 ||
      (ownershipBps !== null && (!Number.isInteger(ownershipBps) || ownershipBps < 1 || ownershipBps > 10_000)) ||
      (role === 'beneficial_owner' && ownershipBps === null)) return null;
  return { role: role as 'subject' | 'legal_representative' | 'beneficial_owner' | 'director', name,
    taxIdLast4: taxId.slice(-4), ownershipBps, pepDeclared };
}

export function normalizeDueDiligenceCheckInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const checkType = body.checkType;
  const source = body.source;
  const status = body.status;
  const resultCode = typeof body.resultCode === 'string' ? body.resultCode.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '_').slice(0, 80) : '';
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : '';
  const evidenceDocumentId = body.evidenceDocumentId === undefined || body.evidenceDocumentId === null || body.evidenceDocumentId === ''
    ? null : identifier(body.evidenceDocumentId);
  if (!DUE_DILIGENCE_CHECK_TYPES.includes(checkType as DueDiligenceCheckType) ||
      !['manual_review', 'official_registry', 'internal_list'].includes(String(source)) ||
      !['pending', 'passed', 'failed', 'review'].includes(String(status)) || resultCode.length < 2 || note.length < 3 ||
      (body.evidenceDocumentId && !evidenceDocumentId)) return null;
  return { checkType: checkType as DueDiligenceCheckType,
    source: source as 'manual_review' | 'official_registry' | 'internal_list',
    status: status as 'pending' | 'passed' | 'failed' | 'review', resultCode, note, evidenceDocumentId };
}

export function normalizeDueDiligenceDecisionInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const decision = body.decision;
  const riskRating = body.riskRating;
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : '';
  if (!['approve', 'reject'].includes(String(decision)) ||
      !['low', 'medium', 'high', 'prohibited'].includes(String(riskRating)) || note.length < 3) return null;
  if (decision === 'approve' && riskRating === 'prohibited') return null;
  return { decision: decision as 'approve' | 'reject', riskRating: riskRating as DueDiligenceRiskRating, note };
}

export function normalizeDueDiligenceCancellation(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const note = typeof (value as Record<string, unknown>).note === 'string'
    ? String((value as Record<string, unknown>).note).trim().slice(0, 1000) : '';
  return note.length >= 3 ? { note } : null;
}
