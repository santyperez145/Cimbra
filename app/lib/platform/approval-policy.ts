import type { OrganizationRole } from './access-policy';

export const APPROVAL_ACTION_TYPES = [
  'settlement.execute',
  'transfer.create',
  'transfer.reverse',
  'payment.create',
  'payment.reverse',
  'bill_payment.create',
  'bill_payment.reverse',
  'instant_transfer.return',
  'instant_transfer.create',
  'collection.refund',
  'recurring_mandate.create',
  'recurring_mandate.resume',
  'debit_request.accept',
  'payment_qr.pay',
  'echeq.deposit',
  'payout_batch.execute',
  'risk.case.resolve',
  'reconciliation.exception.resolve',
  'dispute.resolve',
] as const;
export type ApprovalActionType = typeof APPROVAL_ACTION_TYPES[number];
export type ApprovalStatus = 'pending' | 'executed' | 'rejected' | 'cancelled' | 'expired' | 'failed';

export function approvalActionType(value: unknown): ApprovalActionType | null {
  return typeof value === 'string' && APPROVAL_ACTION_TYPES.includes(value as ApprovalActionType)
    ? value as ApprovalActionType : null;
}

export function approvalExpiryMinutes(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 15 && parsed <= 10_080 ? parsed : null;
}

export function approvalReason(value: unknown, required = false): string | null {
  if (value === undefined || value === null || value === '') return required ? null : '';
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if ((required && normalized.length < 3) || normalized.length > 500) return null;
  return normalized;
}

export function canDecideApproval(input: {
  actorRole: OrganizationRole; actorId: string; requesterId: string; mfaEnabled: boolean;
}) {
  return input.mfaEnabled && input.actorId !== input.requesterId && ['owner', 'admin'].includes(input.actorRole);
}
