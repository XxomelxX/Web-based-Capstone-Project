import ReportsClient from './ReportsClient';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/server/auth';
import { redirect } from 'next/navigation';

// Admin-only page: cashiers opening /reports by URL must not see drawer totals.
// The API routes enforce this too (requireAdmin) — this is the friendly gate.
export default async function ReportsPage() {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    redirect('/dashboard');
  }
  return <ReportsClient />;
}
