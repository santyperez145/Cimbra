import AuthLayout from '@/app/components/auth-layout';
import ResetPasswordForm from './reset-password-form';

export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const token = typeof params.token === 'string' ? params.token : '';
  return <AuthLayout><ResetPasswordForm token={token} /></AuthLayout>;
}
