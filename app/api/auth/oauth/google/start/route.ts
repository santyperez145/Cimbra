import { startOAuth } from '@/app/lib/auth/oauth';

export async function GET(request: Request) {
  return startOAuth('google', request);
}
