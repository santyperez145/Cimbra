import { NextResponse, type NextRequest } from 'next/server';

const requestIdPattern = /^[A-Za-z0-9_-]{8,100}$/;

export function proxy(request: NextRequest) {
  const supplied = request.headers.get('x-request-id')?.trim() ?? '';
  const requestId = requestIdPattern.test(supplied) ? supplied : `req_${crypto.randomUUID().replaceAll('-', '')}`;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-request-id', requestId);
  requestHeaders.set('x-cimbra-request-id', requestId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('X-Request-Id', requestId);
  response.headers.set('Cimbra-Version', '2026-08-30');
  if (request.nextUrl.pathname.startsWith('/api/sandbox/')) {
    response.headers.set('Deprecation', 'true');
    response.headers.set('Link', '</api/v1>; rel="successor-version"');
  }
  return response;
}

export const config = { matcher: '/api/:path*' };
