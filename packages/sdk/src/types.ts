export type Currency = 'ARS' | 'MXN' | 'COP' | 'BRL' | 'CLP' | 'PEN' | 'USD';

export type RequestOptions = { idempotencyKey?: string; requestId?: string; signal?: AbortSignal };
export type ListOptions = RequestOptions & { limit?: number; cursor?: string };
export type Page<T> = { data: T[]; hasMore: boolean; nextCursor: string | null };
export type CimbraResult<T> = { data: T; requestId: string };

export type Customer = { id: string; type: 'individual' | 'business'; name: string; country: string; taxIdLast4: string; status: string; createdAt: string };
export type DueDiligenceCheckType = 'identity_document' | 'address' | 'sanctions' | 'pep' | 'business_registry' | 'beneficial_ownership';
export type DueDiligenceParty = {
  id: string; caseId: string; role: 'subject' | 'legal_representative' | 'beneficial_owner' | 'director';
  name: string; taxIdLast4: string; ownershipPercentage: number | null; pepDeclared: boolean;
  createdBy: string; createdByName: string; createdAt: string;
};
export type DueDiligenceCheck = {
  id: string; caseId: string; checkType: DueDiligenceCheckType; source: 'manual_review' | 'official_registry' | 'internal_list';
  status: 'pending' | 'passed' | 'failed' | 'review'; resultCode: string; note: string; evidenceDocumentId: string | null;
  evidenceFileName: string | null; checkedBy: string; checkedByName: string; createdAt: string;
};
export type DueDiligenceEvent = {
  id: string; caseId: string; event: 'created' | 'submitted' | 'approved' | 'rejected' | 'cancelled' | 'expired';
  fromStatus: string | null; toStatus: string; payload: Record<string, unknown>; actorId: string; actorName: string; createdAt: string;
};
export type DueDiligenceCase = {
  id: string; customerId: string; customerName: string; customerType: Customer['type']; country: string; taxIdLast4: string;
  kind: 'kyc' | 'kyb'; jurisdiction: string; policyVersion: string; requiredChecks: DueDiligenceCheckType[];
  completedRequiredChecks: number; readyForReview: boolean;
  status: 'draft' | 'in_review' | 'approved' | 'rejected' | 'cancelled' | 'expired';
  riskRating: 'unassessed' | 'low' | 'medium' | 'high' | 'prohibited'; expiresAt: string;
  createdBy: string; createdByName: string; submittedBy: string | null; submittedByName: string | null; submittedAt: string | null;
  resolvedBy: string | null; resolvedByName: string | null; resolutionNote: string | null; resolvedAt: string | null;
  createdAt: string; updatedAt: string; parties: DueDiligenceParty[]; checks: DueDiligenceCheck[]; events: DueDiligenceEvent[];
};
export type DueDiligenceState = {
  policy: { version: string; kycRequiredChecks: DueDiligenceCheckType[]; kybRequiredChecks: DueDiligenceCheckType[]; boundary: string };
  metrics: { total: number; drafts: number; inReview: number; approved: number; rejected: number };
  cases: DueDiligenceCase[]; customers: Customer[];
  documents: Array<{ id: string; fileName: string; contentType: string; size: number; status: string; createdAt: string }>;
};
export type Account = { id: string; customerId: string; currency: Currency; country: string; accountReference: string; balance?: number; balanceMinor?: string; status: string; createdAt: string };
export type AccountStatementEntry = {
  id: string; journalId: string; transactionId: string | null; kind: string; description: string;
  direction: 'debit' | 'credit'; amountMinor: string; amount: number; signedAmountMinor: string; signedAmount: number;
  currency: Currency; status: string | null; reversalOf: string | null; createdAt: string;
};
export type AccountStatement = {
  account: Pick<Account, 'id' | 'accountReference' | 'currency' | 'status'>;
  period: { from: string; to: string; openingBalanceMinor: string; openingBalance: number; closingBalanceMinor: string; closingBalance: number };
  data: AccountStatementEntry[]; hasMore: boolean; nextCursor: string | null;
};
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
export type BookTransfer = {
  id: string; externalReference: string; sourceAccountId: string; sourceAccountReference: string; sourceCustomerName: string;
  destinationAccountId: string; destinationAccountReference: string; destinationCustomerName: string;
  transactionId: string; reversalTransactionId: string | null; description: string; amountMinor: string; amount: number;
  currency: Currency; status: 'review' | 'settled' | 'reversed' | 'cancelled'; riskScore: number; holdId: string | null;
  createdBy: string; reversedAt: string | null; createdAt: string; updatedAt: string;
};
export type Biller = {
  id: string; code: string; name: string; country: string;
  category: 'utilities' | 'telecom' | 'tax' | 'education' | 'health' | 'insurance' | 'transport' | 'entertainment' | 'other';
  serviceType: 'bill_payment' | 'mobile_topup' | 'gift_card'; currency: Currency; amountMode: 'exact' | 'range' | 'fixed';
  minAmountMinor: string | null; minAmount: number | null; maxAmountMinor: string | null; maxAmount: number | null;
  status: 'active' | 'suspended'; contractReference: string | null; createdBy: string; createdByName: string; createdAt: string; updatedAt: string;
};
export type BillerObligation = {
  id: string; billerId: string; billerName: string; externalReference: string; subscriberReferenceLast4: string;
  amountMinor: string; amount: number; currency: Currency; dueAt: string; description: string;
  status: 'open' | 'paid' | 'cancelled' | 'expired'; paidAt: string | null; createdByName: string; createdAt: string; updatedAt: string;
};
export type BillPaymentOrder = {
  id: string; billerId: string; billerName: string; accountId: string; accountReference: string; obligationId: string | null;
  mandateId: string | null; transactionId: string | null; reversalTransactionId: string | null; serviceType: Biller['serviceType'];
  destinationReferenceLast4: string; amountMinor: string; amount: number; currency: Currency;
  status: 'declined' | 'review' | 'settled' | 'reversed' | 'cancelled'; failureCode: string | null;
  createdByName: string; createdAt: string; updatedAt: string; settledAt: string | null; reversedAt: string | null;
};
export type RecurringPaymentMandate = {
  id: string; billerId: string; billerName: string; serviceType: Biller['serviceType']; currency: Currency;
  accountId: string; accountReference: string; subscriberReferenceLast4: string; frequency: 'weekly' | 'monthly';
  amountMinor: string | null; amount: number | null; amountLimitMinor: string; amountLimit: number;
  consentReference: string; consentedAt: string; status: 'active' | 'paused' | 'cancelled' | 'expired'; nextChargeAt: string;
  lastExecutedAt: string | null; retryCount: number; maxRetries: number; cancelledAt: string | null;
  createdBy: string; createdByName: string; createdAt: string; updatedAt: string;
};
export type RecurringPaymentExecution = {
  id: string; mandateId: string; orderId: string | null; scheduledFor: string; attemptNumber: number;
  status: 'settled' | 'review' | 'declined' | 'skipped_no_debt' | 'failed'; errorCode: string | null; attemptedAt: string;
};
export type PayoutBeneficiary = {
  id: string; externalReference: string; name: string; entityType: 'individual' | 'business'; country: string; currency: Currency;
  destinationType: 'local_account' | 'alias' | 'iban' | 'clabe' | 'pix_key'; destinationLast4: string; bankCode: string | null;
  status: 'active' | 'suspended'; createdBy: string; createdByName: string; createdAt: string; updatedAt: string;
};
export type PayoutItem = {
  id: string; batchId: string; beneficiaryId: string; beneficiaryName: string; beneficiaryReference: string;
  destinationType: PayoutBeneficiary['destinationType']; destinationLast4: string; externalReference: string;
  amountMinor: string; amount: number; currency: Currency; description: string;
  status: 'pending' | 'processing' | 'review' | 'settled' | 'failed' | 'cancelled'; transactionId: string | null;
  failureCode: string | null; failureMessage: string | null; attemptCount: number; processedAt: string | null; createdAt: string; updatedAt: string;
};
export type PayoutBatch = {
  id: string; sourceAccountId: string; sourceAccountReference: string; externalReference: string; description: string; currency: Currency;
  status: 'draft' | 'pending_approval' | 'scheduled' | 'processing' | 'requires_attention' | 'completed' | 'partially_failed' | 'failed' | 'cancelled';
  totalAmountMinor: string; totalAmount: number; itemCount: number; scheduledFor: string | null; processBefore: string | null;
  submittedAt: string | null; startedAt: string | null; completedAt: string | null; cancelledAt: string | null;
  createdBy: string; createdByName: string; createdAt: string; updatedAt: string; items: PayoutItem[];
};
export type PlatformCapability = {
  id: string; name: string; domain: 'core' | 'payments' | 'cards' | 'commerce' | 'credit' | 'risk' | 'operations' | 'platform';
  summary: string; features: string[]; interfaces: Array<'rest_api' | 'webhooks' | 'sdk' | 'console' | 'iso8583' | 'files' | 'streaming'>;
  availability: 'live' | 'sandbox' | 'foundation' | 'roadmap'; delivery: 'cimbra_native'; regulatoryBoundary: string;
};
export type LiveReadiness = {
  requestedMode: 'sandbox' | 'live';
  effectiveMode: 'sandbox' | 'live';
  liveReady: boolean;
  liveBlocked: boolean;
  blockReason: string | null;
  goLive: {
    benchmark: 'Pomelo';
    documentationUrl: string;
    current: 'integracion' | 'homologacion' | 'go_live';
    stages: Array<{ id: 'integracion' | 'homologacion' | 'go_live'; name: string; summary: string }>;
  };
  environments: Array<{
    id: 'sandbox' | 'production';
    status: 'active' | 'provisioned' | 'not_provisioned';
    hostname: string | null;
    pciHostname: string | null;
    credentialsPrefix: string;
    benchmark: string;
  }>;
  products: Array<{
    id: string; name: string; country: 'AR' | 'LATAM'; benchmark: string; documentationUrl: string;
    network: string; sandboxCoverage: string; missingForProduction: string;
    status: 'integracion' | 'homologacion' | 'go_live';
    requiredRailIds: string[]; missingOfficialRails: string[]; adapterReady: boolean;
  }>;
  rails: Array<{
    id: string; name: string; country: 'AR' | 'LATAM';
    kind: 'corporate' | 'regulatory_registry' | 'safeguarding' | 'directory' | 'instant_credit' | 'instant_debit' | 'echeq_clearing' | 'cvu_assignment' | 'qr_pct' | 'card_issuing' | 'bill_payments';
    counterpartyKind: 'clearing_house' | 'bank' | 'card_scheme' | 'official_registry' | 'regulated_sponsor' | 'corporate';
    counterparty: string; officialUrl: string; summary: string; wiringContract: string;
    productIds: string[]; status: 'unwired' | 'negotiating' | 'contracted' | 'certified' | 'live'; adapterRegistered: boolean;
  }>;
  fintechPath: {
    jurisdiction: 'AR'; intendedFigure: 'PSPCP'; summary: string;
    officialSources: Array<{ name: string; url: string; surface: string }>;
    gates: Array<{ id: string; connectionId: string | null; name: string; summary: string; status: 'unwired' | 'negotiating' | 'contracted' | 'certified' | 'live'; met: boolean }>;
    metCount: number; gateCount: number;
  };
  capitalPlan: {
    currency: 'USD'; envelope: number; allocated: number; remaining: number; spent: number;
    commercialGate: 'gate_1_design_partners'; liveReadyAfterSpend: boolean; summary: string;
    officialSources: Array<{ name: string; url: string; surface: string }>;
    allocations: Array<{ id: string; amount: number; status: 'authorized_unspent' | 'spent' | 'exhausted'; name: string; summary: string }>;
    forbidden: Array<{ id: string; name: string; summary: string }>;
    seedUses: string[];
    raise: { instrument: 'pre_seed'; amountUsd: number | null; thesis: string };
  };
  references: Array<{ benchmark: string; url: string; surface: string }>;
  summary: { integracion: number; homologacion: number; goLive: number; officialRailsLive: number; officialRailsTotal: number };
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
  id: string; actionType: 'settlement.execute' | 'transfer.create' | 'transfer.reverse' | 'payment.create' | 'payment.reverse' | 'bill_payment.create' | 'bill_payment.reverse' | 'instant_transfer.return' | 'collection.refund' | 'recurring_mandate.create' | 'payout_batch.execute' | 'risk.case.resolve' | 'reconciliation.exception.resolve' | 'dispute.resolve';
  resourceType: 'settlement_cycle' | 'transfer' | 'book_transfer' | 'payment' | 'bill_payment' | 'instant_transfer' | 'payment_link' | 'recurring_payment_mandate' | 'payout_batch' | 'risk_case' | 'reconciliation_exception' | 'dispute'; resourceId: string;
  status: 'pending' | 'executed' | 'rejected' | 'cancelled' | 'expired' | 'failed'; requestPayload: {
    name?: string; rail?: ReconciliationRun['source']; currency?: Currency; netMinor?: string; differenceMinor?: string;
    scheduledFor?: string | null; executionMode?: 'manual' | 'scheduled'; counterparty?: string; description?: string;
    amountMinor?: string; origin?: 'session' | 'api_key'; apiKeyId?: string | null; sandbox?: boolean;
    accountId?: string; direction?: 'cash_in' | 'cash_out'; paymentId?: string;
    signals?: RiskSignals;
    resolution?: 'approved' | 'declined' | 'corrected' | 'accepted' | DisputeEventName; note?: string; priority?: RiskCase['priority']; score?: number;
    externalReference?: string; sourceAccountId?: string; destinationAccountId?: string; bookTransfer?: boolean;
    totalAmountMinor?: string; itemCount?: number; processBefore?: string | null;
    runName?: string; reason?: DisputeReason; creditStatus?: Dispute['creditStatus'];
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
export type TransferReversalResult =
  | { ok: true; requiresApproval?: false; transaction: Transaction; replayed: boolean }
  | { ok: true; requiresApproval: true; approval: ApprovalRequest; replayed: boolean; deduplicated: boolean };
export type RiskCaseResolutionResult =
  | { ok: true; requiresApproval: false; case: { id: string; status: 'resolved'; resolution: 'approved' | 'declined'; replayed: boolean }; replayed: boolean }
  | { ok: true; requiresApproval: true; approval: ApprovalRequest; replayed: boolean; deduplicated: boolean };
export type ReconciliationExceptionResolutionResult =
  | { ok: true; requiresApproval: false; exception: { id: string; status: 'resolved' | 'accepted'; resolution: 'corrected' | 'accepted'; replayed: boolean }; replayed: boolean }
  | { ok: true; requiresApproval: true; approval: ApprovalRequest; replayed: boolean; deduplicated: boolean };
export type BookTransferCreationResult =
  | { ok: true; requiresApproval: false; transfer: BookTransfer; replayed: boolean }
  | { ok: true; requiresApproval: true; approval: ApprovalRequest; replayed: boolean; deduplicated: boolean };
export type BookTransferReversalResult =
  | { ok: true; requiresApproval?: false; transfer: BookTransfer; reversal: Transaction; replayed: boolean }
  | { ok: true; requiresApproval: true; approval: ApprovalRequest; replayed: boolean; deduplicated: boolean };
export type WalletStatus = 'active' | 'frozen' | 'closed';
export type WalletPocketKind = 'available' | 'pending' | 'rewards';
export type WalletProgram = {
  id: string; name: string; displayName: string; supportUrl: string | null; termsUrl: string | null;
  accentColor: string | null; defaultCurrency: Currency; allowedCurrencies: Currency[];
  pocketKinds: WalletPocketKind[]; status: 'active' | 'inactive'; createdAt: string; updatedAt: string;
};
export type Wallet = {
  id: string; programId: string; programName: string; programDisplayName: string; customerId: string; customerName: string;
  externalReference: string; status: WalletStatus; statusReason: string | null; pocketCount: number;
  createdAt: string; updatedAt: string; pockets?: WalletPocket[];
};
export type WalletPocket = {
  id: string; walletId: string; accountId: string; accountReference: string; kind: WalletPocketKind; label: string;
  currency: Currency; status: string; balanceMinor: string; balance: number; createdAt: string;
};
export type WalletLifecycleEvent = {
  id: string; walletId: string; fromStatus: WalletStatus | null; toStatus: WalletStatus; reason: string;
  actorId: string; actorName: string; createdAt: string;
};
export type WalletPocketTransferCreationResult =
  | { ok: true; requiresApproval: false; transfer: BookTransfer; walletId: string; sourcePocketId: string; destinationPocketId: string; replayed: boolean }
  | { ok: true; requiresApproval: true; approval: ApprovalRequest; walletId: string; sourcePocketId: string; destinationPocketId: string; replayed: boolean; deduplicated: boolean };
export type RailInstrument = {
  id: string; accountId: string; accountReference: string; customerName: string; kind: 'cvu' | 'alias';
  value: string; last4: string; holderName: string; taxIdLast4: string; status: 'active' | 'revoked'; createdAt: string;
};
export type RailDirectoryPreview = {
  found: boolean; kind: 'cvu' | 'cbu' | 'alias'; last4: string; holderName: string | null; taxIdLast4: string | null;
  rail: 'cimbra_sandbox' | 'external_preview';
};
export type InstantTransfer = {
  id: string; scheme: 'credit_push' | 'debit_pull' | 'qr_collect'; direction: 'outbound' | 'inbound' | 'internal';
  sourceAccountId: string | null; sourceAccountReference: string | null; destinationAccountId: string | null; destinationAccountReference: string | null;
  counterpartyKind: 'cvu' | 'cbu' | 'alias'; counterpartyLast4: string; counterpartyHolderName: string | null; counterpartyTaxLast4: string | null;
  amountMinor: string; amount: number; currency: 'ARS'; description: string; externalReference: string;
  status: 'pending' | 'accepted' | 'rejected' | 'settled' | 'returned' | 'expired' | 'cancelled'; rail: 'cimbra_sandbox';
  transactionId: string | null; reversalTransactionId: string | null; qrPayload: string | null; expiresAt: string | null;
  collectionTillId: string | null; createdAt: string; updatedAt: string;
};
export type PaymentQr = {
  id: string; accountId: string; accountReference: string; amountMinor: string | null; amount: number | null;
  currency: 'ARS'; description: string; payload: string; kind: 'dynamic' | 'static' | 'debt';
  owner: 'account' | 'till'; collectionTillId: string | null;
  status: 'active' | 'paid' | 'expired' | 'cancelled';
  expiresAt: string | null; paidTransferId: string | null; createdAt: string; updatedAt: string;
};
export type QrSaleOrder = {
  id: string; paymentQrId: string; qrPayload: string; accountId: string; accountReference: string;
  amountMinor: string; amount: number; currency: 'ARS'; description: string; externalReference: string;
  status: 'pending' | 'paid' | 'expired' | 'cancelled' | 'superseded';
  expiresAt: string; paidTransferId: string | null; createdAt: string; updatedAt: string;
};
export type QrDebt = {
  id: string; accountId: string; accountReference: string; paymentQrId: string; payload: string;
  amountMinor: string; amount: number; currency: 'ARS'; description: string; externalReference: string;
  status: 'open' | 'paid' | 'expired' | 'cancelled';
  expiresAt: string; paidTransferId: string | null; createdAt: string; updatedAt: string;
};
export type CollectionMethod = 'internal' | 'sandbox_inbound' | 'cimbra_qr' | 'cimbra_cvu';
export type PaymentLinkItem = {
  description: string; amountMinor: string; amount: number; quantity: number;
  code: string | null; additional: string | null;
};
export type PaymentLinkCredit = {
  id: string; amountMinor: string; amount: number; refundedMinor: string; refundedAmount: number;
  remainingMinor: string; remainingAmount: number; method: 'cimbra_cvu';
  payerAccountId: string | null; transactionId: string; instantTransferId: string | null; createdAt: string;
};
export type PaymentLinkRefund = {
  id: string; amountMinor: string; amount: number; creditId: string | null; transactionId: string; createdAt: string;
};
export type PaymentLink = {
  id: string; accountId: string; accountReference: string; customerName: string;
  amountMinor: string; amount: number; collectedMinor: string; collectedAmount: number;
  remainingMinor: string; remainingAmount: number; refundedMinor: string; refundedAmount: number;
  partiallyCollected: boolean; partiallyRefunded: boolean; checkoutUrl: string;
  currency: 'ARS'; description: string; externalReference: string;
  allowedMethods: CollectionMethod[]; payload: string;
  qrDebtId: string | null; collectionTillId: string | null; qrPayload: string | null; cvu: string | null;
  items: PaymentLinkItem[]; credits: PaymentLinkCredit[]; refunds: PaymentLinkRefund[];
  status: 'open' | 'pending' | 'paid' | 'expired' | 'cancelled' | 'refunded'; expiresAt: string;
  paidMethod: CollectionMethod | null; payerAccountId: string | null; payerAccountReference: string | null;
  transactionId: string | null; reversalTransactionId: string | null; createdAt: string; updatedAt: string;
};
export type CollectionTill = {
  id: string; accountId: string; accountReference: string; customerName: string;
  name: string; externalReference: string; cvu: string; alias: string | null; aliasChangedAt: string | null;
  paymentQrId: string | null; qrPayload: string | null; presence: 'present' | 'not_present';
  closedAmountOnly: boolean; status: 'active' | 'disabled'; createdAt: string; updatedAt: string;
};
export type EcheqStatus = 'issued' | 'accepted' | 'endorsed' | 'pending' | 'deposited' | 'cancelled' | 'returned' | 'rejected' | 'expired';
export type Echeq = {
  id: string; drawerAccountId: string; drawerAccountReference: string; drawerCustomerName: string;
  holderAccountId: string | null; holderAccountReference: string | null;
  amountMinor: string; amount: number; currency: 'ARS'; description: string; externalReference: string;
  payload: string; toOrder: boolean; paymentDate: string; expiresAt: string; status: EcheqStatus;
  beneficiaryName: string; beneficiaryTaxLast4: string; endorsementCount: number; rejectReason: string | null;
  transactionId: string | null; rail: 'cimbra_sandbox'; createdAt: string; updatedAt: string;
};
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
export type CreateDueDiligenceCaseInput = { customerId: string; expiresInDays?: number };
export type CreateDueDiligencePartyInput = {
  role: DueDiligenceParty['role']; name: string; taxId: string; ownershipPercentage?: number; pepDeclared?: boolean;
};
export type RecordDueDiligenceCheckInput = {
  checkType: DueDiligenceCheckType; source: DueDiligenceCheck['source']; status: DueDiligenceCheck['status'];
  resultCode: string; note: string; evidenceDocumentId?: string;
};
export type CreateAccountInput = { customerId: string; currency: Currency; country: string };
export type AccountStatementOptions = ListOptions & { from?: string; to?: string };
export type CreateCardInput = { accountId: string; programId?: string; product?: CardProduct; format?: CardFormat };
export type CreateCardProgramInput = { name: string; product: CardProduct; formats: CardFormat[]; defaultCurrency: Currency };
export type TransitionCardInput = { status: Exclude<CardStatus, 'created'>; reason: string };
export type UpdateCardControlsInput = {
  currency: Currency; perTransactionLimit: string | null; dailyLimit: string | null; monthlyLimit: string | null;
  allowedChannels: CardControlChannel[]; allowedMccs: string[]; blockedMccs: string[]; status: 'active' | 'inactive';
};
export type CreateTransferInput = { counterparty: string; description: string; amount: string; currency?: Currency; signals?: RiskSignalsInput };
export type CreateBookTransferInput = {
  externalReference: string; sourceAccountId: string; destinationAccountId: string;
  description: string; amount: string; currency: Currency; signals?: RiskSignalsInput;
};
export type CreateWalletProgramInput = {
  name: string; displayName: string; supportUrl?: string | null; termsUrl?: string | null; accentColor?: string | null;
  defaultCurrency: Currency; allowedCurrencies?: Currency[]; pocketKinds?: WalletPocketKind[];
};
export type CreateWalletInput = { programId: string; customerId: string; externalReference: string };
export type TransitionWalletInput = { status: Exclude<WalletStatus, never>; reason: string };
export type CreateWalletPocketTransferInput = {
  externalReference: string; sourcePocketId: string; destinationPocketId: string;
  description: string; amount: string; currency: Currency; signals?: RiskSignalsInput;
};
export type IssueRailInstrumentInput = { accountId: string; alias?: string | null };
export type AssignRailAliasInput = { alias: string };
export type CreateInstantTransferInput = {
  externalReference: string; accountId: string; destination: string; description: string; amount: string;
  currency: 'ARS'; direction?: 'outbound' | 'inbound'; confirmHolder: true; holderName: string; taxIdLast4: string;
  signals?: RiskSignalsInput;
};
export type CreateDebitRequestInput = {
  externalReference: string; collectorAccountId: string; payerDestination: string; description: string;
  amount: string; currency: 'ARS'; expiresInMinutes?: number;
};
export type CreatePaymentQrInput = {
  accountId: string; description: string; kind?: 'dynamic' | 'static'; amount?: string; currency?: 'ARS'; expiresInMinutes?: number;
};
export type PayPaymentQrInput = { sourceAccountId: string; externalReference: string; amount?: string; signals?: RiskSignalsInput };
export type CreateQrSaleOrderInput = {
  paymentQrId: string; externalReference: string; description: string; amount: string; currency?: 'ARS'; expiresInMinutes?: number;
};
export type CreateQrDebtInput = {
  accountId: string; externalReference: string; description: string; amount: string; currency?: 'ARS'; expiresInMinutes?: number;
};
export type CreatePaymentLinkInput = {
  accountId: string; externalReference: string; description: string; amount: string; currency: 'ARS';
  expiresInMinutes?: number; methods?: CollectionMethod[]; qrDebtId?: string | null; collectionTillId?: string | null;
  items?: Array<{ description: string; amount: string; quantity?: number; code?: string | null; additional?: string | null }>;
};
export type CreateCollectionTillInput = {
  accountId: string; externalReference: string; name: string; paymentQrId?: string | null; alias?: string | null;
  issueStaticQr?: boolean; closedAmountOnly?: boolean; presence?: 'present' | 'not_present';
};
export type CreditCollectionTillInput = {
  externalReference: string; description: string; amount: string; currency?: 'ARS'; signals?: RiskSignalsInput;
};
export type PayPaymentLinkInput = { method: CollectionMethod | 'card' | 'pos' | 'tap_to_phone' | 'qr_interoperable'; payerAccountId?: string; amount?: string; signals?: RiskSignalsInput };
export type RefundPaymentLinkInput = { amount?: string; creditId?: string | null };
export type InstantTransferReturnResult =
  | { ok: true; requiresApproval?: false; transfer: InstantTransfer; reversal: Transaction; replayed: boolean }
  | { ok: true; requiresApproval: true; approval: ApprovalRequest; replayed: boolean; deduplicated: boolean };
export type PaymentLinkRefundResult =
  | { ok: true; requiresApproval?: false; link: PaymentLink; reversal?: Transaction; replayed: boolean }
  | { ok: true; requiresApproval: true; approval: ApprovalRequest; replayed: boolean; deduplicated: boolean };
export type CreateEcheqInput = {
  drawerAccountId: string; externalReference: string; description: string; amount: string; currency?: 'ARS' | 'USD';
  beneficiaryName: string; beneficiaryTaxId: string; paymentDate?: string; toOrder?: boolean;
  discount?: boolean; custody?: boolean; clearing?: 'coelsa' | 'camara';
};
export type AcceptEcheqInput = { accountId: string; taxId: string };
export type EndorseEcheqInput = { beneficiaryName: string; beneficiaryTaxId: string; discount?: boolean };
export type DepositEcheqInput = {
  accountId: string; taxId: string; destinationKind?: 'cimbra_account' | 'cbu' | 'cvu' | 'coelsa'; signals?: RiskSignalsInput;
};
export type CreatePaymentInput = { accountId: string; direction: 'cash_in' | 'cash_out'; counterparty: string; description: string; amount: string; currency: Currency; signals?: RiskSignalsInput };
export type PaymentCreationResult =
  | { ok: true; requiresApproval?: false; payment: Transaction; replayed: boolean }
  | { ok: true; requiresApproval: true; approval: ApprovalRequest; replayed: boolean; deduplicated: boolean };
export type PaymentReversalResult =
  | { ok: true; requiresApproval?: false; payment: Transaction; reversal: Transaction; replayed: boolean }
  | { ok: true; requiresApproval: true; approval: ApprovalRequest; replayed: boolean; deduplicated: boolean };
export type CreateBillerInput = {
  code: string; name: string; country: string; category: Biller['category']; serviceType: Biller['serviceType']; currency: Currency;
  amountMode: Biller['amountMode']; minAmount?: string; maxAmount?: string; contractReference?: string;
};
export type CreateBillerObligationInput = {
  externalReference: string; subscriberReference: string; amount: string; dueAt: string; description: string;
};
export type CreateBillPaymentInput = {
  accountId: string; billerId: string; obligationId?: string; destinationReference?: string; amount?: string;
};
export type BillPaymentCreationResult =
  | { ok: true; requiresApproval?: false; order: BillPaymentOrder; replayed: boolean }
  | { ok: true; requiresApproval: true; approval: ApprovalRequest; replayed: boolean; deduplicated: boolean };
export type BillPaymentReversalResult =
  | { ok: true; requiresApproval?: false; order: BillPaymentOrder; replayed: boolean }
  | { ok: true; requiresApproval: true; approval: ApprovalRequest; replayed: boolean; deduplicated: boolean };
export type CreateRecurringPaymentMandateInput = {
  accountId: string; billerId: string; subscriberReference: string; frequency: RecurringPaymentMandate['frequency'];
  amount?: string; amountLimit: string; consentReference: string; consentedAt: string; nextChargeAt: string; maxRetries?: number;
};
export type RecurringPaymentMandateCreationResult =
  | { ok: true; requiresApproval?: false; mandate: RecurringPaymentMandate; replayed: boolean }
  | { ok: true; requiresApproval: true; approval: ApprovalRequest; replayed: boolean; deduplicated: boolean };
export type CreatePayoutBeneficiaryInput = {
  externalReference: string; name: string; entityType: PayoutBeneficiary['entityType']; country: string; currency: Currency;
  destinationType: PayoutBeneficiary['destinationType']; destination: string; bankCode?: string;
};
export type CreatePayoutBatchInput = {
  sourceAccountId: string; externalReference: string; description: string; currency: Currency;
  scheduledFor?: string; processBefore?: string;
  items: Array<{ externalReference: string; beneficiaryId: string; amount: string; description: string }>;
};
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

export type SupportCategory = 'sandbox' | 'api' | 'console' | 'compliance' | 'commercial' | 'other';
export type SupportCaseStatus = 'open' | 'pending_cimbra' | 'pending_tenant' | 'resolved' | 'closed';
export type SupportCase = {
  id: string; organizationId: string; openedBy: string; openedByName: string; category: SupportCategory;
  subject: string; status: SupportCaseStatus; createdAt: string; updatedAt: string; messageCount: number;
};
export type SupportMessage = {
  id: string; caseId: string; authorId: string; authorName: string; authorKind: 'tenant' | 'platform';
  body: string; createdAt: string;
};
export type SupportCaseThread = { case: SupportCase; messages: SupportMessage[] };
export type SupportCaseResult = { ok: true; case: SupportCase; messages: SupportMessage[]; replayed: boolean };
export type OpenSupportCaseInput = { category: SupportCategory; subject: string; message: string };

export type Organization = {
  id: string; name: string; slug: string; country: string; status: string; createdAt: string; memberCount: number;
};
export type UpdateOrganizationInput = { name?: string; country?: 'AR' | 'MX' | 'CO' | 'BR' | 'CL' | 'PE' };

export type ServiceExtractionDebt = { table: string; owner: string; reason: string };
export type ServiceTopology = {
  services: Array<{
    id: string; name: string; mission: string; runtime: 'in_process' | 'standalone'; ownedTables: number;
    modules: number; publishes: string[]; extractable: boolean; extractionDebt: ServiceExtractionDebt[];
    extractionGate: string; benchmark: string;
  }>;
  totals: { services: number; standalone: number; extractable: number; ownedTables: number; extractionDebt: number };
  kernelContract: string[];
  posture: string;
};
