import { requireUser } from '@/app/lib/auth/session';
import { getDashboardData } from '@/db/runtime';
import { remainingRecoveryCodes } from '@/app/lib/auth/mfa';
import ConsoleClient from './console-client';

export const dynamic = 'force-dynamic';

export default async function ConsolePage() {
  const user = await requireUser('/console');
  const [data, recoveryCodeCount] = await Promise.all([getDashboardData(user), user.mfaEnabled ? remainingRecoveryCodes(user.userId) : Promise.resolve(0)]);
  return <ConsoleClient data={data} user={{ displayName: user.displayName, email: user.email, emailVerified: user.emailVerified, mfaEnabled: user.mfaEnabled, recoveryCodeCount }} />;
}
