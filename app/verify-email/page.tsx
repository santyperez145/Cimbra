import AuthLayout from '@/app/components/auth-layout';
import VerifyEmailForm from './verify-email-form';

export const dynamic = 'force-dynamic';

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return <AuthLayout><VerifyEmailForm token={typeof params.token === 'string' ? params.token : ''} sent={params.sent === '1'} returnTo={typeof params.return_to === 'string' ? params.return_to : '/console'} /></AuthLayout>;
}
