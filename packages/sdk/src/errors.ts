export class CimbraError extends Error {
  override readonly name: string = 'CimbraError';
}

export class CimbraApiError extends CimbraError {
  override readonly name: string = 'CimbraApiError';
  readonly status: number;
  readonly code: string;
  readonly type: string;
  readonly requestId: string;
  readonly retryAfter: number | null;

  constructor(
    message: string,
    status: number,
    code: string,
    type: string,
    requestId: string,
    retryAfter: number | null = null,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.type = type;
    this.requestId = requestId;
    this.retryAfter = retryAfter;
  }
}

export class CimbraConnectionError extends CimbraError {
  override readonly name: string = 'CimbraConnectionError';
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

export class CimbraTimeoutError extends CimbraConnectionError {
  override readonly name: string = 'CimbraTimeoutError';
}

export class CimbraWebhookSignatureError extends CimbraError {
  override readonly name: string = 'CimbraWebhookSignatureError';
}
