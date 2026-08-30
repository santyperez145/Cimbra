import { CimbraApiError, CimbraConnectionError, CimbraTimeoutError } from './errors.ts';
import type {
  Account, ApprovalRequest, AuditEvent, Biller, BillerObligation, BillPaymentOrder, Card, CardControls, CardLifecycleEvent, CardProgram, CimbraResult, CreateAccountInput,
  CreateBillerInput, CreateBillerObligationInput, CreateBillPaymentInput, CreateCardInput, CreateCardProgramInput, CreateCustomerInput, CreateDisputeInput, CreatePaymentInput,
  CreateDueDiligenceCaseInput, CreateDueDiligencePartyInput,
  CreateReconciliationCsvImportInput, CreateReconciliationRunInput, CreateRiskEvaluationInput, CreateRiskListEntryInput, CreateRiskRuleInput, CreateRiskSimulationInput,
  CreateRiskStepUpChallengeInput,
  CreateRecurringPaymentMandateInput, CreateSettlementCycleInput, CreateTransferInput, CreateWebhookInput,
  Customer, DueDiligenceCase, DueDiligenceCheck, DueDiligenceParty, DueDiligenceState,
  Dispute, DisputeEventName, DisputeTimelineEvent, DisputeTransitionResult, Hold, HoldResolution, LedgerBalance, LedgerJournal, ListOptions, Page, PlatformCapability,
  OperationalEvidence, OperationalNote, OperationalState, OperationalWorkItem, TransitionCardInput, UpdateCardControlsInput,
  UpdateOperationalWorkItemInput, WorkItemType,
  ReconciliationException, ReconciliationExceptionResolutionResult, ReconciliationRun, RequestOptions, RiskCase,
  ReportRiskOutcomeInput, RiskCaseResolutionResult, RiskEvaluation, RiskListEntry, RiskMetrics, RiskOutcome, RiskRule, RiskSimulation,
  RecurringPaymentMandate, RiskStepUpAttempt, RiskStepUpChallenge, SettlementCycle, SettlementExecutionResult, VerifyRiskStepUpChallengeInput,
  RecordDueDiligenceCheckInput, Transaction, TransferCreationResult, WebhookOperationalState,
} from './types.ts';

type Fetch = typeof globalThis.fetch;
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
type Sleep = (milliseconds: number) => Promise<void>;

export type CimbraConfig = {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetch?: Fetch;
  sleep?: Sleep;
};

function identifier(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

function retryDelay(response: Response | null, attempt: number) {
  const header = response?.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
    if (milliseconds > 0) return Math.min(milliseconds, 30_000);
  }
  return Math.min(500 * (2 ** attempt), 8_000) + Math.floor(Math.random() * 200);
}

function shouldRetryResponse(response: Response) {
  const instruction = response.headers.get('cimbra-should-retry');
  if (instruction === 'true') return true;
  if (instruction === 'false') return false;
  return response.status === 408 || response.status === 429 || response.status >= 500;
}

function listPath(path: string, options?: ListOptions) {
  const parameters = new URLSearchParams();
  if (options?.limit !== undefined) parameters.set('limit', String(options.limit));
  if (options?.cursor) parameters.set('cursor', options.cursor);
  const query = parameters.toString();
  return query ? `${path}?${query}` : path;
}

function operationalPath(type: WorkItemType) {
  return type === 'risk_case' ? 'risk-case' : type === 'dispute' ? 'dispute' : 'reconciliation-exception';
}

export class Cimbra {
  readonly customers = {
    list: (options?: ListOptions) => this.request<Page<Customer>>('GET', listPath('/api/v1/customers', options), undefined, options),
    listAll: (options?: ListOptions) => this.iterate((page) => this.customers.list({ ...options, cursor: page })),
    retrieve: (id: string, options?: RequestOptions) => this.request<Customer>('GET', `/api/v1/customers/${encodeURIComponent(id)}`, undefined, options),
    create: (input: CreateCustomerInput, options?: RequestOptions) =>
      this.post<{ ok: true; customer: Customer; replayed: boolean }>('/api/v1/customers', input, options, true),
  };

  readonly dueDiligence = {
    state: (options?: RequestOptions) => this.request<{ data: DueDiligenceState }>('GET', '/api/v1/due-diligence', undefined, options),
    retrieve: (id: string, options?: RequestOptions) =>
      this.request<{ data: DueDiligenceCase }>('GET', `/api/v1/due-diligence/cases/${encodeURIComponent(id)}`, undefined, options),
    create: (input: CreateDueDiligenceCaseInput, options?: RequestOptions) =>
      this.post<{ ok: true; case: DueDiligenceCase; replayed: boolean }>('/api/v1/due-diligence/cases', input, options, true),
    addParty: (id: string, input: CreateDueDiligencePartyInput, options?: RequestOptions) =>
      this.post<{ ok: true; party: DueDiligenceParty; replayed: boolean }>(
        `/api/v1/due-diligence/cases/${encodeURIComponent(id)}/parties`, input, options, true),
    recordCheck: (id: string, input: RecordDueDiligenceCheckInput, options?: RequestOptions) =>
      this.post<{ ok: true; check: DueDiligenceCheck; replayed: boolean }>(
        `/api/v1/due-diligence/cases/${encodeURIComponent(id)}/checks`, input, options, true),
    submit: (id: string, options?: RequestOptions) =>
      this.post<{ ok: true; case: DueDiligenceCase; replayed: boolean }>(
        `/api/v1/due-diligence/cases/${encodeURIComponent(id)}/submit`, undefined, options, true),
    cancel: (id: string, note: string, options?: RequestOptions) =>
      this.post<{ ok: true; case: DueDiligenceCase; replayed: boolean }>(
        `/api/v1/due-diligence/cases/${encodeURIComponent(id)}/cancel`, { note }, options, true),
  };

  readonly accounts = {
    list: (options?: ListOptions) => this.request<Page<Account>>('GET', listPath('/api/v1/accounts', options), undefined, options),
    listAll: (options?: ListOptions) => this.iterate((page) => this.accounts.list({ ...options, cursor: page })),
    retrieve: (id: string, options?: RequestOptions) => this.request<Account>('GET', `/api/v1/accounts/${encodeURIComponent(id)}`, undefined, options),
    create: (input: CreateAccountInput, options?: RequestOptions) =>
      this.post<{ ok: true; account: Account; replayed: boolean }>('/api/v1/accounts', input, options, true),
  };

  readonly cards = {
    list: (options?: ListOptions) => this.request<Page<Card>>('GET', listPath('/api/v1/cards', options), undefined, options),
    listAll: (options?: ListOptions) => this.iterate((page) => this.cards.list({ ...options, cursor: page })),
    retrieve: (id: string, options?: RequestOptions) => this.request<Card>('GET', `/api/v1/cards/${encodeURIComponent(id)}`, undefined, options),
    create: (input: CreateCardInput, options?: RequestOptions) =>
      this.post<{ ok: true; card: Card; replayed: boolean }>('/api/v1/cards', input, options, true),
    lifecycle: (id: string, options?: RequestOptions) =>
      this.request<{ data: CardLifecycleEvent[] }>('GET', `/api/v1/cards/${encodeURIComponent(id)}/lifecycle`, undefined, options),
    transition: (id: string, input: TransitionCardInput, options?: RequestOptions) =>
      this.post<{ ok: true; event: CardLifecycleEvent; replayed: boolean }>(
        `/api/v1/cards/${encodeURIComponent(id)}/lifecycle`, input, options, true),
    controls: (id: string, options?: RequestOptions) =>
      this.request<{ controls: CardControls | null }>('GET', `/api/v1/cards/${encodeURIComponent(id)}/controls`, undefined, options),
    updateControls: (id: string, input: UpdateCardControlsInput, options?: RequestOptions) =>
      this.patch<{ ok: true; controls: CardControls; replayed: boolean }>(
        `/api/v1/cards/${encodeURIComponent(id)}/controls`, input, options),
  };

  readonly cardPrograms = {
    list: (options?: RequestOptions) => this.request<{ data: CardProgram[] }>('GET', '/api/v1/card-programs', undefined, options),
    retrieve: (id: string, options?: RequestOptions) =>
      this.request<CardProgram>('GET', `/api/v1/card-programs/${encodeURIComponent(id)}`, undefined, options),
    create: (input: CreateCardProgramInput, options?: RequestOptions) =>
      this.post<{ ok: true; program: CardProgram; replayed: boolean }>('/api/v1/card-programs', input, options, true),
  };

  readonly transfers = {
    list: (options?: ListOptions) => this.request<Page<Transaction>>('GET', listPath('/api/v1/transfers', options), undefined, options),
    listAll: (options?: ListOptions) => this.iterate((page) => this.transfers.list({ ...options, cursor: page })),
    retrieve: (id: string, options?: RequestOptions) => this.request<Transaction>('GET', `/api/v1/transfers/${encodeURIComponent(id)}`, undefined, options),
    create: (input: CreateTransferInput, options?: RequestOptions) =>
      this.post<TransferCreationResult>('/api/v1/transfers', input, options, true),
    reverse: (id: string, options?: RequestOptions) =>
      this.post<{ ok: true; transaction: Transaction; replayed: boolean }>(`/api/v1/transfers/${encodeURIComponent(id)}/reverse`, undefined, options, true),
  };

  readonly ledger = {
    retrieve: (options?: RequestOptions) =>
      this.request<{ data: { balances: LedgerBalance[]; journals: LedgerJournal[]; holds: Hold[] } }>('GET', '/api/v1/ledger', undefined, options),
  };

  readonly payments = {
    create: (input: CreatePaymentInput, options?: RequestOptions) =>
      this.post<{ ok: true; payment: Transaction; replayed: boolean }>('/api/v1/payments', input, options, true),
    retrieve: (id: string, options?: RequestOptions) => this.request<Transaction>('GET', `/api/v1/payments/${encodeURIComponent(id)}`, undefined, options),
  };

  readonly capabilities = {
    list: (options?: RequestOptions) => this.request<{
      data: PlatformCapability[];
      meta: { owner: 'Cimbra'; strategy: 'build_native'; competitorDependency: false; networkBoundary: 'direct_regulated_rails_only' };
    }>('GET', '/api/v1/capabilities', undefined, options),
  };

  readonly risk = {
    state: (options?: RequestOptions) => this.request<{ data: { systemPolicies: Array<{ id: string; name: string; action: string; status: string }>; rules: RiskRule[]; listEntries: RiskListEntry[]; stepUpChallenges: RiskStepUpChallenge[]; evaluations: RiskEvaluation[]; cases: RiskCase[]; simulations: RiskSimulation[]; metrics: RiskMetrics } }>('GET', '/api/v1/risk', undefined, options),
    evaluate: (input: CreateRiskEvaluationInput, options?: RequestOptions) =>
      this.post<{ ok: true; evaluation: RiskEvaluation; replayed: boolean }>('/api/v1/risk/evaluations', input, options, true),
    createRule: (input: CreateRiskRuleInput, options?: RequestOptions) =>
      this.post<{ ok: true; rule: RiskRule; replayed: boolean }>('/api/v1/risk/rules', input, options, true),
    createRuleVersion: (id: string, input: CreateRiskRuleInput, options?: RequestOptions) =>
      this.post<{ ok: true; rule: RiskRule; replayed: boolean }>(`/api/v1/risk/rules/${encodeURIComponent(id)}/versions`, input, options, true),
    simulate: (input: CreateRiskSimulationInput, options?: RequestOptions) =>
      this.post<{ ok: true; simulation: RiskSimulation; replayed: boolean }>('/api/v1/risk/simulations', input, options, true),
    promoteRule: (id: string, options?: RequestOptions) =>
      this.post<{ ok: true; promotion: { id: string; ruleId: string; previousChampionId: string | null; familyId: string; version: number; createdAt: string }; replayed: boolean }>(
        `/api/v1/risk/rules/${encodeURIComponent(id)}/promote`, {}, options, true),
    disableRule: (id: string, options?: RequestOptions) =>
      this.request<{ ok: true }>('DELETE', `/api/v1/risk/rules/${encodeURIComponent(id)}`, undefined, options),
    createListEntry: (input: CreateRiskListEntryInput, options?: RequestOptions) =>
      this.post<{ ok: true; entry: RiskListEntry; replayed: boolean }>('/api/v1/risk/lists', input, options, true),
    disableListEntry: (id: string, options?: RequestOptions) =>
      this.request<{ ok: true; id: string; status: 'disabled' }>('DELETE', `/api/v1/risk/lists/${encodeURIComponent(id)}`, undefined, options),
    reportOutcome: (evaluationId: string, input: ReportRiskOutcomeInput, options?: RequestOptions) =>
      this.post<{ ok: true; outcome: RiskOutcome; replayed: boolean }>(
        `/api/v1/risk/evaluations/${encodeURIComponent(evaluationId)}/outcomes`, input, options, true),
    listStepUpChallenges: (evaluationId: string, options?: RequestOptions) =>
      this.request<{ data: RiskStepUpChallenge[] }>('GET',
        `/api/v1/risk/evaluations/${encodeURIComponent(evaluationId)}/step-up-challenges`, undefined, options),
    createStepUpChallenge: (evaluationId: string, input: CreateRiskStepUpChallengeInput = {}, options?: RequestOptions) =>
      this.post<{ ok: true; challenge: RiskStepUpChallenge; credential: string | null; replayed: boolean }>(
        `/api/v1/risk/evaluations/${encodeURIComponent(evaluationId)}/step-up-challenges`, input, options, true),
    verifyStepUpChallenge: (evaluationId: string, challengeId: string, input: VerifyRiskStepUpChallengeInput, options?: RequestOptions) =>
      this.post<{ ok: true; challenge: RiskStepUpChallenge; attempt: RiskStepUpAttempt; verified: boolean; replayed: boolean }>(
        `/api/v1/risk/evaluations/${encodeURIComponent(evaluationId)}/step-up-challenges/${encodeURIComponent(challengeId)}/verify`, input, options, true),
    resolveCase: (id: string, input: { resolution: 'approved' | 'declined'; note: string }, options?: RequestOptions) =>
      this.post<RiskCaseResolutionResult>(`/api/v1/risk/cases/${encodeURIComponent(id)}/resolve`, input, options, true),
  };

  readonly reconciliation = {
    state: (options?: RequestOptions) => this.request<{ data: { runs: ReconciliationRun[]; exceptions: ReconciliationException[] } }>('GET', '/api/v1/reconciliation', undefined, options),
    createRun: (input: CreateReconciliationRunInput, options?: RequestOptions) =>
      this.post<{ ok: true; run: ReconciliationRun; replayed: boolean }>('/api/v1/reconciliation/runs', input, options, true),
    importCsv: (input: CreateReconciliationCsvImportInput, options?: RequestOptions) => {
      const form = new FormData();
      form.set('name', input.name); form.set('source', input.source); form.set('currency', input.currency);
      form.set('periodStart', input.periodStart); form.set('periodEnd', input.periodEnd);
      form.set('file', new Blob([input.csv], { type: 'text/csv' }), input.fileName ?? 'reconciliation.csv');
      return this.postForm<{ ok: true; run: ReconciliationRun; replayed: boolean; import: { fileName: string; fileSha256: string; rowCount: number } }>(
        '/api/v1/reconciliation/imports', form, options, true);
    },
    retrieveRun: (id: string, options?: RequestOptions) =>
      this.request<ReconciliationRun & { items: Array<Record<string, unknown>> }>('GET', `/api/v1/reconciliation/runs/${encodeURIComponent(id)}`, undefined, options),
    resolveException: (id: string, input: { resolution: 'corrected' | 'accepted'; note: string }, options?: RequestOptions) =>
      this.post<ReconciliationExceptionResolutionResult>(`/api/v1/reconciliation/exceptions/${encodeURIComponent(id)}/resolve`, input, options, true),
  };

  readonly billers = {
    list: (options?: RequestOptions) => this.request<{ data: Biller[] }>('GET', '/api/v1/billers', undefined, options),
    retrieve: (id: string, options?: RequestOptions) => this.request<{ data: Biller }>('GET', `/api/v1/billers/${encodeURIComponent(id)}`, undefined, options),
    create: (input: CreateBillerInput, options?: RequestOptions) =>
      this.post<{ ok: true; biller: Biller; replayed: boolean }>('/api/v1/billers', input, options, true),
    setStatus: (id: string, action: 'activate' | 'suspend', options?: RequestOptions) =>
      this.post<{ ok: true; biller: Biller; replayed: boolean }>(`/api/v1/billers/${encodeURIComponent(id)}/status`, { action }, options, true),
    listObligations: (id: string, subscriberReference?: string, options?: RequestOptions) => this.request<{ data: BillerObligation[] }>('GET',
      `/api/v1/billers/${encodeURIComponent(id)}/obligations${subscriberReference ? `?subscriberReference=${encodeURIComponent(subscriberReference)}` : ''}`, undefined, options),
    createObligation: (id: string, input: CreateBillerObligationInput, options?: RequestOptions) =>
      this.post<{ ok: true; obligation: BillerObligation; replayed: boolean }>(`/api/v1/billers/${encodeURIComponent(id)}/obligations`, input, options, true),
  };

  readonly billPayments = {
    list: (options?: RequestOptions) => this.request<{ data: BillPaymentOrder[] }>('GET', '/api/v1/bill-payments', undefined, options),
    retrieve: (id: string, options?: RequestOptions) => this.request<{ data: BillPaymentOrder }>('GET', `/api/v1/bill-payments/${encodeURIComponent(id)}`, undefined, options),
    create: (input: CreateBillPaymentInput, options?: RequestOptions) =>
      this.post<{ ok: true; order: BillPaymentOrder; replayed: boolean }>('/api/v1/bill-payments', input, options, true),
    reverse: (id: string, options?: RequestOptions) =>
      this.post<{ ok: true; order: BillPaymentOrder; replayed: boolean }>(`/api/v1/bill-payments/${encodeURIComponent(id)}/reverse`, undefined, options, true),
  };

  readonly recurringMandates = {
    list: (options?: RequestOptions) => this.request<{ data: RecurringPaymentMandate[] }>('GET', '/api/v1/recurring-mandates', undefined, options),
    retrieve: (id: string, options?: RequestOptions) => this.request<{ data: RecurringPaymentMandate }>('GET', `/api/v1/recurring-mandates/${encodeURIComponent(id)}`, undefined, options),
    create: (input: CreateRecurringPaymentMandateInput, options?: RequestOptions) =>
      this.post<{ ok: true; mandate: RecurringPaymentMandate; replayed: boolean }>('/api/v1/recurring-mandates', input, options, true),
    pause: (id: string, options?: RequestOptions) => this.post<{ ok: true; mandate: RecurringPaymentMandate; replayed: boolean }>(
      `/api/v1/recurring-mandates/${encodeURIComponent(id)}/status`, { action: 'pause' }, options, true),
    resume: (id: string, options?: RequestOptions) => this.post<{ ok: true; mandate: RecurringPaymentMandate; replayed: boolean }>(
      `/api/v1/recurring-mandates/${encodeURIComponent(id)}/status`, { action: 'resume' }, options, true),
    cancel: (id: string, options?: RequestOptions) => this.post<{ ok: true; mandate: RecurringPaymentMandate; replayed: boolean }>(
      `/api/v1/recurring-mandates/${encodeURIComponent(id)}/status`, { action: 'cancel' }, options, true),
  };

  readonly disputes = {
    list: (options?: RequestOptions) => this.request<{ data: { disputes: Dispute[]; eligibleTransactions: Array<Dispute['originalTransaction'] & { disputableAmountMinor: string; disputableAmount: number }> } }>(
      'GET', '/api/v1/disputes', undefined, options),
    retrieve: (id: string, options?: RequestOptions) => this.request<{ data: { dispute: Dispute; events: DisputeTimelineEvent[] } }>(
      'GET', `/api/v1/disputes/${encodeURIComponent(id)}`, undefined, options),
    create: (input: CreateDisputeInput, options?: RequestOptions) =>
      this.post<{ ok: true; dispute: Dispute; replayed: boolean }>('/api/v1/disputes', input, options, true),
    transition: (id: string, input: { event: DisputeEventName; note: string }, options?: RequestOptions) =>
      this.post<DisputeTransitionResult>(`/api/v1/disputes/${encodeURIComponent(id)}/events`, input, options, true),
  };

  readonly operations = {
    list: (options?: RequestOptions) => this.request<{ data: OperationalState }>('GET', '/api/v1/operations/work-items', undefined, options),
    update: (type: WorkItemType, id: string, input: UpdateOperationalWorkItemInput, options?: RequestOptions) =>
      this.patch<{ ok: true; workItem: OperationalWorkItem; replayed: boolean }>(
        `/api/v1/operations/work-items/${operationalPath(type)}/${encodeURIComponent(id)}`, input, options),
    addNote: (type: WorkItemType, id: string, body: string, options?: RequestOptions) =>
      this.post<{ ok: true; note: OperationalNote; replayed: boolean }>(
        `/api/v1/operations/work-items/${operationalPath(type)}/${encodeURIComponent(id)}/notes`, { body }, options, true),
    linkEvidence: (type: WorkItemType, id: string, documentId: string, options?: RequestOptions) =>
      this.post<{ ok: true; evidence: OperationalEvidence; replayed: boolean }>(
        `/api/v1/operations/work-items/${operationalPath(type)}/${encodeURIComponent(id)}/evidence`, { documentId }, options, true),
  };

  readonly settlements = {
    list: (options?: RequestOptions) => this.request<{ data: SettlementCycle[] }>('GET', '/api/v1/settlements', undefined, options),
    create: (input: CreateSettlementCycleInput, options?: RequestOptions) =>
      this.post<{ ok: true; cycle: SettlementCycle; replayed: boolean }>('/api/v1/settlements', input, options, true),
    retrieve: (id: string, options?: RequestOptions) =>
      this.request<SettlementCycle>('GET', `/api/v1/settlements/${encodeURIComponent(id)}`, undefined, options),
    execute: (id: string, options?: RequestOptions) =>
      this.post<SettlementExecutionResult>(`/api/v1/settlements/${encodeURIComponent(id)}/execute`, undefined, options, true),
  };

  readonly approvals = {
    list: (options?: RequestOptions) => this.request<{ data: ApprovalRequest[] }>('GET', '/api/v1/approvals', undefined, options),
    retrieve: (id: string, options?: RequestOptions) =>
      this.request<ApprovalRequest>('GET', `/api/v1/approvals/${encodeURIComponent(id)}`, undefined, options),
  };

  readonly holds = {
    capture: (id: string, options?: RequestOptions) =>
      this.post<{ ok: true; hold: HoldResolution }>(`/api/v1/holds/${encodeURIComponent(id)}/capture`, undefined, options, true),
    release: (id: string, options?: RequestOptions) =>
      this.post<{ ok: true; hold: HoldResolution }>(`/api/v1/holds/${encodeURIComponent(id)}/release`, undefined, options, true),
  };

  readonly events = {
    list: (options?: ListOptions) => this.request<Page<AuditEvent>>('GET', listPath('/api/v1/events', options), undefined, options),
    listAll: (options?: ListOptions) => this.iterate((page) => this.events.list({ ...options, cursor: page })),
  };

  readonly webhooks = {
    list: (options?: RequestOptions) => this.request<{ data: WebhookOperationalState }>('GET', '/api/v1/webhooks', undefined, options),
    create: (input: CreateWebhookInput, options?: RequestOptions) =>
      this.post<{ ok: true; endpoint: WebhookOperationalState['endpoints'][number]; secret: string }>('/api/v1/webhooks', input, options, false),
    disable: (id: string, options?: RequestOptions) =>
      this.request<{ ok: true }>('DELETE', `/api/v1/webhooks/${encodeURIComponent(id)}`, undefined, options),
    rotateSecret: (id: string, options?: RequestOptions) =>
      this.post<{ ok: true; secret: string; secretRotatedAt: string }>(`/api/v1/webhooks/${encodeURIComponent(id)}/rotate`, undefined, options, false),
    replayDelivery: (id: string, options?: RequestOptions) =>
      this.post<{ ok: true }>(`/api/v1/webhooks/deliveries/${encodeURIComponent(id)}/replay`, undefined, options, false),
  };

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetcher: Fetch;
  private readonly sleep: Sleep;

  constructor(config: CimbraConfig) {
    if (!config.apiKey?.trim()) throw new CimbraConnectionError('apiKey es requerido.');
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? 'https://cimbra-rose.vercel.app').replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.maxRetries = Math.max(0, Math.min(config.maxRetries ?? 2, 5));
    this.fetcher = config.fetch ?? globalThis.fetch;
    this.sleep = config.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  private async *iterate<T>(fetchPage: (cursor?: string) => Promise<CimbraResult<Page<T>>>) {
    let cursor: string | undefined;
    do {
      const result = await fetchPage(cursor);
      for (const item of result.data.data) yield item;
      cursor = result.data.hasMore ? result.data.nextCursor ?? undefined : undefined;
    } while (cursor);
  }

  private post<T>(path: string, body: unknown, options: RequestOptions | undefined, retryable: boolean) {
    const idempotencyKey = retryable ? options?.idempotencyKey ?? identifier('idem') : options?.idempotencyKey;
    return this.request<T>('POST', path, body, { ...options, idempotencyKey });
  }

  private patch<T>(path: string, body: unknown, options?: RequestOptions) {
    const idempotencyKey = options?.idempotencyKey ?? identifier('idem');
    return this.request<T>('PATCH', path, body, { ...options, idempotencyKey });
  }

  private postForm<T>(path: string, body: FormData, options: RequestOptions | undefined, retryable: boolean) {
    const idempotencyKey = retryable ? options?.idempotencyKey ?? identifier('idem') : options?.idempotencyKey;
    return this.request<T>('POST', path, body, { ...options, idempotencyKey });
  }

  private async request<T>(method: Method, path: string, body?: unknown, options: RequestOptions = {}): Promise<CimbraResult<T>> {
    const requestId = options.requestId ?? identifier('req');
    const retryable = method === 'GET' || Boolean(options.idempotencyKey);
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (options.signal?.aborted) throw new CimbraConnectionError('La solicitud fue cancelada.', options.signal.reason);
      const controller = new AbortController();
      const onAbort = () => controller.abort(options.signal?.reason);
      options.signal?.addEventListener('abort', onAbort, { once: true });
      const timeout = setTimeout(() => controller.abort(new Error('cimbra_timeout')), this.timeoutMs);
      let response: Response | null = null;
      try {
        const multipart = body instanceof FormData;
        const headers = new Headers({
          Accept: 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'X-Request-Id': requestId,
          'X-Cimbra-SDK': 'typescript/0.1.0',
        });
        if (!multipart) headers.set('Content-Type', 'application/json');
        if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);
        response = await this.fetcher(`${this.baseUrl}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
          signal: controller.signal,
        });
        if (response.ok) {
          const payload = await response.json() as T;
          return { data: payload, requestId: response.headers.get('x-request-id') ?? requestId };
        }
        const error = await this.apiError(response, requestId);
        if (!retryable || !shouldRetryResponse(response) || attempt === this.maxRetries) throw error;
        lastError = error;
      } catch (error) {
        if (error instanceof CimbraApiError) {
          if (!retryable || !response || !shouldRetryResponse(response) || attempt === this.maxRetries) throw error;
          lastError = error;
        } else {
          if (options.signal?.aborted) throw new CimbraConnectionError('La solicitud fue cancelada.', error);
          const timedOut = controller.signal.aborted;
          const connectionError = timedOut
            ? new CimbraTimeoutError(`La solicitud superó ${this.timeoutMs} ms.`, error)
            : new CimbraConnectionError('No se pudo conectar con la API de Cimbra.', error);
          if (!retryable || attempt === this.maxRetries) throw connectionError;
          lastError = connectionError;
        }
      } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener('abort', onAbort);
      }
      await this.sleep(retryDelay(response, attempt));
    }
    throw lastError instanceof Error ? lastError : new CimbraConnectionError('No se pudo completar la solicitud.');
  }

  private async apiError(response: Response, fallbackRequestId: string) {
    const body = await response.json().catch(() => null) as {
      error?: { type?: string; code?: string; message?: string; requestId?: string } | string;
      code?: string;
    } | null;
    const structured = body?.error && typeof body.error === 'object' ? body.error : null;
    const message = structured?.message ?? (typeof body?.error === 'string' ? body.error : `La API respondió HTTP ${response.status}.`);
    const requestId = structured?.requestId ?? response.headers.get('x-request-id') ?? fallbackRequestId;
    const retryAfter = Number(response.headers.get('retry-after'));
    return new CimbraApiError(
      message,
      response.status,
      structured?.code ?? body?.code ?? 'api_error',
      structured?.type ?? 'cimbra_api_error',
      requestId,
      Number.isFinite(retryAfter) ? retryAfter : null,
    );
  }
}
