import { finishOAuth } from '@/app/lib/auth/oauth';

export async function POST(request: Request) {
  const form = await request.formData();
  return finishOAuth('apple', request, {
    code: typeof form.get('code') === 'string' ? String(form.get('code')) : undefined,
    state: typeof form.get('state') === 'string' ? String(form.get('state')) : undefined,
    error: typeof form.get('error') === 'string' ? String(form.get('error')) : undefined,
    user: typeof form.get('user') === 'string' ? String(form.get('user')) : undefined,
  });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return finishOAuth('apple', request, {
    code: params.get('code') ?? undefined,
    state: params.get('state') ?? undefined,
    error: params.get('error') ?? undefined,
  });
}
