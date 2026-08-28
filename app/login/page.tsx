import { redirect } from 'next/navigation';
import { oauthAvailability, safeReturnTo } from '@/app/lib/auth/config';
import { getCurrentUser } from '@/app/lib/auth/session';
import AuthLayout from '@/app/components/auth-layout';
import LoginForm from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const returnTo = safeReturnTo(typeof params.return_to === 'string' ? params.return_to : undefined);
  if (await getCurrentUser()) redirect(returnTo);
  const error = typeof params.error === 'string' ? params.error : '';
  return <AuthLayout><LoginForm availability={oauthAvailability()} returnTo={returnTo} initialError={error} initialMfa={params.mfa === '1'} /></AuthLayout>;
}
