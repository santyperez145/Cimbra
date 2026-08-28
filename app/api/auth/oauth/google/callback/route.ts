import { finishOAuth } from '@/app/lib/auth/oauth';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return finishOAuth('google', request, {
    code: params.get('code') ?? undefined,
    state: params.get('state') ?? undefined,
    error: params.get('error') ?? undefined,
  });
}
