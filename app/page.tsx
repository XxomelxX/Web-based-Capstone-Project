import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/server/auth';

export default async function Home() {
  const session = await getServerSession(authOptions);
  redirect(session?.user ? '/dashboard' : '/login');
}
