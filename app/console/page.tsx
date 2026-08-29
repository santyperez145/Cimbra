import { requireUser } from '@/app/lib/auth/session';
import { getDashboardData } from '@/db/runtime';
import { AccessControlError } from '@/db/access';
import { remainingRecoveryCodes } from '@/app/lib/auth/mfa';
import ConsoleClient from './console-client';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function ConsolePage() {
  const user = await requireUser('/console');
  let data;
  try { data = await getDashboardData(user); }
  catch (error) {
    if (error instanceof AccessControlError && error.code === 'invitation_email_verification_required') redirect('/verify-email?return_to=%2Fconsole');
    throw error;
  }
  const recoveryCodeCount = user.mfaEnabled ? await remainingRecoveryCodes(user.userId) : 0;
  return <ConsoleClient data={data} user={{ displayName: user.displayName, email: user.email, role: data.role, emailVerified: user.emailVerified, mfaEnabled: user.mfaEnabled, recoveryCodeCount }} />;
}
