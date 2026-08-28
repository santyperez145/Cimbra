type RouteResult = Response | Promise<Response>;

function errorCode(status: number) {
  if (status === 400) return 'invalid_request';
  if (status === 401) return 'authentication_required';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 422) return 'unprocessable_entity';
  if (status === 429) return 'rate_limit_exceeded';
  return status >= 500 ? 'internal_error' : 'api_error';
}

function versionHeaders(response: Response, requestId: string) {
  response.headers.set('X-Request-Id', requestId);
  response.headers.set('Cimbra-Version', '2026-08-28');
  response.headers.set('Cache-Control', response.headers.get('Cache-Control') ?? 'no-store');
  if (response.status === 408 || response.status === 429 || response.status >= 500) response.headers.set('Cimbra-Should-Retry', 'true');
  else if (response.status >= 400) response.headers.set('Cimbra-Should-Retry', 'false');
  return response;
}

async function replayHeader(response: Response) {
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return response;
  const body = await response.clone().json().catch(() => null) as { replayed?: unknown; hold?: { replayed?: unknown } } | null;
  if (body?.replayed === true || body?.hold?.replayed === true) response.headers.set('Idempotent-Replayed', 'true');
  return response;
}

export async function versionedApi(request: Request, handler: () => RouteResult) {
  const requestId = request.headers.get('x-cimbra-request-id') ?? request.headers.get('x-request-id') ?? `req_${crypto.randomUUID().replaceAll('-', '')}`;
  try {
    const response = await handler();
    if (response.status < 400 || !response.headers.get('content-type')?.includes('application/json')) {
      return versionHeaders(await replayHeader(response), requestId);
    }
    const body = await response.json().catch(() => null) as { error?: unknown; code?: unknown } | null;
    const message = typeof body?.error === 'string' ? body.error : 'La solicitud no pudo completarse.';
    const code = typeof body?.code === 'string' ? body.code : errorCode(response.status);
    const headers = new Headers(response.headers);
    headers.set('X-Request-Id', requestId);
    headers.set('Cimbra-Version', '2026-08-28');
    headers.set('Cache-Control', 'no-store');
    return versionHeaders(Response.json({ error: { type: 'cimbra_api_error', code, message, requestId } }, { status: response.status, headers }), requestId);
  } catch {
    return versionHeaders(Response.json({
      error: { type: 'cimbra_api_error', code: 'internal_error', message: 'Ocurrió un error interno.', requestId },
    }, { status: 500, headers: { 'X-Request-Id': requestId, 'Cimbra-Version': '2026-08-28', 'Cache-Control': 'no-store' } }), requestId);
  }
}
