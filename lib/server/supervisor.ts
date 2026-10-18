import { prisma } from '@/lib/server/prisma';
import { compare } from 'bcryptjs';
import { isRateLimited } from '@/lib/server/rate-limit';

// Shared supervisor-password gate for destructive actions (void, customer
// delete). Throttled per supervisor username — without this the admin password
// is brute-forceable through these endpoints even though login is throttled.
export async function verifySupervisor(
  adminUsername: unknown,
  adminPassword: unknown
): Promise<{ ok: true; adminId: number } | { ok: false; error: string; status: 403 | 429 }> {
  if (typeof adminUsername !== 'string' || !adminUsername.trim() || typeof adminPassword !== 'string' || !adminPassword) {
    return { ok: false, error: 'Supervisor authorization required.', status: 403 };
  }
  const username = adminUsername.trim();
  if (isRateLimited(`supervisor:${username.toLowerCase()}`, 5, 10 * 60 * 1000)) {
    return { ok: false, error: 'Too many supervisor attempts. Please try again later.', status: 429 };
  }
  const adminUser = await prisma.user.findUnique({ where: { username } });
  if (!adminUser || adminUser.status !== 'active' || adminUser.role !== 'admin') {
    return { ok: false, error: 'Invalid supervisor credentials.', status: 403 };
  }
  const isValid = await compare(adminPassword, adminUser.passwordHash);
  if (!isValid) {
    return { ok: false, error: 'Invalid supervisor password.', status: 403 };
  }
  return { ok: true, adminId: adminUser.id };
}
