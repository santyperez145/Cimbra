import { CimbraApiError, CimbraConnectionError, CimbraTimeoutError } from './errors.ts';
import type {
  Account, AuditEvent, Card, CimbraResult, CreateAccountInput, CreateCardInput, CreateCustomerInput, CreatePaymentInput,
  CreateTransferInput, CreateWebhookInput, Customer, Hold, HoldResolution, LedgerBalance, LedgerJournal,
  ListOptions, Page, RequestOptions, Transaction, WebhookOperationalState,
} from './types.ts';

type Fetch = typeof globalThis.fetch;
type Method = 'GET' | 'POST' | 'DELETE';
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

export class Cimbra {
  readonly customers = {
    list: (options?: ListOptions) => this.request<Page<Customer>>('GET', listPath('/api/v1/customers', options), undefined, options),
    listAll: (options?: ListOptions) => this.iterate((page) => this.customers.list({ ...options, cursor: page })),
    retrieve: (id: string, options?: RequestOptions) => this.request<Customer>('GET', `/api/v1/customers/${encodeURIComponent(id)}`, undefined, options),
    create: (input: CreateCustomerInput, options?: RequestOptions) =>
      this.post<{ ok: true; customer: Customer; replayed: boolean }>('/api/v1/customers', input, options, true),
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
  };

  readonly transfers = {
    list: (options?: ListOptions) => this.request<Page<Transaction>>('GET', listPath('/api/v1/transfers', options), undefined, options),
    listAll: (options?: ListOptions) => this.iterate((page) => this.transfers.list({ ...options, cursor: page })),
    retrieve: (id: string, options?: RequestOptions) => this.request<Transaction>('GET', `/api/v1/transfers/${encodeURIComponent(id)}`, undefined, options),
    create: (input: CreateTransferInput, options?: RequestOptions) =>
      this.post<{ ok: true; transaction: Transaction; replayed: boolean }>('/api/v1/transfers', input, options, true),
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

  readonly holds = {
    capture: (id: string, options?: RequestOptions) =>
      this.post<{ ok: true; hold: HoldResolution }>(`/api/v1/holds/${encodeURIComponent(id)}/capture`, undefined, options, true),
    release: (id: string, options?: RequestOptions) =>
      this.post<{ ok: true; hold: HoldResolution }>(`/api/v1/holds/${encodeURIComponent(id)}/release`, undefined, options, true),
  };

  readonly events = {
    list: (options?: RequestOptions) => this.request<{ data: AuditEvent[] }>('GET', '/api/v1/events', undefined, options),
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
        const headers = new Headers({
          Accept: 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'X-Request-Id': requestId,
          'X-Cimbra-SDK': 'typescript/0.1.0',
        });
        if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);
        response = await this.fetcher(`${this.baseUrl}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
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
