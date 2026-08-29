export const DISPUTE_REASONS = [
  'card_not_present',
  'duplicate',
  'amount_mismatch',
  'service_not_received',
  'credit_not_processed',
  'cash_not_received',
  'other',
] as const;

export const DISPUTE_STATUSES = [
  'opened',
  'under_review',
  'network_ready',
  'won',
  'lost',
  'rejected',
  'cancelled',
] as const;

export const DISPUTE_EVENTS = [
  'start_review',
  'mark_network_ready',
  'resolve_won',
  'resolve_lost',
  'reject',
  'cancel',
] as const;

export type DisputeReason = typeof DISPUTE_REASONS[number];
export type DisputeStatus = typeof DISPUTE_STATUSES[number];
export type DisputeEvent = typeof DISPUTE_EVENTS[number];

const transitions: Record<DisputeStatus, Partial<Record<DisputeEvent, DisputeStatus>>> = {
  opened: { start_review: 'under_review', cancel: 'cancelled' },
  under_review: { mark_network_ready: 'network_ready', resolve_won: 'won', resolve_lost: 'lost', reject: 'rejected', cancel: 'cancelled' },
  network_ready: { resolve_won: 'won', resolve_lost: 'lost', reject: 'rejected' },
  won: {}, lost: {}, rejected: {}, cancelled: {},
};

export function disputeReason(value: unknown): DisputeReason | null {
  return typeof value === 'string' && DISPUTE_REASONS.includes(value as DisputeReason) ? value as DisputeReason : null;
}

export function disputeEvent(value: unknown): DisputeEvent | null {
  return typeof value === 'string' && DISPUTE_EVENTS.includes(value as DisputeEvent) ? value as DisputeEvent : null;
}

export function disputeNextStatus(status: DisputeStatus, event: DisputeEvent): DisputeStatus | null {
  return transitions[status][event] ?? null;
}

export function disputePossibleEvents(status: DisputeStatus): DisputeEvent[] {
  return Object.keys(transitions[status]) as DisputeEvent[];
}

export function isOpenDispute(status: string) {
  return status === 'opened' || status === 'under_review' || status === 'network_ready';
}

export function disputeText(value: unknown, maxLength: number, minimum = 0) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().slice(0, maxLength);
  return normalized.length >= minimum ? normalized : null;
}
