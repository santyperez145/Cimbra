export type Currency = 'ARS' | 'MXN' | 'COP' | 'BRL' | 'CLP' | 'PEN' | 'USD';

export type RequestOptions = { idempotencyKey?: string; requestId?: string; signal?: AbortSignal };
export type ListOptions = RequestOptions & { limit?: number; cursor?: string };
export type Page<T> = { data: T[]; hasMore: boolean; nextCursor: string | null };
export type CimbraResult<T> = { data: T; requestId: string };

export type Customer = { id: string; type: 'individual' | 'business'; name: string; country: string; taxIdLast4: string; status: string; createdAt: string };
export type Account = { id: string; customerId: string; currency: Currency; country: string; accountReference: string; balance?: number; balanceMinor?: string; status: string; createdAt: string };
export type CardStatus = 'created' | 'active' | 'frozen' | 'terminated';
export type CardProduct = 'debit' | 'credit' | 'prepaid';
export type CardFormat = 'virtual' | 'physical';
export type CardControlChannel = 'ecommerce' | 'contactless' | 'chip' | 'magstripe' | 'atm';
export type Card = {
  id: string; programId: string | null; programName: string | null; accountId: string; customerId: string;
  product: CardProduct; format: CardFormat; last4: string; status: CardStatus; statusReason: string | null;
  activatedAt: string | null; terminatedAt: string | null; createdAt: string; updatedAt: string;
};
export type CardProgram = {
  id: string; name: string; product: CardProduct; formats: CardFormat[]; defaultCurrency: Currency;
  status: 'active' | 'inactive'; createdAt: string;
};
export type CardLifecycleEvent = {
  id: string; cardId: string; fromStatus: CardStatus | null; toStatus: CardStatus; reason: string;
  actorId: string; actorName: string; createdAt: string;
};
export type CardControls = {
  id: string; cardId: string; version: number; currency: Currency;
  perTransactionLimitMinor: string | null; perTransactionLimit: string | null;
  dailyLimitMinor: string | null; dailyLimit: string | null; monthlyLimitMinor: string | null; monthlyLimit: string | null;
  allowedChannels: CardControlChannel[]; allowedMccs: string[]; blockedMccs: string[];
  status: 'active' | 'inactive'; createdBy: string; createdByName: string; createdAt: string;
};
export type Transaction = { id: string; counterparty: string; description: string; amount: number; amountMinor: string; currency: Currency; status: string; riskScore: number; reversalOf: string | null; createdAt: string };
export type PlatformCapability = {
  id: string; name: string; domain: 'core' | 'payments' | 'cards' | 'commerce' | 'credit' | 'risk' | 'operations' | 'platform';
  summary: string; features: string[]; interfaces: Array<'rest_api' | 'webhooks' | 'sdk' | 'console' | 'iso8583' | 'files' | 'streaming'>;
  availability: 'sandbox' | 'foundation' | 'roadmap'; delivery: 'cimbra_native'; regulatoryBoundary: string;
};
export type RiskRule = {
  id: string; name: string; kind: 'amount_threshold' | 'velocity_count' | 'counterparty_match';
  operationType: 'any' | 'transfer' | 'cash_in' | 'cash_out'; scoreDelta: number; action: 'score' | 'review' | 'decline';
  familyId: string; version: number; deployment: 'champion' | 'challenger' | 'archived';
  configuration: Record<string, unknown>; priority: number; status: 'active' | 'disabled'; createdAt: string; updatedAt: string;
};
export type RiskSignalsInput = {
  deviceReference?: string; identityReference?: string; deviceTrust?: 'trusted' | 'unknown' | 'suspicious';
  identityVerified?: boolean; ipCountry?: string; countryMismatch?: boolean;
};
export type RiskSignals = Omit<RiskSignalsInput, 'deviceReference' | 'identityReference'> & {
  deviceReferencePresent: boolean; identityReferencePresent: boolean;
};
export type RiskOutcome = {
  id: string; evaluationId?: string; supersedesOutcomeId?: string | null; label: 'legitimate' | 'fraud';
  fraudType: 'account_takeover' | 'identity_fraud' | 'scam' | 'stolen_instrument' | 'merchant_fraud' | 'other' | null;
  lossAmountMinor: string; currency: Currency; note: string; status?: 'active' | 'superseded'; createdAt: string;
};
export type RiskListEntry = {
  id: string; subjectType: 'counterparty' | 'device' | 'identity'; subjectPreview: string; category: 'allow' | 'watch' | 'block';
  reason: string; status: 'active' | 'disabled'; expiresAt: string | null; createdAt: string; updatedAt?: string;
};
export type RiskEvaluation = {
  id: string; operationType: 'transfer' | 'cash_in' | 'cash_out'; resourceType: string; resourceId: string | null;
  amountMinor: string; amount: number; currency: Currency; counterparty: string; score: number; decision: 'approve' | 'review' | 'decline';
  matchedRuleIds: string[]; matchedListEntryIds: string[]; reasons: string[]; signals: RiskSignals; decisionLatencyMs: number | null; outcome: RiskOutcome | null;
  createdAt: string; requestFingerprint: string; replayed: boolean;
};
export type RiskStepUpChallenge = {
  id: string; evaluationId: string; method: 'otp'; delivery: 'client_managed';
  status: 'pending' | 'verified' | 'failed' | 'expired' | 'cancelled'; attemptCount: number; remainingAttempts: number;
  maxAttempts: number; expiresAt: string; verifiedAt: string | null; failedAt: string | null; createdAt: string; updatedAt: string;
};
export type RiskStepUpAttempt = {
  id: string; attemptNumber: number; result: 'matched' | 'mismatch' | 'expired' | 'locked'; createdAt: string;
};
export type RiskCase = {
  id: string; evaluationId: string; transactionId: string | null; holdId: string | null; status: 'open' | 'resolved';
  priority: 'low' | 'medium' | 'high' | 'critical'; resolution: 'approved' | 'declined' | null; resolutionNote: string | null;
  counterparty: string; amountMinor: string; amount: number; currency: Currency; score: number; decision: 'review' | 'decline'; reasons: string[]; createdAt: string;
};
export type ReconciliationRun = {
  id: string; name: string; source: 'bank' | 'clearing' | 'card_network' | 'cash_network' | 'internal'; currency: Currency;
  ingestionMode: 'api' | 'csv'; fileName: string | null; fileSha256: string | null;
  periodStart: string; periodEnd: string; status: 'open' | 'completed'; expectedMinor: string; expected: number; actualMinor: string; actual: number;
  differenceMinor: string; difference: number; matchedCount: number; exceptionCount: number; createdAt: string; updatedAt: string;
};
export type SettlementCycle = {
  id: string; reconciliationRunId: string; name: string; rail: ReconciliationRun['source']; currency: Currency;
  periodStart: string; periodEnd: string; netMinor: string; net: number; differenceMinor: string; difference: number;
  status: 'ready' | 'scheduled' | 'settled'; scheduledFor: string | null; settledAt: string | null; createdAt: string; updatedAt: string;
};
export type ApprovalRequest = {
  id: string; actionType: 'settlement.execute' | 'transfer.create' | 'risk.case.resolve' | 'reconciliation.exception.resolve' | 'dispute.resolve';
  resourceType: 'settlement_cycle' | 'transfer' | 'risk_case' | 'reconciliation_exception' | 'dispute'; resourceId: string;
  status: 'pending' | 'executed' | 'rejected' | 'cancelled' | 'expired' | 'failed'; requestPayload: {
    name?: string; rail?: ReconciliationRun['source']; currency?: Currency; netMinor?: string; differenceMinor?: string;
    scheduledFor?: string | null; executionMode?: 'manual' | 'scheduled'; counterparty?: string; description?: string;
    amountMinor?: string; origin?: 'session' | 'api_key'; apiKeyId?: string | null; sandbox?: boolean;
    signals?: RiskSignals;
    resolution?: 'approved' | 'declined' | 'corrected' | 'accepted' | DisputeEventName; note?: string; priority?: RiskCase['priority']; score?: number;
    externalReference?: string; runName?: string; reason?: DisputeReason; creditStatus?: Dispute['creditStatus'];
  };
  requestedBy: string; requestedByName: string; resolvedBy: string | null; resolvedByName: string | null;
  resolutionReason: string | null; expiresAt: string; resolvedAt: string | null; executedAt: string | null;
  createdAt: string; updatedAt: string;
};
export type SettlementExecutionResult =
  | { ok: true; cycle: SettlementCycle; replayed: boolean; requiresApproval?: false }
  | { ok: true; requiresApproval: true; approval: ApprovalRequest; replayed: boolean; deduplicated: boolean };
export type TransferCreationResult =
  | { ok: true; requiresApproval: false; transaction: Transaction; replayed: boolean }
  | { ok: true; requiresApproval: true; approval: ApprovalRequest; replayed: boolean; deduplicated: boolean };
export type RiskCaseResolutionResult =
  | { ok: true; requiresApproval: false; case: { id: string; status: 'resolved'; resolution: 'approved' | 'declined'; replayed: boolean }; replayed: boolean }
  | { ok: true; requiresApproval: true; approval: ApprovalRequest; replayed: boolean; deduplicated: boolean };
export type ReconciliationExceptionResolutionResult =
  | { ok: true; requiresApproval: false; exception: { id: string; status: 'resolved' | 'accepted'; resolution: 'corrected' | 'accepted'; replayed: boolean }; replayed: boolean }
  | { ok: true; requiresApproval: true; approval: ApprovalRequest; replayed: boolean; deduplicated: boolean };
export type DisputeReason = 'card_not_present' | 'duplicate' | 'amount_mismatch' | 'service_not_received' | 'credit_not_processed' | 'cash_not_received' | 'other';
export type DisputeStatus = 'opened' | 'under_review' | 'network_ready' | 'won' | 'lost' | 'rejected' | 'cancelled';
export type DisputeEventName = 'start_review' | 'mark_network_ready' | 'resolve_won' | 'resolve_lost' | 'reject' | 'cancel';
export type Dispute = {
  id: string; transactionId: string; reason: DisputeReason; description: string; amountMinor: string; amount: number; currency: Currency;
  status: DisputeStatus; open: boolean; priority: 'low' | 'medium' | 'high' | 'critical'; provisionalCreditRequested: boolean;
  creditStatus: 'none' | 'posted' | 'final' | 'reversed'; creditTransactionId: string | null; creditReversalTransactionId: string | null;
  assignedTo: string | null; assigneeName: string | null; dueAt: string | null; escalatedAt: string | null;
  openedBy: string; openedByName: string; resolvedBy: string | null; resolvedByName: string | null;
  resolutionNote: string | null; resolvedAt: string | null; possibleEvents: DisputeEventName[]; createdAt: string; updatedAt: string;
  originalTransaction: { id: string; counterparty: string; description: string; amountMinor: string; amount: number; currency: Currency; status: string; createdAt: string };
};
export type DisputeTimelineEvent = {
  id: string; event: 'created' | DisputeEventName; fromStatus: DisputeStatus | null; toStatus: DisputeStatus;
  note: string; actorId: string; actorName: string; createdAt: string;
};
export type DisputeTransitionResult =
  | { ok: true; requiresApproval: false; dispute: Dispute; replayed: boolean }
  | { ok: true; requiresApproval: true; approval: ApprovalRequest; replayed: boolean; deduplicated: boolean };
export type ReconciliationException = {
  id: string; runId: string; itemId: string; kind: 'amount_mismatch' | 'missing_internal' | 'missing_external'; status: 'open' | 'resolved' | 'accepted';
  externalReference: string; transactionId: string | null; expectedMinor: string; expected: number; actualMinor: string; actual: number;
  differenceMinor: string; difference: number; currency: Currency; reason: string; resolution: 'corrected' | 'accepted' | null; createdAt: string;
};
export type RiskDecisionSummary = { approve: number; review: number; decline: number; averageScore: number };
export type RiskSimulation = {
  id: string; candidateRuleId: string; baselineRuleId: string | null; sampleCount: number;
  baselineSummary: RiskDecisionSummary; candidateSummary: RiskDecisionSummary;
  deltaSummary: { decisionsChanged: number; newlyReviewed: number; newlyDeclined: number; newlyApproved: number; averageScoreDelta: number };
  createdAt: string;
};
export type RiskMetrics = {
  windowDays: number; totalEvaluations: number; approvals: number; reviews: number; declines: number;
  openCases: number; resolvedCases: number; approvedAfterReview: number; falsePositiveProxyRate: number | null;
  confirmed: {
    total: number; truePositives: number; falsePositives: number; trueNegatives: number; falseNegatives: number;
    precision: number | null; recall: number | null; falsePositiveRate: number | null;
    losses: Array<{ currency: Currency; amountMinor: string; amount: number; count: number }>;
  };
  stepUp: { total: number; pending: number; verified: number; unsuccessful: number; verificationRate: number | null };
  decisionSlo: { targetMs: number; samples: number; p50Ms: number | null; p95Ms: number | null; p99Ms: number | null; complianceRate: number | null };
};
export type WorkItemType = 'risk_case' | 'reconciliation_exception' | 'dispute';
export type OperationalWorkItem = {
  id: string; type: WorkItemType; status: 'open' | 'resolved' | 'accepted' | DisputeStatus; open: boolean; priority: 'low' | 'medium' | 'high' | 'critical';
  assignee: { userId: string; displayName: string; email: string } | null; dueAt: string | null; escalatedAt: string | null;
  slaStatus: 'none' | 'overdue' | 'due_soon' | 'on_track'; reference: string; summary: string;
  amountMinor: string; amount: number; currency: Currency; noteCount: number; evidenceCount: number;
  metadata: Record<string, unknown>; createdAt: string; updatedAt: string;
};
export type OperationalNote = {
  id: string; subjectType: WorkItemType; subjectId: string; body: string; authorId: string; authorName: string; createdAt: string;
};
export type OperationalEvidence = {
  id: string; subjectType: WorkItemType; subjectId: string; documentId: string; fileName: string; contentType: string;
  linkedBy: string; linkedByName: string; createdAt: string;
};
export type OperationalState = {
  workItems: OperationalWorkItem[];
  members: Array<{ userId: string; displayName: string; email: string; role: 'owner' | 'admin' | 'operator' | 'viewer' }>;
  documents: Array<{ id: string; fileName: string; contentType: string; status: string; createdAt: string }>;
  notes: OperationalNote[]; evidence: OperationalEvidence[];
};
export type UpdateOperationalWorkItemInput = {
  assignedToUserId?: string | null; priority?: OperationalWorkItem['priority']; dueAt?: string | null; escalated?: boolean;
};
export type Hold = { id: string; transactionId: string; amountMinor: string; amount: number; currency: Currency; status: string; expiresAt: string | null; createdAt: string; counterparty: string; description: string };
export type LedgerBalance = { currency: Currency; currentMinor: string; heldMinor: string; availableMinor: string; current: number; held: number; available: number };
export type LedgerJournal = { id: string; transactionId: string | null; kind: string; description: string; currency: Currency; status: string; reversalOf: string | null; postedAt: string | null; amountMinor: string; amount: number; postingCount: number };
export type AuditEvent = { id: string; action: string; resourceType: string; resourceId: string; payload: unknown; createdAt: string };
export type WebhookEndpoint = { id: string; name: string; url: string; eventTypes: string[]; status: string; secretRotatedAt: string; createdAt: string; updatedAt: string };
export type WebhookDelivery = { id: string; eventId: string; endpointId: string; eventType: string; status: string; attemptCount: number; nextAttemptAt: string; deliveredAt: string | null; responseStatus: number | null; lastError: string | null };
export type WebhookDeliveryAttempt = { id: string; deliveryId: string; attemptNumber: number; status: string; responseStatus: number | null; responseExcerpt: string | null; error: string | null; startedAt: string; completedAt: string };
export type WebhookOperationalState = { endpoints: WebhookEndpoint[]; deliveries: WebhookDelivery[]; attempts: WebhookDeliveryAttempt[] };
export type HoldResolution = { id: string; status: string; replayed: boolean };
export type WebhookEvent<T = unknown> = { id: string; type: string; created_at: string; data: T };
export type CreateResult<T> = { ok: true; replayed: boolean; customer?: T; account?: T; card?: T };

export type CreateCustomerInput = { type?: 'individual' | 'business'; name: string; country: string; taxId: string };
export type CreateAccountInput = { customerId: string; currency: Currency; country: string };
export type CreateCardInput = { accountId: string; programId?: string; product?: CardProduct; format?: CardFormat };
export type CreateCardProgramInput = { name: string; product: CardProduct; formats: CardFormat[]; defaultCurrency: Currency };
export type TransitionCardInput = { status: Exclude<CardStatus, 'created'>; reason: string };
export type UpdateCardControlsInput = {
  currency: Currency; perTransactionLimit: string | null; dailyLimit: string | null; monthlyLimit: string | null;
  allowedChannels: CardControlChannel[]; allowedMccs: string[]; blockedMccs: string[]; status: 'active' | 'inactive';
};
export type CreateTransferInput = { counterparty: string; description: string; amount: string; currency?: Currency; signals?: RiskSignalsInput };
export type CreatePaymentInput = { accountId: string; direction: 'cash_in' | 'cash_out'; counterparty: string; description: string; amount: string; currency: Currency; signals?: RiskSignalsInput };
export type CreateRiskEvaluationInput = { operationType: 'transfer' | 'cash_in' | 'cash_out'; amount: string; currency: Currency; counterparty: string; signals?: RiskSignalsInput };
export type CreateRiskStepUpChallengeInput = { method?: 'otp'; delivery?: 'client_managed'; expiresInSeconds?: number; maxAttempts?: number };
export type VerifyRiskStepUpChallengeInput = { credential: string };
export type CreateRiskListEntryInput = {
  subjectType: RiskListEntry['subjectType']; subjectValue: string; category: RiskListEntry['category']; reason: string; expiresAt?: string;
};
export type ReportRiskOutcomeInput = {
  label: RiskOutcome['label']; fraudType?: Exclude<RiskOutcome['fraudType'], null>; lossAmount?: string; currency?: Currency;
  note?: string; supersedesOutcomeId?: string;
};
export type CreateRiskRuleInput = {
  name: string; kind: RiskRule['kind']; operationType: RiskRule['operationType']; scoreDelta: number; action: RiskRule['action']; priority?: number;
  configuration: { threshold: string; currency: Currency } | { count: number; windowMinutes: number } | { pattern: string };
};
export type CreateRiskSimulationInput = {
  candidateRuleId: string;
  samples: Array<{ operationType: CreateRiskEvaluationInput['operationType']; amount: string; currency: Currency; counterparty: string }>;
};
export type CreateReconciliationRunInput = {
  name: string; source: ReconciliationRun['source']; currency: Currency; periodStart: string; periodEnd: string;
  entries: Array<{ externalReference: string; transactionId?: string; direction: 'credit' | 'debit'; amount: string }>;
};
export type CreateReconciliationCsvImportInput = {
  name: string; source: ReconciliationRun['source']; currency: Currency; periodStart: string; periodEnd: string;
  csv: string; fileName?: string;
};
export type CreateSettlementCycleInput = { reconciliationRunId: string; name: string; scheduledFor?: string };
export type CreateDisputeInput = {
  transactionId: string; reason: DisputeReason; description: string; amount: string; currency: Currency; provisionalCreditRequested?: boolean;
};
export type CreateWebhookInput = { name: string; url: string; eventTypes: string[] };
