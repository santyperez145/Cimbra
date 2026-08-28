import { requireUser } from '@/app/lib/auth/session';
import { getDashboardData } from '@/db/runtime';
import ConsoleClient from './console-client';

export const dynamic = 'force-dynamic';

export default async function ConsolePage() {
  const user = await requireUser('/console');
  const data = await getDashboardData(user);
  return <ConsoleClient data={data} user={{ displayName: user.displayName, email: user.email }} />;
}
