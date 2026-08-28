export type Currency = 'ARS' | 'MXN' | 'COP' | 'BRL' | 'CLP' | 'PEN' | 'USD';

export type RequestOptions = { idempotencyKey?: string; requestId?: string; signal?: AbortSignal };
export type ListOptions = RequestOptions & { limit?: number; cursor?: string };
export type Page<T> = { data: T[]; hasMore: boolean; nextCursor: string | null };
export type CimbraResult<T> = { data: T; requestId: string };

export type Customer = { id: string; type: 'individual' | 'business'; name: string; country: string; taxIdLast4: string; status: string; createdAt: string };
export type Account = { id: string; customerId: string; currency: Currency; country: string; accountReference: string; balance?: number; balanceMinor?: string; status: string; createdAt: string };
export type Card = { id: string; accountId: string; customerId: string; product: 'debit' | 'credit' | 'prepaid'; format: 'virtual' | 'physical'; last4: string; status: string; createdAt: string };
export type Transaction = { id: string; counterparty: string; description: string; amount: number; amountMinor: string; currency: Currency; status: string; riskScore: number; reversalOf: string | null; createdAt: string };
export type Hold = { id: string; transactionId: string; amountMinor: string; amount: number; currency: Currency; status: string; expiresAt: string | null; createdAt: string; counterparty: string; description: string };
export type LedgerBalance = { currency: Currency; currentMinor: string; heldMinor: string; availableMinor: string; current: number; held: number; available: number };
export type LedgerJournal = { id: string; transactionId: string | null; kind: string; description: string; currency: Currency; status: string; reversalOf: string | null; postedAt: string | null; amountMinor: string; amount: number; postingCount: number };
export type AuditEvent = { id: string; action: string; resourceType: string; resourceId: string; payload: unknown; createdAt: string };
export type WebhookEndpoint = { id: string; name: string; url: string; eventTypes: string[]; status: string; secretRotatedAt: string; createdAt: string; updatedAt: string };
export type WebhookDelivery = { id: string; eventId: string; endpointId: string; eventType: string; status: string; attemptCount: number; nextAttemptAt: string; deliveredAt: string | null; responseStatus: number | null; lastError: string | null };
export type WebhookDeliveryAttempt = { id: string; deliveryId: string; attemptNumber: number; status: string; responseStatus: number | null; responseExcerpt: string | null; error: string | null; startedAt: string; completedAt: string };
export type WebhookOperationalState = { endpoints: WebhookEndpoint[]; deliveries: WebhookDelivery[]; attempts: WebhookDeliveryAttempt[] };
export type HoldResolution = { id: string; status: string; replayed: boolean };
export type WebhookEvent<T = unknown> = { id: string; type: string; createdAt: string; data: T };
export type CreateResult<T> = { ok: true; replayed: boolean; customer?: T; account?: T; card?: T };

export type CreateCustomerInput = { type?: 'individual' | 'business'; name: string; country: string; taxId: string };
export type CreateAccountInput = { customerId: string; currency: Currency; country: string };
export type CreateCardInput = { accountId: string; product?: Card['product']; format?: Card['format'] };
export type CreateTransferInput = { counterparty: string; description: string; amount: string; currency?: Currency };
export type CreatePaymentInput = { accountId: string; direction: 'cash_in' | 'cash_out'; counterparty: string; description: string; amount: string; currency: Currency };
export type CreateWebhookInput = { name: string; url: string; eventTypes: string[] };
